/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MiZalipMaintenanceProfile, MiZalipMaintenanceRun } from '@/models/ZalipMaintenanceRun.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { MiZalipCatalogRelation } from '@/models/ZalipCatalogRelation.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { ImportProviderError } from './zalip-importer/providers.js';
import { emptyMaintenanceCursor, normalizeMaintenanceInput, safeMaintenanceError, ZalipImporterMaintenanceService } from './ZalipImporterMaintenanceService.js';
import type { MaintenanceKind, MaintenanceSource } from './zalip-importer/types.js';

const isolated = vi.hoisted(() => ({ providers: vi.fn(), person: vi.fn() }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('./zalip-importer/providers.js', async original => ({ ...await original<typeof import('./zalip-importer/providers.js')>(), createImportProviders: isolated.providers, defaultImportTransport: () => { throw new Error('LIVE_NETWORK_FORBIDDEN'); } }));
vi.mock('./zalip-importer/persons.js', () => ({ fetchImportedPerson: isolated.person }));

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function matches(row: Row, where: Row | Row[]): boolean {
	if (Array.isArray(where)) return where.some(value => matches(row, value));
	return Object.entries(where).every(([key, value]) => {
		if (value && typeof value === 'object' && '_type' in value) {
			const op = value as Row;
			if (op._type === 'in') return op._value.includes(row[key]);
			if (op._type === 'moreThan') return row[key] > op._value;
			if (op._type === 'lessThanOrEqual') return row[key] != null && row[key] <= op._value;
			if (op._type === 'raw') return row[key]?.collaps === op._objectLiteralParameters.collectionId;
			throw new Error('UNKNOWN_OFFLINE_OPERATOR');
		}
		return row[key] === value;
	});
}

function repository(seed: Row[] = []) {
	const rows = structuredClone(seed);
	const select = (options: Row = {}) => {
		let result = rows.filter(row => !options.where || matches(row, options.where));
		for (const [key, direction] of Object.entries(options.order ?? {})) result = result.slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (direction === 'DESC' ? -1 : 1));
		return structuredClone(result.slice(0, options.take));
	};
	return {
		rows,
		create: (row: Row) => structuredClone(row),
		save: vi.fn(async (row: Row) => { const index = rows.findIndex(item => item.id === row.id); if (index < 0) rows.push(structuredClone(row)); else rows[index] = structuredClone(row); return structuredClone(row); }),
		find: vi.fn(async (options?: Row) => select(options)),
		findOne: vi.fn(async (options: Row) => select(options)[0] ?? null),
		findOneBy: vi.fn(async (where: Row) => select({ where })[0] ?? null),
		findOneByOrFail: vi.fn(async (where: Row) => select({ where })[0] ?? Promise.reject(new Error('MISSING_OFFLINE_ROW'))),
		findBy: vi.fn(async (where: Row | Row[]) => select({ where })),
		existsBy: vi.fn(async (where: Row) => rows.some(row => matches(row, where))),
		update: vi.fn(async (criteria: Row | string, patch: Row) => { const selected = rows.filter(row => matches(row, typeof criteria === 'string' ? { id: criteria } : criteria)); selected.forEach(row => Object.assign(row, structuredClone(patch))); return { affected: selected.length }; }),
		delete: vi.fn(async (id: string) => { const index = rows.findIndex(row => row.id === id); if (index >= 0) rows.splice(index, 1); return { affected: index < 0 ? 0 : 1 }; }),
	};
}

function run(kind: MaintenanceKind = 'collections-dictionary', source: MaintenanceSource = 'collaps', extra: Row = {}): Row {
	return { id: 'run', kind, source, state: 'queued', createdAt: new Date(), updatedAt: new Date(), finishedAt: null, profileId: null, createdById: null, options: {}, batchLimit: 20, timeBudgetSeconds: 60, cursor: emptyMaintenanceCursor(), stats: { processed: 0, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 }, error: null, retryAfter: null, warnings: [], ...extra };
}

function fixture(seed: { runs?: Row[]; profiles?: Row[]; entries?: Row[]; works?: Row[]; identities?: Row[]; relations?: Row[] } = {}) {
	const runs = repository(seed.runs), profiles = repository(seed.profiles), entries = repository(seed.entries), works = repository(seed.works), identities = repository(seed.identities), relations = repository(seed.relations);
	const repos = new Map<unknown, ReturnType<typeof repository>>([[MiZalipMaintenanceRun, runs], [MiZalipMaintenanceProfile, profiles], [MiZalipCatalogEntry, entries], [MiZalipWork, works], [MiZalipExternalIdentity, identities], [MiZalipCatalogRelation, relations]]);
	let held = false;
	const connection = { connect: vi.fn(), release: vi.fn(), query: vi.fn(async (sql: string) => { if (sql.includes('pg_try_advisory_lock')) { const locked = !held; held = true; return [{ locked }]; } held = false; return []; }) };
	const db = { getRepository: (model: unknown) => { const repo = repos.get(model); if (!repo) throw new Error('UNKNOWN_OFFLINE_REPOSITORY'); return repo; }, query: vi.fn(), transaction: vi.fn(async (action: (manager: unknown) => unknown) => action(db)), createQueryRunner: () => connection };
	const providers = Object.fromEntries(['tmdb', 'kinopoisk', 'collaps'].map(source => [source, { status: () => ({ configured: true }), collectionDictionary: vi.fn().mockResolvedValue({ items: [], hasMore: false, page: 1, warnings: [] }), collectionMembers: vi.fn().mockResolvedValue({ items: [], hasMore: false, page: 1 }) }])) as Record<string, { status: ReturnType<typeof vi.fn> | (() => { configured: boolean }); collectionDictionary: ReturnType<typeof vi.fn>; collectionMembers: ReturnType<typeof vi.fn> }>;
	isolated.providers.mockReturnValue(providers);
	const taxonomy = {
		upsertImportedEntry: vi.fn(async (input: Row) => { const existing = entries.rows.find(row => row.externalIds?.collaps === input.externalIds.collaps); const row = { id: existing?.id ?? `entry${entries.rows.length}`, ...input, data: { ...input.data, ...existing?.data } }; await entries.save(row); return row; }),
		linkWork: vi.fn(async (input: Row, source: string) => { if (!await relations.existsBy({ ...input, source })) await relations.save({ id: `relation${relations.rows.length}`, ...input, source }); return true; }),
		enrichPerson: vi.fn(async (entryId: string, source: string, fetcher: (id: string) => unknown) => { await fetcher(entries.rows.find(row => row.id === entryId)!.externalIds[source]); return { changedFields: ['description'] }; }),
	};
	let nextId = 0;
	const queue = { add: vi.fn().mockResolvedValue({}) };
	const sourceSettings = { getRuntime: vi.fn().mockResolvedValue({ apiOrigins: { tmdb: 'https://api.themoviedb.org', kinopoisk: 'https://kinopoiskapiunofficial.tech', alloha: 'https://apbugall.org', collaps: 'https://api.bhcesh.me' }, allohaPlayerOrigin: 'https://ascorbic-as.stravers.live', collapsPlayerOrigin: 'https://api.nextembed.ws' }) };
	const service = new ZalipImporterMaintenanceService(db as never, {} as never, queue as never, { gen: () => `generated${++nextId}` } as never, taxonomy as never, sourceSettings as never);
	return { service, runs, profiles, entries, works, identities, relations, providers, taxonomy, queue, db, connection, sourceSettings };
}

beforeEach(() => { vi.clearAllMocks(); isolated.person.mockResolvedValue({ type: 'person', name: 'Person', externalIds: { tmdb: '1' } }); });

describe('durable maintenance policy', () => {
	test('resource kinds and sources are explicit and bounds are enforced', () => {
		expect(normalizeMaintenanceInput({ kind: 'collections-dictionary', source: 'collaps' })).toMatchObject({ batchLimit: 20, timeBudgetSeconds: 60, options: {} });
		for (const input of [{ kind: 'collections-dictionary', source: 'tmdb' }, { kind: 'person-enrichment', source: 'collaps' }, { kind: 'collection-backfill', source: 'collaps', batchLimit: 100 }, { kind: 'collection-backfill', source: 'collaps', options: { collectionIds: ['secret'] } }, { kind: 'person-enrichment', source: 'tmdb', options: { collectionIds: [] } }]) expect(() => normalizeMaintenanceInput(input as never)).toThrow('invalid-ref');
	});
	test('safe errors discard upstream URLs and unknown exception messages', () => {
		expect(safeMaintenanceError(new Error('https://upstream?token=fixture'))).toBe('maintenance-failed');
		expect(safeMaintenanceError(new ImportProviderError('quota-exceeded'))).toBe('quota-exceeded');
	});
});

describe('maintenance orchestration without network or database', () => {
	test('create persists typed durable resource and queues IDs only', async () => {
		const context = fixture();
		const { runId } = await context.service.createRun({ kind: 'collections-dictionary', source: 'collaps' }, 'admin');
		expect(context.runs.rows[0]).toMatchObject({ id: runId, createdById: 'admin', kind: 'collections-dictionary', state: 'queued', cursor: emptyMaintenanceCursor() });
		expect(context.queue.add.mock.calls[0][1]).toEqual({ runId });
		expect(context.runs.rows[0]).not.toHaveProperty('ref');
	});
	test('unconfigured create cannot enqueue or persist', async () => {
		const context = fixture(); context.providers.collaps.status = () => ({ configured: false });
		await expect(context.service.createRun({ kind: 'collections-dictionary', source: 'collaps' })).rejects.toMatchObject({ code: 'not-configured' });
		expect(context.runs.rows).toHaveLength(0); expect(context.queue.add).not.toHaveBeenCalled();
	});
	test('dictionary imports bounded stages and persists page cursor before continuation', async () => {
		const context = fixture({ runs: [run()] });
		context.providers.collaps.collectionDictionary.mockResolvedValueOnce({ items: Array.from({ length: 20 }, (_, index) => ({ externalId: String(index + 1), name: `Collection ${index + 1}` })), hasMore: true, page: 1, warnings: [] }).mockResolvedValue({ items: [{ externalId: '21', name: 'Collection 21' }], hasMore: false, page: 2, warnings: [] });
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'queued', cursor: { page: 2, offset: 0 }, stats: { processed: 20, created: 20 } });
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'completed', stats: { processed: 21, created: 21 } });
		expect(context.entries.rows).toHaveLength(21);
	});
	test('quota pause persists exact offset, retry time and safe error', async () => {
		const context = fixture({ runs: [run()] });
		context.providers.collaps.collectionDictionary.mockRejectedValueOnce(new ImportProviderError('quota-exceeded', 60000));
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'paused', error: 'quota-exceeded', cursor: emptyMaintenanceCursor() });
		expect(context.runs.rows[0].retryAfter.getTime()).toBeGreaterThan(Date.now());
		await context.service.actionRun('run', 'resume'); await context.service.processRun('run');
		expect(context.runs.rows[0].state).toBe('completed');
	});
	test('partial-page cursor resumes without replaying already committed entries', async () => {
		const context = fixture({ runs: [run('collections-dictionary', 'collaps', { cursor: { ...emptyMaintenanceCursor(), offset: 1 } })] });
		context.providers.collaps.collectionDictionary.mockResolvedValue({ items: [{ externalId: '1', name: 'First' }, { externalId: '2', name: 'Second' }], hasMore: false, page: 1, warnings: [] });
		await context.service.processRun('run');
		expect(context.taxonomy.upsertImportedEntry).toHaveBeenCalledTimes(1);
		expect(context.taxonomy.upsertImportedEntry.mock.calls[0][0].name).toBe('Second');
	});
	test('cancelled jobs never write, and a cancellation during fetch wins', async () => {
		const cancelled = fixture({ runs: [run('collections-dictionary', 'collaps', { state: 'cancelled' })] });
		await cancelled.service.processRun('run'); expect(cancelled.taxonomy.upsertImportedEntry).not.toHaveBeenCalled();
		const context = fixture({ runs: [run()] });
		context.providers.collaps.collectionDictionary.mockImplementation(async () => { await context.service.actionRun('run', 'cancel'); return { items: [{ externalId: '1', name: 'First' }], hasMore: false }; });
		await context.service.processRun('run');
		expect(context.runs.rows[0].state).toBe('cancelled'); expect(context.taxonomy.upsertImportedEntry).not.toHaveBeenCalled();
	});
	test('backfill links only exact existing identities, preserves manual and skips locked/conflicting works', async () => {
		const items = [1, 2, 3, 4].map(id => ({ externalId: String(id), mediaType: 'movie', identities: [{ provider: 'collaps', externalId: String(id), entityType: 'movie' }] }));
		items[3].identities.push({ provider: 'kinopoisk', externalId: '44', entityType: 'movie' });
		const context = fixture({ runs: [run('collection-backfill')], entries: [{ id: 'collection', type: 'collection', externalIds: { collaps: '99' }, data: { isEnabled: true } }], works: [{ id: 'work1', publicationState: 'published', importData: {} }, { id: 'work2', importData: { locks: ['collections'] } }, { id: 'work4', importData: {} }, { id: 'other', importData: {} }], identities: [{ id: 'i1', provider: 'collaps', externalId: '1', entityType: 'movie', workId: 'work1' }, { id: 'i2', provider: 'collaps', externalId: '2', entityType: 'movie', workId: 'work2' }, { id: 'i4', provider: 'collaps', externalId: '4', entityType: 'movie', workId: 'work4' }, { id: 'ix', provider: 'kinopoisk', externalId: '44', entityType: 'movie', workId: 'other' }], relations: [{ id: 'manual', entryId: 'collection', workId: 'work1', source: 'manual' }] });
		context.providers.collaps.collectionMembers.mockResolvedValue({ items, hasMore: false, page: 1 });
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'completed', stats: { linked: 1, skipped: 3, processed: 4 }, warnings: ['collection-field-locked', 'collection-identity-conflict'] });
		expect(context.taxonomy.linkWork).toHaveBeenCalledTimes(1); expect(context.works.rows[0].publicationState).toBe('published');
		expect(context.relations.rows.some(row => row.id === 'manual')).toBe(true); expect(context.works.rows).toHaveLength(4);
	});
	test('disabled and unselected collections send no provider requests', async () => {
		const context = fixture({ runs: [run('collection-backfill', 'collaps', { options: { collectionIds: ['7'] } })], entries: [{ id: 'a', type: 'collection', externalIds: { collaps: '7' }, data: { isEnabled: false } }, { id: 'b', type: 'collection', externalIds: { collaps: '8' }, data: {} }] });
		await context.service.processRun('run'); expect(context.providers.collaps.collectionMembers).not.toHaveBeenCalled();
		expect(context.runs.rows[0].state).toBe('completed');
	});
	test('person maintenance uses verified source IDs and advances past missing IDs', async () => {
		const context = fixture({ runs: [run('person-enrichment', 'tmdb')], entries: [{ id: 'a', type: 'person', externalIds: { tmdb: '1' }, data: {} }, { id: 'b', type: 'person', externalIds: {}, data: {} }] });
		await context.service.processRun('run');
		expect(context.taxonomy.enrichPerson.mock.calls[0].slice(0, 2)).toEqual(['a', 'tmdb']);
		expect(isolated.person.mock.calls[0].slice(0, 2)).toEqual(['tmdb', '1']);
		expect(context.runs.rows[0]).toMatchObject({ state: 'completed', stats: { updated: 1, skipped: 1, processed: 2 }, warnings: ['person-id-missing'], cursor: { entryAfterId: 'b' } });
	});
	test('new profiles stay disabled, enable is explicit, busy reset/delete is rejected', async () => {
		const context = fixture();
		const profile = await context.service.saveProfile({ name: 'Person daily', kind: 'person-enrichment', source: 'tmdb', intervalMinutes: 1440 });
		expect(profile).toMatchObject({ enabled: false, nextRunAt: null });
		await context.service.tickSchedules(); expect(context.runs.rows).toHaveLength(0);
		await context.service.actionProfile(profile.id, 'enable'); await context.service.tickSchedules();
		expect(context.runs.rows).toHaveLength(1);
		await expect(context.service.actionProfile(profile.id, 'reset-cursor')).rejects.toThrow('IMPORT_RUN_BUSY');
		await expect(context.service.actionProfile(profile.id, 'delete')).rejects.toThrow('IMPORT_RUN_BUSY');
		await context.service.actionProfile(profile.id, 'disable');
		expect(context.runs.rows[0].state).toBe('queued');
	});
	test('scheduler does not create duplicate jobs for a paused profile and can safely recover interruption', async () => {
		const context = fixture({ runs: [run('person-enrichment', 'tmdb', { state: 'running' })] });
		await context.service.recoverInterruptedRuns();
		expect(context.runs.rows[0].state).toBe('queued');
		await context.service.processRun('run'); expect(context.runs.rows[0].state).toBe('completed');
	});
	test('one unconfigured paused source does not block queued jobs or due profiles of other sources', async () => {
		const context = fixture({ runs: [run('person-enrichment', 'tmdb', { id: 'paused', state: 'paused', retryAfter: new Date(Date.now() - 1000) }), run('collections-dictionary', 'collaps', { id: 'queued' })] });
		context.providers.tmdb.status = () => ({ configured: false });
		const profile = await context.service.saveProfile({ name: 'Dictionary', kind: 'collections-dictionary', source: 'collaps', intervalMinutes: 60 });
		await context.service.actionProfile(profile.id, 'enable');
		await expect(context.service.tickSchedules()).resolves.toBeUndefined();
		expect(context.runs.rows.find(row => row.id === 'paused')).toMatchObject({ state: 'paused', error: 'not-configured' });
		expect(context.runs.rows.find(row => row.profileId === profile.id)).toMatchObject({ state: 'queued', source: 'collaps' });
		expect(context.queue.add.mock.calls.some(call => call[1].runId === 'queued')).toBe(true);
	});
	test('completed profile can reset/delete without touching catalogue data', async () => {
		const context = fixture();
		const profile = await context.service.saveProfile({ name: 'Dictionary', kind: 'collections-dictionary', source: 'collaps', intervalMinutes: 60 });
		await context.service.actionProfile(profile.id, 'reset-cursor');
		expect(await context.service.actionProfile(profile.id, 'delete')).toBeNull();
		expect(context.profiles.rows).toHaveLength(0);
	});

	test('historical failed runs cannot resume into an edited profile or overwrite its cursor', async () => {
		const context = fixture();
		const profile = await context.service.saveProfile({ name: 'Old dictionary', kind: 'collections-dictionary', source: 'collaps', intervalMinutes: 60 });
		await context.runs.save(run('collections-dictionary', 'collaps', { profileId: profile.id, state: 'failed', cursor: { ...emptyMaintenanceCursor(), page: 7 } }));
		await context.service.saveProfile({ profileId: profile.id, name: 'People', kind: 'person-enrichment', source: 'tmdb', intervalMinutes: 60 });
		await expect(context.service.actionRun('run', 'resume')).rejects.toThrow('IMPORT_RUN_BUSY');
		expect(context.profiles.rows[0].cursor).toEqual(emptyMaintenanceCursor());
		expect(context.runs.rows[0].state).toBe('failed');
	});

	test('an explicit profile cursor reset also rejects historical same-configuration resume', async () => {
		const context = fixture();
		const profile = await context.service.saveProfile({ name: 'Dictionary', kind: 'collections-dictionary', source: 'collaps', intervalMinutes: 60 });
		const cursor = { ...emptyMaintenanceCursor(), page: 7 };
		await context.profiles.update(profile.id, { cursor });
		await context.runs.save(run('collections-dictionary', 'collaps', { profileId: profile.id, state: 'failed', cursor }));
		await context.service.actionProfile(profile.id, 'reset-cursor');
		await expect(context.service.actionRun('run', 'resume')).rejects.toThrow('IMPORT_RUN_BUSY');
		expect(context.profiles.rows[0].cursor).toEqual(emptyMaintenanceCursor());
	});
});
