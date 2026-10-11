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
import { createImportProviders, defaultImportTransport } from './zalip-importer/providers.js';
import type { ImportMediaType, ImportProvider, ImportSource } from './zalip-importer/types.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipWork } from '@/models/ZalipWork.js';

@Injectable()
export class ZalipImporterDiagnosticsService {
	private providers: Record<ImportSource, ImportProvider>;
	private cacheNamespace: string;

	constructor(@Inject(DI.redis) private redis: Redis.Redis, @Inject(DI.db) private db: DataSource) {
		const keys = {
			tmdbApiKey: process.env.ZALIP_TMDB_API_KEY,
			kinopoiskApiKey: process.env.ZALIP_KINOPOISK_API_KEY,
			allohaApiToken: process.env.ZALIP_ALLOHA_API_TOKEN,
			collapsApiToken: process.env.ZALIP_COLLAPS_API_TOKEN,
		};
		const limit = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		this.providers = createImportProviders(keys, budgetedTransport(this.redis, defaultImportTransport, keys.kinopoiskApiKey, Number.isSafeInteger(limit) && limit > 0 ? limit : 350));
		// A key change invalidates diagnostics without exposing any part of the credential.
		this.cacheNamespace = createHash('sha256').update(JSON.stringify(keys)).digest('hex').slice(0, 20);
	}

	public async check(source: ImportSource): Promise<ImportSourceCheck> {
		const key = `zalip:import:health:${this.cacheNamespace}:${source}`;
		const cached = await this.redis.get(key);
		if (cached) {
			try {
				const result = cachedImportSourceCheck(JSON.parse(cached), source);
				if (result) return result;
			} catch { /* A stale cache is not a failed integration. */ }
		}
		const result = await checkImportProvider(this.providers[source]);
		await this.redis.set(key, JSON.stringify(result), 'EX', 300);
		return result;
	}

	public async resolve(source: ImportSource, imdbId: string, mediaType: ImportMediaType) {
		return resolveImdbImport(this.providers[source], imdbId, mediaType);
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
