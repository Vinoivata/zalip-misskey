/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, LessThanOrEqual, type EntityManager } from 'typeorm';
import type * as Redis from 'ioredis';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { ZalipImporterArtworkService } from '@/core/ZalipImporterArtworkService.js';
import { ZalipPlaybackSettingsService } from '@/core/ZalipPlaybackSettingsService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import type { ZalipImportQueue } from '@/core/QueueModule.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipImportItem, MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { MiZalipImportProfile } from '@/models/ZalipImportProfile.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { applyImportRecord, currentImportFields, findImportWork } from './zalip-importer/apply.js';
import { budgetedTransport } from './zalip-importer/budget.js';
import { recordArtworkCandidates, sameImportRef, selectImportArtwork } from './zalip-importer/artwork-candidates.js';
import { equivalentImportArtwork } from './zalip-importer/artwork.js';
import { canUpdateField, importFieldSelected, matchesCreatePlayerFilter, matchesImportFilters, mergeImportRecords, nonEmpty, normalizeImportOptions, readImportState, sameValue, selectedImportSources } from './zalip-importer/policy.js';
import { configuredImportPlayerUrl, createImportProviders, createConfiguredImportTransport, ImportProviderError, importPlayerTranslationUrl } from './zalip-importer/providers.js';
import { importArtworkFields, importFields, importSources, validImportRef, type ExternalIdentity, type ImportArtworkExpected, type ImportArtworkField, type ImportField, type ImportMediaType, type ImportOptions, type ImportPlayer, type ImportPreview, type ImportProvider, type ImportRecord, type ImportRef, type ImportSource, type PreparedImportRecord } from './zalip-importer/types.js';

export type CreateImportRun = {
	refs?: ImportRef[];
	workIds?: string[];
	mode: 'import' | 'sync' | 'availability';
	lockedFields?: string[];
	categoryIds?: string[];
	profileId?: string;
	options?: ImportOptions;
};
export type SaveImportProfile = {
	id?: string;
	name: string;
	enabled: boolean;
	source: ImportSource;
	mode: 'metadata' | 'availability' | 'collection' | 'discovery';
	intervalMinutes: number;
	collectionId?: string | null;
	lockedFields?: string[];
	categoryIds?: string[];
	options?: ImportOptions;
};

type VoiceRefreshStatus = 'updated' | 'already-current' | 'locked' | 'stale' | 'unsupported' | 'empty' | 'unavailable';

/** An anime season must not inherit the identity/numbering of a whole-series KP/IMDb record. */
function kodikAnimeSeason(record: ImportRecord): boolean {
	return record.ref.source === 'kodik' && record.ref.mediaType === 'tv' && record.kind === 'anime';
}

function exactKodikSeasonBinding(record: ImportRecord, identities: ExternalIdentity[]): boolean {
	return identities.some(identity => identity.entityType === 'tv' && (
		(identity.provider === 'kodik' && identity.externalId === record.ref.externalId) ||
		(identity.provider === 'shikimori' && record.identities.some(incoming => incoming.provider === 'shikimori' && incoming.entityType === 'tv' && incoming.externalId === identity.externalId))
	));
}

/** Canonical JSON keys make the opaque revision independent of JSONB property order. */
function playbackRevision(work: MiZalipWork, identities: ExternalIdentity[]): string {
	const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
		? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]))
		: value;
	const bindings = identities.map(({ provider, entityType, externalId }) => ({ provider, entityType, externalId })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
	return createHash('sha256').update(JSON.stringify(stable({ version: 1, workId: work.id, players: readImportState(work.importData).values.players ?? null, locks: readImportState(work.importData).locks, tmdbId: work.tmdbId, tmdbMediaType: work.tmdbMediaType, identities: bindings }))).digest('hex');
}

/** A repair never guesses an ID/media type, creates a slot, or overwrites an existing voice list. */
function collapsVoiceTarget(work: MiZalipWork, identities: ExternalIdentity[]) {
	const raw = readImportState(work.importData).values.players;
	if (!Array.isArray(raw) || raw.length > 20) return null;
	const slots = raw.flatMap((value, index) => value && typeof value === 'object' && !Array.isArray(value) && value.source === 'collaps' ? [{ index, player: value as ImportPlayer }] : []);
	const bindings = identities.filter(identity => identity.provider === 'collaps');
	if (slots.length !== 1 || bindings.length !== 1) return null;
	const { index, player } = slots[0];
	const binding = bindings[0];
	if (typeof player.externalId !== 'string' || !/^[1-9][0-9]{0,15}$/u.test(player.externalId) || player.externalId !== binding.externalId || !['movie', 'tv'].includes(binding.entityType) || (work.tmdbMediaType && work.tmdbMediaType !== binding.entityType) || typeof player.iframeUrl !== 'string' || !Array.isArray(player.translations)) return null;
	return { index, player, ref: { source: 'collaps', externalId: binding.externalId, mediaType: binding.entityType } as ImportRef };
}

export function safeImportError(error: unknown): string {
	if (error instanceof ImportProviderError) return error.code;
	if (error instanceof Error && ['NO_SUCH_WORK', 'IMPORT_IDENTITY_CONFLICT', 'IMPORT_INVALID_RECORD', 'ZALIP_CATALOG_ENTRY_NOT_FOUND', 'IMPORT_ARTWORK_SELECTION_STALE'].includes(error.message)) return error.message;
	return 'import-failed';
}

