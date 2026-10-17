/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ZalipImporterService, safeImportError, safeImportWarnings } from '@/core/ZalipImporterService.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipImportItem, MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { MiZalipImportProfile } from '@/models/ZalipImportProfile.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { defaultImportApiOrigins, ImportProviderError } from './zalip-importer/providers.js';
import { importSources, type ImportProvider, type ImportRecord, type ImportRef, type ImportSource } from './zalip-importer/types.js';
import { defaultPlaybackSettings } from './zalip-importer/playback-settings.js';
import { artworkCandidate } from './zalip-importer/artwork-candidates.js';

const isolated = vi.hoisted(() => ({ providers: vi.fn(), apply: vi.fn() }));

// No runtime credentials, live transport, Redis or Bull worker is used in this suite.
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));
vi.mock('@/core/ZalipImporterArtworkService.js', () => ({ ZalipImporterArtworkService: class {} }));
vi.mock('@/core/ZalipPlaybackSettingsService.js', () => ({ ZalipPlaybackSettingsService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
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
		delete: vi.fn(async (criteria: string) => {
			const index = rows.findIndex(row => row.id === criteria);
			if (index === -1) return { affected: 0 };
			rows.splice(index, 1);
			return { affected: 1 };
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
	return { id: 'run', state: 'queued', mode: 'import', createdAt: new Date(), updatedAt: new Date(), createdById: null, profileId: null, lockedFields: [], categoryIds: [], options: {}, error: null, retryAt: null, ...values };
}

function item(values: Partial<MiZalipImportItem> = {}): MiZalipImportItem {
	return { id: 'item', runId: 'run', position: 0, state: 'pending', ref: record().ref, workId: null, error: null, warnings: [], updatedAt: new Date(), run: null, ...values };
}

function profile(values: Partial<MiZalipImportProfile> = {}): MiZalipImportProfile {
	return { id: 'profile', name: 'Collection', enabled: true, source: 'tmdb', mode: 'metadata', intervalMinutes: 15, collectionId: null, lockedFields: [], categoryIds: [], options: {}, lastRunAt: null, nextRunAt: new Date('2026-01-01'), lastError: null, cursor: 0, ...values };
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
		query: vi.fn().mockResolvedValue([]),
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
		updates: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }),
	}])) as unknown as Record<ImportSource, ImportProvider & { fetch: ReturnType<typeof vi.fn>; lookup: ReturnType<typeof vi.fn>; collection: ReturnType<typeof vi.fn>; updates: ReturnType<typeof vi.fn> }>;
	isolated.providers.mockReturnValue(providers);
	isolated.apply.mockResolvedValue({ work: work({ publicationState: 'draft', publishedAt: null }), created: true, protectedFields: [] });
	const jobs = new Map<string, { runId: string }>();
	const queue = { add: vi.fn(async (name: string, data: { runId: string }, options: { jobId: string }) => {
		if (!jobs.has(options.jobId)) jobs.set(options.jobId, structuredClone(data));
		return { id: options.jobId, name };
	}) };
	const catalogue = { recordAllohaAvailability: vi.fn(), dispatchPendingAllohaAvailabilityNotifications: vi.fn(), dispatchPendingReleaseNotifications: vi.fn() };
	const taxonomy = { syncImportedWork: vi.fn(), linkWork: vi.fn(), upsertImportedEntry: vi.fn().mockResolvedValue({ id: 'collection' }) };
	const artwork = { prepare: vi.fn().mockImplementation(async (incoming: ImportRecord) => incoming) };
	let nextId = 0;
	const playbackSettings = { show: vi.fn().mockResolvedValue({ providers: defaultPlaybackSettings() }) };
	const sourceSettings = { getRuntime: vi.fn().mockResolvedValue({ apiOrigins: defaultImportApiOrigins }) };
	const service = new ZalipImporterService(db as never, {} as never, queue as never, { gen: () => `id-${++nextId}` } as never, catalogue as never, taxonomy as never, artwork as never, playbackSettings as never, sourceSettings as never);
	return { service, runs, items, works, identities, profiles, entries, providers, queue, jobs, catalogue, taxonomy, artwork, playbackSettings, sourceSettings, connection, db };
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

describe('Kodik importer service boundaries', () => {
	const ref: ImportRef = { source: 'kodik', externalId: 'shikimori-46569', mediaType: 'tv' };
	const seasonRecord = () => record({ ref, kind: 'anime', identities: [{ provider: 'kodik', externalId: ref.externalId, entityType: 'tv' }, { provider: 'shikimori', externalId: '46569', entityType: 'tv' }], description: 'One anime season', players: [{ source: 'kodik', externalId: ref.externalId, iframeUrl: 'https://kodikplayer.com/serial/49752/fixture/720p', quality: '720p', episodes: [], translations: [] }] });

	test('queues canonical refs but rejects malformed provider refs before a durable write', async () => {
		const context = fixture();
		enable(context, 'kodik');
		await expect(context.service.createRun({ mode: 'import', refs: [ref] })).resolves.toMatchObject({ state: 'queued' });
		expect(context.items.rows[0]).toMatchObject({ ref, workId: null });
		context.db.transaction.mockClear();
		await expect(context.service.createRun({ mode: 'import', refs: [{ ...ref, externalId: 'movie-42' }] })).rejects.toThrow('invalid-ref');
		expect(context.db.transaction).not.toHaveBeenCalled();
	});

	test('does not enrich an anime-season draft with whole-series metadata', async () => {
		const context = fixture();
		enable(context, 'kodik');
		context.providers.kodik.fetch.mockResolvedValueOnce(seasonRecord());
		context.providers.tmdb.lookup.mockResolvedValue(record({ ref: { source: 'tmdb', externalId: '100', mediaType: 'tv' }, identities: [{ provider: 'tmdb', externalId: '100', entityType: 'tv' }], description: 'Whole-series description' }));
		const preview = await context.service.preview(ref, undefined, { sources: ['tmdb'] });
		expect(preview.record.description).toBe('One anime season');
		expect(preview.record.identities.map(identity => identity.provider)).not.toContain('tmdb');
		expect(preview.warnings).toContain('kodik-anime-scope-unmapped');
	});

	test.each([false, true])('whole-series enrichment requires exact season proof (proven=%s)', async proven => {
		const context = fixture();
		enable(context, 'kodik');
		const primary = record({ ref: { source: 'tmdb', externalId: '100', mediaType: 'tv' }, kind: 'series', identities: [{ provider: 'tmdb', externalId: '100', entityType: 'tv' }, ...(proven ? [{ provider: 'shikimori', externalId: '46569', entityType: 'tv' as const }] : [])] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(primary);
		context.providers.kodik.lookup.mockResolvedValue(seasonRecord());
		const preview = await context.service.preview(primary.ref, undefined, { sources: ['kodik'], fields: ['players'] });
		expect(preview.record.players.some(player => player.source === 'kodik')).toBe(proven);
		expect(preview.warnings.includes('kodik-anime-scope-unmapped')).toBe(!proven);
	});

	test('Kodik refresh profile resolves only an exact existing binding', async () => {
		const context = fixture({ profiles: [profile({ source: 'kodik' })], works: [work()], identities: [{ id: 'kp', workId: 'canonical', provider: 'kinopoisk', externalId: '1', entityType: 'movie' }] });
		enable(context, 'kodik');
		const movieRef: ImportRef = { source: 'kodik', externalId: 'kinopoisk-1', mediaType: 'movie' };
		context.providers.kodik.lookup.mockResolvedValueOnce(record({ ref: movieRef, identities: [{ provider: 'kodik', externalId: 'kinopoisk-1', entityType: 'movie' }, { provider: 'kinopoisk', externalId: '1', entityType: 'movie' }] }));
		await context.service.runProfile('profile');
		expect(context.providers.kodik.lookup).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ provider: 'kinopoisk', externalId: '1' })]), 'movie', ['players']);
		expect(context.items.rows[0]).toMatchObject({ workId: 'canonical', ref: movieRef });
	});

	test.each(['quota-exceeded', 'rate-limited', 'upstream-failure', 'malformed-response'] as const)('profile lookup %s preserves the cursor and records a retryable failure', async code => {
		const context = fixture({ profiles: [profile({ source: 'kodik', cursor: 100 })], works: [work()], identities: [{ id: 'kp', workId: 'canonical', provider: 'kinopoisk', externalId: '1', entityType: 'movie' }] });
		enable(context, 'kodik');
		context.works.find.mockResolvedValueOnce([work() as unknown as Row]);
		context.providers.kodik.lookup.mockRejectedValueOnce(new ImportProviderError(code));
		await expect(context.service.runProfile('profile')).rejects.toThrow(code);
		expect(context.profiles.rows[0]).toMatchObject({ cursor: 100, lastError: code });
		expect(context.runs.rows).toHaveLength(0);
		expect(context.queue.add).not.toHaveBeenCalled();
	});

	test('weak anime-season lookup is skipped without attaching to a whole-series work', async () => {
		const context = fixture({ profiles: [profile({ source: 'kodik' })], works: [work({ tmdbMediaType: 'tv' })], identities: [{ id: 'kp', workId: 'canonical', provider: 'kinopoisk', externalId: '4786341', entityType: 'tv' }] });
		enable(context, 'kodik');
		context.providers.kodik.lookup.mockResolvedValueOnce(seasonRecord());
		await context.service.runProfile('profile');
		expect(context.items.rows).toHaveLength(0);
		expect(context.runs.rows[0].state).toBe('completed');
	});

	test('public voice projection keeps per-voice coverage and subtitles without API credentials or rejected URLs', async () => {
		const player = seasonRecord().players[0];
		player.translations = [
			{ id: 'serial-49752', name: 'Studio', providerTranslationId: '923', type: 'voice', iframe: player.iframeUrl, episodes: [{ seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: -1, episodeNumber: 2 }] },
			{ id: 'serial-49750', name: 'Subtitles', providerTranslationId: 'bad-input', type: 'subtitles', iframe: 'https://kodikplayer.com/serial/49750/subtitle/720p', episodes: [] },
			{ id: 'serial-49999', name: 'Rejected', iframe: 'https://untrusted.example.org/embed?token=private-example' },
			{ id: 'serial-40000', name: 'No own iframe' },
		];
		const context = fixture({ works: [work({ importData: { values: { players: [player] } } })] });
		context.sourceSettings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, kodikApiToken: 'private-example' });
		const playback = await context.service.playback('canonical');
		expect(playback.sources[0].source).toBe('kodik');
		expect(playback.sources[0].translations).toHaveLength(2);
		expect(playback.sources[0].translations[0]).toMatchObject({ providerTranslationId: '923', type: 'voice', episodes: [{ seasonNumber: 1, episodeNumber: 1 }] });
		expect(playback.sources[0].translations[1]).toMatchObject({ type: 'subtitles', episodes: [] });
		expect(playback.sources[0].translations[1]).not.toHaveProperty('providerTranslationId');
		expect(JSON.stringify(playback)).not.toContain('private-example');
		expect(context.works.save).not.toHaveBeenCalled();
		expect(safeImportWarnings(['kodik-anime-identity-partial', 'kodik-anime-scope-unmapped', 'kodik:upstream-failure', 'kodik:https://private.test/?token=secret'])).toEqual(['kodik-anime-identity-partial', 'kodik-anime-scope-unmapped', 'kodik:upstream-failure']);
	});
});

