/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { applyImportRecord, currentImportFields, findImportWork } from './apply.js';
import type { ImportRecord } from './types.js';

function record(values: Partial<ImportRecord> = {}): ImportRecord {
	return {
		ref: { source: 'tmdb', externalId: '100', mediaType: 'movie' }, identities: [{ provider: 'tmdb', externalId: '100', entityType: 'movie' }],
		title: 'Movie', originalTitle: null, description: 'Description', releaseYear: 2026, runtimeMinutes: 90, kind: 'movie',
		genres: ['драма'], countries: ['Россия'], posterUrl: 'https://image.tmdb.org/t/p/original/poster.jpg', backdropUrl: null,
		logoUrl: null, galleryUrls: [], trailerYoutubeKey: null, ratings: [{ source: 'tmdb', value: 8, votes: 20 }], ageRating: '16+',
		credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [], ...values,
	};
}

function work(values: Partial<MiZalipWork> = {}): MiZalipWork {
	return {
		id: 'legacy', slug: 'legacy', title: 'Editorial legacy title', kind: 'movie', publicationState: 'published', publishedAt: new Date('2026-01-01'),
		createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), originalTitle: null, description: null,
		releaseYear: null, runtimeMinutes: null, genres: [], posterPath: null, backdropPath: null, logoPath: null,
		galleryPaths: [], trailerYoutubeKey: null, tmdbMediaType: 'movie', tmdbId: 100, importData: {}, ...values,
	};
}

type Row = Record<string, unknown>;

/** In-memory transactions commit only successful callbacks, exposing rollback mistakes. */
function fixture(seed: { works?: MiZalipWork[]; identities?: Partial<MiZalipExternalIdentity>[] } = {}) {
	let persisted = new Map<unknown, Row[]>([
		[MiZalipWork, structuredClone(seed.works ?? []) as unknown as Row[]],
		[MiZalipExternalIdentity, structuredClone(seed.identities ?? []) as unknown as Row[]],
		[MiZalipSeason, []], [MiZalipEpisode, []],
	]);
	const query = vi.fn();
	const matches = (row: Row, where: Row) => Object.entries(where).every(([key, value]) => row[key] === value);

	function repository(storage: Map<unknown, Row[]>, model: unknown) {
		const rows = storage.get(model) ?? [];
		return {
			findBy: vi.fn(async (where: Row | Row[]) => rows.filter(row => (Array.isArray(where) ? where : [where]).some(condition => matches(row, condition)))),
			findOneBy: vi.fn(async (where: Row) => rows.find(row => matches(row, where)) ?? null),
			findOneOrFail: vi.fn(async (options: { where: Row }) => {
				const value = rows.find(row => matches(row, options.where));
				if (!value) throw new Error('NOT_FOUND');
				return value;
			}),
			existsBy: vi.fn(async (where: Row) => rows.some(row => matches(row, where))),
			create: vi.fn((value: Row) => value),
			save: vi.fn(async (value: Row) => {
				const index = rows.findIndex(row => row.id === value.id);
				if (index < 0) rows.push(value);
				else rows[index] = value;
				return value;
			}),
		};
	}

	const db = {
		getRepository: (model: unknown) => repository(persisted, model),
		transaction: vi.fn(async (action: (manager: unknown) => Promise<unknown>) => {
			const staged = new Map([...persisted].map(([key, value]) => [key, structuredClone(value)]));
			const result = await action({ getRepository: (model: unknown) => repository(staged, model), query });
			persisted = staged;
			return result;
		}),
	};
	let nextId = 0;
	return {
		db: db as never, idService: { gen: () => `id-${++nextId}` }, query,
		works: () => persisted.get(MiZalipWork) as unknown as MiZalipWork[],
		identities: () => persisted.get(MiZalipExternalIdentity) as unknown as MiZalipExternalIdentity[],
		seasons: () => persisted.get(MiZalipSeason) as unknown as MiZalipSeason[],
		episodes: () => persisted.get(MiZalipEpisode) as unknown as MiZalipEpisode[],
	};
}

