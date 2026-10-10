/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, LessThanOrEqual } from 'typeorm';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import type { ZalipImportQueue } from '@/core/QueueModule.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipImportItem, MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { MiZalipImportProfile } from '@/models/ZalipImportProfile.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { applyImportRecord, currentImportFields, findImportWork } from './zalip-importer/apply.js';
import { budgetedTransport } from './zalip-importer/budget.js';
import { canUpdateField, mergeImportRecords, readImportState } from './zalip-importer/policy.js';
import { createImportProviders, defaultImportTransport, ImportProviderError } from './zalip-importer/providers.js';
import { importFields, importSources, type ImportMediaType, type ImportPreview, type ImportProvider, type ImportRecord, type ImportRef, type ImportSource } from './zalip-importer/types.js';

export type CreateImportRun = {
	refs?: ImportRef[];
	workIds?: string[];
	mode: 'import' | 'sync' | 'availability';
	lockedFields?: string[];
	categoryIds?: string[];
	profileId?: string;
};
export type SaveImportProfile = {
	id?: string;
	name: string;
	enabled: boolean;
	source: ImportSource;
	mode: 'metadata' | 'availability' | 'collection';
	intervalMinutes: number;
	collectionId?: string | null;
	lockedFields?: string[];
	categoryIds?: string[];
};

export function safeImportError(error: unknown): string {
	if (error instanceof ImportProviderError) return error.code;
	if (error instanceof Error && ['NO_SUCH_WORK', 'IMPORT_IDENTITY_CONFLICT', 'IMPORT_INVALID_RECORD', 'ZALIP_CATALOG_ENTRY_NOT_FOUND'].includes(error.message)) return error.message;
	return 'import-failed';
}