const importWarningCodes = new Set([
	'tmdb-metadata-partial', 'tmdb-seasons-unavailable', 'tmdb-season-limit', 'tmdb-episode-limit',
	'kinopoisk-metadata-partial', 'kinopoisk-artwork-unavailable', 'kinopoisk-season-limit', 'kinopoisk-episode-limit',
	'collaps-metadata-partial', 'collaps-season-limit', 'collaps-episode-limit', 'collaps-player-url-rejected',
	'alloha-player-url-rejected',
	'kodik-people-without-identities', 'kodik-studios-without-identities', 'kodik-metadata-partial', 'kodik-voice-limit',
	'kodik-player-url-rejected', 'kodik-season-limit', 'kodik-episode-data-rejected', 'kodik-episode-limit',
	'kodik-anime-identity-partial', 'kodik-anime-scope-unmapped',
]);
const sourceWarningPattern = /^(?:tmdb|kinopoisk|alloha|collaps|kodik):(?:not-configured|not-found|quota-exceeded|rate-limited|upstream-failure|invalid-ref|unsupported|malformed-response|import-failed|NO_SUCH_WORK|IMPORT_IDENTITY_CONFLICT|IMPORT_INVALID_RECORD|ZALIP_CATALOG_ENTRY_NOT_FOUND)$/u;

/** The durable journal accepts closed codes only, never provider text, URLs or credentials. */
export function safeImportWarnings(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const warnings = new Set<string>();
	for (const warning of value.slice(0, 1000)) {
		if (typeof warning !== 'string' || warning.length > 100) continue;
		if (importWarningCodes.has(warning) || sourceWarningPattern.test(warning) || /^tmdb-season-(?:0|[1-9][0-9]{0,3})-unavailable$/u.test(warning) || /^artwork-local-unavailable:(?:posterUrl|backdropUrl|logoUrl|galleryUrls)$/u.test(warning)) warnings.add(warning);
		if (warnings.size >= 50) break;
	}
	return [...warnings];
}