describe('Zalip transactional import application', () => {
	test('creates only drafts, stores normalized metadata and initializes persistent ownership locks', async () => {
		const context = fixture();
		const result = await applyImportRecord(context.db, context.idService, record(), { title: 'tmdb' }, { lockedFields: ['title', 'genres'] });
		expect(result.created).toBe(true);
		expect(result.protectedFields).toEqual([]);
		expect(result.work).toMatchObject({ title: 'Movie', description: 'Description', publicationState: 'draft', publishedAt: null, tmdbId: 100, tmdbMediaType: 'movie' });
		expect(result.work.importData).toMatchObject({ locks: ['title', 'genres'], countries: ['Россия'], ratings: [{ source: 'tmdb', value: 8, votes: 20 }] });
		expect(context.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-import-identities']);
		expect(context.identities()).toHaveLength(1);
	});

	test('persists selectable voice iframes, quality and resolutions without raw provider fields or unsafe URLs', async () => {
		const context = fixture();
		const result = await applyImportRecord(context.db, context.idService, record({ players: [{
			source: 'alloha', externalId: 'tmdb:movie:100', iframeUrl: 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&token=public-player-fixture', quality: 'HD', episodes: [],
			translations: [
				{ id: '3', name: 'Studio', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-fixture&translation=3&token=public-player-fixture', quality: ' HD ', resolutions: ['1080p', '1080p', '720p'] },
				{ id: '4', name: 'Unsafe', iframe: 'https://user:password@ascorbic-as.stravers.live/embed/4', quality: null, resolutions: [] },
				{ id: '5', name: 'Legacy' },
				{ id: '6', name: 'Foreign origin', iframe: 'https://untrusted.example.org/embed/6?token=untrusted-token-fixture' },
			],
		}] }), {});
		expect((result.work.importData.values as Row).players).toEqual([expect.objectContaining({ translations: [
			{ id: '3', name: 'Studio', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-fixture&translation=3&token=public-player-fixture', quality: 'HD', resolutions: ['1080p', '720p'] },
			{ id: '4', name: 'Unsafe', quality: null, resolutions: [] },
			{ id: '5', name: 'Legacy' },
			{ id: '6', name: 'Foreign origin' },
		] })]);
		expect(JSON.stringify(result.work.importData)).not.toContain('password');
		expect(JSON.stringify(result.work.importData)).not.toContain('untrusted.example.org');
	});

	test('repeated imports deduplicate by identities and update provider-owned fields', async () => {
		const context = fixture();
		const first = await applyImportRecord(context.db, context.idService, record(), {});
		const second = await applyImportRecord(context.db, context.idService, record({ title: 'Updated title', description: 'Updated description' }), {});
		expect(second.created).toBe(false);
		expect(second.work.id).toBe(first.work.id);
		expect(second.work.title).toBe('Updated title');
		expect(second.work.description).toBe('Updated description');
		expect(context.works()).toHaveLength(1);
		expect(context.identities()).toHaveLength(1);
	});

	test('a new title requires only title and kind when all optional blocks are excluded', async () => {
		const context = fixture();
		const incoming = record({ seasons: [{ seasonNumber: 1, title: 'Season', episodes: [{ episodeNumber: 1, title: 'Episode' }] }] });
		const result = await applyImportRecord(context.db, context.idService, incoming, {}, { options: { fields: [] } });
		expect(result.work).toMatchObject({ title: 'Movie', kind: 'movie', description: null, releaseYear: null, posterPath: null, genres: [], publicationState: 'draft' });
		expect(result.work.importData).toMatchObject({ countries: [], ratings: [], values: { title: 'Movie', kind: 'movie' } });
		expect(result.protectedFields).toContain('seasons');
		expect(context.seasons()).toEqual([]);
		expect(context.episodes()).toEqual([]);
	});

	test('selected fields cannot update excluded values, baselines, players or episode blocks', async () => {
		const context = fixture();
		const initial = record({ seasons: [{ seasonNumber: 1, title: 'Original season', episodes: [{ episodeNumber: 1, title: 'Original episode' }] }] });
		await applyImportRecord(context.db, context.idService, initial, {});
		const baseline = structuredClone(context.works()[0].importData);
		const result = await applyImportRecord(context.db, context.idService, record({ title: 'Excluded title', description: 'Selected description', genres: ['комедия'], releaseYear: 2027, countries: ['Япония'], ratings: [{ source: 'tmdb', value: 5, votes: 1 }], seasons: [{ seasonNumber: 2, title: 'Excluded season', episodes: [] }], players: [{ source: 'collaps', externalId: '50', iframeUrl: 'https://api.nextembed.ws/embed/movie/50', translations: [], quality: null, episodes: [] }] }), {}, { options: { fields: ['description'] } });
		expect(result.work).toMatchObject({ title: 'Movie', description: 'Selected description', releaseYear: 2026, genres: ['драма'] });
		for (const field of ['title', 'genres', 'releaseYear', 'seasons', 'players', 'ratings', 'countries']) expect((result.work.importData.values as Row)[field]).toEqual((baseline.values as Row)[field]);
		expect(result.work.importData).toMatchObject({ countries: ['Россия'], ratings: [{ source: 'tmdb', value: 8, votes: 20 }] });
		expect(result.protectedFields).toEqual(expect.arrayContaining(['credits', 'genres', 'collections', 'companies', 'players', 'seasons']));
		expect(context.seasons()).toHaveLength(1);
		expect(context.episodes()[0].title).toBe('Original episode');
	});

	test('detects manual edits and manual clearing independently of explicit locks', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record(), {});
		context.works()[0].title = 'Editorial title';
		context.works()[0].description = null;
		context.works()[0].genres = [];
		const refreshed = await applyImportRecord(context.db, context.idService, record({ title: 'Provider title', description: 'Provider description', genres: ['комедия'], releaseYear: 2027 }), {});
		expect(refreshed.work.title).toBe('Editorial title');
		expect(refreshed.work.description).toBeNull();
		expect(refreshed.work.genres).toEqual([]);
		expect(refreshed.work.releaseYear).toBe(2027);
		expect(refreshed.protectedFields).toEqual(expect.arrayContaining(['title', 'description', 'genres']));
	});

	test('locks persist across later jobs and never change publication state', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record(), {}, { lockedFields: ['title'] });
		context.works()[0].publicationState = 'archived';
		context.works()[0].publishedAt = new Date('2026-01-01');
		const refreshed = await applyImportRecord(context.db, context.idService, record({ title: 'Changed' }), {}, { mode: 'sync' });
		expect(refreshed.work.title).toBe('Movie');
		expect(refreshed.work.publicationState).toBe('archived');
		expect(refreshed.work.publishedAt).toEqual(new Date('2026-01-01'));
		expect(refreshed.protectedFields).toContain('title');
	});

	test('legacy TMDB bindings are reused without treating existing editorial fields as importer-owned', async () => {
		const context = fixture({ works: [work({ description: 'Editorial description' })] });
		const refreshed = await applyImportRecord(context.db, context.idService, record(), {});
		expect(refreshed.created).toBe(false);
		expect(refreshed.work.id).toBe('legacy');
		expect(refreshed.work.title).toBe('Editorial legacy title');
		expect(refreshed.work.description).toBe('Editorial description');
		expect(refreshed.work.posterPath).toBe('https://image.tmdb.org/t/p/original/poster.jpg');
		expect(refreshed.work.publicationState).toBe('published');
		expect(context.identities()).toHaveLength(1);
	});

	test('the same TMDB integer for movie and TV is never merged', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record(), {});
		const television = record({ ref: { source: 'tmdb', externalId: '100', mediaType: 'tv' }, identities: [{ provider: 'tmdb', externalId: '100', entityType: 'tv' }], kind: 'series' });
		await applyImportRecord(context.db, context.idService, television, {});
		expect(context.works()).toHaveLength(2);
		expect(context.identities().map(identity => identity.entityType)).toEqual(['movie', 'tv']);
	});

	test('conflicting provider bindings and an explicit foreign title are rejected before commit', async () => {
		const context = fixture({ works: [work(), work({ id: 'another', slug: 'another', tmdbId: 200 })] });
		await expect(applyImportRecord(context.db, context.idService, record(), {}, { workId: 'another' })).rejects.toThrow('IMPORT_IDENTITY_CONFLICT');
		expect(context.identities()).toEqual([]);
		const disagreement = fixture({ works: [work(), work({ id: 'another', slug: 'another', tmdbId: null })], identities: [{ id: 'binding', workId: 'another', provider: 'kinopoisk', entityType: 'movie', externalId: '300' }] });
		await expect(applyImportRecord(disagreement.db, disagreement.idService, record({ identities: [{ provider: 'tmdb', entityType: 'movie', externalId: '100' }, { provider: 'kinopoisk', entityType: 'movie', externalId: '300' }] }), {})).rejects.toThrow('IMPORT_IDENTITY_CONFLICT');
	});

	test('existing different IDs from the same provider cannot be silently remapped', async () => {
		const context = fixture({ works: [work()], identities: [{ id: 'binding', workId: 'legacy', provider: 'kinopoisk', entityType: 'movie', externalId: 'old' }] });
		await expect(findImportWork(context.db, record({ identities: [{ provider: 'kinopoisk', entityType: 'movie', externalId: 'new' }] }), 'legacy')).rejects.toThrow('IMPORT_IDENTITY_CONFLICT');
	});

	test('sync and availability jobs cannot add new titles', async () => {
		for (const mode of ['sync', 'availability'] as const) {
			const context = fixture();
			await expect(applyImportRecord(context.db, context.idService, record(), {}, { mode })).rejects.toThrow('NO_SUCH_WORK');
			expect(context.works()).toEqual([]);
		}
	});

	test('invalid identities and mixed media are rejected without writing any data', async () => {
		const context = fixture();
		await expect(applyImportRecord(context.db, context.idService, record({ identities: [{ provider: 'tmdb', externalId: 'bad', entityType: 'movie' }] }), {})).rejects.toThrow('IMPORT_IDENTITY_CONFLICT');
		await expect(applyImportRecord(context.db, context.idService, record({ identities: [{ provider: 'kinopoisk', externalId: '1', entityType: 'tv' }] }), {})).rejects.toThrow('IMPORT_MEDIA_TYPE_CONFLICT');
		expect(context.works()).toEqual([]);
	});

	test('an episode error rolls back its work, provider bindings and previously saved season', async () => {
		const context = fixture();
		await expect(applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'Season', episodes: [{ episodeNumber: -1, title: 'Invalid' }] }] }), {})).rejects.toThrow('INVALID_IMPORT_EPISODE');
		expect(context.works()).toEqual([]);
		expect(context.identities()).toEqual([]);
		expect(context.seasons()).toEqual([]);
	});

	test('snapshots contain normalized fields only, never extra raw objects', async () => {
		const context = fixture();
		const source = record({ credits: [{ source: 'tmdb', externalId: '10', name: 'Actor', role: 'actor', character: null, imageUrl: null, raw: { secret: 'fixture' } } as never] });
		Object.assign(source, { raw: { secret: 'fixture' } });
		await applyImportRecord(context.db, context.idService, source, {});
		const snapshot = context.identities()[0].snapshot;
		expect(snapshot).not.toHaveProperty('raw');
		expect(snapshot?.credits[0]).not.toHaveProperty('raw');
		expect(currentImportFields(context.works()[0])).not.toHaveProperty('snapshot');
	});
});