/** Queue payloads contain IDs only. Tokens and normalized private snapshots never enter job logs. */
@Injectable()
export class ZalipImporterService {
	private providers: Record<ImportSource, ImportProvider>;

	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redis: Redis.Redis,
		@Inject('queue:zalipImport') private queue: ZalipImportQueue,
		private idService: IdService,
		private catalogue: ZalipCatalogService,
		private taxonomy: ZalipTaxonomyService,
	) {
		const kpKey = process.env.ZALIP_KINOPOISK_API_KEY;
		const budget = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		this.providers = createImportProviders({
			tmdbApiKey: process.env.ZALIP_TMDB_API_KEY,
			allohaApiToken: process.env.ZALIP_ALLOHA_API_TOKEN,
			kinopoiskApiKey: kpKey,
			collapsApiToken: process.env.ZALIP_COLLAPS_API_TOKEN,
			allohaIframeHosts: process.env.ZALIP_ALLOHA_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean),
			collapsIframeHosts: process.env.ZALIP_COLLAPS_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean),
		}, budgetedTransport(this.redis, defaultImportTransport, kpKey, Number.isSafeInteger(budget) && budget > 0 ? budget : 350));
	}

	public sources() {
		return { sources: importSources.map(source => this.providers[source].status()) };
	}

	public async search(source: ImportSource, query: string, page = 1, mediaType?: ImportMediaType) {
		return this.providers[source].search(query, page, mediaType);
	}

	private async fetchRecord(ref: ImportRef, availabilityOnly = false) {
		const records = [await this.providers[ref.source].fetch(ref)];
		const visited = new Set<ImportSource>([ref.source]);
		// A second pass permits TMDB discovery from IMDb obtained from Kinopoisk/Collaps.
		for (let pass = 0; pass < 2; pass++) {
			for (const source of importSources) {
				if (visited.has(source) || !this.providers[source].status().configured || (availabilityOnly && source !== 'alloha' && source !== 'collaps')) continue;
				const provider = this.providers[source];
				try {
					const identities = records.flatMap(record => record.identities);
					const extra = await provider.lookup?.(identities, ref.mediaType);
					if (extra) {
						if (extra.ref.mediaType !== ref.mediaType) throw new Error('IMPORT_IDENTITY_CONFLICT');
						// Reject contradictory provider IDs before allowing enrichment to bind them.
						for (const identity of extra.identities) {
							const existing = identities.find(item => item.provider === identity.provider && item.entityType === identity.entityType);
							if (existing && existing.externalId !== identity.externalId) throw new Error('IMPORT_IDENTITY_CONFLICT');
						}
						records.push(extra);
						visited.add(source);
					}
				} catch (error) {
					if (safeImportError(error) === 'IMPORT_IDENTITY_CONFLICT') throw error;
					if (error instanceof ImportProviderError && ['quota-exceeded', 'rate-limited'].includes(error.code)) throw error;
					records[0].warnings.push(`${source}:${safeImportError(error)}`);
					records[0].complete = false;
					visited.add(source);
				}
			}
		}
		return mergeImportRecords(records);
	}

	public async preview(ref: ImportRef, workId?: string): Promise<ImportPreview> {
		const { record } = await this.fetchRecord(ref);
		const work = await findImportWork(this.db, record, workId);
		const state = readImportState(work?.importData);
		const fields = work ? currentImportFields(work) : {};
		return {
			record,
			workId: work?.id ?? null,
			changes: importFields.map(field => ({ field, before: fields[field] ?? null, after: record[field], protected: work != null && !canUpdateField(fields[field], state.values[field], record[field], state.locks.includes(field)) })),
			warnings: record.warnings,
		};
	}

	private async refsForWorks(workIds: string[], source?: ImportSource): Promise<{ ref: ImportRef; workId: string }[]> {
		const works = await this.db.getRepository(MiZalipWork).findBy({ id: In(workIds) });
		if (works.length !== new Set(workIds).size) throw new Error('NO_SUCH_WORK');
		const identities = await this.db.getRepository(MiZalipExternalIdentity).findBy({ workId: In(workIds) });
		return works.map(work => {
			const identity = identities.find(item => item.workId === work.id && importSources.includes(item.provider as ImportSource) && (!source || item.provider === source) && this.providers[item.provider as ImportSource].status().configured);
			if (identity) return { workId: work.id, ref: { source: identity.provider as ImportSource, externalId: identity.externalId, mediaType: identity.entityType } };
			if ((!source || source === 'tmdb') && work.tmdbId && work.tmdbMediaType) return { workId: work.id, ref: { source: 'tmdb' as const, externalId: String(work.tmdbId), mediaType: work.tmdbMediaType } };
			if (source === 'alloha' && work.tmdbId && work.tmdbMediaType) return { workId: work.id, ref: { source: 'alloha' as const, externalId: `tmdb:${work.tmdbMediaType}:${work.tmdbId}`, mediaType: work.tmdbMediaType } };
			throw new ImportProviderError('invalid-ref');
		});
	}

	public async createRun(input: CreateImportRun, actorId?: string, boundTargets?: { ref: ImportRef; workId: string | null }[]) {
		if ((input.refs?.length ?? 0) > 100 || (input.workIds?.length ?? 0) > 100 || (input.refs?.length && input.workIds?.length)) throw new ImportProviderError('invalid-ref');
		const targets = boundTargets ?? (input.workIds?.length ? await this.refsForWorks(input.workIds) : (input.refs ?? []).map(ref => ({ ref, workId: null })));
		if (targets.length === 0 && boundTargets === undefined) throw new ImportProviderError('invalid-ref');
		if (targets.some(item => !this.providers[item.ref.source]?.status().configured)) throw new ImportProviderError('not-configured');
		const categoryIds = [...new Set(input.categoryIds ?? [])];
		if (categoryIds.length && await this.db.getRepository(MiZalipCatalogEntry).countBy({ id: In(categoryIds), type: 'category' }) !== categoryIds.length) throw new Error('ZALIP_CATALOG_ENTRY_NOT_FOUND');
		const now = new Date();
		const run = await this.db.transaction(async manager => {
			const runs = manager.getRepository(MiZalipImportRun);
			const created = await runs.save(runs.create({ id: this.idService.gen(), createdAt: now, updatedAt: now, createdById: actorId ?? null, profileId: input.profileId ?? null, mode: input.mode, state: targets.length ? 'queued' : 'completed', lockedFields: [...new Set(input.lockedFields ?? [])], categoryIds, error: null, retryAt: null }));
			const items = manager.getRepository(MiZalipImportItem);
			if (targets.length) await items.save(targets.map((target, position) => items.create({ id: this.idService.gen(), runId: created.id, position, ref: target.ref, workId: target.workId, state: 'pending', error: null, updatedAt: now })));
			return created;
		});
		if (targets.length) await this.enqueue(run.id);
		return { id: run.id, state: run.state };
	}

	private async enqueue(runId: string) {
		const run = await this.db.getRepository(MiZalipImportRun).findOneBy({ id: runId });
		if (!run || !['queued', 'running'].includes(run.state)) return;
		// A persisted dispatch generation deduplicates scheduler recovery of queued jobs.
		await this.queue.add('import', { runId }, { jobId: `${runId}-${run.state}-${run.updatedAt.getTime()}`, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 50, removeOnFail: 50 });
	}

	private async packRun(run: MiZalipImportRun) {
		const items = await this.db.getRepository(MiZalipImportItem).findBy({ runId: run.id });
		return { id: run.id, state: run.state, mode: run.mode, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), total: items.length, completed: items.filter(item => item.state === 'completed' || item.state === 'skipped').length, failed: items.filter(item => item.state === 'failed').length, error: run.error, profileId: run.profileId };
	}

	public async listRuns() {
		const runs = await this.db.getRepository(MiZalipImportRun).find({ order: { createdAt: 'DESC' }, take: 50 });
		return { runs: await Promise.all(runs.map(run => this.packRun(run))) };
	}

	public async showRun(runId: string) {
		const run = await this.db.getRepository(MiZalipImportRun).findOneBy({ id: runId });
		if (!run) throw new ImportProviderError('not-found');
		const items = await this.db.getRepository(MiZalipImportItem).find({ where: { runId }, order: { position: 'ASC' } });
		return { run: await this.packRun(run), items: items.map(({ id, position, state, ref, workId, error }) => ({ id, position, state, ref, workId, error })) };
	}

	public async actionRun(runId: string, action: 'pause' | 'resume' | 'retry' | 'cancel') {
		const repository = this.db.getRepository(MiZalipImportRun);
		const run = await repository.findOneBy({ id: runId });
		if (!run) throw new ImportProviderError('not-found');
		if (action === 'pause' || action === 'cancel') {
			await repository.update({ id: run.id, state: In(['queued', 'running', 'paused']) }, { state: action === 'pause' ? 'paused' : 'cancelled', retryAt: null, updatedAt: new Date() });
		} else {
			const resumed = await this.db.transaction(async manager => {
				const changed = await manager.getRepository(MiZalipImportRun).update({ id: run.id, state: In(action === 'retry' ? ['paused', 'failed', 'completed'] : ['paused', 'failed']) }, { state: 'queued', error: null, retryAt: null, updatedAt: new Date(Math.max(Date.now(), run.updatedAt.getTime() + 1)) });
				if (!changed.affected) return false;
				await manager.getRepository(MiZalipImportItem).update({ runId, state: In(['failed', 'running']) }, { state: 'pending', error: null });
				return true;
			});
			if (resumed) await this.enqueue(run.id);
		}
		return { id: run.id, state: (await repository.findOneByOrFail({ id: run.id })).state };
	}

	/** A session advisory lock also serializes resumes and stalled jobs across worker processes. */
	public async processRun(runId: string): Promise<void> {
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`zalip-import:${runId}`]) as { locked: boolean }[];
			locked = lock.locked;
			if (!locked) throw new Error('import-busy');
			const runs = this.db.getRepository(MiZalipImportRun);
			const items = this.db.getRepository(MiZalipImportItem);
			const run = await runs.findOneBy({ id: runId });
			if (!run || !['queued', 'running'].includes(run.state)) return;
			const claimed = await runs.update({ id: runId, state: In(['queued', 'running']) }, { state: 'running', updatedAt: new Date() });
			if (!claimed.affected) return;
			await items.update({ runId, state: 'running' }, { state: 'pending' });
			while (true) {
				if ((await runs.findOneBy({ id: runId }))?.state !== 'running') return;
				const item = await items.findOne({ where: { runId, state: 'pending' }, order: { position: 'ASC' } });
				if (!item) break;
				await items.update(item.id, { state: 'running', updatedAt: new Date() });
				try {
					const { record, sources } = await this.fetchRecord(item.ref, run.mode === 'availability');
					if ((await runs.findOneBy({ id: runId }))?.state !== 'running') { await items.update(item.id, { state: 'pending' }); return; }
					const before = await findImportWork(this.db, record, item.workId ?? undefined);
					const establishedAvailability = before != null && readImportState(before.importData).values.players !== undefined;
					const result = await applyImportRecord(this.db, this.idService, record, sources, { workId: item.workId ?? undefined, lockedFields: run.lockedFields, mode: run.mode });
					await items.update(item.id, { workId: result.work.id });
					if (run.mode !== 'availability') await this.taxonomy.syncImportedWork(result.work.id, record, result.protectedFields);
					for (const entryId of run.categoryIds) await this.taxonomy.linkWork({ entryId, workId: result.work.id });
					if (run.profileId) {
						const profile = await this.db.getRepository(MiZalipImportProfile).findOneBy({ id: run.profileId });
						if (profile?.mode === 'collection' && profile.collectionId) {
							const collection = await this.taxonomy.upsertImportedEntry({ type: 'collection', name: profile.name, externalIds: { [profile.source]: profile.collectionId }, data: { collectionKind: 'provider' } }, profile.source);
							await this.taxonomy.linkWork({ entryId: collection.id, workId: result.work.id }, `profile-${profile.id.slice(-20)}`);
						}
					}
					await this.recordAvailability(result.work, result.created || !establishedAvailability);
					await items.update(item.id, { state: 'completed', error: null, updatedAt: new Date() });
				} catch (error) {
					const code = safeImportError(error);
					if (code === 'quota-exceeded' || code === 'rate-limited') {
						await items.update(item.id, { state: 'pending', error: code });
						await runs.update({ id: runId, state: 'running' }, { state: 'paused', error: code, retryAt: new Date(Date.now() + (error instanceof ImportProviderError ? error.retryAfterMs ?? 3600000 : 3600000)), updatedAt: new Date() });
						return;
					}
					await items.update(item.id, { state: 'failed', error: code, updatedAt: new Date() });
				}
				await runs.update({ id: runId, state: 'running' }, { updatedAt: new Date() });
			}
			const failed = await items.countBy({ runId, state: 'failed' });
			await runs.update({ id: runId, state: 'running' }, { state: failed > 0 ? 'failed' : 'completed', error: failed > 0 ? 'some-items-failed' : null, updatedAt: new Date() });
			await this.catalogue.dispatchPendingAllohaAvailabilityNotifications();
		} finally {
			try {
				if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [`zalip-import:${runId}`]);
			} finally {
				await connection.release();
			}
		}
	}

	private async recordAvailability(work: MiZalipWork, suppress: boolean) {
		const stored = readImportState(work.importData).values.players;
		for (const player of Array.isArray(stored) ? stored as ImportRecord['players'] : []) {
			const episodes = work.kind === 'movie' || work.tmdbMediaType === 'movie' ? [{ seasonNumber: null, episodeNumber: null }] : player.episodes;
			for (const episode of episodes) await this.catalogue.recordAllohaAvailability({ workId: work.id, ...episode, translationCount: player.translations.length, suppressNotification: suppress || work.publicationState !== 'published' });
		}
	}

	public async playback(workId: string) {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId, publicationState: 'published' });
		if (!work) throw new Error('NO_SUCH_WORK');
		const stored = readImportState(work.importData).values.players;
		const players = Array.isArray(stored) ? stored as ImportRecord['players'] : [];
		return { sources: players.map(player => ({ source: player.source, iframe: player.iframeUrl, translations: player.translations, quality: player.quality, episodes: player.episodes })) };
	}

	private packProfile(profile: MiZalipImportProfile) {
		return { ...profile, lastRunAt: profile.lastRunAt?.toISOString() ?? null, nextRunAt: profile.nextRunAt?.toISOString() ?? null };
	}

	public async listProfiles() {
		return { profiles: (await this.db.getRepository(MiZalipImportProfile).find({ order: { name: 'ASC' }, take: 100 })).map(profile => this.packProfile(profile)) };
	}

	public async saveProfile(input: SaveImportProfile) {
		if (!importSources.includes(input.source) || input.intervalMinutes < 15 || input.intervalMinutes > 43200 || (input.mode === 'collection' && !input.collectionId)) throw new ImportProviderError('invalid-ref');
		if (input.mode === 'collection' && !this.providers[input.source].status().capabilities.collections) throw new ImportProviderError('unsupported');
		const repository = this.db.getRepository(MiZalipImportProfile);
		const existing = input.id ? await repository.findOneBy({ id: input.id }) : null;
		if (input.id && !existing) throw new ImportProviderError('not-found');
		const profile = repository.create({ ...existing, ...input, id: existing?.id ?? this.idService.gen(), collectionId: input.collectionId ?? null, lockedFields: input.lockedFields ?? [], categoryIds: input.categoryIds ?? [], lastRunAt: existing?.lastRunAt ?? null, nextRunAt: input.enabled ? new Date(Date.now() + input.intervalMinutes * 60000) : null, lastError: existing?.lastError ?? null, cursor: existing?.cursor ?? 0 });
		return this.packProfile(await repository.save(profile));
	}

	public async runProfile(profileId: string) {
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [result] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`zalip-import-profile:${profileId}`]) as { locked: boolean }[];
			locked = result.locked;
			if (!locked) throw new ImportProviderError('rate-limited');
			return await this.dispatchProfile(profileId);
		} finally {
			try {
				if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [`zalip-import-profile:${profileId}`]);
			} finally {
				await connection.release();
			}
		}
	}

	private async dispatchProfile(profileId: string) {
		const profiles = this.db.getRepository(MiZalipImportProfile);
		const profile = await profiles.findOneBy({ id: profileId });
		if (!profile) throw new ImportProviderError('not-found');
		if (await this.db.getRepository(MiZalipImportRun).existsBy({ profileId, state: In(['queued', 'running', 'paused']) })) throw new ImportProviderError('rate-limited');
		try {
			let targets: { ref: ImportRef; workId: string | null }[];
			if (profile.mode === 'collection') {
				const page = await this.providers[profile.source].collection?.(profile.collectionId!, profile.cursor + 1);
				if (!page) throw new ImportProviderError('unsupported');
				targets = page.items.slice(0, 100).map(item => ({ ref: item.ref, workId: null }));
				profile.cursor = page.hasMore ? profile.cursor + 1 : 0;
			} else {
				const works = await this.db.getRepository(MiZalipWork).find({ order: { id: 'ASC' }, skip: profile.cursor, take: 100 });
				targets = [];
				for (const work of works) {
					try { targets.push(...await this.refsForWorks([work.id], profile.source)); } catch { /* Unmapped manual titles are intentionally skipped. */ }
				}
				profile.cursor = works.length === 100 ? profile.cursor + 100 : 0;
			}
			const run = await this.createRun({ mode: profile.mode === 'collection' ? 'import' : profile.mode === 'availability' ? 'availability' : 'sync', lockedFields: profile.lockedFields, categoryIds: profile.categoryIds, profileId }, undefined, targets);
			profile.lastRunAt = new Date();
			profile.nextRunAt = profile.enabled ? new Date(Date.now() + profile.intervalMinutes * 60000) : null;
			profile.lastError = null;
			await profiles.save(profile);
			return run;
		} catch (error) {
			await profiles.update(profile.id, { lastError: safeImportError(error), nextRunAt: profile.enabled ? new Date(Date.now() + profile.intervalMinutes * 60000) : null });
			throw error;
		}
	}

	/** Recurring scheduler dispatches only persisted enabled profiles, never a hardcoded catalogue crawl. */
	public async tickSchedules(): Promise<void> {
		const runs = this.db.getRepository(MiZalipImportRun);
		const paused = await runs.find({ where: { state: 'paused', retryAt: LessThanOrEqual(new Date()) }, take: 10 });
		for (const run of paused) await this.actionRun(run.id, 'resume');
		const recoverable = await runs.find({ where: [{ state: 'queued' }, { state: 'running', updatedAt: LessThanOrEqual(new Date(Date.now() - 15 * 60000)) }], take: 10 });
		for (const run of recoverable) await this.enqueue(run.id);
		const profiles = await this.db.getRepository(MiZalipImportProfile).find({ where: { enabled: true, nextRunAt: LessThanOrEqual(new Date()) }, order: { nextRunAt: 'ASC' }, take: 5 });
		for (const profile of profiles) {
			// Distributed claim prevents duplicate schedules in multi-worker installations.
			const claimed = await this.db.getRepository(MiZalipImportProfile).update({ id: profile.id, nextRunAt: profile.nextRunAt ?? IsNull() }, { nextRunAt: new Date(Date.now() + profile.intervalMinutes * 60000) });
			if (!claimed.affected) continue;
			try { await this.runProfile(profile.id); } catch { /* Error code is already recorded in the profile. */ }
		}
		await this.catalogue.dispatchPendingAllohaAvailabilityNotifications();
	}
}
