/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { In, LessThanOrEqual, MoreThan, Raw, type DataSource, type EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { ZalipPersonImportService, type PersonImportWarning } from '@/core/ZalipPersonImportService.js';
import { MiZalipMaintenanceProfile, MiZalipMaintenanceRun } from '@/models/ZalipMaintenanceRun.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { MiZalipCatalogRelation } from '@/models/ZalipCatalogRelation.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { budgetedTransport } from './zalip-importer/budget.js';
import { fetchImportedPerson } from './zalip-importer/persons.js';
import { createConfiguredImportTransport, createImportProviders, ImportProviderError } from './zalip-importer/providers.js';
import { readImportState } from './zalip-importer/policy.js';
import { maintenanceKinds, type ImportCollectionMembersPage, type ImportProvider, type ImportSource, type MaintenanceCursor, type MaintenanceKind, type MaintenanceOptions, type MaintenanceSource, type MaintenanceStats } from './zalip-importer/types.js';
import type { Queue } from 'bullmq';
import type * as Redis from 'ioredis';

export type CreateMaintenanceRun = { kind: MaintenanceKind; source: MaintenanceSource; options?: MaintenanceOptions; batchLimit?: number; timeBudgetSeconds?: number };
export type SaveMaintenanceProfile = CreateMaintenanceRun & { profileId?: string; name: string; intervalMinutes: number };
const busyStates = ['queued', 'running', 'paused'] as const;
const numericId = /^[1-9]\d{0,15}$/u;
const closedWarnings = new Set(['collection-identity-conflict', 'collection-field-locked', 'person-id-missing', 'person-photo-local-unavailable']);

export function emptyMaintenanceCursor(): MaintenanceCursor {
	return { page: 1, offset: 0, entryAfterId: null, activeEntryId: null, collectionIndex: 0 };
}

function emptyStats(): MaintenanceStats {
	return { processed: 0, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 };
}

export function normalizeMaintenanceInput(input: CreateMaintenanceRun): Required<CreateMaintenanceRun> {
	if (!input || !maintenanceKinds.includes(input.kind) || !['collaps', 'tmdb', 'kinopoisk'].includes(input.source)) throw new ImportProviderError('invalid-ref');
	if ((input.kind === 'person-enrichment') !== (input.source !== 'collaps')) throw new ImportProviderError('invalid-ref');
	const batchLimit = input.batchLimit ?? 20;
	const timeBudgetSeconds = input.timeBudgetSeconds ?? 60;
	if (!Number.isInteger(batchLimit) || batchLimit < 20 || batchLimit > 50 || !Number.isInteger(timeBudgetSeconds) || timeBudgetSeconds < 10 || timeBudgetSeconds > 120) throw new ImportProviderError('invalid-ref');
	const raw = input.options ?? {};
	if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(key => key !== 'collectionIds')) throw new ImportProviderError('invalid-ref');
	if (raw.collectionIds !== undefined && (input.kind !== 'collection-backfill' || !Array.isArray(raw.collectionIds) || raw.collectionIds.length > 100 || raw.collectionIds.some(value => typeof value !== 'string' || !numericId.test(value)))) throw new ImportProviderError('invalid-ref');
	const options: MaintenanceOptions = raw.collectionIds?.length ? { collectionIds: [...new Set(raw.collectionIds)] } : {};
	return { kind: input.kind, source: input.source, options, batchLimit, timeBudgetSeconds };
}

export function safeMaintenanceError(error: unknown): string {
	if (error instanceof ImportProviderError) return error.code;
	if (error instanceof Error && ['CATALOG_ID_CONFLICT', 'IMPORT_IDENTITY_CONFLICT'].includes(error.message)) return 'collection-identity-conflict';
	return 'maintenance-failed';
}

function sameMaintenanceConfiguration(left: CreateMaintenanceRun, right: CreateMaintenanceRun): boolean {
	return JSON.stringify(normalizeMaintenanceInput(left)) === JSON.stringify(normalizeMaintenanceInput(right));
}

