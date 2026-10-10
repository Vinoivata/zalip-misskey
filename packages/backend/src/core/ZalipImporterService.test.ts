/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ZalipImporterService, safeImportError } from '@/core/ZalipImporterService.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipImportItem, MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { MiZalipImportProfile } from '@/models/ZalipImportProfile.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { ImportProviderError } from './zalip-importer/providers.js';
import { importSources, type ImportProvider, type ImportRecord, type ImportRef, type ImportSource } from './zalip-importer/types.js';

const isolated = vi.hoisted(() => ({ providers: vi.fn(), apply: vi.fn() }));

// No runtime credentials, live transport, Redis or Bull worker is used in this suite.
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));
vi.mock('./zalip-importer/providers.js', async importOriginal => ({
	...await importOriginal<typeof import('./zalip-importer/providers.js')>(),
	createImportProviders: isolated.providers,
	defaultImportTransport: () => { throw new Error('LIVE_TRANSPORT_FORBIDDEN'); },
}));
vi.mock('./zalip-importer/apply.js', async importOriginal => ({
	...await importOriginal<typeof import('./zalip-importer/apply.js')>(),
	applyImportRecord: isolated.apply,
}));

type Row = Record<string, unknown>;
type Where = Row | Row[];

function matches(row: Row, where: Where): boolean {
	if (Array.isArray(where)) return where.some(value => matches(row, value));
	return Object.entries(where).every(([key, value]) => {
		if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
		if (value != null && typeof value === 'object' && '_type' in value) {
			const operator = value as { _type: string; _value: unknown };
			if (operator._type === 'in') return (operator._value as unknown[]).includes(row[key]);
			if (operator._type === 'isNull') return row[key] == null;
			if (operator._type === 'lessThanOrEqual') return row[key] != null && Number(row[key]) <= Number(operator._value);
			throw new Error(`UNSUPPORTED_TEST_OPERATOR:${operator._type}`);
		}
		return row[key] === value;
	});
}

function memoryRepository(seed: object[] = []) {
	const rows = structuredClone(seed) as Row[];
	const select = (options: { where?: Where; order?: Record<string, string>; skip?: number; take?: number } = {}) => {
		let selected = rows.filter(row => options.where == null || matches(row, options.where));
		if (options.order) {
			for (const [key, direction] of Object.entries(options.order).reverse()) {
				selected = selected.slice().sort((a, b) => {
					const first = a[key] instanceof Date ? a[key].getTime() : String(a[key]);
					const second = b[key] instanceof Date ? b[key].getTime() : String(b[key]);
					return (first < second ? -1 : first > second ? 1 : 0) * (direction === 'DESC' ? -1 : 1);
				});
			}
		}
		return structuredClone(selected.slice(options.skip ?? 0, options.take == null ? undefined : (options.skip ?? 0) + options.take));
	};
	return {
		rows,
		create: vi.fn((value: Row) => structuredClone(value)),
		save: vi.fn(async (value: Row | Row[]) => {
			for (const item of Array.isArray(value) ? value : [value]) {
				const index = rows.findIndex(row => row.id === item.id);
				if (index === -1) rows.push(structuredClone(item));
				else rows[index] = structuredClone(item);
			}
			return structuredClone(value);
		}),
		find: vi.fn(async (options?: Parameters<typeof select>[0]) => select(options)),
		findBy: vi.fn(async (where: Where) => select({ where })),
		findOne: vi.fn(async (options: Parameters<typeof select>[0]) => select(options)[0] ?? null),
		findOneBy: vi.fn(async (where: Where) => select({ where })[0] ?? null),
		findOneByOrFail: vi.fn(async (where: Where) => {
			const row = select({ where }).at(0);
			if (!row) throw new Error('TEST_ROW_NOT_FOUND');
			return row;
		}),
		existsBy: vi.fn(async (where: Where) => rows.some(row => matches(row, where))),
		countBy: vi.fn(async (where: Where) => rows.filter(row => matches(row, where)).length),
		update: vi.fn(async (criteria: string | Where, value: Row) => {
			const selected = rows.filter(row => matches(row, typeof criteria === 'string' ? { id: criteria } : criteria));
			for (const row of selected) Object.assign(row, structuredClone(value));
			return { affected: selected.length };
		}),
	};
}