describe('bounded Collaps voice repair', () => {
	const ref: ImportRef = { source: 'collaps', externalId: '555', mediaType: 'tv' };
	const collaps = () => ({ source: 'collaps', externalId: '555', iframeUrl: 'https://api.nextembed.ws/embed/555?season=2&episode=3', translations: [], quality: '1080p', episodes: [{ seasonNumber: 2, episodeNumber: 3 }], preserved: { untouched: true } });
	const alloha = () => ({ source: 'alloha', externalId: 'tmdb:tv:100', iframeUrl: 'https://ascorbic-as.stravers.live/?token_movie=chosen&token=preserved-embed', translations: [{ id: '7', name: 'Existing voice', iframe: 'https://ascorbic-as.stravers.live/?token_movie=chosen&token=preserved-embed&translation=7' }], quality: 'HD', episodes: [{ seasonNumber: 1, episodeNumber: 1 }] });
	const voices = [{ id: 'name:fixture', name: '  Studio  Full & Name  ', iframe: 'https://evil.example.org/never-use', quality: 'HD', resolutions: ['720p'] }];

	function setup() {
		const context = fixture({
			works: [work({ kind: 'anime', tmdbMediaType: 'tv', importData: { locks: ['posterUrl'], values: { players: [alloha(), collaps()], description: 'Owned description' }, sources: { players: 'alloha', description: 'kinopoisk' }, localArtwork: { posterUrl: '/files/retained.png' }, availability: { last: 'unchanged' } } })],
			identities: [{ id: 'collapsbinding', workId: 'canonical', provider: 'collaps', externalId: '555', entityType: 'tv', snapshot: record(), updatedAt: new Date('2026-01-01') }, { id: 'tmdbbinding', workId: 'canonical', provider: 'tmdb', externalId: '100', entityType: 'tv' }],
		});
		enable(context, 'collaps');
		context.sourceSettings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaPlayerToken: 'preserved-embed' });
		context.providers.collaps.fetch.mockResolvedValue(record({ ref, identities: [{ provider: 'collaps', externalId: '555', entityType: 'tv' }], players: [{ ...collaps(), source: 'collaps', iframeUrl: 'https://api.nextembed.ws/embed/replacement-not-used', translations: voices }], title: 'Do not overwrite', description: 'Do not overwrite', complete: false }));
		return context;
	}

	const storedPlayers = (context: ReturnType<typeof fixture>) => ((context.works.rows[0].importData as Row).values as Row).players as Row[];

	test('updates only existing empty translations, retains parent/Alloha and yields public oneSound choices', async () => {
		const context = setup();
		const before = structuredClone(context.works.rows[0]);
		const identityBefore = structuredClone(context.identities.rows);
		const state = await context.service.showWorkState('canonical');
		expect(state.playbackRevision).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.stringify(state)).not.toContain('preserved-embed');
		const result = await context.service.refreshCollapsVoices('canonical', state.playbackRevision);
		expect(result).toMatchObject({ status: 'updated', translations: 1 });
		expect(result.playbackRevision).not.toBe(state.playbackRevision);
		expect(context.providers.collaps.fetch).toHaveBeenCalledExactlyOnceWith(ref, ['players']);
		const expected = structuredClone(before);
		const expectedPlayers = ((expected.importData as Row).values as Row).players as Row[];
		expectedPlayers[1].translations = [{ id: 'name:fixture', name: 'Studio  Full & Name', iframe: 'https://api.nextembed.ws/embed/555?season=2&episode=3&oneSound=Studio++Full+%26+Name', quality: 'HD', resolutions: ['720p'] }];
		expect(context.works.rows[0]).toEqual(expected);
		expect(context.identities.rows).toEqual(identityBefore);
		expect(context.works.update).toHaveBeenCalledExactlyOnceWith('canonical', { importData: expected.importData });
		expect(context.works.save).not.toHaveBeenCalled();
		expect(context.db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-import-identities']);
		expect(context.works.findOne).toHaveBeenCalledWith({ where: { id: 'canonical' }, lock: { mode: 'pessimistic_write' } });
		expect(context.db.query.mock.invocationCallOrder[0]).toBeLessThan(context.works.findOne.mock.invocationCallOrder[0]);
		expect(context.providers.collaps.fetch.mock.invocationCallOrder[0]).toBeLessThan(context.db.transaction.mock.invocationCallOrder[0]);
		const playback = await context.service.playback('canonical');
		expect(playback.sources.find(player => player.source === 'collaps')?.translations).toEqual(expectedPlayers[1].translations);
		expect(playback.sources.find(player => player.source === 'alloha')?.translations[0].name).toBe('Existing voice');
		expect(context.queue.add).not.toHaveBeenCalled();
		expect(isolated.apply).not.toHaveBeenCalled();
		expect(context.taxonomy.syncImportedWork).not.toHaveBeenCalled();
		expect(context.catalogue.recordAllohaAvailability).not.toHaveBeenCalled();
		expect(context.artwork.prepare).not.toHaveBeenCalled();
		context.providers.collaps.fetch.mockClear();
		expect((await context.service.refreshCollapsVoices('canonical', state.playbackRevision)).status).toBe('stale');
		expect((await context.service.refreshCollapsVoices('canonical', result.playbackRevision)).status).toBe('already-current');
		expect(context.providers.collaps.fetch).not.toHaveBeenCalled();
		expect(context.works.update).toHaveBeenCalledOnce();
	});

	test('revisions include complete player payloads, locks and exact binding/media, not snapshot secrets or unrelated metadata', async () => {
		const context = setup();
		const baseline = (await context.service.showWorkState('canonical')).playbackRevision;
		context.works.rows[0].title = 'Unrelated edit';
		context.identities.rows[0].snapshot = { private: 'do-not-expose' };
		expect((await context.service.showWorkState('canonical')).playbackRevision).toBe(baseline);
		const original = structuredClone(context.works.rows[0]);
		for (const mutate of [
			() => { storedPlayers(context)[0].iframeUrl = 'https://ascorbic-as.stravers.live/?token=other'; },
			() => { (context.works.rows[0].importData as Row).locks = ['players']; },
			() => { context.works.rows[0].tmdbMediaType = 'movie'; },
		]) {
			mutate();
			expect((await context.service.showWorkState('canonical')).playbackRevision).not.toBe(baseline);
			context.works.rows[0] = structuredClone(original);
		}
		context.identities.rows[0].externalId = '556';
		expect((await context.service.showWorkState('canonical')).playbackRevision).not.toBe(baseline);
		context.identities.rows[0].externalId = '555';
		context.identities.rows[0].entityType = 'movie';
		expect((await context.service.showWorkState('canonical')).playbackRevision).not.toBe(baseline);
	});

	test.each(['locked', 'missing-binding', 'wrong-id', 'wrong-media', 'ambiguous-slots', 'ambiguous-bindings', 'invalid-parent', 'already-current'])('does not fetch or write when target is %s', async condition => {
		const context = setup();
		if (condition === 'locked') (context.works.rows[0].importData as Row).locks = ['players'];
		if (condition === 'missing-binding') context.identities.rows.splice(0, 1);
		if (condition === 'wrong-id') context.identities.rows[0].externalId = '999';
		if (condition === 'wrong-media') context.identities.rows[0].entityType = 'movie';
		if (condition === 'ambiguous-slots') storedPlayers(context).push(collaps());
		if (condition === 'ambiguous-bindings') context.identities.rows.push({ provider: 'collaps', externalId: '555', entityType: 'movie', workId: 'canonical' });
		if (condition === 'invalid-parent') storedPlayers(context)[1].iframeUrl = 'https://evil.example.org/embed/555';
		if (condition === 'already-current') storedPlayers(context)[1].translations = [{ id: '7', name: 'Retained' }];
		const before = structuredClone(context.works.rows);
		const revision = (await context.service.showWorkState('canonical')).playbackRevision;
		const result = await context.service.refreshCollapsVoices('canonical', revision);
		expect(result.status).toBe(condition === 'locked' || condition === 'already-current' ? condition : 'unsupported');
		expect(context.providers.collaps.fetch).not.toHaveBeenCalled();
		expect(context.works.update).not.toHaveBeenCalled();
		expect(context.works.rows).toEqual(before);
	});

	test.each(['empty', 'wrong-ref', 'wrong-media', 'wrong-slot', 'malformed-voices', 'upstream-error'])('retains the exact work and binding on %s responses', async condition => {
		const context = setup();
		const incoming = record({ ref: { ...ref }, identities: [{ provider: 'collaps', externalId: '555', entityType: 'tv' }], players: [{ ...collaps(), source: 'collaps', translations: [] }] });
		if (condition === 'wrong-ref') incoming.ref.externalId = '556';
		if (condition === 'wrong-media') incoming.ref.mediaType = 'movie';
		if (condition === 'wrong-slot') incoming.players[0].externalId = '556';
		if (condition === 'malformed-voices') incoming.players[0].translations = [{ id: 'x', name: 'Invalid\u0000Name' }];
		if (condition === 'upstream-error') context.providers.collaps.fetch.mockRejectedValue(new Error('private-provider-url-token'));
		else context.providers.collaps.fetch.mockResolvedValue(incoming);
		const before = structuredClone(context.works.rows);
		const bindings = structuredClone(context.identities.rows);
		const result = await context.service.refreshCollapsVoices('canonical', (await context.service.showWorkState('canonical')).playbackRevision);
		expect(result.status).toBe(condition === 'empty' ? 'empty' : condition === 'malformed-voices' || condition === 'upstream-error' ? 'unavailable' : 'unsupported');
		expect(JSON.stringify(result)).not.toContain('private-provider');
		expect(context.works.rows).toEqual(before);
		expect(context.identities.rows).toEqual(bindings);
		expect(context.db.transaction).not.toHaveBeenCalled();
		expect(context.works.update).not.toHaveBeenCalled();
	});

	test.each(['players', 'lock', 'identity', 'media'])('CAS rejects concurrent %s changes after HTTP without overwriting them', async changed => {
		const context = setup();
		const pending = deferred<ImportRecord>();
		context.providers.collaps.fetch.mockReturnValueOnce(pending.promise);
		const revision = (await context.service.showWorkState('canonical')).playbackRevision;
		const operation = context.service.refreshCollapsVoices('canonical', revision);
		await vi.waitFor(() => expect(context.providers.collaps.fetch).toHaveBeenCalledOnce());
		if (changed === 'players') storedPlayers(context)[1].iframeUrl = 'https://api.nextembed.ws/embed/editorial';
		if (changed === 'lock') (context.works.rows[0].importData as Row).locks = ['players'];
		if (changed === 'identity') context.identities.rows[0].externalId = '556';
		if (changed === 'media') context.identities.rows[0].entityType = 'movie';
		const before = structuredClone(context.works.rows);
		pending.resolve(record({ ref, identities: [{ provider: 'collaps', externalId: '555', entityType: 'tv' }], players: [{ ...collaps(), source: 'collaps', translations: voices }] }));
		expect((await operation).status).toBe('stale');
		expect(context.works.rows).toEqual(before);
		expect(context.works.update).not.toHaveBeenCalled();
	});

	test('retains unrelated concurrent edits by merging only into the reread work', async () => {
		const context = setup();
		const pending = deferred<ImportRecord>();
		context.providers.collaps.fetch.mockReturnValueOnce(pending.promise);
		const operation = context.service.refreshCollapsVoices('canonical', (await context.service.showWorkState('canonical')).playbackRevision);
		await vi.waitFor(() => expect(context.providers.collaps.fetch).toHaveBeenCalledOnce());
		context.works.rows[0].title = 'Concurrent title';
		(context.works.rows[0].importData as Row).localArtwork = { posterUrl: '/files/concurrent.png' };
		pending.resolve(record({ ref, identities: [{ provider: 'collaps', externalId: '555', entityType: 'tv' }], players: [{ ...collaps(), source: 'collaps', translations: voices }] }));
		expect((await operation).status).toBe('updated');
		expect(context.works.rows[0].title).toBe('Concurrent title');
		expect((context.works.rows[0].importData as Row).localArtwork).toEqual({ posterUrl: '/files/concurrent.png' });
	});
});