/** Maintenance creates no works, publishes nothing and never removes catalogue relationships. */
@Injectable()
export class ZalipImporterMaintenanceService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redis: Redis.Redis,
		@Inject('queue:zalipMaintenance') private queue: Queue<{ runId: string }>,
		private idService: IdService,
		private taxonomy: ZalipTaxonomyService,
		private sourceSettings: ZalipImporterSourceSettingsService,
		private personImporter: ZalipPersonImportService,
	) {}

	private async runtime() {
		const config = await this.sourceSettings.getRuntime();
		const budget = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		const transport = budgetedTransport(this.redis, createConfiguredImportTransport(config), config.kinopoiskApiKey, Number.isSafeInteger(budget) && budget > 0 ? budget : 350, config.apiOrigins.kinopoisk);
		return { config, transport, providers: createImportProviders(config, transport) };
	}

	private assertConfigured(input: CreateMaintenanceRun, providers: Record<ImportSource, ImportProvider>) {
		if (!providers[input.source].status().configured) throw new ImportProviderError('not-configured');
		if (input.kind === 'collections-dictionary' && !providers.collaps.collectionDictionary) throw new ImportProviderError('unsupported');
		if (input.kind === 'collection-backfill' && !providers.collaps.collectionMembers) throw new ImportProviderError('unsupported');
	}

	private async lockProfile(manager: EntityManager, profileId: string) {
		await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-maintenance-profile:${profileId}`]);
	}

	private async profileBusy(manager: EntityManager, profileId: string, exceptRunId?: string) {
		const active = await manager.getRepository(MiZalipMaintenanceRun).find({ where: { profileId, state: In(busyStates) }, take: 100 });
		return active.some(run => run.id !== exceptRunId);
	}

	private async makeRun(manager: EntityManager, input: Required<CreateMaintenanceRun>, actorId?: string, profile?: MiZalipMaintenanceProfile) {
		const now = new Date();
		const repository = manager.getRepository(MiZalipMaintenanceRun);
		return repository.save(repository.create({ id: this.idService.gen(), ...input, createdById: actorId ?? null, profileId: profile?.id ?? null, createdAt: now, updatedAt: now, finishedAt: null, state: 'queued', cursor: profile?.cursor ?? emptyMaintenanceCursor(), stats: emptyStats(), warnings: [], error: null, retryAfter: null }));
	}

	public async createRun(input: CreateMaintenanceRun, actorId?: string) {
		const normalized = normalizeMaintenanceInput(input);
		this.assertConfigured(normalized, (await this.runtime()).providers);
		const run = await this.db.transaction(manager => this.makeRun(manager, normalized, actorId));
		await this.enqueue(run);
		return { runId: run.id };
	}

	private async enqueue(run: MiZalipMaintenanceRun) {
		await this.queue.add('maintenance', { runId: run.id }, { jobId: `${run.id}-${run.updatedAt.getTime()}`, attempts: 3, backoff: { type: 'exponential', delay: 30000 }, removeOnComplete: 50, removeOnFail: 50 });
	}

	private packRun(run: MiZalipMaintenanceRun) {
		return { id: run.id, kind: run.kind, source: run.source, state: run.state, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, profileId: run.profileId, options: run.options ?? {}, batchLimit: run.batchLimit, timeBudgetSeconds: run.timeBudgetSeconds, cursor: run.cursor, stats: run.stats, error: run.error, warnings: run.warnings.filter(value => closedWarnings.has(value)), retryAfter: run.retryAfter?.toISOString() ?? null };
	}

	public async listRuns(limit = 20) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ImportProviderError('invalid-ref');
		return (await this.db.getRepository(MiZalipMaintenanceRun).find({ order: { createdAt: 'DESC' }, take: limit })).map(run => this.packRun(run));
	}

	public async showRun(runId: string) {
		const run = await this.db.getRepository(MiZalipMaintenanceRun).findOneBy({ id: runId });
		if (!run) throw new ImportProviderError('not-found');
		return this.packRun(run);
	}

	public async actionRun(runId: string, action: 'cancel' | 'resume') {
		if (!['cancel', 'resume'].includes(action)) throw new ImportProviderError('invalid-ref');
		const runtime = action === 'resume' ? await this.runtime() : null;
		const changed = await this.db.transaction(async manager => {
			const repository = manager.getRepository(MiZalipMaintenanceRun);
			const run = await repository.findOneBy({ id: runId });
			if (!run) throw new ImportProviderError('not-found');
			if (run.profileId) {
				await this.lockProfile(manager, run.profileId);
				if (action === 'resume' && await this.profileBusy(manager, run.profileId, run.id)) throw new Error('IMPORT_RUN_BUSY');
				const profile = await manager.getRepository(MiZalipMaintenanceProfile).findOneBy({ id: run.profileId });
				if (action === 'resume' && profile && (!sameMaintenanceConfiguration(profile, run) || JSON.stringify(profile.cursor) !== JSON.stringify(run.cursor))) throw new Error('IMPORT_RUN_BUSY');
			}
			if (action === 'resume') {
				if (!['paused', 'failed'].includes(run.state)) return null;
				this.assertConfigured(run, runtime!.providers);
			}
			const now = new Date(Math.max(Date.now(), run.updatedAt.getTime() + 1));
			const result = await repository.update({ id: runId, state: In(action === 'cancel' ? busyStates : ['paused', 'failed']) }, { state: action === 'cancel' ? 'cancelled' : 'queued', updatedAt: now, finishedAt: action === 'cancel' ? now : null, retryAfter: null, error: null });
			return result.affected ? repository.findOneByOrFail({ id: runId }) : null;
		});
		if (changed?.state === 'queued') await this.enqueue(changed);
		return this.showRun(runId);
	}

	private packProfile(profile: MiZalipMaintenanceProfile) {
		return { id: profile.id, name: profile.name, kind: profile.kind, source: profile.source, enabled: profile.enabled, options: profile.options ?? {}, intervalMinutes: profile.intervalMinutes, batchLimit: profile.batchLimit, timeBudgetSeconds: profile.timeBudgetSeconds, cursor: profile.cursor, lastRunAt: profile.lastRunAt?.toISOString() ?? null, nextRunAt: profile.nextRunAt?.toISOString() ?? null, lastError: profile.lastError };
	}

	public async listProfiles() {
		return (await this.db.getRepository(MiZalipMaintenanceProfile).find({ order: { name: 'ASC' }, take: 100 })).map(profile => this.packProfile(profile));
	}

	public async saveProfile(input: SaveMaintenanceProfile) {
		const normalized = normalizeMaintenanceInput(input);
		if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 120 || !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 60 || input.intervalMinutes > 10080) throw new ImportProviderError('invalid-ref');
		const profile = await this.db.transaction(async manager => {
			const repository = manager.getRepository(MiZalipMaintenanceProfile);
			if (input.profileId) await this.lockProfile(manager, input.profileId);
			const existing = input.profileId ? await repository.findOneBy({ id: input.profileId }) : null;
			if (input.profileId && !existing) throw new ImportProviderError('not-found');
			if (existing && await this.profileBusy(manager, existing.id)) throw new Error('IMPORT_RUN_BUSY');
			if (existing?.enabled) this.assertConfigured(normalized, (await this.runtime()).providers);
			const now = new Date();
			const changed = existing && (existing.kind !== normalized.kind || existing.source !== normalized.source || JSON.stringify(existing.options) !== JSON.stringify(normalized.options) || existing.batchLimit !== normalized.batchLimit);
			return repository.save(repository.create({ id: existing?.id ?? this.idService.gen(), createdAt: existing?.createdAt ?? now, updatedAt: now, name: input.name.trim(), ...normalized, enabled: existing?.enabled ?? false, intervalMinutes: input.intervalMinutes, cursor: changed ? emptyMaintenanceCursor() : existing?.cursor ?? emptyMaintenanceCursor(), lastRunAt: existing?.lastRunAt ?? null, nextRunAt: existing?.enabled ? new Date(Date.now() + input.intervalMinutes * 60000) : null, lastError: null }));
		});
		return this.packProfile(profile);
	}

	public async actionProfile(profileId: string, action: 'enable' | 'disable' | 'reset-cursor' | 'delete') {
		if (!['enable', 'disable', 'reset-cursor', 'delete'].includes(action)) throw new ImportProviderError('invalid-ref');
		const runtime = action === 'enable' ? await this.runtime() : null;
		const profile = await this.db.transaction(async manager => {
			await this.lockProfile(manager, profileId);
			const repository = manager.getRepository(MiZalipMaintenanceProfile);
			const existing = await repository.findOneBy({ id: profileId });
			if (!existing) throw new ImportProviderError('not-found');
			if ((action === 'reset-cursor' || action === 'delete') && await this.profileBusy(manager, profileId)) throw new Error('IMPORT_RUN_BUSY');
			if (action === 'enable') this.assertConfigured(existing, runtime!.providers);
			if (action === 'delete') { await repository.delete(profileId); return null; }
			await repository.update(profileId, { updatedAt: new Date(), ...(action === 'reset-cursor' ? { cursor: emptyMaintenanceCursor(), lastError: null } : { enabled: action === 'enable', nextRunAt: action === 'enable' ? new Date() : null }) });
			return repository.findOneByOrFail({ id: profileId });
		});
		return profile ? this.packProfile(profile) : null;
	}

	private async active(runId: string): Promise<boolean> {
		return (await this.db.getRepository(MiZalipMaintenanceRun).findOneBy({ id: runId }))?.state === 'running';
	}

	private warn(run: MiZalipMaintenanceRun, value: string) {
		if (closedWarnings.has(value) && !run.warnings.includes(value)) run.warnings.push(value);
	}

	private async checkpoint(run: MiZalipMaintenanceRun, complete = false) {
		const now = new Date(Math.max(Date.now(), run.updatedAt.getTime() + 1));
		run.updatedAt = now;
		await this.db.transaction(async manager => {
			if (run.profileId) await this.lockProfile(manager, run.profileId);
			const runs = manager.getRepository(MiZalipMaintenanceRun);
			const previous = await runs.findOneBy({ id: run.id });
			const changed = await runs.update({ id: run.id, state: 'running' }, { cursor: run.cursor, stats: run.stats, warnings: run.warnings, updatedAt: now, ...(complete ? { state: 'completed' as const, finishedAt: now, error: null } : {}) });
			if (changed.affected && run.profileId) {
				const profiles = manager.getRepository(MiZalipMaintenanceProfile);
				const profile = await profiles.findOneBy({ id: run.profileId });
				if (profile && previous && sameMaintenanceConfiguration(profile, run) && JSON.stringify(profile.cursor) === JSON.stringify(previous.cursor)) await profiles.update(run.profileId, { cursor: complete ? emptyMaintenanceCursor() : run.cursor, lastError: null, updatedAt: now });
			}
		});
	}

	private async nextEntry(type: 'person' | 'collection', afterId: string | null) {
		return this.db.getRepository(MiZalipCatalogEntry).findOne({ where: { type, ...(afterId ? { id: MoreThan(afterId) } : {}) }, order: { id: 'ASC' } });
	}

	private async linkExisting(run: MiZalipMaintenanceRun, entry: MiZalipCatalogEntry, item: ImportCollectionMembersPage['items'][number]) {
		const matches = await this.db.getRepository(MiZalipExternalIdentity).findBy(item.identities.map(identity => ({ provider: identity.provider, entityType: identity.entityType, externalId: identity.externalId })));
		const workIds = [...new Set(matches.map(identity => identity.workId))];
		if (workIds.length !== 1) {
			if (workIds.length > 1) this.warn(run, 'collection-identity-conflict');
			run.stats.skipped++;
			return;
		}
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workIds[0] });
		if (!work || readImportState(work.importData).locks.includes('collections')) {
			if (work) this.warn(run, 'collection-field-locked');
			run.stats.skipped++;
			return;
		}
		const exists = await this.db.getRepository(MiZalipCatalogRelation).existsBy({ entryId: entry.id, workId: work.id, source: 'collaps' });
		if (!await this.active(run.id)) return;
		if (await this.taxonomy.linkWork({ entryId: entry.id, workId: work.id }, 'collaps', 'collections') === false) {
			this.warn(run, 'collection-field-locked');
			run.stats.skipped++;
			return;
		}
		if (exists) run.stats.skipped++;
		else run.stats.linked++;
	}

	/** A global session lock enforces concurrency=1 even across worker processes/restarts. */
	public async processRun(runId: string): Promise<void> {
		const connection = this.db.createQueryRunner();
		let locked = false;
		let run: MiZalipMaintenanceRun | null = null;
		try {
			await connection.connect();
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['zalip-maintenance-worker']) as { locked: boolean }[];
			locked = lock.locked;
			if (!locked) throw new ImportProviderError('rate-limited', 30000);
			const repository = this.db.getRepository(MiZalipMaintenanceRun);
			run = await repository.findOneBy({ id: runId });
			if (!run || !['queued', 'running'].includes(run.state)) return;
			const runtime = await this.runtime();
			this.assertConfigured(run, runtime.providers);
			const normalized = normalizeMaintenanceInput(run);
			Object.assign(run, normalized);
			const claimed = await repository.update({ id: runId, state: In(['queued', 'running']) }, { state: 'running', updatedAt: new Date() });
			if (!claimed.affected) return;
			const deadline = Date.now() + run.timeBudgetSeconds * 1000;
			let count = 0;
			let complete = false;
			while (count < run.batchLimit && Date.now() < deadline && await this.active(runId)) {
				if (run.kind === 'person-enrichment') {
					const entry = await this.nextEntry('person', run.cursor.entryAfterId);
					if (!entry) { complete = true; break; }
					const personId = entry.externalIds[run.source];
					if (!personId || !numericId.test(personId)) { this.warn(run, 'person-id-missing'); run.stats.skipped++; } else {
						try {
							const warnings: PersonImportWarning[] = [];
							const result = await this.taxonomy.enrichPerson(entry.id, run.source as 'tmdb' | 'kinopoisk', async (id, context) => {
								const person = await fetchImportedPerson(run!.source as 'tmdb' | 'kinopoisk', id, runtime.config, runtime.transport);
								if (!await this.active(runId)) throw new ImportProviderError('rate-limited', 30000);
								const localized = await this.personImporter.localizePhoto(person, context.canImportImage, warnings);
								if (!await this.active(runId)) throw new ImportProviderError('rate-limited', 30000);
								return localized;
							});
							for (const warning of warnings) this.warn(run, warning);
							if (result.changedFields.length) run.stats.updated++;
							else run.stats.skipped++;
						} catch (error) {
							if (!(error instanceof ImportProviderError) || error.code !== 'not-found') throw error;
							run.stats.failed++;
						}
					}
					run.cursor.entryAfterId = entry.id;
					count++;
					run.stats.processed++;
					await this.checkpoint(run);
					continue;
				}
				if (run.kind === 'collections-dictionary') {
					const page = await runtime.providers.collaps.collectionDictionary!(run.cursor.page, run.batchLimit);
					if (run.cursor.offset > page.items.length) throw new ImportProviderError('malformed-response');
					while (run.cursor.offset < page.items.length && count < run.batchLimit && Date.now() < deadline && await this.active(runId)) {
						const item = page.items[run.cursor.offset];
						const before = await this.db.getRepository(MiZalipCatalogEntry).findOne({ where: { type: 'collection', externalIds: Raw(alias => `${alias}->>'collaps' = :collectionId`, { collectionId: item.externalId }) } });
						if (!await this.active(runId)) return;
						await this.taxonomy.upsertImportedEntry({ type: 'collection', name: item.name, externalIds: { collaps: item.externalId }, data: { collectionKind: 'provider' } }, 'collaps');
						if (before) run.stats.updated++; else run.stats.created++;
						run.stats.processed++; count++; run.cursor.offset++;
						await this.checkpoint(run);
					}
					if (run.cursor.offset === page.items.length) {
						if (!page.hasMore) { complete = true; break; }
						run.cursor.page++; run.cursor.offset = 0;
						await this.checkpoint(run);
					}
					continue;
				}
				const entry = run.cursor.activeEntryId ? await this.db.getRepository(MiZalipCatalogEntry).findOneBy({ id: run.cursor.activeEntryId, type: 'collection' }) : await this.nextEntry('collection', run.cursor.entryAfterId);
				if (!entry && !run.cursor.activeEntryId) { complete = true; break; }
				const entryId = entry?.id ?? run.cursor.activeEntryId!;
				const collectionId = entry?.externalIds.collaps;
				if (!entry || entry.data.isEnabled === false || !collectionId || !numericId.test(collectionId) || (run.options.collectionIds?.length && !run.options.collectionIds.includes(collectionId))) {
					run.cursor.entryAfterId = entryId; run.cursor.activeEntryId = null; run.cursor.offset = 0; run.cursor.page = 1;
					run.stats.skipped++; run.stats.processed++; count++;
					await this.checkpoint(run);
					continue;
				}
				run.cursor.activeEntryId = entry.id;
				const page = await runtime.providers.collaps.collectionMembers!(collectionId, run.cursor.page, run.batchLimit);
				if (run.cursor.offset > page.items.length) throw new ImportProviderError('malformed-response');
				while (run.cursor.offset < page.items.length && count < run.batchLimit && Date.now() < deadline && await this.active(runId)) {
					await this.linkExisting(run, entry, page.items[run.cursor.offset]);
					run.stats.processed++; count++; run.cursor.offset++;
					await this.checkpoint(run);
				}
				if (run.cursor.offset === page.items.length) {
					if (page.hasMore) { run.cursor.page++; run.cursor.offset = 0; } else { run.cursor.entryAfterId = entry.id; run.cursor.activeEntryId = null; run.cursor.page = 1; run.cursor.offset = 0; run.cursor.collectionIndex++; if (!page.items.length) count++; }
					await this.checkpoint(run);
				}
			}
			if (!await this.active(runId)) return;
			if (complete) { await this.checkpoint(run, true); return; }
			const now = new Date(Math.max(Date.now(), run.updatedAt.getTime() + 1));
			const changed = await repository.update({ id: runId, state: 'running' }, { state: 'queued', updatedAt: now });
			if (changed.affected) await this.enqueue({ ...run, updatedAt: now });
		} catch (error) {
			if (!run || !locked) throw error;
			const code = safeMaintenanceError(error);
			const retry = error instanceof ImportProviderError && ['quota-exceeded', 'rate-limited'].includes(error.code);
			const requestedDelay = error instanceof ImportProviderError ? error.retryAfterMs : undefined;
			const delay = requestedDelay !== undefined && Number.isFinite(requestedDelay) ? Math.min(86400000, Math.max(30000, requestedDelay)) : 3600000;
			const now = new Date();
			await this.db.getRepository(MiZalipMaintenanceRun).update({ id: runId, state: In(['running', 'queued']) }, { state: retry ? 'paused' : 'failed', error: code, updatedAt: now, finishedAt: retry ? null : now, retryAfter: retry ? new Date(Date.now() + delay) : null });
			if (run.profileId) await this.db.getRepository(MiZalipMaintenanceProfile).update(run.profileId, { lastError: code });
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', ['zalip-maintenance-worker']); } finally { await connection.release(); }
		}
	}

	/** Worker restarts are handled under the same global lock; no active process is stolen. */
	public async recoverInterruptedRuns(): Promise<void> {
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', ['zalip-maintenance-worker']) as { locked: boolean }[];
			locked = lock.locked;
			if (!locked) return;
			await this.db.getRepository(MiZalipMaintenanceRun).update({ state: 'running' }, { state: 'queued', updatedAt: new Date() });
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', ['zalip-maintenance-worker']); } finally { await connection.release(); }
		}
	}

	public async tickSchedules(): Promise<void> {
		await this.recoverInterruptedRuns();
		const runs = this.db.getRepository(MiZalipMaintenanceRun);
		for (const run of await runs.find({ where: { state: 'paused', retryAfter: LessThanOrEqual(new Date()) }, take: 20 })) {
			try { await this.actionRun(run.id, 'resume'); } catch (error) {
				await runs.update({ id: run.id, state: 'paused' }, { error: safeMaintenanceError(error), retryAfter: new Date(Date.now() + 3600000), updatedAt: new Date() });
			}
		}
		for (const run of await runs.find({ where: { state: 'queued' }, take: 100 })) await this.enqueue(run);
		const due = await this.db.getRepository(MiZalipMaintenanceProfile).find({ where: { enabled: true, nextRunAt: LessThanOrEqual(new Date()) }, order: { nextRunAt: 'ASC' }, take: 20 });
		for (const candidate of due) {
			try {
				const run = await this.db.transaction(async manager => {
					await this.lockProfile(manager, candidate.id);
					const profiles = manager.getRepository(MiZalipMaintenanceProfile);
					const profile = await profiles.findOneBy({ id: candidate.id });
					if (!profile?.enabled || !profile.nextRunAt || profile.nextRunAt.getTime() > Date.now() || await this.profileBusy(manager, profile.id)) return null;
					const input = normalizeMaintenanceInput(profile);
					this.assertConfigured(input, (await this.runtime()).providers);
					const created = await this.makeRun(manager, input, undefined, profile);
					await profiles.update(profile.id, { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + profile.intervalMinutes * 60000), lastError: null });
					return created;
				});
				if (run) await this.enqueue(run);
			} catch (error) {
				await this.db.getRepository(MiZalipMaintenanceProfile).update({ id: candidate.id, enabled: true }, { lastError: safeMaintenanceError(error), nextRunAt: new Date(Date.now() + candidate.intervalMinutes * 60000) });
			}
		}
	}
}