function record(values: Partial<ImportRecord> = {}): ImportRecord {
	return {
		ref: { source: 'tmdb', externalId: '100', mediaType: 'movie' }, identities: [{ provider: 'tmdb', externalId: '100', entityType: 'movie' }],
		title: 'Provider title', originalTitle: null, description: 'Provider description', releaseYear: 2026, runtimeMinutes: 90, kind: 'movie',
		genres: ['драма'], countries: ['Россия'], posterUrl: null, backdropUrl: null, logoUrl: null, galleryUrls: [], trailerYoutubeKey: null,
		ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [], ...values,
	};
}

function work(values: Partial<MiZalipWork> = {}): MiZalipWork {
	return {
		id: 'canonical', slug: 'canonical', title: 'Editorial title', kind: 'movie', publicationState: 'published', publishedAt: new Date('2026-01-01'),
		createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), originalTitle: null, description: null,
		releaseYear: null, runtimeMinutes: null, genres: [], posterPath: null, backdropPath: null, logoPath: null,
		galleryPaths: [], trailerYoutubeKey: null, tmdbMediaType: 'movie', tmdbId: 100, importData: {}, ...values,
	};
}

function run(values: Partial<MiZalipImportRun> = {}): MiZalipImportRun {
	return { id: 'run', state: 'queued', mode: 'import', createdAt: new Date(), updatedAt: new Date(), createdById: null, profileId: null, lockedFields: [], categoryIds: [], error: null, retryAt: null, ...values };
}

function item(values: Partial<MiZalipImportItem> = {}): MiZalipImportItem {
	return { id: 'item', runId: 'run', position: 0, state: 'pending', ref: record().ref, workId: null, error: null, updatedAt: new Date(), run: null, ...values };
}

function profile(values: Partial<MiZalipImportProfile> = {}): MiZalipImportProfile {
	return { id: 'profile', name: 'Collection', enabled: true, source: 'tmdb', mode: 'metadata', intervalMinutes: 15, collectionId: null, lockedFields: [], categoryIds: [], lastRunAt: null, nextRunAt: new Date('2026-01-01'), lastError: null, cursor: 0, ...values };
}

function fixture(seed: { runs?: MiZalipImportRun[]; items?: MiZalipImportItem[]; works?: MiZalipWork[]; identities?: object[]; profiles?: MiZalipImportProfile[]; entries?: object[] } = {}) {
	const runs = memoryRepository(seed.runs);
	const items = memoryRepository(seed.items);
	const works = memoryRepository(seed.works);
	const identities = memoryRepository(seed.identities);
	const profiles = memoryRepository(seed.profiles);
	const entries = memoryRepository(seed.entries);
	const repositories = new Map<unknown, ReturnType<typeof memoryRepository>>([
		[MiZalipImportRun, runs], [MiZalipImportItem, items], [MiZalipWork, works],
		[MiZalipExternalIdentity, identities], [MiZalipImportProfile, profiles], [MiZalipCatalogEntry, entries],
	]);
	const advisoryLocks = new Set<string>();
	const connection = {
		connect: vi.fn(), release: vi.fn(),
		query: vi.fn(async (sql: string, parameters: string[]) => {
			const name = parameters[0];
			if (sql.includes('pg_try_advisory_lock')) {
				const locked = !advisoryLocks.has(name);
				if (locked) advisoryLocks.add(name);
				return [{ locked }];
			}
			advisoryLocks.delete(name);
			return [];
		}),
	};
	const db = {
		getRepository: (model: unknown) => {
			const repository = repositories.get(model);
			if (!repository) throw new Error('UNEXPECTED_TEST_REPOSITORY');
			return repository;
		},
		transaction: vi.fn(async (action: (manager: unknown) => Promise<unknown>) => action(db)),
		createQueryRunner: () => connection,
	};
	const providers = Object.fromEntries(importSources.map(source => [source, {
		status: () => ({ source, configured: source === 'tmdb', capabilities: { search: true, collections: true, updates: true }, dailyLimit: null }),
		search: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }),
		fetch: vi.fn().mockImplementation(async (ref: ImportRef) => record({ ref })),
		lookup: vi.fn().mockResolvedValue(null),
		collection: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }),
	}])) as unknown as Record<ImportSource, ImportProvider & { fetch: ReturnType<typeof vi.fn>; lookup: ReturnType<typeof vi.fn>; collection: ReturnType<typeof vi.fn> }>;
	isolated.providers.mockReturnValue(providers);
	isolated.apply.mockResolvedValue({ work: work({ publicationState: 'draft', publishedAt: null }), created: true, protectedFields: [] });
	const jobs = new Map<string, { runId: string }>();
	const queue = { add: vi.fn(async (name: string, data: { runId: string }, options: { jobId: string }) => {
		if (!jobs.has(options.jobId)) jobs.set(options.jobId, structuredClone(data));
		return { id: options.jobId, name };
	}) };
	const catalogue = { recordAllohaAvailability: vi.fn(), dispatchPendingAllohaAvailabilityNotifications: vi.fn() };
	const taxonomy = { syncImportedWork: vi.fn(), linkWork: vi.fn(), upsertImportedEntry: vi.fn().mockResolvedValue({ id: 'collection' }) };
	let nextId = 0;
	const service = new ZalipImporterService(db as never, {} as never, queue as never, { gen: () => `id-${++nextId}` } as never, catalogue as never, taxonomy as never);
	return { service, runs, items, works, identities, profiles, entries, providers, queue, jobs, catalogue, taxonomy, connection };
}