describe('Zalip importer image choices', () => {
	const picture = () => artworkCandidate({ source: 'tmdb', field: 'posterUrl', url: 'https://image.tmdb.org/t/p/original/chosen.jpg', previewUrl: 'https://image.tmdb.org/t/p/w300/chosen.jpg', width: 600, height: 900, language: 'ru' });

	test('preview exposes only selected provider/field candidates and applies a bound manual choice', async () => {
		const context = fixture();
		enable(context, 'kinopoisk');
		const candidate = picture();
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ posterUrl: 'https://image.tmdb.org/t/p/original/main.jpg', backdropUrl: 'https://image.tmdb.org/t/p/original/backdrop.jpg', artworkCandidates: [candidate] }));
		const preview = await context.service.preview(record().ref, undefined, { sources: [], fields: ['posterUrl'], artworkSelections: [{ ref: record().ref, choices: { posterUrl: candidate.id } }] });
		expect(preview.record.posterUrl).toBe(candidate.url);
		expect(preview.record.artworkCandidates).toEqual(expect.arrayContaining([candidate]));
		expect(preview.record.artworkCandidates?.every(value => value.field === 'posterUrl' && value.source === 'tmdb')).toBe(true);
		expect(context.providers.kinopoisk.fetch).not.toHaveBeenCalled();
		expect(context.providers.kinopoisk.lookup).not.toHaveBeenCalled();
		expect(context.artwork.prepare).not.toHaveBeenCalled();
	});

	test('worker rejects changed provider candidates before any image or work writes', async () => {
		const candidate = picture();
		const context = fixture({ runs: [run({ options: { artwork: 'local', artworkSelections: [{ ref: record().ref, choices: { posterUrl: candidate.id } }] } })], items: [item()] });
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'failed', error: 'IMPORT_ARTWORK_SELECTION_STALE' });
		expect(context.artwork.prepare).not.toHaveBeenCalled();
		expect(isolated.apply).not.toHaveBeenCalled();
	});

	test('one title choice cannot leak into the next item in a batch', async () => {
		const candidate = picture();
		const options = { fields: ['posterUrl'] as const, artworkSelections: [{ ref: record().ref, choices: { posterUrl: candidate.id } }] };
		const context = fixture({ runs: [run({ options: { ...options, fields: [...options.fields] } })], items: [item(), item({ id: 'second', position: 1, ref: { source: 'tmdb', externalId: '101', mediaType: 'movie' } })] });
		context.providers.tmdb.fetch.mockImplementation(async (ref: ImportRef) => record({ ref, identities: [{ provider: ref.source, externalId: ref.externalId, entityType: ref.mediaType }], posterUrl: `https://image.tmdb.org/t/p/original/${ref.externalId}.jpg`, artworkCandidates: [candidate] }));
		await context.service.processRun('run');
		expect(isolated.apply).toHaveBeenCalledTimes(2);
		expect(isolated.apply.mock.calls[0][2].posterUrl).toBe(candidate.url);
		expect(isolated.apply.mock.calls[1][2].posterUrl).toBe('https://image.tmdb.org/t/p/original/101.jpg');
		expect(isolated.apply.mock.calls[0][4].artworkSelectedFields).toEqual(['posterUrl']);
		expect(isolated.apply.mock.calls[1][4].artworkSelectedFields).toEqual([]);
	});

	test('run creation rejects choices for titles outside its exact target set', async () => {
		const context = fixture();
		await expect(context.service.createRun({ mode: 'import', refs: [record().ref], options: { artworkSelections: [{ ref: { ...record().ref, externalId: '101' }, choices: { posterUrl: picture().id } }] } })).rejects.toThrow('INVALID_IMPORT_OPTIONS');
		expect(context.runs.rows).toEqual([]);
		expect(context.queue.add).not.toHaveBeenCalled();
	});

	test('new processing settings and successful localization snapshots reach the locked commit', async () => {
		const candidate = picture();
		const settings = { format: 'avif' as const, quality: 70, keepOriginal: true };
		const context = fixture({ runs: [run({ options: { artwork: 'local', fields: ['posterUrl'], artworkSettings: settings, artworkSelections: [{ ref: record().ref, choices: { posterUrl: candidate.id } }] } })], items: [item({ workId: 'canonical' })], works: [work({ posterPath: '/old.jpg' })] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ artworkCandidates: [candidate] }));
		context.artwork.prepare.mockResolvedValueOnce({ ...record({ posterUrl: '/files/chosen.avif' }), artworkExpected: { posterUrl: '/old.jpg' } });
		await context.service.processRun('run');
		expect(context.artwork.prepare).toHaveBeenCalledWith(expect.objectContaining({ posterUrl: candidate.url }), expect.anything(), ['posterUrl'], [], settings, 'local', ['posterUrl']);
		expect(isolated.apply.mock.calls[0][4]).toMatchObject({ artworkExpected: { posterUrl: '/old.jpg' }, artworkLocalizedFields: ['posterUrl'], artworkSelectedFields: ['posterUrl'] });
	});

	test('legacy localization preview changes only image ownership and keeps metadata protected', async () => {
		const context = fixture({ works: [work({ posterPath: '/main.jpg' })] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ posterUrl: 'https://image.tmdb.org/t/p/w780/main.jpg' }));
		const preview = await context.service.preview(record().ref, 'canonical', { artwork: 'local', fields: ['posterUrl'] });
		expect(preview.changes.find(value => value.field === 'posterUrl')).toMatchObject({ selected: true, protected: false });
		expect(preview.changes.find(value => value.field === 'title')).toMatchObject({ selected: false, protected: true });
	});

	test('an explicit empty gallery on a new local draft remains an editorial choice without downloaded bytes', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local', fields: ['galleryUrls'], artworkSelections: [{ ref: record().ref, choices: { galleryUrls: [] } }] } })], items: [item()] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ galleryUrls: ['https://image.tmdb.org/t/p/original/frame.jpg'] }));
		await context.service.processRun('run');
		expect(context.artwork.prepare).toHaveBeenCalledWith(expect.objectContaining({ galleryUrls: [] }), null, ['galleryUrls'], [], undefined, 'local', ['galleryUrls']);
		expect(isolated.apply.mock.calls[0][4]).toMatchObject({ artworkSelectedFields: ['galleryUrls'], artworkLocalizedFields: [] });
	});

	test('a zero gallery download limit without an empty choice does not acquire an editorial clear lock', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local', fields: ['galleryUrls'], artworkSettings: { galleryLimit: 0 } } })], items: [item()] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ galleryUrls: ['https://image.tmdb.org/t/p/original/frame.jpg'] }));
		context.artwork.prepare.mockImplementationOnce(async incoming => ({ ...incoming, galleryUrls: [] }));
		await context.service.processRun('run');
		expect(isolated.apply.mock.calls[0][4]).toMatchObject({ artworkSelectedFields: [], artworkLocalizedFields: [] });
	});
});