describe('Zalip imported seasons and playback', () => {
	test('updates episode stills while preserving manual title, description and explicit clearing', async () => {
		const context = fixture();
		const seasons = [{ seasonNumber: 1, title: 'Season 1', episodes: [{ episodeNumber: 1, title: 'Episode 1', description: 'Source description', stillUrl: 'https://images.example.org/old.jpg' }] }];
		await applyImportRecord(context.db, context.idService, record({ seasons }), {});
		context.episodes()[0].title = 'Editorial episode title';
		context.episodes()[0].description = null;
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ ...seasons[0], episodes: [{ ...seasons[0].episodes[0], title: 'New source title', description: 'New source description', stillUrl: 'https://images.example.org/new.jpg' }] }] }), {});
		expect(context.episodes()[0]).toMatchObject({ title: 'Editorial episode title', description: null, stillPath: 'https://images.example.org/new.jpg' });
	});

	test('missing seasons or episodes never delete canonical metadata', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'Season 1', episodes: [{ episodeNumber: 1, title: 'One' }, { episodeNumber: 2, title: 'Two' }] }] }), {});
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'Season 1', episodes: [{ episodeNumber: 1, title: 'One' }] }] }), {});
		expect(context.episodes()).toHaveLength(2);
		await applyImportRecord(context.db, context.idService, record({ seasons: [] }), {});
		expect(context.seasons()).toHaveLength(1);
		expect(context.episodes()).toHaveLength(2);
	});

	test('generated episode titles have a baseline and can later be enriched', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: '', episodes: [{ episodeNumber: 1, title: '' }] }] }), {});
		expect(context.episodes()[0].title).toBe('Серия 1');
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'Actual season', episodes: [{ episodeNumber: 1, title: 'Actual episode' }] }] }), {});
		expect(context.seasons()[0].title).toBe('Actual season');
		expect(context.episodes()[0].title).toBe('Actual episode');
	});

	test('persistent season lock prevents both metadata changes and new episodes', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'Season 1', episodes: [{ episodeNumber: 1, title: 'One' }] }] }), {}, { lockedFields: ['seasons'] });
		await applyImportRecord(context.db, context.idService, record({ seasons: [{ seasonNumber: 1, title: 'New season', episodes: [{ episodeNumber: 2, title: 'Two' }] }] }), {});
		expect(context.seasons()[0].title).toBe('Season 1');
		expect(context.episodes()).toHaveLength(1);
	});

	test('availability-only jobs update players without overwriting any title or episode fields', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record(), {});
		const player = { source: 'collaps' as const, externalId: '50', iframeUrl: 'https://api.nextembed.ws/embed/movie/50', translations: [], quality: null, episodes: [] };
		const applied = await applyImportRecord(context.db, context.idService, record({ title: 'Unwanted title', releaseYear: 2000, players: [player], seasons: [{ seasonNumber: 1, title: 'Unwanted season', episodes: [] }] }), {}, { mode: 'availability' });
		expect(applied.work.title).toBe('Movie');
		expect(applied.work.releaseYear).toBe(2026);
		expect((applied.work.importData.values as Row).players).toEqual([player]);
		expect(context.seasons()).toEqual([]);
		expect(applied.protectedFields).toContain('seasons');
	});

	test('partial source responses preserve existing playback sources', async () => {
		const context = fixture();
		const alloha = { source: 'alloha' as const, externalId: 'a', iframeUrl: 'https://player.example.org/a', translations: [], quality: null, episodes: [] };
		const collaps = { source: 'collaps' as const, externalId: 'c', iframeUrl: 'https://player.example.org/c', translations: [], quality: null, episodes: [] };
		await applyImportRecord(context.db, context.idService, record({ players: [alloha] }), {});
		const applied = await applyImportRecord(context.db, context.idService, record({ players: [collaps], complete: false }), {});
		expect((applied.work.importData.values as Row).players).toEqual([alloha, collaps]);
	});
});