/** Queue payloads contain IDs only. Tokens and normalized private snapshots never enter job logs. */
@Injectable()
export class ZalipImporterService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redis: Redis.Redis,
		@Inject('queue:zalipImport') private queue: ZalipImportQueue,
		private idService: IdService,
		private catalogue: ZalipCatalogService,
		private taxonomy: ZalipTaxonomyService,
		private artwork: ZalipImporterArtworkService,
		private playbackSettings: ZalipPlaybackSettingsService,
		private sourceSettings: ZalipImporterSourceSettingsService,
	) {}

	private async getProviders(): Promise<Record<ImportSource, ImportProvider>> {
		const config = await this.sourceSettings.getRuntime();
		const budget = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		return createImportProviders(config, budgetedTransport(this.redis, createConfiguredImportTransport(config), config.kinopoiskApiKey, Number.isSafeInteger(budget) && budget > 0 ? budget : 350, config.apiOrigins.kinopoisk));
	}

	public async sources() {
		const providers = await this.getProviders();
		return { sources: importSources.map(source => providers[source].status()) };
	}

	public async search(source: ImportSource, query: string, page = 1, mediaType?: ImportMediaType) {
		return (await this.getProviders())[source].search(query, page, mediaType);
	}

	private assertCompatibleIdentities(record: ImportRecord, identities: ExternalIdentity[], mediaType: ImportMediaType) {
		if (record.ref.mediaType !== mediaType) throw new Error('IMPORT_IDENTITY_CONFLICT');
		for (const identity of record.identities) {
			const existing = identities.find(item => item.provider === identity.provider && item.entityType === identity.entityType);
			if (existing && existing.externalId !== identity.externalId) throw new Error('IMPORT_IDENTITY_CONFLICT');
		}
	}

	private async fetchRecord(ref: ImportRef, availabilityOnly = false, inputOptions?: ImportOptions, workId?: string) {
		const providers = await this.getProviders();
		const options = normalizeImportOptions(inputOptions);
		const selectedSources = selectedImportSources(ref.source, options);
		const fields = availabilityOnly ? ['players'] as const : options.fields;
		let primary: ImportRecord;
		try {
			primary = await providers[ref.source].fetch(ref, fields);
		} catch (error) {
			// Refresh recovery uses only previously bound exact IDs, never a title search.
			// Authentication, quota and transport errors must retain their original handling.
			if (!(error instanceof ImportProviderError) || error.code !== 'not-found' || !workId) throw error;
			const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
			if (!work) throw new Error('NO_SUCH_WORK');
			const identities: ExternalIdentity[] = await this.db.getRepository(MiZalipExternalIdentity).findBy({ workId });
			if (work.tmdbId && work.tmdbMediaType && !identities.some(identity => identity.provider === 'tmdb')) identities.push({ provider: 'tmdb', externalId: String(work.tmdbId), entityType: work.tmdbMediaType });
			let fallback: ImportRecord | null = null;
			for (const source of selectedSources) {
				const provider = providers[source];
				if (source === ref.source || !provider.status().configured || (availabilityOnly && source !== 'alloha' && source !== 'collaps' && source !== 'kodik')) continue;
				try {
					const exact = identities.find(identity => identity.provider === source && identity.entityType === ref.mediaType);
					const candidate = exact ? await provider.fetch({ source, externalId: exact.externalId, mediaType: ref.mediaType }, fields) : await provider.lookup?.(identities, ref.mediaType, fields);
					if (!candidate) continue;
					if (kodikAnimeSeason(candidate) && !exactKodikSeasonBinding(candidate, identities)) continue;
					this.assertCompatibleIdentities(candidate, identities, ref.mediaType);
					fallback = candidate;
					break;
				} catch (fallbackError) {
					if (safeImportError(fallbackError) === 'IMPORT_IDENTITY_CONFLICT' || (fallbackError instanceof ImportProviderError && ['quota-exceeded', 'rate-limited'].includes(fallbackError.code))) throw fallbackError;
				}
			}
			if (!fallback) throw error;
			fallback.warnings.push(`${ref.source}:not-found`);
			fallback.complete = false;
			primary = fallback;
		}
		const records = [primary];
		const visited = new Set<ImportSource>([ref.source, primary.ref.source]);
		// A second pass permits TMDB discovery from IMDb obtained from Kinopoisk/Collaps.
		for (let pass = 0; pass < 2; pass++) {
			for (const source of selectedSources) {
				if (visited.has(source) || !providers[source].status().configured || (availabilityOnly && source !== 'alloha' && source !== 'collaps' && source !== 'kodik')) continue;
				const provider = providers[source];
				try {
					const identities = records.flatMap(record => record.identities);
					const extra = await provider.lookup?.(identities, ref.mediaType, fields);
					if (extra) {
						const scoped = records.find(kodikAnimeSeason);
						if ((kodikAnimeSeason(extra) && !exactKodikSeasonBinding(extra, identities)) || (scoped && !exactKodikSeasonBinding(scoped, extra.identities))) {
							primary.warnings.push('kodik-anime-scope-unmapped');
							primary.complete = false;
							visited.add(source);
							continue;
						}
						this.assertCompatibleIdentities(extra, identities, ref.mediaType);
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
		const merged = mergeImportRecords(records, options);
		merged.record.artworkCandidates = records.flatMap(record => recordArtworkCandidates(record, fields));
		return selectImportArtwork(merged.record, ref, options, merged.sources);
	}

	public async preview(ref: ImportRef, workId?: string, inputOptions?: ImportOptions): Promise<ImportPreview> {
		const options = normalizeImportOptions(inputOptions);
		const { record, selectedFields } = await this.fetchRecord(ref, false, options, workId);
		const work = await findImportWork(this.db, record, workId);
		const state = readImportState(work?.importData);
		const fields = work ? currentImportFields(work) : {};
		const localArtwork = work?.importData.localArtwork && typeof work.importData.localArtwork === 'object' && !Array.isArray(work.importData.localArtwork) ? work.importData.localArtwork as Record<string, unknown> : {};
		return {
			record,
			workId: work?.id ?? null,
			options, locks: state.locks,
			matchesFilters: matchesImportFilters(record, options.filters) && matchesCreatePlayerFilter(record, work != null, options.filters),
			changes: importFields.map(field => {
				const artworkField = importArtworkFields.includes(field as ImportArtworkField);
				const explicitArtwork = selectedFields.includes(field as ImportArtworkField);
				const localizingLegacyArtwork = artworkField && nonEmpty(record[field]) && options.artwork !== undefined && options.artwork !== 'remote' && state.values[field] === undefined && equivalentImportArtwork(fields[field], record[field], Boolean(work?.tmdbId && work.tmdbMediaType));
				const preserveLocalized = !explicitArtwork && options.artwork !== 'local' && options.artwork !== 'local-webp' && Object.hasOwn(localArtwork, field) && sameValue(fields[field], localArtwork[field]);
				return { field, before: fields[field] ?? null, after: record[field], selected: importFieldSelected(field, options, !work), protected: !importFieldSelected(field, options, !work) || (work != null && (state.locks.includes(field) || preserveLocalized || (!explicitArtwork && !localizingLegacyArtwork && !canUpdateField(fields[field], state.values[field], record[field], false)))) };
			}),
			warnings: record.warnings,
		};
	}

	private async refsForWorks(workIds: string[], source?: ImportSource): Promise<{ ref: ImportRef; workId: string }[]> {
		const providers = await this.getProviders();
		const works = await this.db.getRepository(MiZalipWork).findBy({ id: In(workIds) });
		if (works.length !== new Set(workIds).size) throw new Error('NO_SUCH_WORK');
		const identities = await this.db.getRepository(MiZalipExternalIdentity).findBy({ workId: In(workIds) });
		const targets: { ref: ImportRef; workId: string }[] = [];
		for (const work of works) {
			const identity = identities.find(item => item.workId === work.id && importSources.includes(item.provider as ImportSource) && (!source || item.provider === source) && providers[item.provider as ImportSource].status().configured);
			if (identity) {
				targets.push({ workId: work.id, ref: { source: identity.provider as ImportSource, externalId: identity.externalId, mediaType: identity.entityType } });
				continue;
			}
			if ((!source || source === 'tmdb') && work.tmdbId && work.tmdbMediaType) {
				targets.push({ workId: work.id, ref: { source: 'tmdb', externalId: String(work.tmdbId), mediaType: work.tmdbMediaType } });
				continue;
			}
			if (source === 'alloha' && work.tmdbId && work.tmdbMediaType) {
				targets.push({ workId: work.id, ref: { source: 'alloha', externalId: `tmdb:${work.tmdbMediaType}:${work.tmdbId}`, mediaType: work.tmdbMediaType } });
				continue;
			}
			if (source === 'kodik' && providers.kodik.status().configured) {
				const bindings = identities.filter(item => item.workId === work.id);
				const mediaTypes = [...new Set(bindings.map(item => item.entityType))];
				const mediaType = work.tmdbMediaType ?? (mediaTypes.length === 1 ? mediaTypes[0] : null);
				if (mediaType === 'movie' || mediaType === 'tv') {
					const record = await providers.kodik.lookup?.(bindings, mediaType, ['players']);
					if (record) {
						if (kodikAnimeSeason(record) && !exactKodikSeasonBinding(record, bindings)) throw new ImportProviderError('invalid-ref');
						this.assertCompatibleIdentities(record, bindings, mediaType);
						targets.push({ workId: work.id, ref: record.ref });
						continue;
					}
				}
			}
			throw new ImportProviderError('invalid-ref');
		}
		return targets;
	}

	public async createRun(input: CreateImportRun, actorId?: string, boundTargets?: { ref: ImportRef; workId: string | null }[]) {
		const providers = await this.getProviders();
		const options = normalizeImportOptions(input.options);
		const lockedFields = normalizeImportOptions({ fields: input.lockedFields as ImportField[] | undefined }).fields ?? [];
		if ((input.refs?.length ?? 0) > 100 || (input.workIds?.length ?? 0) > 100 || (input.refs?.length && input.workIds?.length)) throw new ImportProviderError('invalid-ref');
		const targets = boundTargets ?? (input.workIds?.length ? await this.refsForWorks(input.workIds) : (input.refs ?? []).map(ref => ({ ref, workId: null })));
		if (targets.length > 100) throw new ImportProviderError('invalid-ref');
		if (targets.some(target => !validImportRef(target.ref))) throw new ImportProviderError('invalid-ref');
		if (targets.length === 0 && boundTargets === undefined) throw new ImportProviderError('invalid-ref');
		if (targets.some(item => !providers[item.ref.source]?.status().configured)) throw new ImportProviderError('not-configured');
		if (options.artworkSelections?.some(selection => !targets.some(target => sameImportRef(target.ref, selection.ref)))) throw new Error('INVALID_IMPORT_OPTIONS');
		const categoryIds = [...new Set(input.categoryIds ?? [])];
		if (categoryIds.length > 50 || (categoryIds.length && await this.db.getRepository(MiZalipCatalogEntry).countBy({ id: In(categoryIds), type: 'category' }) !== categoryIds.length)) throw new Error('ZALIP_CATALOG_ENTRY_NOT_FOUND');
		const now = new Date();
		const run = await this.db.transaction(async manager => {
			const runs = manager.getRepository(MiZalipImportRun);
			const created = await runs.save(runs.create({ id: this.idService.gen(), createdAt: now, updatedAt: now, createdById: actorId ?? null, profileId: input.profileId ?? null, mode: input.mode, state: targets.length ? 'queued' : 'completed', lockedFields, categoryIds, options, error: null, retryAt: null }));
			const items = manager.getRepository(MiZalipImportItem);
			if (targets.length) await items.save(targets.map((target, position) => items.create({ id: this.idService.gen(), runId: created.id, position, ref: target.ref, workId: target.workId, state: 'pending', error: null, warnings: [], updatedAt: now })));
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
		return { id: run.id, state: run.state, mode: run.mode, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString(), total: items.length, completed: items.filter(item => item.state === 'completed' || item.state === 'skipped').length, failed: items.filter(item => item.state === 'failed').length, error: run.error, profileId: run.profileId, options: run.options ?? {}, retryAt: run.retryAt?.toISOString() ?? null };
	}

	public async listRuns() {
		const runs = await this.db.getRepository(MiZalipImportRun).find({ order: { createdAt: 'DESC' }, take: 50 });
		return { runs: await Promise.all(runs.map(run => this.packRun(run))) };
	}

	public async showRun(runId: string) {
		const run = await this.db.getRepository(MiZalipImportRun).findOneBy({ id: runId });
		if (!run) throw new ImportProviderError('not-found');
		const items = await this.db.getRepository(MiZalipImportItem).find({ where: { runId }, order: { position: 'ASC' } });
		return { run: await this.packRun(run), items: items.map(({ id, position, state, ref, workId, error, warnings }) => ({ id, position, state, ref, workId, error, warnings: safeImportWarnings(warnings) })) };
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
				await items.update(item.id, { state: 'running', warnings: [], updatedAt: new Date() });
				let warnings: string[] = [];
				try {
					const { record: fetchedRecord, sources, selectedFields } = await this.fetchRecord(item.ref, run.mode === 'availability', run.options, item.workId ?? undefined);
					let record: PreparedImportRecord = fetchedRecord;
					warnings = safeImportWarnings(record.warnings);
					if (warnings.length) await items.update(item.id, { warnings });
					if ((await runs.findOneBy({ id: runId }))?.state !== 'running') { await items.update(item.id, { state: 'pending', warnings }); return; }
					if (!matchesImportFilters(record, run.options?.filters)) {
						await items.update(item.id, { state: 'skipped', error: 'import-filtered', warnings, updatedAt: new Date() });
						continue;
					}
					const before = await findImportWork(this.db, record, item.workId ?? undefined);
					if (!matchesCreatePlayerFilter(record, before != null, run.options?.filters)) {
						await items.update(item.id, { state: 'skipped', error: 'import-player-required', warnings, updatedAt: new Date() });
						continue;
					}
					const establishedAvailability = before != null && readImportState(before.importData).values.players !== undefined;
					const localArtwork = run.mode !== 'availability' && (run.options?.artwork === 'local-webp' || run.options?.artwork === 'local');
					if (localArtwork) record = await this.artwork.prepare(record, before, run.options.fields, run.lockedFields, run.options.artworkSettings, run.options.artwork === 'local' ? 'local' : 'local-webp', selectedFields);
					let artworkExpected = record.artworkExpected;
					if (!localArtwork && before && selectedFields.length) {
						const current = currentImportFields(before);
						artworkExpected = Object.fromEntries(selectedFields.map(field => [field, structuredClone(current[field])])) as ImportArtworkExpected;
					}
					const localizedFields = localArtwork ? importArtworkFields.filter(field => !record.warnings.includes(`artwork-local-unavailable:${field}`) && ((artworkExpected && Object.hasOwn(artworkExpected, field)) || (nonEmpty(record[field]) && !sameValue(record[field], fetchedRecord[field])))) : [];
					// An intentional empty gallery has no bytes to localize, but remains an editorial choice.
					// Do not confuse it with galleryLimit: 0 truncating a nonempty provider selection.
					const manualArtworkFields = selectedFields.filter(field => !localArtwork || localizedFields.includes(field) || (field === 'galleryUrls' && fetchedRecord.galleryUrls.length === 0 && !record.warnings.includes('artwork-local-unavailable:galleryUrls')));
					const preparedWarnings = safeImportWarnings(record.warnings);
					if (!sameValue(warnings, preparedWarnings)) await items.update(item.id, { warnings: preparedWarnings });
					warnings = preparedWarnings;
					// Optional local artwork involves network work: a late pause/cancel still wins.
					if ((await runs.findOneBy({ id: runId }))?.state !== 'running') { await items.update(item.id, { state: 'pending', warnings }); return; }
					const result = await applyImportRecord(this.db, this.idService, record, sources, { workId: item.workId ?? undefined, lockedFields: run.lockedFields, mode: run.mode, options: run.options, artworkExpected, artworkSelectedFields: manualArtworkFields, artworkLocalizedFields: localizedFields });
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
					await items.update(item.id, { state: 'completed', error: null, warnings, updatedAt: new Date() });
				} catch (error) {
					const code = safeImportError(error);
					if (code === 'quota-exceeded' || code === 'rate-limited') {
						await items.update(item.id, { state: 'pending', error: code, warnings });
						await runs.update({ id: runId, state: 'running' }, { state: 'paused', error: code, retryAt: new Date(Date.now() + (error instanceof ImportProviderError ? error.retryAfterMs ?? 3600000 : 3600000)), updatedAt: new Date() });
						return;
					}
					await items.update(item.id, { state: 'failed', error: code, warnings, updatedAt: new Date() });
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
		const { providers } = await this.playbackSettings.show();
		const config = await this.sourceSettings.getRuntime();
		return {
			providers,
			sources: providers.filter(setting => setting.enabled).flatMap(setting => {
				const player = players.find(candidate => candidate.source === setting.source);
				const iframe = player ? configuredImportPlayerUrl(player.iframeUrl, setting.source, config) : null;
				if (!player || !iframe) return [];
				const seen = new Set<string>();
				const translations = (Array.isArray(player.translations) ? player.translations : []).slice(0, 100).flatMap(translation => {
					if (translation == null || typeof translation !== 'object' || typeof translation.id !== 'string' || typeof translation.name !== 'string') return [];
					const id = translation.id.trim();
					const name = translation.name.trim();
					if (!id || id.length > 100 || !name || name.length > 256 || seen.has(id)) return [];
					seen.add(id);
					const voiceIframe = translation.iframe === undefined
						? importPlayerTranslationUrl(iframe, player.source, { id, name })
						: configuredImportPlayerUrl(translation.iframe, player.source, config);
					// A Kodik voice has its own resource path; falling back to the parent would select another voice.
					if (player.source === 'kodik' && !voiceIframe) return [];
					const quality = translation.quality === null ? null : typeof translation.quality === 'string' ? translation.quality.trim().slice(0, 64) || null : undefined;
					const resolutions = Array.isArray(translation.resolutions) ? [...new Set(translation.resolutions.filter((value): value is string => typeof value === 'string').map(value => value.trim().slice(0, 32)).filter(Boolean))].slice(0, 12) : undefined;
					const episodes = Array.isArray(translation.episodes) ? [...new Map(translation.episodes.slice(0, 1000).flatMap(episode => {
						if (!episode || typeof episode !== 'object' || !Number.isInteger(episode.seasonNumber) || episode.seasonNumber < 0 || episode.seasonNumber > 1000 || !Number.isInteger(episode.episodeNumber) || episode.episodeNumber < 0 || episode.episodeNumber > 100000) return [];
						return [[`${episode.seasonNumber}:${episode.episodeNumber}`, { seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }] as const];
					})).values()] : undefined;
					return [{
						id, name,
						...(voiceIframe == null ? {} : { iframe: voiceIframe }),
						...(quality === undefined ? {} : { quality }),
						...(resolutions === undefined ? {} : { resolutions }),
						...(episodes === undefined ? {} : { episodes }),
						...(translation.type === 'voice' || translation.type === 'subtitles' ? { type: translation.type } : {}),
						...(player.source === 'kodik' && typeof translation.providerTranslationId === 'string' && /^[1-9][0-9]{0,15}$/u.test(translation.providerTranslationId) ? { providerTranslationId: translation.providerTranslationId } : {}),
					}];
				});
				return [{ source: player.source, label: setting.label, iframe, translations, quality: player.quality, episodes: player.episodes }];
			}),
		};
	}

	private async packWorkState(work: MiZalipWork, manager: DataSource | EntityManager = this.db) {
		const state = readImportState(work.importData);
		const current = currentImportFields(work);
		const identities = await manager.getRepository(MiZalipExternalIdentity).findBy({ workId: work.id });
		return {
			workId: work.id, title: work.title, playbackRevision: playbackRevision(work, identities), locks: state.locks.filter(field => importFields.includes(field as ImportField)),
			fields: importFields.map(field => ({ field, source: importSources.includes(state.sources[field] as ImportSource) ? state.sources[field] : null, editorial: state.values[field] === undefined ? nonEmpty(current[field]) : !sameValue(current[field], state.values[field]) })),
		};
	}

	public async showWorkState(workId: string) {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
		if (!work) throw new Error('NO_SUCH_WORK');
		return this.packWorkState(work);
	}

	/** Replacing explicit locks never changes field values or the editorial ownership baseline. */
	public async saveWorkState(workId: string, lockedFields: string[]) {
		const locks = normalizeImportOptions({ fields: lockedFields as ImportField[] }).fields!;
		return this.db.transaction(async manager => {
			const repository = manager.getRepository(MiZalipWork);
			const work = await repository.findOne({ where: { id: workId }, lock: { mode: 'pessimistic_write' } });
			if (!work) throw new Error('NO_SUCH_WORK');
			work.importData = { ...work.importData, locks };
			work.updatedAt = new Date();
			await repository.save(work);
			return this.packWorkState(work, manager);
		});
	}

	/** Repair only empty voices in one existing Collaps slot; no metadata/import side effects. */
	public async refreshCollapsVoices(workId: string, expected: string) {
		if (!/^[a-f0-9]{64}$/u.test(expected)) throw new ImportProviderError('invalid-ref');
		const before = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
		if (!before) throw new Error('NO_SUCH_WORK');
		const identities = await this.db.getRepository(MiZalipExternalIdentity).findBy({ workId });
		const reply = (work: MiZalipWork, bindings: ExternalIdentity[], status: VoiceRefreshStatus, translations = 0) => ({ workId, status, translations, playbackRevision: playbackRevision(work, bindings) });
		if (playbackRevision(before, identities) !== expected) return reply(before, identities, 'stale');
		if (readImportState(before.importData).locks.includes('players')) return reply(before, identities, 'locked');
		const target = collapsVoiceTarget(before, identities);
		if (!target) return reply(before, identities, 'unsupported');
		if (target.player.translations.length) return reply(before, identities, 'already-current', target.player.translations.length);
		let translations: ImportPlayer['translations'];
		try {
			const config = await this.sourceSettings.getRuntime();
			// Validate against approved provider hosts, but retain the exact stored parent URL.
			if (!configuredImportPlayerUrl(target.player.iframeUrl, 'collaps', config)) return reply(before, identities, 'unsupported');
			const provider = (await this.getProviders()).collaps;
			if (!provider.status().configured) return reply(before, identities, 'unavailable');
			const record = await provider.fetch(target.ref, ['players']);
			if (!sameImportRef(record.ref, target.ref)) return reply(before, identities, 'unsupported');
			this.assertCompatibleIdentities(record, identities, target.ref.mediaType);
			const players = record.players.filter(player => player.source === 'collaps');
			if (players.length !== 1 || players[0].externalId !== target.ref.externalId || !Array.isArray(players[0].translations) || players[0].translations.length > 100) return reply(before, identities, 'unsupported');
			if (!players[0].translations.length) return reply(before, identities, 'empty');
			const ids = new Set<string>();
			const names = new Set<string>();
			translations = players[0].translations.map(translation => {
				if (typeof translation.id !== 'string' || !translation.id || translation.id.length > 100 || typeof translation.name !== 'string') throw new ImportProviderError('malformed-response');
				const name = translation.name.trim();
				const iframe = importPlayerTranslationUrl(target.player.iframeUrl, 'collaps', { id: translation.id, name });
				if (!iframe || ids.has(translation.id) || names.has(name)) throw new ImportProviderError('malformed-response');
				ids.add(translation.id);
				names.add(name);
				return { id: translation.id, name, iframe, ...(translation.quality === undefined ? {} : { quality: translation.quality }), ...(translation.resolutions === undefined ? {} : { resolutions: structuredClone(translation.resolutions) }) };
			});
		} catch {
			return reply(before, identities, 'unavailable');
		}
		return this.db.transaction(async manager => {
			// Match import's identity -> work lock ordering; never hold a connection over HTTP.
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-import-identities']);
			const repository = manager.getRepository(MiZalipWork);
			const current = await repository.findOne({ where: { id: workId }, lock: { mode: 'pessimistic_write' } });
			if (!current) throw new Error('NO_SUCH_WORK');
			const bindings = await manager.getRepository(MiZalipExternalIdentity).findBy({ workId });
			if (playbackRevision(current, bindings) !== expected) return reply(current, bindings, 'stale');
			if (readImportState(current.importData).locks.includes('players')) return reply(current, bindings, 'locked');
			const fresh = collapsVoiceTarget(current, bindings);
			if (!fresh || !sameImportRef(fresh.ref, target.ref) || fresh.index !== target.index) return reply(current, bindings, 'stale');
			if (fresh.player.translations.length) return reply(current, bindings, 'already-current', fresh.player.translations.length);
			const state = readImportState(current.importData);
			const players = structuredClone(state.values.players) as ImportPlayer[];
			players[fresh.index] = { ...players[fresh.index], translations };
			current.importData = { ...current.importData, values: { ...state.values, players } };
			// JSONB is replaced atomically; TypeORM's recursive partial type cannot represent unknown JSON values.
			await repository.update(workId, { importData: current.importData } as unknown as Parameters<typeof repository.update>[1]);
			return reply(current, bindings, 'updated', translations.length);
		});
	}

	private packProfile(profile: MiZalipImportProfile) {
		return { ...profile, options: profile.options ?? {}, lastRunAt: profile.lastRunAt?.toISOString() ?? null, nextRunAt: profile.nextRunAt?.toISOString() ?? null };
	}

	public async listProfiles() {
		return { profiles: (await this.db.getRepository(MiZalipImportProfile).find({ order: { name: 'ASC' }, take: 100 })).map(profile => this.packProfile(profile)) };
	}

	public async saveProfile(input: SaveImportProfile) {
		const providers = await this.getProviders();
		const name = input.name.trim();
		if (!name || name.length > 120 || !importSources.includes(input.source) || !['metadata', 'availability', 'collection', 'discovery'].includes(input.mode) || !Number.isInteger(input.intervalMinutes) || input.intervalMinutes < 15 || input.intervalMinutes > 43200 || (input.mode === 'collection' && (!input.collectionId || !/^[A-Za-z0-9_-]{1,100}$/u.test(input.collectionId)))) throw new ImportProviderError('invalid-ref');
		if (input.mode === 'collection' && !providers[input.source].status().capabilities.collections) throw new ImportProviderError('unsupported');
		if (input.mode === 'discovery' && (!providers[input.source].status().capabilities.updates || !providers[input.source].updates)) throw new ImportProviderError('unsupported');
		if (input.enabled && !providers[input.source].status().configured) throw new ImportProviderError('not-configured');
		return this.db.transaction(async manager => {
			if (input.id) await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-import-profile:${input.id}`]);
			const repository = manager.getRepository(MiZalipImportProfile);
			const existing = input.id ? await repository.findOne({ where: { id: input.id }, lock: { mode: 'pessimistic_write' } }) : null;
			if (input.id && !existing) throw new ImportProviderError('not-found');
			const options = normalizeImportOptions(input.options ?? existing?.options);
			// A title-specific manual choice is a one-off action, not a catalogue-wide cron policy.
			if (options.artworkSelections?.length) throw new Error('INVALID_IMPORT_OPTIONS');
			const lockedFields = normalizeImportOptions({ fields: (input.lockedFields ?? existing?.lockedFields ?? []) as ImportField[] }).fields!;
			const categoryIds = [...new Set(input.categoryIds ?? existing?.categoryIds ?? [])];
			if (categoryIds.length > 50 || (categoryIds.length && await manager.getRepository(MiZalipCatalogEntry).countBy({ id: In(categoryIds), type: 'category' }) !== categoryIds.length)) throw new Error('ZALIP_CATALOG_ENTRY_NOT_FOUND');
			const collectionId = input.mode === 'collection' ? input.collectionId! : null;
			const config = { name, source: input.source, mode: input.mode, intervalMinutes: input.intervalMinutes, collectionId, lockedFields, categoryIds, options };
			const changed = existing && Object.entries(config).some(([field, value]) => !sameValue(existing[field as keyof MiZalipImportProfile] ?? (field === 'options' ? {} : null), value));
			if (changed && await manager.getRepository(MiZalipImportRun).existsBy({ profileId: existing.id, state: In(['queued', 'running', 'paused']) })) throw new Error('IMPORT_RUN_BUSY');
			const resetCursor = existing && (existing.source !== input.source || existing.mode !== input.mode || existing.collectionId !== collectionId);
			const profile = repository.create({ ...existing, ...config, enabled: input.enabled, id: existing?.id ?? this.idService.gen(), lastRunAt: existing?.lastRunAt ?? null, nextRunAt: input.enabled ? new Date(Date.now() + input.intervalMinutes * 60000) : null, lastError: resetCursor ? null : existing?.lastError ?? null, cursor: resetCursor ? 0 : existing?.cursor ?? 0 });
			return this.packProfile(await repository.save(profile));
		});
	}

	public async actionProfile(profileId: string, action: 'enable' | 'disable' | 'reset-cursor' | 'delete') {
		if (!['enable', 'disable', 'reset-cursor', 'delete'].includes(action)) throw new Error('INVALID_IMPORT_ACTION');
		const providers = action === 'enable' ? await this.getProviders() : null;
		return this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-import-profile:${profileId}`]);
			const repository = manager.getRepository(MiZalipImportProfile);
			const profile = await repository.findOne({ where: { id: profileId }, lock: { mode: 'pessimistic_write' } });
			if (!profile) throw new ImportProviderError('not-found');
			if (['reset-cursor', 'delete'].includes(action) && await manager.getRepository(MiZalipImportRun).existsBy({ profileId, state: In(['queued', 'running', 'paused']) })) throw new Error('IMPORT_RUN_BUSY');
			if (action === 'delete') {
				await repository.delete(profileId);
				return { id: profileId, deleted: true };
			}
			if (action === 'enable') {
				if (!providers?.[profile.source]?.status().configured) throw new ImportProviderError('not-configured');
				if (profile.mode === 'discovery' && !providers[profile.source].updates) throw new ImportProviderError('unsupported');
				profile.enabled = true;
				profile.nextRunAt = new Date(Date.now() + profile.intervalMinutes * 60000);
			} else if (action === 'disable') {
				profile.enabled = false;
				profile.nextRunAt = null;
			} else {
				profile.cursor = 0;
				profile.lastError = null;
			}
			return { id: profileId, profile: this.packProfile(await repository.save(profile)) };
		});
	}

	public async runProfile(profileId: string, scheduled = false) {
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [result] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [`zalip-import-profile:${profileId}`]) as { locked: boolean }[];
			locked = result.locked;
			if (!locked) throw new ImportProviderError('rate-limited');
			return await this.dispatchProfile(profileId, scheduled);
		} finally {
			try {
				if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [`zalip-import-profile:${profileId}`]);
			} finally {
				await connection.release();
			}
		}
	}

	private async dispatchProfile(profileId: string, scheduled: boolean) {
		const profiles = this.db.getRepository(MiZalipImportProfile);
		const profile = await profiles.findOneBy({ id: profileId });
		if (!profile) throw new ImportProviderError('not-found');
		// Re-check after taking the shared profile lock: disabling a claimed schedule must win.
		if (scheduled && !profile.enabled) throw new ImportProviderError('rate-limited');
		if (await this.db.getRepository(MiZalipImportRun).existsBy({ profileId, state: In(['queued', 'running', 'paused']) })) throw new ImportProviderError('rate-limited');
		try {
			let targets: { ref: ImportRef; workId: string | null }[];
			const providers = await this.getProviders();
			if (profile.mode === 'collection') {
				const page = await providers[profile.source].collection?.(profile.collectionId!, profile.cursor + 1);
				if (!page) throw new ImportProviderError('unsupported');
				targets = page.items.slice(0, 100).map(item => ({ ref: item.ref, workId: null }));
				profile.cursor = page.hasMore ? profile.cursor + 1 : 0;
			} else if (profile.mode === 'discovery') {
				const page = await providers[profile.source].updates?.(profile.cursor + 1);
				if (!page) throw new ImportProviderError('unsupported');
				targets = page.items.slice(0, 100).map(item => ({ ref: item.ref, workId: null }));
				profile.cursor = page.hasMore ? profile.cursor + 1 : 0;
			} else {
				const works = await this.db.getRepository(MiZalipWork).find({ order: { id: 'ASC' }, skip: profile.cursor, take: 100 });
				targets = [];
				for (const work of works) {
					try {
						targets.push(...await this.refsForWorks([work.id], profile.source));
					} catch (error) {
						// Local unmapped titles are skipped; API failures must not advance the profile cursor.
						if (!(error instanceof ImportProviderError) || !['invalid-ref', 'not-found'].includes(error.code)) throw error;
					}
				}
				profile.cursor = works.length === 100 ? profile.cursor + 100 : 0;
			}
			const run = await this.createRun({ mode: profile.mode === 'collection' || profile.mode === 'discovery' ? 'import' : profile.mode === 'availability' ? 'availability' : 'sync', lockedFields: profile.lockedFields, categoryIds: profile.categoryIds, options: profile.options, profileId }, undefined, targets);
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
			const claimed = await this.db.getRepository(MiZalipImportProfile).update({ id: profile.id, enabled: true, nextRunAt: profile.nextRunAt ?? IsNull() }, { nextRunAt: new Date(Date.now() + profile.intervalMinutes * 60000) });
			if (!claimed.affected) continue;
			try { await this.runProfile(profile.id, true); } catch { /* Error code is already recorded in the profile. */ }
		}
		// Retry already committed notices even when every import/discovery profile is disabled.
		const notificationErrors: unknown[] = [];
		// The two outboxes share a bounded dispatch claim; run them sequentially for fairness.
		for (const dispatch of [() => this.catalogue.dispatchPendingAllohaAvailabilityNotifications(), () => this.catalogue.dispatchPendingReleaseNotifications()]) {
			try { await dispatch(); } catch (error) { notificationErrors.push(error); }
		}
		if (notificationErrors.length) throw notificationErrors[0];
	}
}
