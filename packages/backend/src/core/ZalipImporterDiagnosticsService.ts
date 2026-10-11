/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { budgetedTransport } from './zalip-importer/budget.js';
import { cachedImportSourceCheck, checkImportProvider, resolveImdbImport, type ImportSourceCheck } from './zalip-importer/diagnostics.js';
import { createImportProviders, createConfiguredImportTransport } from './zalip-importer/providers.js';
import type { ImportMediaType, ImportSource } from './zalip-importer/types.js';
import { ZalipImporterSourceSettingsService } from './ZalipImporterSourceSettingsService.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipWork } from '@/models/ZalipWork.js';

@Injectable()
export class ZalipImporterDiagnosticsService {
	constructor(@Inject(DI.redis) private redis: Redis.Redis, @Inject(DI.db) private db: DataSource, private sourceSettings: ZalipImporterSourceSettingsService) {}

	private async snapshot() {
		const config = await this.sourceSettings.getRuntime();
		const limit = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		const providers = createImportProviders(config, budgetedTransport(this.redis, createConfiguredImportTransport(config), config.kinopoiskApiKey, Number.isSafeInteger(limit) && limit > 0 ? limit : 350, config.apiOrigins.kinopoisk));
		// Both address and credential changes invalidate diagnostics; raw secrets never enter Redis.
		return { providers, namespace: createHash('sha256').update(JSON.stringify(config)).digest('hex').slice(0, 20) };
	}

	public async check(source: ImportSource): Promise<ImportSourceCheck> {
		const { providers, namespace } = await this.snapshot();
		const key = `zalip:import:health:${namespace}:${source}`;
		const cached = await this.redis.get(key);
		if (cached) {
			try {
				const result = cachedImportSourceCheck(JSON.parse(cached), source);
				if (result) return result;
			} catch { /* A stale cache is not a failed integration. */ }
		}
		const result = await checkImportProvider(providers[source]);
		await this.redis.set(key, JSON.stringify(result), 'EX', 300);
		return result;
	}

	public async resolve(source: ImportSource, imdbId: string, mediaType: ImportMediaType) {
		return resolveImdbImport((await this.snapshot()).providers[source], imdbId, mediaType);
	}

	/** Aggregates only; recipient identities and private work metadata are never returned. */
	public async statistics() {
		const subscriptions = await this.db.getRepository(MiZalipLibraryEntry).createQueryBuilder('entry')
			.select('COUNT(*)', 'total').addSelect('COUNT(DISTINCT entry."workId")', 'works')
			.where('entry."isReleaseSubscribed" = TRUE').getRawOne<{ total: string; works: string }>();
		const outbox = async (model: typeof MiZalipAllohaAvailabilityEvent | typeof MiZalipReleaseEvent) => {
			const repository = this.db.getRepository(model);
			const pending = await repository.createQueryBuilder('event')
				.innerJoin(MiZalipWork, 'work', 'work.id = event."workId" AND work."publicationState" = :state', { state: 'published' })
				.select('COUNT(*)', 'count').addSelect('MIN(event."createdAt")', 'oldest')
				.where('event."notificationDeliveredAt" IS NULL').getRawOne<{ count: string; oldest: Date | null }>();
			return { total: await repository.count(), pendingPublished: Number(pending?.count ?? 0), oldestPendingAt: pending?.oldest ? new Date(pending.oldest).toISOString() : null };
		};
		return { subscriptions: { total: Number(subscriptions?.total ?? 0), works: Number(subscriptions?.works ?? 0) }, availability: await outbox(MiZalipAllohaAvailabilityEvent), releases: await outbox(MiZalipReleaseEvent) };
	}
}
