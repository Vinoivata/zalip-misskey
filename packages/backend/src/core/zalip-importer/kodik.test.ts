/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { configuredImportPlayerUrl, createImportProviders, importPlayerTranslationUrl, normalizeKodikRecord, type ImportTransport } from './providers.js';
import { validImportRef } from './types.js';

function edition(values: Record<string, unknown> = {}) {
	return {
		id: 'serial-49752', type: 'anime-serial', title: 'Сериал', title_orig: 'Series', year: 2021,
		kinopoisk_id: '4786341', imdb_id: 'tt13911284', shikimori_id: '46569', link: '//kodikplayer.com/serial/49752/fixture/720p', quality: 'WEB-DL 720p',
		translation: { id: 12, title: 'AnimeVost', type: 'voice' },
		seasons: { 1: { link: '//kodikplayer.com/season/1/fixture/720p', episodes: { 1: '//kodikplayer.com/seria/1/fixture/720p', 2: '//kodikplayer.com/seria/2/fixture/720p' } } },
		material_data: { title: 'Название', title_en: 'Original title', description: '<b>Описание</b>', duration: 24, countries: ['Япония'], all_genres: ['Аниме', 'Драма'], poster_url: 'https://st.kp.yandex.net/images/poster.jpg', anime_poster_url: 'https://shikimori.io/system/animes/original/46569.jpg', screenshots: ['https://st.kp.yandex.net/images/still.jpg'], minimal_age: 16, kinopoisk_rating: 8.2, kinopoisk_votes: 100, imdb_rating: 8.1, imdb_votes: 90, shikimori_rating: 8.3, shikimori_votes: 80 },
		...values,
	};
}

const rawRef = { source: 'kodik', externalId: 'serial-49752', mediaType: 'tv' } as const;
const ref = { source: 'kodik', externalId: 'shikimori-46569', mediaType: 'tv' } as const;