function enable(context: ReturnType<typeof fixture>, source: ImportSource) {
	context.providers[source].status = () => ({ source, configured: true, capabilities: { search: true, collections: true, updates: true }, dailyLimit: null });
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(settle => { resolve = settle; });
	return { promise, resolve };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('Zalip importer orchestration', () => {
	test('persists bounded targets and sends IDs only to the job queue', async () => {
		const context = fixture();
		const result = await context.service.createRun({ refs: [record().ref], mode: 'import', lockedFields: ['title', 'title'] }, 'admin');
		expect(context.runs.rows[0]).toMatchObject({ id: result.id, state: 'queued', createdById: 'admin', lockedFields: ['title'] });
		expect(context.items.rows[0]).toMatchObject({ runId: result.id, state: 'pending', position: 0, workId: null, ref: record().ref });
		expect(context.queue.add).toHaveBeenCalledWith('import', { runId: result.id }, expect.objectContaining({ attempts: 3 }));
	});

	test('rejects empty, oversized, mixed and unconfigured requests before creating jobs', async () => {
		const context = fixture();
		for (const input of [{ refs: [], mode: 'import' as const }, { refs: Array.from({ length: 101 }, () => record().ref), mode: 'import' as const }, { refs: [record().ref], workIds: ['canonical'], mode: 'sync' as const }]) {
			await expect(context.service.createRun(input)).rejects.toThrow('invalid-ref');
		}
		await expect(context.service.createRun({ refs: [{ source: 'kinopoisk', externalId: '100', mediaType: 'movie' }], mode: 'import' })).rejects.toThrow('not-configured');
		expect(context.queue.add).not.toHaveBeenCalled();
		expect(context.runs.rows).toEqual([]);
	});

	test('binds canonical work IDs before queueing refreshes and rejects invalid category IDs', async () => {
		const context = fixture({ works: [work()], identities: [{ id: 'identity', workId: 'canonical', provider: 'tmdb', externalId: '100', entityType: 'movie' }] });
		await context.service.createRun({ workIds: ['canonical'], mode: 'sync' });
		expect(context.items.rows[0]).toMatchObject({ workId: 'canonical', ref: record().ref });
		await expect(context.service.createRun({ refs: [record().ref], mode: 'import', categoryIds: ['not-a-category'] })).rejects.toThrow('ZALIP_CATALOG_ENTRY_NOT_FOUND');
		expect(context.runs.rows).toHaveLength(1);
	});

	test('passes canonical IDs, provenance locks and protected taxonomy fields to their boundaries', async () => {
		const context = fixture({ runs: [run({ mode: 'sync', lockedFields: ['credits'], categoryIds: ['category'] })], items: [item({ workId: 'canonical' })], works: [work()] });
		isolated.apply.mockResolvedValue({ work: work(), created: false, protectedFields: ['credits', 'genres'] });
		await context.service.processRun('run');
		expect(isolated.apply).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ title: 'Provider title' }), expect.objectContaining({ title: 'tmdb' }), { workId: 'canonical', lockedFields: ['credits'], mode: 'sync' });
		expect(context.taxonomy.syncImportedWork).toHaveBeenCalledWith('canonical', expect.anything(), ['credits', 'genres']);
		expect(context.taxonomy.linkWork).toHaveBeenCalledWith({ entryId: 'category', workId: 'canonical' });
		expect(context.runs.rows[0].state).toBe('completed');
		expect(context.items.rows[0]).toMatchObject({ state: 'completed', workId: 'canonical' });
		expect(context.connection.release).toHaveBeenCalledOnce();
	});

	test('availability-only refreshes skip metadata providers and taxonomy changes', async () => {
		const context = fixture({ runs: [run({ mode: 'availability' })], items: [item({ ref: { source: 'alloha', externalId: '100', mediaType: 'movie' }, workId: 'canonical' })], works: [work({ importData: { values: { players: [] } } })] });
		enable(context, 'alloha');
		enable(context, 'kinopoisk');
		isolated.apply.mockResolvedValue({ work: work(), created: false, protectedFields: ['title', 'genres'] });
		await context.service.processRun('run');
		expect(context.providers.kinopoisk.lookup).not.toHaveBeenCalled();
		expect(context.providers.tmdb.lookup).not.toHaveBeenCalled();
		expect(context.taxonomy.syncImportedWork).not.toHaveBeenCalled();
		expect(isolated.apply.mock.calls[0][4]).toMatchObject({ mode: 'availability', workId: 'canonical' });
	});

	test('pauses on provider quota without failing the item, then resumes pending work only', async () => {
		const context = fixture({ runs: [run()], items: [item(), item({ id: 'done', position: 1, state: 'completed' })] });
		context.providers.tmdb.fetch.mockRejectedValueOnce(new ImportProviderError('quota-exceeded', 10000));
		const started = Date.now();
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'paused', error: 'quota-exceeded' });
		expect(Number(context.runs.rows[0].retryAt)).toBeGreaterThanOrEqual(started + 10000);
		expect(context.items.rows[0]).toMatchObject({ state: 'pending', error: 'quota-exceeded' });
		expect(isolated.apply).not.toHaveBeenCalled();
		await context.service.actionRun('run', 'resume');
		await context.service.processRun('run');
		expect(context.runs.rows[0].state).toBe('completed');
		expect(context.providers.tmdb.fetch).toHaveBeenCalledTimes(2);
		expect(isolated.apply).toHaveBeenCalledOnce();
		expect(context.items.rows[1].state).toBe('completed');
	});

	test.each(['pause', 'cancel'] as const)('%s during an in-flight fetch prevents application and releases the worker lock', async action => {
		const context = fixture({ runs: [run()], items: [item()] });
		const fetching = deferred<void>();
		const response = deferred<ImportRecord>();
		context.providers.tmdb.fetch.mockImplementationOnce(async () => { fetching.resolve(); return response.promise; });
		const processing = context.service.processRun('run');
		await fetching.promise;
		await context.service.actionRun('run', action);
		response.resolve(record());
		await processing;
		expect(context.runs.rows[0].state).toBe(action === 'pause' ? 'paused' : 'cancelled');
		expect(context.items.rows[0].state).toBe('pending');
		expect(isolated.apply).not.toHaveBeenCalled();
		expect(context.connection.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock(hashtext($1))', ['zalip-import:run']);
		expect(context.connection.release).toHaveBeenCalledOnce();
	});

	test('cancelled runs cannot be resumed and never fetch provider data', async () => {
		const context = fixture({ runs: [run({ state: 'cancelled' })], items: [item()] });
		await expect(context.service.actionRun('run', 'resume')).resolves.toMatchObject({ state: 'cancelled' });
		await context.service.processRun('run');
		expect(context.providers.tmdb.fetch).not.toHaveBeenCalled();
		expect(context.queue.add).not.toHaveBeenCalled();
	});

	test('a pause or cancellation between the worker read and claim cannot be overwritten', async () => {
		for (const state of ['paused', 'cancelled']) {
			const context = fixture({ runs: [run()], items: [item()] });
			context.runs.findOneBy.mockImplementationOnce(async () => {
				const before = structuredClone(context.runs.rows[0]);
				context.runs.rows[0].state = state;
				return before;
			});
			await context.service.processRun('run');
			expect(context.runs.rows[0].state).toBe(state);
			expect(context.providers.tmdb.fetch).not.toHaveBeenCalled();
		}
	});

	test('a late pause or cancellation cannot change a run completed after the action read', async () => {
		for (const action of ['pause', 'cancel'] as const) {
			const context = fixture({ runs: [run({ state: 'running' })] });
			context.runs.findOneBy.mockImplementationOnce(async () => {
				const before = structuredClone(context.runs.rows[0]);
				context.runs.rows[0].state = 'completed';
				return before;
			});
			await expect(context.service.actionRun('run', action)).resolves.toMatchObject({ state: 'completed' });
		}
	});

	test('concurrent resume requests transition once and enqueue one continuation', async () => {
		const context = fixture({ runs: [run({ state: 'paused' })], items: [item({ state: 'failed' })] });
		await Promise.all([context.service.actionRun('run', 'resume'), context.service.actionRun('run', 'resume')]);
		expect(context.queue.add).toHaveBeenCalledOnce();
		expect(context.runs.rows[0].state).toBe('queued');
		expect(context.items.rows[0].state).toBe('pending');
	});

	test('failed items retain safe codes and retries do not reimport completed items', async () => {
		const context = fixture({ runs: [run()], items: [item(), item({ id: 'done', position: 1, state: 'completed' })] });
		context.providers.tmdb.fetch.mockRejectedValueOnce(new Error('https://upstream.test/?token=PRIVATE_EXAMPLE'));
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'failed', error: 'import-failed' });
		expect(context.runs.rows[0]).toMatchObject({ state: 'failed', error: 'some-items-failed' });
		await context.service.actionRun('run', 'retry');
		await context.service.processRun('run');
		expect(isolated.apply).toHaveBeenCalledOnce();
		expect(context.runs.rows[0].state).toBe('completed');
		expect(JSON.stringify(await context.service.showRun('run'))).not.toContain('PRIVATE_EXAMPLE');
	});

	test('retries a taxonomy failure against the saved canonical work ID', async () => {
		const context = fixture({ runs: [run()], items: [item()], works: [work()] });
		context.taxonomy.syncImportedWork.mockRejectedValueOnce(new Error('database unavailable'));
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'failed', workId: 'canonical' });
		await context.service.actionRun('run', 'retry');
		await context.service.processRun('run');
		expect(isolated.apply.mock.calls[1][4]).toMatchObject({ workId: 'canonical' });
	});

	test('session lock contention does not process or mutate the same run concurrently', async () => {
		const context = fixture({ runs: [run()], items: [item()] });
		context.connection.query.mockResolvedValueOnce([{ locked: false }]);
		await expect(context.service.processRun('run')).rejects.toThrow('import-busy');
		expect(context.providers.tmdb.fetch).not.toHaveBeenCalled();
		expect(context.runs.rows[0].state).toBe('queued');
		expect(context.connection.release).toHaveBeenCalledOnce();
	});

	test('releases the pooled worker connection when lock acquisition fails', async () => {
		const context = fixture({ runs: [run()], items: [item()] });
		context.connection.query.mockRejectedValueOnce(new Error('DB_LOCK_UNAVAILABLE'));
		await expect(context.service.processRun('run')).rejects.toThrow('DB_LOCK_UNAVAILABLE');
		expect(context.connection.release).toHaveBeenCalledOnce();
		expect(context.providers.tmdb.fetch).not.toHaveBeenCalled();
	});

	test('releases worker and profile connections even if advisory unlock fails', async () => {
		const worker = fixture({ runs: [run({ state: 'cancelled' })] });
		worker.connection.query.mockResolvedValueOnce([{ locked: true }]).mockRejectedValueOnce(new Error('DB_UNLOCK_UNAVAILABLE'));
		await expect(worker.service.processRun('run')).rejects.toThrow('DB_UNLOCK_UNAVAILABLE');
		expect(worker.connection.release).toHaveBeenCalledOnce();
		const scheduled = fixture();
		scheduled.connection.query.mockResolvedValueOnce([{ locked: true }]).mockRejectedValueOnce(new Error('DB_UNLOCK_UNAVAILABLE'));
		await expect(scheduled.service.runProfile('missing')).rejects.toThrow('DB_UNLOCK_UNAVAILABLE');
		expect(scheduled.connection.release).toHaveBeenCalledOnce();
	});

	test('queues persisted work after an enqueue failure and recovers running items without replaying completed ones', async () => {
		const context = fixture();
		context.queue.add.mockRejectedValueOnce(new Error('QUEUE_UNAVAILABLE'));
		await expect(context.service.createRun({ refs: [record().ref], mode: 'import' })).rejects.toThrow('QUEUE_UNAVAILABLE');
		expect(context.runs.rows).toHaveLength(1);
		await context.service.tickSchedules();
		expect(context.queue.add).toHaveBeenCalledTimes(2);
		context.items.rows[0].state = 'running';
		context.items.rows.push(item({ id: 'already-completed', runId: String(context.runs.rows[0].id), state: 'completed', position: 1 }) as unknown as Row);
		await context.service.processRun(String(context.runs.rows[0].id));
		expect(isolated.apply).toHaveBeenCalledOnce();
		expect(context.items.rows.every(row => row.state === 'completed')).toBe(true);
	});

	test('automatically resumes due quota pauses but leaves explicit user pauses alone', async () => {
		const context = fixture({ runs: [run({ id: 'quota', state: 'paused', retryAt: new Date('2026-01-01') }), run({ id: 'manual', state: 'paused', retryAt: null })] });
		await context.service.tickSchedules();
		expect(context.runs.rows.find(row => row.id === 'quota')?.state).toBe('queued');
		expect(context.runs.rows.find(row => row.id === 'manual')?.state).toBe('paused');
		expect(context.queue.add.mock.calls.every(call => call[1].runId === 'quota')).toBe(true);
	});

	test('scheduler requeues stale running work but never touches a recently active worker', async () => {
		const context = fixture({ runs: [run({ id: 'stale', state: 'running', updatedAt: new Date(Date.now() - 16 * 60000) }), run({ id: 'fresh', state: 'running', updatedAt: new Date() })] });
		await context.service.tickSchedules();
		expect(context.queue.add).toHaveBeenCalledOnce();
		expect(context.queue.add.mock.calls[0][1]).toEqual({ runId: 'stale' });
	});

	test('repeated scheduler recovery uses the same persisted dispatch generation and one Bull job', async () => {
		const updatedAt = new Date('2026-01-01');
		const context = fixture({ runs: [run({ updatedAt })] });
		await context.service.tickSchedules();
		await context.service.tickSchedules();
		await context.service.tickSchedules();
		expect(context.queue.add).toHaveBeenCalledTimes(3);
		expect(context.queue.add.mock.calls.every(call => call[2].jobId === `run-queued-${updatedAt.getTime()}`)).toBe(true);
		expect(context.jobs.size).toBe(1);
	});

	test('resume creates a strictly newer generation even within one clock millisecond', async () => {
		const timestamp = Date.now();
		const context = fixture({ runs: [run({ updatedAt: new Date(timestamp) })], items: [item()] });
		const now = vi.spyOn(Date, 'now').mockReturnValue(timestamp);
		try {
			await context.service.tickSchedules();
			context.runs.rows[0].state = 'paused';
			await context.service.actionRun('run', 'resume');
			expect(context.runs.rows[0].updatedAt).toEqual(new Date(timestamp + 1));
			await context.service.tickSchedules();
			expect(context.jobs.size).toBe(2);
			expect([...context.jobs.keys()]).toEqual([`run-queued-${timestamp}`, `run-queued-${timestamp + 1}`]);
		} finally {
			now.mockRestore();
		}
	});

	test('recovery cannot enqueue a run cancelled after the scheduler selected it', async () => {
		const context = fixture({ runs: [run()] });
		context.runs.find.mockResolvedValueOnce([]).mockImplementationOnce(async () => {
			const candidate = structuredClone(context.runs.rows[0]);
			context.runs.rows[0].state = 'cancelled';
			return [candidate];
		});
		await context.service.tickSchedules();
		expect(context.runs.rows[0].state).toBe('cancelled');
		expect(context.queue.add).not.toHaveBeenCalled();
		expect(context.jobs.size).toBe(0);
	});

	test('preview reflects persistent locks, manual edits and deliberate manual clearing', async () => {
		const context = fixture({ works: [work({ description: null, releaseYear: 2026, importData: { values: { title: 'Previous title', description: 'Previous description', releaseYear: 2026 }, locks: ['releaseYear'] } })] });
		const preview = await context.service.preview(record().ref);
		expect(preview.workId).toBe('canonical');
		for (const field of ['title', 'description', 'releaseYear']) expect(preview.changes.find(change => change.field === field)?.protected).toBe(true);
		expect(preview.changes.find(change => change.field === 'posterUrl')?.protected).toBe(true); // An empty incoming field is not an update.
	});

	test('incomplete enrichment cannot authorize destructive taxonomy replacement', async () => {
		const context = fixture({ runs: [run()], items: [item()] });
		enable(context, 'kinopoisk');
		context.providers.kinopoisk.lookup.mockRejectedValueOnce(new ImportProviderError('upstream-failure'));
		await context.service.processRun('run');
		expect(isolated.apply.mock.calls[0][2]).toMatchObject({ complete: false, warnings: ['kinopoisk:upstream-failure'] });
		expect(context.taxonomy.syncImportedWork.mock.calls[0][1]).toMatchObject({ complete: false });
	});

	test.each(['quota-exceeded', 'rate-limited'] as const)('enrichment %s pauses the whole job rather than continuing the batch', async code => {
		const context = fixture({ runs: [run()], items: [item(), item({ id: 'second', position: 1 })] });
		enable(context, 'kinopoisk');
		context.providers.kinopoisk.lookup.mockRejectedValueOnce(new ImportProviderError(code, 10000));
		await context.service.processRun('run');
		expect(context.runs.rows[0]).toMatchObject({ state: 'paused', error: code });
		expect(context.items.rows.map(row => row.state)).toEqual(['pending', 'pending']);
		expect(context.providers.tmdb.fetch).toHaveBeenCalledOnce();
		expect(isolated.apply).not.toHaveBeenCalled();
	});

	test('contradictory identities fail safely instead of merging another title', async () => {
		const context = fixture({ runs: [run()], items: [item()] });
		enable(context, 'kinopoisk');
		context.providers.kinopoisk.lookup.mockResolvedValueOnce(record({ identities: [{ provider: 'tmdb', externalId: '101', entityType: 'movie' }] }));
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'failed', error: 'IMPORT_IDENTITY_CONFLICT' });
		expect(isolated.apply).not.toHaveBeenCalled();
	});

	test('initial, unpublished and established availability events have distinct notification suppression', async () => {
		const player: ImportRecord['players'][number] = { source: 'alloha', externalId: 'player', iframeUrl: 'https://player.example.test/embed', translations: [{ id: '1', name: 'Dub' }], quality: 'HD', episodes: [] };
		for (const [created, publicationState, baseline, expected] of [[true, 'published', true, true], [false, 'draft', true, true], [false, 'published', false, true], [false, 'published', true, false]] as const) {
			const context = fixture({ runs: [run()], items: [item({ workId: 'canonical' })], works: [work({ importData: baseline ? { values: { players: [] } } : {} })] });
			isolated.apply.mockResolvedValue({ work: work({ publicationState, importData: { values: { players: [player] } } }), created, protectedFields: [] });
			await context.service.processRun('run');
			expect(context.catalogue.recordAllohaAvailability).toHaveBeenCalledWith({ workId: 'canonical', seasonNumber: null, episodeNumber: null, translationCount: 1, suppressNotification: expected });
		}
	});

	test('public playback hides drafts and private provider identity fields', async () => {
		const player: ImportRecord['players'][number] = { source: 'alloha', externalId: 'private-id', iframeUrl: 'https://player.example.test/embed', translations: [], quality: 'HD', episodes: [] };
		const context = fixture({ works: [work({ importData: { values: { players: [player] }, raw: { private: 'internal' } } }), work({ id: 'draft', publicationState: 'draft' })] });
		await expect(context.service.playback('draft')).rejects.toThrow('NO_SUCH_WORK');
		const playback = await context.service.playback('canonical');
		expect(playback.sources).toHaveLength(1);
		expect(JSON.stringify(playback)).not.toContain('private-id');
		expect(JSON.stringify(playback)).not.toContain('internal');
	});

	test('refresh profiles bind existing work IDs and skip unmapped manual titles', async () => {
		const context = fixture({ profiles: [profile()], works: [work(), work({ id: 'manual', tmdbId: null, tmdbMediaType: null })] });
		await context.service.runProfile('profile');
		expect(context.items.rows).toHaveLength(1);
		expect(context.items.rows[0]).toMatchObject({ workId: 'canonical', ref: record().ref });
		expect(context.runs.rows[0]).toMatchObject({ mode: 'sync', profileId: 'profile' });
	});

	test('collection paging preserves profile locks and creates membership against canonical IDs', async () => {
		const context = fixture({ runs: [run({ profileId: 'profile' })], items: [item()], profiles: [profile({ mode: 'collection', collectionId: 'collection-id' })] });
		await context.service.processRun('run');
		expect(context.taxonomy.upsertImportedEntry).toHaveBeenCalledWith(expect.objectContaining({ type: 'collection', externalIds: { tmdb: 'collection-id' } }), 'tmdb');
		expect(context.taxonomy.linkWork).toHaveBeenCalledWith({ entryId: 'collection', workId: 'canonical' }, expect.stringMatching(/^profile-[a-z0-9_-]{1,20}$/u));
		context.providers.tmdb.collection.mockResolvedValueOnce({ items: [{ ref: record().ref }], page: 1, hasMore: true });
		await context.service.runProfile('profile');
		expect(context.providers.tmdb.collection).toHaveBeenCalledWith('collection-id', 1);
		expect(context.profiles.rows[0].cursor).toBe(1);
	});

	test('does not dispatch a profile while another run is queued, paused or active', async () => {
		const context = fixture({ profiles: [profile()], runs: [run({ profileId: 'profile', state: 'paused' })] });
		await expect(context.service.runProfile('profile')).rejects.toThrow('rate-limited');
		expect(context.queue.add).not.toHaveBeenCalled();
	});

	test('manual profile dispatches are serialized while their collection fetch is in flight', async () => {
		const context = fixture({ profiles: [profile({ mode: 'collection', collectionId: 'provider-list' })] });
		const fetching = deferred<void>();
		const response = deferred<{ items: { ref: ImportRef }[]; page: number; hasMore: boolean }>();
		context.providers.tmdb.collection.mockImplementationOnce(async () => { fetching.resolve(); return response.promise; });
		const first = context.service.runProfile('profile');
		await fetching.promise;
		await expect(context.service.runProfile('profile')).rejects.toThrow('rate-limited');
		response.resolve({ items: [{ ref: record().ref }], page: 1, hasMore: false });
		await first;
		expect(context.runs.rows).toHaveLength(1);
		expect(context.queue.add).toHaveBeenCalledOnce();
		expect(context.connection.release).toHaveBeenCalledTimes(2);
	});

	test('an unmapped first page advances the cursor so later mapped titles are reachable', async () => {
		const manual = Array.from({ length: 100 }, (_, index) => work({ id: `a${String(index).padStart(3, '0')}`, tmdbId: null, tmdbMediaType: null }));
		const context = fixture({ profiles: [profile()], works: [...manual, work({ id: 'z-mapped' })] });
		await context.service.runProfile('profile');
		expect(context.profiles.rows[0].cursor).toBe(100);
		expect(context.runs.rows[0].state).toBe('completed');
		expect(context.queue.add).not.toHaveBeenCalled();
		await context.service.runProfile('profile');
		expect(context.items.rows[0]).toMatchObject({ workId: 'z-mapped', ref: record().ref });
		expect(context.profiles.rows[0].cursor).toBe(0);
	});

	test('scheduler claims a due profile once across concurrent tick invocations', async () => {
		const context = fixture({ profiles: [profile()], works: [work()] });
		await Promise.all([context.service.tickSchedules(), context.service.tickSchedules()]);
		expect(context.runs.rows).toHaveLength(1);
		expect(context.items.rows).toHaveLength(1);
	});

	test('error boundary never returns arbitrary messages or provider credentials', () => {
		expect(safeImportError(new ImportProviderError('quota-exceeded'))).toBe('quota-exceeded');
		expect(safeImportError(new Error('IMPORT_IDENTITY_CONFLICT'))).toBe('IMPORT_IDENTITY_CONFLICT');
		expect(safeImportError(new Error('password=PRIVATE_EXAMPLE'))).toBe('import-failed');
	});
});