describe('Zalip artwork commit compare-and-swap', () => {
	test('localizes a confirmed legacy TMDB path without claiming unrelated editorial metadata', async () => {
		const context = fixture({ works: [work({ posterPath: '/poster.jpg', description: 'Editorial description' })] });
		const result = await applyImportRecord(context.db, context.idService, record({ posterUrl: '/files/local-poster.webp' }), {}, { options: { fields: ['posterUrl'], artwork: 'local' }, artworkExpected: { posterUrl: '/poster.jpg' }, artworkLocalizedFields: ['posterUrl'] });
		expect(result.work).toMatchObject({ posterPath: '/files/local-poster.webp', title: 'Editorial legacy title', description: 'Editorial description', publicationState: 'published' });
		expect(result.work.importData).toMatchObject({ values: { posterUrl: '/files/local-poster.webp' }, localArtwork: { posterUrl: '/files/local-poster.webp' } });
		expect(result.work.importData.values).not.toHaveProperty('title');
		expect(result.protectedFields).not.toContain('posterUrl');
	});

	test('a stale prepared image cannot overwrite a newer provider-owned commit', async () => {
		const context = fixture({ works: [work({ posterPath: '/files/newer.webp', importData: { values: { posterUrl: '/files/newer.webp' } } })] });
		const result = await applyImportRecord(context.db, context.idService, record({ posterUrl: '/files/stale.webp' }), {}, { options: { fields: ['posterUrl'] }, artworkExpected: { posterUrl: '/files/old.webp' }, artworkLocalizedFields: ['posterUrl'] });
		expect(result.work.posterPath).toBe('/files/newer.webp');
		expect(result.protectedFields).toContain('posterUrl');
		expect(result.work.importData).not.toHaveProperty('localArtwork');
	});

	test('persistent and per-run locks always beat an explicit image choice', async () => {
		for (const persistent of [true, false]) {
			const context = fixture({ works: [work({ posterPath: '/files/editorial.webp', importData: { locks: persistent ? ['posterUrl'] : [] } })] });
			const result = await applyImportRecord(context.db, context.idService, record({ posterUrl: '/files/chosen.webp' }), {}, { lockedFields: persistent ? [] : ['posterUrl'], options: { fields: ['posterUrl'] }, artworkExpected: { posterUrl: '/files/editorial.webp' }, artworkSelectedFields: ['posterUrl'], artworkLocalizedFields: ['posterUrl'] });
			expect(result.work.posterPath).toBe('/files/editorial.webp');
			expect(result.protectedFields).toContain('posterUrl');
		}
	});

	test('an explicit unlocked editorial replacement is saved and then protected from automatic refresh', async () => {
		const context = fixture({ works: [work({ posterPath: '/files/editorial.webp' })] });
		const chosen = await applyImportRecord(context.db, context.idService, record({ posterUrl: '/files/chosen.webp' }), {}, { options: { fields: ['posterUrl'] }, artworkExpected: { posterUrl: '/files/editorial.webp' }, artworkSelectedFields: ['posterUrl'], artworkLocalizedFields: ['posterUrl'] });
		expect(chosen.work.posterPath).toBe('/files/chosen.webp');
		expect(chosen.work.importData.locks).toContain('posterUrl');
		const refreshed = await applyImportRecord(context.db, context.idService, record(), {}, { options: { fields: ['posterUrl'], artwork: 'remote' } });
		expect(refreshed.work.posterPath).toBe('/files/chosen.webp');
	});

	test('ordinary remote sync cannot turn a localized image back into a CDN link', async () => {
		const context = fixture();
		await applyImportRecord(context.db, context.idService, record({ posterUrl: '/files/local.webp' }), {}, { artworkLocalizedFields: ['posterUrl'] });
		const result = await applyImportRecord(context.db, context.idService, record({ description: 'Refreshed metadata' }), {}, { mode: 'sync' });
		expect(result.work.posterPath).toBe('/files/local.webp');
		expect(result.work.description).toBe('Refreshed metadata');
		expect(result.protectedFields).toContain('posterUrl');
	});

	test('explicit empty gallery clears only that unlocked image role', async () => {
		const context = fixture({ works: [work({ galleryPaths: ['/files/one.webp'], posterPath: '/files/poster.webp' })] });
		const result = await applyImportRecord(context.db, context.idService, record({ galleryUrls: [] }), {}, { options: { fields: ['galleryUrls'] }, artworkExpected: { galleryUrls: ['/files/one.webp'] }, artworkSelectedFields: ['galleryUrls'] });
		expect(result.work.galleryPaths).toEqual([]);
		expect(result.work.posterPath).toBe('/files/poster.webp');
		expect(result.work.importData.locks).toContain('galleryUrls');
	});

	test('an explicit empty gallery on a newly created draft is locked against later automatic filling', async () => {
		const context = fixture();
		const created = await applyImportRecord(context.db, context.idService, record({ galleryUrls: [] }), {}, { options: { fields: ['galleryUrls'], artwork: 'local' }, artworkSelectedFields: ['galleryUrls'] });
		expect(created.work.galleryPaths).toEqual([]);
		expect(created.work.importData.locks).toContain('galleryUrls');
		const refreshed = await applyImportRecord(context.db, context.idService, record({ galleryUrls: ['https://image.tmdb.org/t/p/original/frame.jpg'] }), {}, { options: { fields: ['galleryUrls'] }, mode: 'sync' });
		expect(refreshed.work.galleryPaths).toEqual([]);
		expect(refreshed.protectedFields).toContain('galleryUrls');
	});
});