describe('Kodik importer boundaries', () => {
	test('normalizes metadata, exact identities and distinct per-resource voices without exposing raw facts', () => {
		const second = edition({ id: 'serial-49750', translation: { id: 4, title: 'Crunchyroll.Subtitles', type: 'subtitles' }, link: '//kodikplayer.com/serial/49750/other/720p', seasons: { 1: { episodes: { 1: '//kodikplayer.com/seria/1/subtitle/720p' } } }, secret: 'fixture-private' });
		const result = normalizeKodikRecord(edition({ screenshots: ['https://i.kodikres.com/screenshots/seria/123/hash/1.jpg'] }), [second]);
		expect(result).toMatchObject({ ref, title: 'Название', originalTitle: 'Original title', description: 'Описание', releaseYear: 2021, runtimeMinutes: 24, kind: 'anime', genres: ['Аниме', 'Драма'], countries: ['Япония'], ageRating: '16+', complete: true });
		expect(result.identities).toEqual([{ provider: 'kodik', externalId: 'shikimori-46569', entityType: 'tv' }, { provider: 'shikimori', externalId: '46569', entityType: 'tv' }]);
		expect(result.ratings).toEqual([{ source: 'kinopoisk', value: 8.2, votes: 100 }, { source: 'imdb', value: 8.1, votes: 90 }, { source: 'shikimori', value: 8.3, votes: 80 }]);
		expect(result.galleryUrls).toEqual(['https://st.kp.yandex.net/images/still.jpg', 'https://i.kodikres.com/screenshots/seria/123/hash/1.jpg']);
		expect(result.players).toHaveLength(1);
		expect(result.players[0].translations.map(value => ({ id: value.id, name: value.name, episodes: value.episodes }))).toEqual([{ id: 'serial-49752', name: 'AnimeVost', episodes: [{ seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 2 }] }, { id: 'serial-49750', name: 'Crunchyroll.Subtitles', episodes: [{ seasonNumber: 1, episodeNumber: 1 }] }]);
		expect(result.players[0].translations[1].iframe).toBe('https://kodikplayer.com/serial/49750/other/720p');
		expect(result.players[0].translations.map(value => value.type)).toEqual(['voice', 'subtitles']);
		expect(JSON.stringify(result)).not.toContain('fixture-private');
	});

	test('rejects grouping different anime cours sharing a KP identity or conflicting IMDb identities', () => {
		for (const values of [{ shikimori_id: '46570' }, { shikimori_id: undefined }, { imdb_id: 'tt1234567' }, { kinopoisk_id: '1' }, { id: 'movie-1' }]) expect(() => normalizeKodikRecord(edition(), [edition({ id: 'serial-2', ...values })])).toThrow('malformed-response');
		const untyped = edition({ shikimori_id: undefined });
		expect(() => normalizeKodikRecord(untyped, [edition({ id: 'serial-2', shikimori_id: '1' }), edition({ id: 'serial-3', shikimori_id: '2' })])).toThrow('malformed-response');
	});

	test('different voices normalize to one stable material reference while anime seasons never share KP/IMDb bindings', () => {
		const first = normalizeKodikRecord(edition());
		const alternate = normalizeKodikRecord(edition({ id: 'serial-49750', link: '//kodikplayer.com/serial/49750/hash/720p' }));
		const seasonTwo = normalizeKodikRecord(edition({ id: 'serial-90000', link: '//kodikplayer.com/serial/90000/hash/720p', shikimori_id: '55825' }));
		expect(alternate.ref).toEqual(first.ref);
		expect(alternate.players[0].externalId).toBe(first.players[0].externalId);
		expect(seasonTwo.ref.externalId).toBe('shikimori-55825');
		for (const result of [first, alternate, seasonTwo]) expect(result.identities.map(value => value.provider)).toEqual(['kodik', 'shikimori']);
	});

	test('an anime edition without Shikimori remains raw and cannot borrow a different edition identity', async () => {
		const anchor = edition({ shikimori_id: undefined });
		const result = normalizeKodikRecord(anchor);
		expect(result.ref).toEqual(rawRef);
		expect(result.identities).toEqual([{ provider: 'kodik', externalId: rawRef.externalId, entityType: 'tv' }]);
		expect(result.warnings).toContain('kodik-anime-identity-partial');
		expect(() => normalizeKodikRecord(anchor, [edition({ id: 'serial-2', link: '//kodikplayer.com/serial/2/hash/720p' })])).toThrow('malformed-response');
		const transport = vi.fn<ImportTransport>(async () => ({ results: [anchor] }));
		expect((await createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik.fetch(rawRef)).players[0].translations).toHaveLength(1);
		expect(transport).toHaveBeenCalledOnce();
		expect(new URL(transport.mock.calls[0][0]).searchParams.get('id')).toBe(rawRef.externalId);
	});

	test('non-anime editions use stable KP then IMDb identities, but unresolved anime never guesses them', () => {
		const ordinary = { type: 'foreign-serial', shikimori_id: undefined, material_data: { title: 'Drama', all_genres: ['Драма'] } };
		expect(normalizeKodikRecord(edition(ordinary)).ref.externalId).toBe('kinopoisk-4786341');
		expect(normalizeKodikRecord(edition({ ...ordinary, kinopoisk_id: undefined })).ref.externalId).toBe('imdb-tt13911284');
		expect(normalizeKodikRecord(edition({ ...ordinary, kinopoisk_id: undefined, imdb_id: undefined })).ref.externalId).toBe(rawRef.externalId);
	});

	test('preserves names without inventing stable person or studio IDs and reports skipped metadata', () => {
		const result = normalizeKodikRecord(edition({ material_data: { title: 'Title', actors: ['Two different people can share a name'], directors: ['Director'], anime_studios: ['Studio'] } }));
		expect(result.credits).toEqual([]);
		expect(result.companies).toEqual([]);
		expect(result.warnings).toEqual(expect.arrayContaining(['kodik-people-without-identities', 'kodik-studios-without-identities']));
		expect(result.complete).toBe(false);
	});

	test('rejects unapproved or credential-bearing iframes and never guesses a Kodik voice URL', () => {
		for (const link of ['http://kodikplayer.com/serial/1/hash', '//kodikplayer.com.evil.org/serial/1/hash', 'https://user:pass@kodikplayer.com/serial/1/hash', '//kodikplayer.com/serial/1/hash?token=private', '//127.0.0.1/serial/1/hash', '//kodikplayer.com:8443/serial/1/hash', '//kodikplayer.com/serial/1/hash#fragment', '//kodikplayer.com/serial/1/hash/720p', '//kodikplayer.com/video/49752/hash/720p', '//kodikplayer.com/serial/49752/hash', '//kodikplayer.com/serial/49752/hash/720p/extra']) expect(normalizeKodikRecord(edition({ link })).players).toEqual([]);
		expect(importPlayerTranslationUrl('https://kodikplayer.com/serial/1/hash/720p', 'kodik', { id: 'serial-2', name: 'Other' })).toBeNull();
		expect(configuredImportPlayerUrl('https://kodikplayer.com/serial/1/hash/720p?season=1', 'kodik', { kodikPlayerOrigin: 'https://mirror.example.org' })).toBe('https://mirror.example.org/serial/1/hash/720p?season=1');
		expect(configuredImportPlayerUrl('https://evil.example.org/serial/1/hash/720p', 'kodik', {})).toBeNull();
	});

	test('separates unknown voice episode availability from a known empty edition', () => {
		expect(normalizeKodikRecord(edition({ seasons: undefined })).players[0].translations[0]).not.toHaveProperty('episodes');
		expect(normalizeKodikRecord(edition({ seasons: {} })).players[0].translations[0].episodes).toEqual([]);
		expect(normalizeKodikRecord(edition({ seasons: { 1: { episodes: { 1: '//evil.example.org/seria/1', 2: '//kodikplayer.com/seria/2/hash/720p' } } } })).players[0].translations[0].episodes).toEqual([{ seasonNumber: 1, episodeNumber: 2 }]);
	});

	test('keeps season zero distinct and skips negative or malformed season/episode keys with a warning', () => {
		const result = normalizeKodikRecord(edition({ seasons: { '-1': { episodes: { 1: '//kodikplayer.com/seria/1/hash/720p' } }, 0: { episodes: { 1: '//kodikplayer.com/seria/1/hash/720p', '-1': '//kodikplayer.com/seria/1/hash/720p' } }, 1: { episodes: { 2: '//kodikplayer.com/seria/2/hash/720p' } } } }));
		expect(result.players[0].episodes).toEqual([{ seasonNumber: 0, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 2 }]);
		expect(result.warnings).toContain('kodik-episode-data-rejected');
		expect(result.complete).toBe(false);
	});

	test('uses the movie namespace and preserves a public /video/ edition URL', () => {
		const result = normalizeKodikRecord(edition({ id: 'movie-34204', type: 'anime', shikimori_id: '32281', link: '//kodikplayer.com/video/34204/hash/720p', seasons: undefined }));
		expect(result.ref).toEqual({ source: 'kodik', externalId: 'shikimori-32281', mediaType: 'movie' });
		expect(result.players[0].iframeUrl).toBe('https://kodikplayer.com/video/34204/hash/720p');
		expect(result.identities.every(value => value.entityType === 'movie')).toBe(true);
	});

	test('bounds editions and episodes, preserving visible truncation warnings', () => {
		const result = normalizeKodikRecord(edition({ seasons: { 1: { episodes: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [String(index + 1), '//kodikplayer.com/seria/1/hash/720p'])) } } }), Array.from({ length: 101 }, (_, index) => edition({ id: `serial-${index + 1}`, link: `//kodikplayer.com/serial/${index + 1}/hash/720p` })));
		expect(result.players[0].translations.length).toBeLessThanOrEqual(100);
		expect(result.players[0].episodes).toHaveLength(1000);
		expect(result.warnings).toEqual(expect.arrayContaining(['kodik-voice-limit', 'kodik-episode-limit']));
		expect(result.complete).toBe(false);
	});

	test('source-specific IDs never treat Kodik strings as TMDB or swap movie/TV namespaces', () => {
		expect(validImportRef(ref)).toBe(true);
		expect(validImportRef(rawRef)).toBe(true);
		expect(validImportRef({ source: 'kodik', externalId: 'movie-1', mediaType: 'movie' })).toBe(true);
		expect(validImportRef({ source: 'kodik', externalId: 'kinopoisk-123', mediaType: 'movie' })).toBe(true);
		expect(validImportRef({ source: 'kodik', externalId: 'imdb-tt1234567', mediaType: 'tv' })).toBe(true);
		for (const invalid of [null, undefined, [], 'serial-1', {}, { source: 'kodik', mediaType: 'tv' }]) expect(validImportRef(invalid)).toBe(false);
		for (const invalid of [{ ...ref, externalId: '49752' }, { ...ref, externalId: 'movie-49752' }, { ...ref, externalId: 'serial-0' }, { ...ref, externalId: 'serial-01' }, { ...ref, externalId: 'serial-1/path' }, { ...ref, source: 'tmdb' }]) expect(validImportRef(invalid as never)).toBe(false);
	});

	test('fetch binds one exact resource and groups voices by Shikimori without following next_page URLs', async () => {
		const transport = vi.fn<ImportTransport>(async value => {
			const url = new URL(value);
			expect(url.origin).toBe('https://kodik-api.com');
			expect(url.searchParams.get('token')).toBe('synthetic-private-fixture');
			return url.searchParams.has('id') ? { results: [edition()] } : { results: [edition(), edition({ id: 'serial-49750', link: '//kodikplayer.com/serial/49750/hash/720p' })], next_page: 'https://evil.example.org/path?token=private' };
		});
		const provider = createImportProviders({ kodikApiToken: 'synthetic-private-fixture' }, transport).kodik;
		expect(provider.status()).toMatchObject({ source: 'kodik', configured: true, capabilities: { search: true, collections: false, updates: false } });
		const result = await provider.fetch(rawRef, ['players']);
		expect(transport).toHaveBeenCalledTimes(2);
		expect(new URL(transport.mock.calls[1][0]).searchParams.get('shikimori_id')).toBe('46569');
		expect(result.ref).toEqual(ref);
		expect(result.players[0].translations).toHaveLength(2);
		expect(result.warnings).toContain('kodik-voice-limit');
		expect(JSON.stringify(result)).not.toContain('private');
	});

	test('canonical references fetch the exact authoritative ID and search collapses alternate voices, not separate seasons', async () => {
		const rows = [edition(), edition({ id: 'serial-49750', link: '//kodikplayer.com/serial/49750/hash/720p' }), edition({ id: 'serial-90000', link: '//kodikplayer.com/serial/90000/hash/720p', shikimori_id: '55825' })];
		const transport = vi.fn<ImportTransport>(async value => {
			const url = new URL(value);
			return { results: url.searchParams.has('shikimori_id') ? rows.filter(row => row.shikimori_id === url.searchParams.get('shikimori_id')) : rows };
		});
		const provider = createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik;
		const normalized = await provider.fetch(ref);
		expect(normalized.ref).toEqual(ref);
		expect(normalized.players[0].translations).toHaveLength(2);
		expect(transport).toHaveBeenCalledOnce();
		expect(new URL(transport.mock.calls[0][0]).searchParams.get('shikimori_id')).toBe('46569');
		expect(new URL(transport.mock.calls[0][0]).searchParams.has('id')).toBe(false);
		expect((await provider.search('Название')).items.map(value => value.ref.externalId)).toEqual(['shikimori-46569', 'shikimori-55825']);
		expect(new URL(transport.mock.calls[1][0]).searchParams.get('limit')).toBe('100');
	});

	test('raw alternate voice inputs and the queued canonical ref retain the same chosen screenshot candidates', async () => {
		const rows = [edition({ screenshots: ['https://i.kodikres.com/screenshots/seria/2/hash/1.jpg'] }), edition({ id: 'serial-49750', link: '//kodikplayer.com/serial/49750/hash/720p', screenshots: ['https://i.kodikres.com/screenshots/seria/1/hash/1.jpg'] })];
		const transport = vi.fn<ImportTransport>(async value => {
			const id = new URL(value).searchParams.get('id');
			return { results: id ? rows.filter(row => row.id === id) : rows };
		});
		const provider = createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik;
		const first = await provider.fetch(rawRef);
		const alternate = await provider.fetch({ ...rawRef, externalId: 'serial-49750' });
		const queued = await provider.fetch(ref);
		expect(first.ref).toEqual(ref);
		expect(first.galleryUrls).toEqual(alternate.galleryUrls);
		expect(first.galleryUrls).toEqual(queued.galleryUrls);
		expect(first.players).toEqual(queued.players);
	});

	test('metadata-only fetch does not spend extra voice or season requests', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ results: [edition()] }));
		await createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik.fetch(ref, ['title']);
		expect(transport).toHaveBeenCalledOnce();
		expect(new URL(transport.mock.calls[0][0]).searchParams.has('with_episodes')).toBe(false);
	});

	test('an exact known anchor wins over edition order; unknown and invalid anchors never become another title', async () => {
		const transport = vi.fn<ImportTransport>(async value => ({ results: new URL(value).searchParams.has('id') ? [edition()] : [edition({ id: 'serial-1' })] }));
		const provider = createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik;
		expect((await provider.lookup!([{ provider: 'kodik', externalId: 'serial-49752', entityType: 'tv' }], 'tv', ['title']))?.ref).toEqual(ref);
		await expect(provider.fetch({ ...rawRef, externalId: 'serial-999' })).rejects.toMatchObject({ code: 'not-found' });
		const before = transport.mock.calls.length;
		await expect(provider.fetch({ ...ref, externalId: 'movie-1' })).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(transport).toHaveBeenCalledTimes(before);
	});

	test('lookup rejects ambiguous Shikimori groups and mismatched secondary identities without title guessing', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ results: [edition(), edition({ id: 'serial-2', shikimori_id: '2' })] }));
		const provider = createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik;
		await expect(provider.lookup!([{ provider: 'kinopoisk', externalId: '4786341', entityType: 'tv' }], 'tv')).rejects.toMatchObject({ code: 'malformed-response' });
		transport.mockResolvedValue({ results: [edition({ imdb_id: 'tt1234567' })] });
		await expect(provider.lookup!([{ provider: 'kinopoisk', externalId: '4786341', entityType: 'tv' }, { provider: 'imdb', externalId: 'tt13911284', entityType: 'tv' }], 'tv')).rejects.toMatchObject({ code: 'malformed-response' });
		expect(await provider.lookup!([{ provider: 'tmdb', externalId: '1', entityType: 'tv' }], 'tv')).toBeNull();
	});

	test('search and health use bounded fixed API routes; numeric pagination and discovery are not invented', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ results: [edition()] }));
		const provider = createImportProviders({ kodikApiToken: 'fixture' }, transport).kodik;
		expect((await provider.search('Название', 1, 'tv')).items[0].ref).toEqual(ref);
		await expect(provider.search('Название', 2)).rejects.toMatchObject({ code: 'unsupported' });
		await provider.check!();
		expect(transport.mock.calls.map(call => new URL(call[0]).pathname)).toEqual(['/search', '/list']);
		expect(provider.updates).toBeUndefined();
		expect(provider.collection).toBeUndefined();
	});

	test('malformed responses and raw transport errors never expose a provider body or API credential', async () => {
		const transport = vi.fn<ImportTransport>(async () => { throw new Error('fixture-private-key'); });
		const provider = createImportProviders({ kodikApiToken: 'fixture-private-key' }, transport).kodik;
		await expect(provider.fetch(ref)).rejects.toThrow('upstream-failure');
		transport.mockResolvedValue({ secret: 'fixture-private-key' });
		await expect(provider.fetch(ref)).rejects.toThrow('malformed-response');
		await expect(createImportProviders({}, transport).kodik.fetch(ref)).rejects.toThrow('not-configured');
	});
});