describe('Zalip importer orchestration', () => {
	test('new works without a player are skipped before artwork, while existing sync proceeds', async () => {
		const fresh = fixture({ runs: [run({ options: { filters: { requirePlayer: true }, artwork: 'local-webp' } })], items: [item()] });
		await fresh.service.processRun('run');
		expect(fresh.items.rows[0]).toMatchObject({ state: 'skipped', error: 'import-player-required' });
		expect(fresh.artwork.prepare).not.toHaveBeenCalled();
		expect(isolated.apply).not.toHaveBeenCalled();
		const existing = fixture({ runs: [run({ mode: 'sync', options: { filters: { requirePlayer: true } } })], items: [item({ workId: 'canonical' })], works: [work()] });
		await existing.service.processRun('run');
		expect(existing.items.rows[0]).toMatchObject({ state: 'completed' });
	});
	test('persists bounded targets and sends IDs only to the job queue', async () => {
		const context = fixture();
		const result = await context.service.createRun({ refs: [record().ref], mode: 'import', lockedFields: ['title', 'title'] }, 'admin');
		expect(context.runs.rows[0]).toMatchObject({ id: result.id, state: 'queued', createdById: 'admin', lockedFields: ['title'] });
		expect(context.items.rows[0]).toMatchObject({ runId: result.id, state: 'pending', position: 0, workId: null, ref: record().ref, warnings: [] });
		expect(context.queue.add).toHaveBeenCalledWith('import', { runId: result.id }, expect.objectContaining({ attempts: 3 }));
	});

	test('persists provider and local artwork warnings in the completed journal', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local-webp' } })], items: [item()] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ complete: false, warnings: ['tmdb-metadata-partial', 'tmdb-season-2-unavailable', 'tmdb-metadata-partial', 'token=PRIVATE_EXAMPLE'] }));
		context.artwork.prepare.mockImplementationOnce(async (incoming: ImportRecord) => ({ ...incoming, warnings: [...incoming.warnings, 'artwork-local-unavailable:posterUrl'] }));
		await context.service.processRun('run');
		const expected = ['tmdb-metadata-partial', 'tmdb-season-2-unavailable', 'artwork-local-unavailable:posterUrl'];
		expect(context.items.rows[0]).toMatchObject({ state: 'completed', error: null, warnings: expected });
		expect((await context.service.showRun('run')).items[0].warnings).toEqual(expected);
		expect(context.runs.rows[0].state).toBe('completed');
		expect(JSON.stringify(await context.service.showRun('run'))).not.toContain('PRIVATE_EXAMPLE');
	});

	test('retains fetched warnings on filtered and failed items without treating warnings as errors', async () => {
		for (const filtered of [false, true]) {
			const context = fixture({ runs: [run({ options: filtered ? { filters: { yearFrom: 2027 } } : {} })], items: [item()] });
			context.providers.tmdb.fetch.mockResolvedValueOnce(record({ complete: false, warnings: ['collaps-player-url-rejected'] }));
			if (!filtered) context.taxonomy.syncImportedWork.mockRejectedValueOnce(new Error('PRIVATE_EXAMPLE'));
			await context.service.processRun('run');
			expect(context.items.rows[0]).toMatchObject({ state: filtered ? 'skipped' : 'failed', error: filtered ? 'import-filtered' : 'import-failed', warnings: ['collaps-player-url-rejected'] });
			expect((await context.service.showRun('run')).items[0].warnings).toEqual(['collaps-player-url-rejected']);
		}
	});

	test('journals fetch warnings before downstream work and keeps them when cancelled', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local-webp' } })], items: [item()] });
		context.providers.tmdb.fetch.mockResolvedValueOnce(record({ complete: false, warnings: ['tmdb-metadata-partial'] }));
		const preparing = deferred<void>();
		const response = deferred<ImportRecord>();
		context.artwork.prepare.mockImplementationOnce(async () => { preparing.resolve(); return response.promise; });
		const processing = context.service.processRun('run');
		await preparing.promise;
		expect((await context.service.showRun('run')).items[0]).toMatchObject({ state: 'running', warnings: ['tmdb-metadata-partial'] });
		await context.service.actionRun('run', 'cancel');
		response.resolve(record({ warnings: ['tmdb-metadata-partial', 'artwork-local-unavailable:posterUrl'] }));
		await processing;
		expect((await context.service.showRun('run')).items[0]).toMatchObject({ state: 'pending', warnings: ['tmdb-metadata-partial', 'artwork-local-unavailable:posterUrl'] });
		expect(isolated.apply).not.toHaveBeenCalled();
	});

	test('warnings describe the latest attempt and do not leak from a failed retry', async () => {
		const context = fixture({ runs: [run({ state: 'failed' })], items: [item({ state: 'failed', warnings: ['tmdb-season-limit'] })] });
		await context.service.actionRun('run', 'retry');
		context.providers.tmdb.fetch.mockRejectedValueOnce(new Error('PRIVATE_EXAMPLE'));
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'failed', error: 'import-failed', warnings: [] });
	});

	test('journal projection supplies a safe array for every state and legacy missing values', async () => {
		const states = ['pending', 'running', 'completed', 'failed', 'skipped'] as const;
		const context = fixture({ runs: [run({ state: 'completed' })], items: states.map((state, position) => item({ id: `item-${position}`, state, position, warnings: position === 0 ? undefined as never : ['kinopoisk:upstream-failure', 'unsafe PRIVATE_EXAMPLE'] })) });
		const shown = await context.service.showRun('run');
		expect(shown.items.map(value => value.warnings)).toEqual([[], ...states.slice(1).map(() => ['kinopoisk:upstream-failure'])]);
		expect(JSON.stringify(shown)).not.toContain('PRIVATE_EXAMPLE');
	});

	test('persists the job policy, always fetches primary, and excludes unchecked enrichment', async () => {
		const context = fixture();
		enable(context, 'kinopoisk');
		enable(context, 'collaps');
		const options = { sources: ['collaps'] as ImportSource[], fields: ['description'] as const, fieldSources: { description: 'collaps' as const } };
		const created = await context.service.createRun({ refs: [record().ref], mode: 'import', options: { ...options, fields: [...options.fields] } });
		await context.service.processRun(created.id);
		expect(context.providers.tmdb.fetch).toHaveBeenCalledWith(record().ref, ['description']);
		expect(context.providers.collaps.lookup).toHaveBeenCalled();
		expect(context.providers.collaps.lookup.mock.calls[0][2]).toEqual(['description']);
		expect(context.providers.kinopoisk.lookup).not.toHaveBeenCalled();
		expect(isolated.apply.mock.calls[0][4].options).toEqual(options);
		expect((await context.service.showRun(created.id)).run.options).toEqual(options);
	});

	test('local filters skip nonmatching items without artwork, work or taxonomy writes', async () => {
		const context = fixture({ runs: [run({ options: { sources: [], filters: { yearFrom: 2027 }, artwork: 'local-webp' } })], items: [item()] });
		await context.service.processRun('run');
		expect(context.items.rows[0]).toMatchObject({ state: 'skipped', error: 'import-filtered', workId: null });
		expect(context.runs.rows[0].state).toBe('completed');
		expect(isolated.apply).not.toHaveBeenCalled();
		expect(context.artwork.prepare).not.toHaveBeenCalled();
		expect(context.taxonomy.syncImportedWork).not.toHaveBeenCalled();
		expect((await context.service.showRun('run')).run.completed).toBe(1);
	});

	test('local artwork preparation is opt-in and forwards field selection and locks', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local-webp', fields: ['posterUrl'] }, lockedFields: ['logoUrl'] })], items: [item({ workId: 'canonical' })], works: [work()] });
		context.artwork.prepare.mockResolvedValueOnce(record({ posterUrl: 'https://cdn.example.test/local.webp' }));
		await context.service.processRun('run');
		expect(context.artwork.prepare).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'canonical' }), ['posterUrl'], ['logoUrl'], undefined, 'local-webp', []);
		expect(isolated.apply.mock.calls[0][2].posterUrl).toBe('https://cdn.example.test/local.webp');
		const remote = fixture({ runs: [run()], items: [item()] });
		await remote.service.processRun('run');
		expect(remote.artwork.prepare).not.toHaveBeenCalled();
	});

	test('a missing primary refresh can recover only from stored exact alternate IDs', async () => {
		const context = fixture({ runs: [run({ mode: 'sync' })], items: [item({ workId: 'canonical' })], works: [work()], identities: [{ provider: 'tmdb', entityType: 'movie', externalId: '100', workId: 'canonical' }, { provider: 'kinopoisk', entityType: 'movie', externalId: '200', workId: 'canonical' }] });
		enable(context, 'kinopoisk');
		context.providers.tmdb.fetch.mockRejectedValueOnce(new ImportProviderError('not-found'));
		context.providers.kinopoisk.fetch.mockResolvedValueOnce(record({ ref: { source: 'kinopoisk', externalId: '200', mediaType: 'movie' }, identities: [{ provider: 'kinopoisk', externalId: '200', entityType: 'movie' }] }));
		await context.service.processRun('run');
		expect(context.providers.kinopoisk.fetch).toHaveBeenCalledWith({ source: 'kinopoisk', externalId: '200', mediaType: 'movie' }, undefined);
		expect(isolated.apply.mock.calls[0][2]).toMatchObject({ complete: false, warnings: ['tmdb:not-found'] });
		expect(isolated.apply.mock.calls[0][4].workId).toBe('canonical');
		expect(context.items.rows[0].state).toBe('completed');
	});

	test.each(['quota-exceeded', 'not-configured', 'upstream-failure'] as const)('primary %s never triggers alternate source recovery', async code => {
		const context = fixture({ runs: [run({ mode: 'sync' })], items: [item({ workId: 'canonical' })], works: [work()], identities: [{ provider: 'kinopoisk', entityType: 'movie', externalId: '200', workId: 'canonical' }] });
		enable(context, 'kinopoisk');
		context.providers.tmdb.fetch.mockRejectedValueOnce(new ImportProviderError(code));
		await context.service.processRun('run');
		expect(context.providers.kinopoisk.fetch).not.toHaveBeenCalled();
		expect(context.providers.kinopoisk.lookup).not.toHaveBeenCalled();
		expect(isolated.apply).not.toHaveBeenCalled();
	});

	test('missing-primary recovery respects source selection and rejects contradictory identities', async () => {
		for (const selected of [false, true]) {
			const context = fixture({ runs: [run({ mode: 'sync', options: selected ? {} : { sources: [] } })], items: [item({ workId: 'canonical' })], works: [work()], identities: [{ provider: 'kinopoisk', entityType: 'movie', externalId: '200', workId: 'canonical' }] });
			enable(context, 'kinopoisk');
			context.providers.tmdb.fetch.mockRejectedValueOnce(new ImportProviderError('not-found'));
			context.providers.kinopoisk.fetch.mockResolvedValueOnce(record({ ref: { source: 'kinopoisk', externalId: '201', mediaType: 'movie' }, identities: [{ provider: 'kinopoisk', externalId: '201', entityType: 'movie' }] }));
			await context.service.processRun('run');
			expect(isolated.apply).not.toHaveBeenCalled();
			expect(context.items.rows[0].error).toBe(selected ? 'IMPORT_IDENTITY_CONFLICT' : 'not-found');
		}
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
		expect(isolated.apply).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ title: 'Provider title' }), expect.objectContaining({ title: 'tmdb' }), expect.objectContaining({ workId: 'canonical', lockedFields: ['credits'], mode: 'sync', options: {} }));
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

	test('cancelling during optional artwork preparation prevents later work application', async () => {
		const context = fixture({ runs: [run({ options: { artwork: 'local-webp' } })], items: [item()] });
		const preparing = deferred<void>();
		const response = deferred<ImportRecord>();
		context.artwork.prepare.mockImplementationOnce(async () => { preparing.resolve(); return response.promise; });
		const processing = context.service.processRun('run');
		await preparing.promise;
		await context.service.actionRun('run', 'cancel');
		response.resolve(record());
		await processing;
		expect(context.items.rows[0].state).toBe('pending');
		expect(context.runs.rows[0].state).toBe('cancelled');
		expect(isolated.apply).not.toHaveBeenCalled();
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

	test('scheduler retries both committed subscription outboxes without enabling profiles or fetching providers', async () => {
		const context = fixture({ profiles: [profile({ enabled: false })] });
		await context.service.tickSchedules();
		expect(context.catalogue.dispatchPendingAllohaAvailabilityNotifications).toHaveBeenCalledOnce();
		expect(context.catalogue.dispatchPendingReleaseNotifications).toHaveBeenCalledOnce();
		expect(context.queue.add).not.toHaveBeenCalled();
		expect(context.profiles.rows[0].enabled).toBe(false);
		for (const provider of Object.values(context.providers)) expect(provider.fetch).not.toHaveBeenCalled();
		context.catalogue.dispatchPendingAllohaAvailabilityNotifications.mockRejectedValueOnce(new Error('Availability delivery failed'));
		await expect(context.service.tickSchedules()).rejects.toThrow('Availability delivery failed');
		expect(context.catalogue.dispatchPendingReleaseNotifications).toHaveBeenCalledTimes(2);
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

	test('preview distinguishes selected fields and still requires title/kind for a new draft', async () => {
		const existing = fixture({ works: [work()] });
		const preview = await existing.service.preview(record().ref, 'canonical', { fields: ['description'], sources: [] });
		expect(preview.changes.find(change => change.field === 'title')).toMatchObject({ selected: false, protected: true });
		expect(preview.changes.find(change => change.field === 'description')).toMatchObject({ selected: true, protected: false });
		const fresh = fixture();
		const creation = await fresh.service.preview(record().ref, undefined, { fields: [], sources: [] });
		expect(creation.matchesFilters).toBe(true);
		expect(creation.changes.find(change => change.field === 'title')).toMatchObject({ selected: true, protected: false });
		expect(creation.changes.find(change => change.field === 'kind')).toMatchObject({ selected: true, protected: false });
		expect(creation.changes.find(change => change.field === 'genres')).toMatchObject({ selected: false, protected: true });
		expect((await fresh.service.preview(record().ref, undefined, { sources: [], filters: { yearTo: 2000 } })).matchesFilters).toBe(false);
	});

	test('exact work locks use a pessimistic write lock without replacing editorial baselines', async () => {
		const context = fixture({ works: [work({ importData: { locks: ['title', 'credits'], values: { title: 'Provider title' }, sources: { title: 'tmdb', credits: 'private-source' }, extra: { preserved: true } } })] });
		const before = structuredClone(context.works.rows[0]);
		const result = await context.service.saveWorkState('canonical', ['genres']);
		expect(result.locks).toEqual(['genres']);
		expect(result.fields.find(field => field.field === 'title')).toMatchObject({ editorial: true, source: 'tmdb' });
		expect(result.fields.find(field => field.field === 'credits')?.source).toBeNull();
		expect(context.works.findOne).toHaveBeenCalledWith({ where: { id: 'canonical' }, lock: { mode: 'pessimistic_write' } });
		expect(context.works.rows[0].title).toBe(before.title);
		expect(context.works.rows[0].importData).toEqual({ ...(before.importData as Row), locks: ['genres'] });
		expect(JSON.stringify(await context.service.showWorkState('canonical'))).not.toContain('preserved');
		await expect(context.service.saveWorkState('canonical', ['raw'])).rejects.toThrow('INVALID_IMPORT_OPTIONS');
		await expect(context.service.showWorkState('missing')).rejects.toThrow('NO_SUCH_WORK');
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
		const player: ImportRecord['players'][number] = { source: 'alloha', externalId: 'private-id', iframeUrl: 'https://ascorbic-as.stravers.live/embed', translations: [], quality: 'HD', episodes: [] };
		const context = fixture({ works: [work({ importData: { values: { players: [player] }, raw: { private: 'internal' } } }), work({ id: 'draft', publicationState: 'draft' })] });
		await expect(context.service.playback('draft')).rejects.toThrow('NO_SUCH_WORK');
		const playback = await context.service.playback('canonical');
		expect(playback.sources).toHaveLength(1);
		expect(JSON.stringify(playback)).not.toContain('private-id');
		expect(JSON.stringify(playback)).not.toContain('internal');
	});

	test('runtime settings rotate API adapters and cached Alloha iframe token without a restart', async () => {
		const player: ImportRecord['players'][number] = { source: 'alloha', externalId: 'private-id', iframeUrl: 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&season=1&episode=2&token=old-player-fixture', translations: [], quality: 'HD', episodes: [] };
		const context = fixture({ works: [work({ importData: { values: { players: [player] } } })] });
		await context.service.sources();
		context.sourceSettings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaApiToken: 'new-api-fixture', allohaPlayerToken: 'new-public-fixture', allohaPlayerOrigin: 'https://mirror.example.org' });
		await context.service.sources();
		expect(isolated.providers.mock.calls.at(-1)?.[0]).toMatchObject({ allohaApiToken: 'new-api-fixture' });
		const playback = await context.service.playback('canonical');
		const iframe = new URL(playback.sources[0].iframe);
		expect(iframe.origin).toBe('https://mirror.example.org');
		expect(iframe.searchParams.get('token')).toBe('new-public-fixture');
		expect(iframe.searchParams.get('episode')).toBe('2');
		expect(JSON.stringify(playback)).not.toContain('new-api-fixture');
		expect(JSON.stringify(playback)).not.toContain('old-player-fixture');
	});

	test('public playback preserves each voice iframe and rotates its mirror and approved embed token', async () => {
		const player: ImportRecord['players'][number] = {
			source: 'alloha', externalId: 'private-id', iframeUrl: 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&token=old-player-fixture', quality: 'HD', episodes: [],
			translations: [
				{ id: '3', name: 'Studio One', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-one&translation=3&season=1&episode=2&token=old-player-fixture', quality: 'HD', resolutions: ['1080p'] },
				{ id: '4', name: 'Studio Two', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-two&translation=4&token=old-player-fixture', quality: null, resolutions: [] },
			],
		};
		const context = fixture({ works: [work({ importData: { values: { players: [player] } } })] });
		context.sourceSettings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaApiToken: 'new-api-fixture', allohaPlayerToken: 'new-public-fixture', allohaPlayerOrigin: 'https://mirror.example.org' });
		const playback = await context.service.playback('canonical');
		expect(playback.sources[0].translations).toHaveLength(2);
		for (const translation of playback.sources[0].translations) {
			const iframe = new URL(translation.iframe!);
			expect(iframe.origin).toBe('https://mirror.example.org');
			expect(iframe.searchParams.get('token')).toBe('new-public-fixture');
			expect(iframe.searchParams.get('translation')).toBe(translation.id);
		}
		expect(new URL(playback.sources[0].translations[0].iframe!).searchParams.get('token_movie')).toBe('voice-one');
		expect(new URL(playback.sources[0].translations[1].iframe!).searchParams.get('token_movie')).toBe('voice-two');
		expect(playback.sources[0].translations[0]).toMatchObject({ quality: 'HD', resolutions: ['1080p'] });
		expect(JSON.stringify(playback)).not.toContain('new-api-fixture');
		expect(JSON.stringify(playback)).not.toContain('old-player-fixture');
	});

	test('old label-only snapshots get provider-specific voice iframes without reimport or writes', async () => {
		const alloha: ImportRecord['players'][number] = { source: 'alloha', externalId: 'private-alloha', iframeUrl: 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&season=1&episode=2&token=old-player-fixture', translations: [{ id: '246', name: 'Studio' }, { id: 'arbitrary-id', name: 'Not a documented selector' }], quality: 'HD', episodes: [] };
		const collaps: ImportRecord['players'][number] = { source: 'collaps', externalId: 'private-collaps', iframeUrl: 'https://api.nextembed.ws/embed/50?season=1&episode=2', translations: [{ id: '5', name: 'Творческая студия МИР' }], quality: 'HD', episodes: [] };
		const stored = { values: { players: [alloha, collaps] } };
		const context = fixture({ works: [work({ importData: stored })] });
		context.sourceSettings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaPlayerToken: 'new-public-fixture', allohaPlayerOrigin: 'https://mirror.example.org', collapsPlayerOrigin: 'https://collaps.example.org' });
		const playback = await context.service.playback('canonical');
		const first = new URL(playback.sources.find(player => player.source === 'alloha')!.translations[0].iframe!);
		const second = new URL(playback.sources.find(player => player.source === 'collaps')!.translations[0].iframe!);
		expect(first.origin).toBe('https://mirror.example.org');
		expect(first.searchParams.get('token')).toBe('new-public-fixture');
		expect(first.searchParams.get('translation')).toBe('246');
		expect(first.searchParams.get('oneSound')).toBeNull();
		expect(second.origin).toBe('https://collaps.example.org');
		expect(second.searchParams.get('oneSound')).toBe('Творческая студия МИР');
		expect(second.searchParams.get('translation')).toBeNull();
		for (const iframe of [first, second]) {
			expect(iframe.searchParams.get('season')).toBe('1');
			expect(iframe.searchParams.get('episode')).toBe('2');
		}
		expect(playback.sources.find(player => player.source === 'alloha')!.translations[1]).not.toHaveProperty('iframe');
		expect(context.works.rows[0].importData).toEqual(stored);
		expect(context.works.save).not.toHaveBeenCalled();
		expect(context.catalogue.recordAllohaAvailability).not.toHaveBeenCalled();
	});

	test('malformed cached voice fields and rejected iframe URLs never leave the playback boundary', async () => {
		const player = {
			source: 'alloha', externalId: 'private-id', iframeUrl: 'https://ascorbic-as.stravers.live/embed', quality: 'HD', episodes: [],
			translations: [
				null, 'invalid', { id: 2, name: 'Invalid ID' }, { id: '3', name: {} },
				{ id: '4', name: 'Unsafe origin', iframe: 'https://untrusted.example.org/embed?token=private-fixture' },
				{ id: '5', name: 'Unsafe credentials', iframe: 'https://ascorbic-as.stravers.live/embed?api_key=private-fixture' },
				{ id: '6', name: 'Safe label', quality: { token: 'private-fixture' }, resolutions: ['1080p', { token: 'private-fixture' }, '1080p'], raw: { token: 'private-fixture' } },
				{ id: '6', name: 'Duplicate' },
			],
		};
		const context = fixture({ works: [work({ importData: { values: { players: [player] } } })] });
		const playback = await context.service.playback('canonical');
		expect(playback.sources[0].translations).toEqual([
			{ id: '4', name: 'Unsafe origin' },
			{ id: '5', name: 'Unsafe credentials' },
			{ id: '6', name: 'Safe label', iframe: 'https://ascorbic-as.stravers.live/embed?translation=6', resolutions: ['1080p'] },
		]);
		expect(JSON.stringify(playback)).not.toContain('private-fixture');
	});

	test('public playback follows administrator order, hides disabled players and deduplicates canonical sources without events', async () => {
		const alloha = { source: 'alloha', externalId: 'private-alloha', iframeUrl: 'https://ascorbic-as.stravers.live/alloha', translations: [], quality: 'HD', episodes: [] } as const;
		const collaps = { ...alloha, source: 'collaps', externalId: 'private-collaps', iframeUrl: 'https://api.nextembed.ws/collaps' } as const;
		const context = fixture({ works: [work({ importData: { values: { players: [alloha, collaps, { ...collaps, iframeUrl: 'https://player.example.test/duplicate' }] } } }), work({ id: 'draft', publicationState: 'draft' })] });
		context.playbackSettings.show.mockResolvedValue({ providers: [{ source: 'collaps', label: 'Основной', enabled: true, position: 0 }, { source: 'alloha', label: 'Резервный', enabled: true, position: 1 }] });
		const ordered = await context.service.playback('canonical');
		expect(ordered.sources.map(player => player.source)).toEqual(['collaps', 'alloha']);
		expect(ordered.sources[0]).toMatchObject({ label: 'Основной', iframe: collaps.iframeUrl });
		context.playbackSettings.show.mockResolvedValue({ providers: [{ source: 'collaps', label: 'Основной', enabled: false, position: 0 }, { source: 'alloha', label: 'Резервный', enabled: true, position: 1 }] });
		expect((await context.service.playback('canonical')).sources.map(player => player.source)).toEqual(['alloha']);
		await expect(context.service.playback('draft')).rejects.toThrow('NO_SUCH_WORK');
		expect(context.catalogue.recordAllohaAvailability).not.toHaveBeenCalled();
		expect(context.catalogue.dispatchPendingAllohaAvailabilityNotifications).not.toHaveBeenCalled();
	});

	test('refresh profiles bind existing work IDs and skip unmapped manual titles', async () => {
		const context = fixture({ profiles: [profile()], works: [work(), work({ id: 'manual', tmdbId: null, tmdbMediaType: null })] });
		await context.service.runProfile('profile');
		expect(context.items.rows).toHaveLength(1);
		expect(context.items.rows[0]).toMatchObject({ workId: 'canonical', ref: record().ref });
		expect(context.runs.rows[0]).toMatchObject({ mode: 'sync', profileId: 'profile' });
	});

	test('profile bounds match database lengths and omitted policies preserve their saved value', async () => {
		const context = fixture({ profiles: [profile({ options: { sources: [], fields: ['ratings'] } })] });
		const saved = await context.service.saveProfile({ id: 'profile', name: 'n'.repeat(120), enabled: false, source: 'tmdb', mode: 'collection', collectionId: 'c'.repeat(100), intervalMinutes: 15 });
		expect(saved).toMatchObject({ options: { sources: [], fields: ['ratings'] }, enabled: false, nextRunAt: null });
		await expect(context.service.saveProfile({ name: 'n'.repeat(121), enabled: false, source: 'tmdb', mode: 'metadata', intervalMinutes: 15 })).rejects.toThrow('invalid-ref');
		await expect(context.service.saveProfile({ name: 'name', enabled: false, source: 'tmdb', mode: 'collection', collectionId: 'c'.repeat(101), intervalMinutes: 15 })).rejects.toThrow('invalid-ref');
		expect(context.db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-import-profile:profile']);
	});

	test('changing source, mode or collection resets the cursor while unchanged config preserves it', async () => {
		const context = fixture({ profiles: [profile({ mode: 'collection', collectionId: 'first', cursor: 3, lastError: 'not-found' })] });
		const base = { id: 'profile', name: 'Collection', enabled: false, source: 'tmdb' as const, mode: 'collection' as const, collectionId: 'first', intervalMinutes: 15 };
		expect((await context.service.saveProfile(base)).cursor).toBe(3);
		expect(await context.service.saveProfile({ ...base, collectionId: 'second' })).toMatchObject({ cursor: 0, lastError: null });
		context.profiles.rows[0].cursor = 5;
		expect((await context.service.saveProfile({ ...base, source: 'kinopoisk', collectionId: 'second' })).cursor).toBe(0);
		context.profiles.rows[0].cursor = 100;
		expect((await context.service.saveProfile({ ...base, source: 'kinopoisk', mode: 'metadata' })).cursor).toBe(0);
	});

	test.each(['queued', 'running', 'paused'] as const)('profile %s runs block config changes, cursor reset and deletion but allow disabling', async state => {
		const context = fixture({ profiles: [profile({ cursor: 5 })], runs: [run({ profileId: 'profile', state })] });
		await expect(context.service.saveProfile({ id: 'profile', name: 'Changed', enabled: false, source: 'tmdb', mode: 'metadata', intervalMinutes: 15 })).rejects.toThrow('IMPORT_RUN_BUSY');
		await expect(context.service.actionProfile('profile', 'reset-cursor')).rejects.toThrow('IMPORT_RUN_BUSY');
		await expect(context.service.actionProfile('profile', 'delete')).rejects.toThrow('IMPORT_RUN_BUSY');
		await expect(context.service.actionProfile('profile', 'disable')).resolves.toMatchObject({ profile: { enabled: false, nextRunAt: null, cursor: 5 } });
		expect(context.runs.rows[0].state).toBe(state);
		expect(context.profiles.rows[0].name).toBe('Collection');
	});

	test('profile actions enable, reset and delete only the specified idle profile', async () => {
		const context = fixture({ profiles: [profile({ enabled: false, cursor: 3, lastError: 'not-found' }), profile({ id: 'other' })] });
		await expect(context.service.actionProfile('profile', 'enable')).resolves.toMatchObject({ profile: { enabled: true } });
		await expect(context.service.actionProfile('profile', 'reset-cursor')).resolves.toMatchObject({ profile: { cursor: 0, lastError: null } });
		await expect(context.service.actionProfile('profile', 'delete')).resolves.toEqual({ id: 'profile', deleted: true });
		expect(context.profiles.rows.map(row => row.id)).toEqual(['other']);
		await expect(context.service.actionProfile('missing', 'disable')).rejects.toThrow('not-found');
	});

	test('discovery is disabled on creation and accepts only providers with update capability', async () => {
		const context = fixture();
		context.providers.tmdb.updates = undefined as never;
		await expect(context.service.saveProfile({ name: 'Unsupported', enabled: false, source: 'tmdb', mode: 'discovery', intervalMinutes: 15 })).rejects.toThrow('unsupported');
		const saved = await context.service.saveProfile({ name: 'Discover', enabled: false, source: 'collaps', mode: 'discovery', intervalMinutes: 15, options: { filters: { yearFrom: 2026 } } });
		expect(saved).toMatchObject({ enabled: false, nextRunAt: null, cursor: 0, options: { filters: { yearFrom: 2026 } } });
		await context.service.tickSchedules();
		expect(context.providers.collaps.updates).not.toHaveBeenCalled();
		await expect(context.service.actionProfile(saved.id, 'enable')).rejects.toThrow('not-configured');
	});

	test('discovery pages at most 100 draft imports and carries the persisted policy into runs', async () => {
		const options = { sources: ['collaps'] as ImportSource[], fields: ['title', 'ratings'] as const, filters: { yearFrom: 2026 } };
		const context = fixture({ profiles: [profile({ source: 'collaps', mode: 'discovery', enabled: false, cursor: 2, options: { ...options, fields: [...options.fields] } })] });
		enable(context, 'collaps');
		context.providers.collaps.updates.mockResolvedValueOnce({ items: Array.from({ length: 101 }, (_, index) => ({ ref: { source: 'collaps', mediaType: 'movie', externalId: String(index + 1) } })), page: 3, hasMore: true });
		const dispatched = await context.service.runProfile('profile');
		expect(context.providers.collaps.updates).toHaveBeenCalledWith(3);
		expect(context.items.rows).toHaveLength(100);
		expect(context.runs.rows[0]).toMatchObject({ id: dispatched.id, mode: 'import', options });
		expect(context.profiles.rows[0]).toMatchObject({ cursor: 3, nextRunAt: null });
		expect(isolated.apply).not.toHaveBeenCalled(); // Queue dispatch never auto-publishes.
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

	test('a scheduled profile disabled after its claim cannot start a new run', async () => {
		const context = fixture({ profiles: [profile()], works: [work()] });
		context.profiles.findOneBy.mockImplementationOnce(async () => {
			context.profiles.rows[0].enabled = false;
			context.profiles.rows[0].nextRunAt = null;
			return structuredClone(context.profiles.rows[0]);
		});
		await context.service.tickSchedules();
		expect(context.runs.rows).toEqual([]);
		expect(context.queue.add).not.toHaveBeenCalled();
	});

	test('error boundary never returns arbitrary messages or provider credentials', () => {
		expect(safeImportError(new ImportProviderError('quota-exceeded'))).toBe('quota-exceeded');
		expect(safeImportError(new Error('IMPORT_IDENTITY_CONFLICT'))).toBe('IMPORT_IDENTITY_CONFLICT');
		expect(safeImportError(new Error('password=PRIVATE_EXAMPLE'))).toBe('import-failed');
	});

	test('warning boundary accepts closed codes only and bounds deduplicated output', () => {
		expect(safeImportWarnings(null)).toEqual([]);
		expect(safeImportWarnings(['tmdb-season-limit', 'tmdb-season-limit', 'tmdb-season-0-unavailable', 'tmdb-season-9999-unavailable', 'tmdb-season-10000-unavailable', 'tmdb-season-01-unavailable', 'kinopoisk:upstream-failure', 'kinopoisk:some-user-error', 'artwork-local-unavailable:logoUrl', 'artwork-local-unavailable:token', 'https://provider.test/?token=PRIVATE_EXAMPLE', 1])).toEqual(['tmdb-season-limit', 'tmdb-season-0-unavailable', 'tmdb-season-9999-unavailable', 'kinopoisk:upstream-failure', 'artwork-local-unavailable:logoUrl']);
		expect(safeImportWarnings(Array.from({ length: 100 }, (_, index) => `tmdb-season-${index}-unavailable`))).toHaveLength(50);
		expect(safeImportWarnings([...Array.from({ length: 1000 }, () => 'not-a-warning'), 'tmdb-season-limit'])).toEqual([]);
	});
});
