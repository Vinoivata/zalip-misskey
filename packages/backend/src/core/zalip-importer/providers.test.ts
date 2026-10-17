/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { configuredImportPlayerUrl, createImportProviders, createConfiguredImportTransport, defaultImportTransport, ImportProviderError, normalizeAllohaRecord, normalizeCollapsRecord, normalizeImportApiOrigin, normalizeKinopoiskRecord, normalizeTmdbRecord, pacedImportTransport, safeImportUrl, safeAllohaPlayerUrl } from './providers.js';
import type { ImportTransport } from './providers.js';

const mockedFetch = vi.hoisted(() => vi.fn());
const mockedLookup = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockedFetch }));
vi.mock('node:dns/promises', () => ({ lookup: mockedLookup }));

afterEach(() => {
	vi.useRealTimers();
	mockedFetch.mockReset();
	mockedLookup.mockReset();
});

describe('importer normalizers', () => {
	test('explicit public Alloha token rewrites API credential only on approved iframe hosts', () => {
		const raw = 'https://ascorbic-as.stravers.live/?token_movie=title-specific&token=private-api-fixture';
		const hosts = ['ascorbic-as.stravers.live'];
		expect(safeAllohaPlayerUrl(raw, hosts)).toBeNull();
		const result = safeAllohaPlayerUrl(raw, hosts, 'public-player-fixture');
		expect(new URL(result!).searchParams.get('token')).toBe('public-player-fixture');
		expect(new URL(result!).searchParams.get('token_movie')).toBe('title-specific');
		expect(result).not.toContain('private-api-fixture');
		expect(safeImportUrl(result, hosts)).toBeNull();
		for (const url of [raw.replace('ascorbic-as.stravers.live', 'untrusted.example.org'), `${raw}&api_key=private`, `${raw}&token=duplicate`, `${raw}&TOKEN=ambiguous`, raw.replace('https:', 'http:'), raw.replace('https://', 'https://user:pass@'), `${raw}#secret`]) expect(safeAllohaPlayerUrl(url, hosts, 'public-player-fixture')).toBeNull();
		expect(safeAllohaPlayerUrl(raw, hosts, 'bad token')).toBeNull();
		const record = normalizeAllohaRecord({ data: { iframe: raw, category: { slug: 'movie' }, translations: [{ id: 1, name: 'Studio', iframe: raw }] } }, { source: 'alloha', externalId: 'tmdb:movie:1', mediaType: 'movie' }, hosts, 'public-player-fixture');
		expect(record.players).toHaveLength(1);
		expect(record.players[0].translations).toHaveLength(1);
		expect(JSON.stringify(record)).not.toContain('private-api-fixture');
		expect(record.warnings).not.toContain('alloha-player-url-rejected');
	});
	test('TMDB identities keep movie and TV namespaces and omit arbitrary upstream properties', () => {
		const record = normalizeTmdbRecord({ id: 123, title: 'Тайтл', original_title: 'Title', release_date: '2026-07-17', runtime: 123, imdb_id: 'tt1234567', token: 'fixture-secret-never-persist', nested: { api_key: 'fixture-secret-never-persist' }, vote_average: 7.8, vote_count: 100, poster_path: '/poster.jpg' }, 'movie');
		expect(record.identities).toEqual([{ provider: 'tmdb', externalId: '123', entityType: 'movie' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'movie' }]);
		expect(record.releaseYear).toBe(2026);
		expect(record.ratings).toEqual([{ source: 'tmdb', value: 7.8, votes: 100 }]);
		expect(record.posterUrl).toBe('https://image.tmdb.org/t/p/original/poster.jpg');
		expect(JSON.stringify(record)).not.toContain('fixture-secret-never-persist');
		expect(normalizeTmdbRecord({ id: 123, name: 'Сериал' }, 'tv').ref.mediaType).toBe('tv');
	});

	test('TMDB prefers Russian logos, deduplicates gallery and selects a trailer', () => {
		const record = normalizeTmdbRecord({ id: 1, title: 'Title', images: { logos: [{ file_path: '/en.png', iso_639_1: 'en' }, { file_path: '/ru.png', iso_639_1: 'ru' }], backdrops: [{ file_path: '/one.jpg' }, { file_path: '/one.jpg' }, { file_path: '/../../unsafe' }] }, videos: { results: [{ site: 'YouTube', key: 'teaser001', type: 'Teaser' }, { site: 'YouTube', key: 'trailer01', type: 'Trailer', iso_639_1: 'ru' }] } }, 'movie');
		expect(record.logoUrl).toContain('/ru.png');
		expect(record.galleryUrls).toEqual(['https://image.tmdb.org/t/p/original/one.jpg']);
		expect(record.trailerYoutubeKey).toBe('trailer01');
	});

	test('TMDB imports cast, crew, companies, collection and ordered episodes', () => {
		const record = normalizeTmdbRecord({ id: 1, name: 'Show', genres: [{ name: 'Animation' }], production_countries: [{ name: 'Japan' }], credits: { cast: [{ id: 2, name: 'Actor', character: 'Hero' }, { id: 2, name: 'Actor', character: 'Hero' }], crew: [{ id: 3, name: 'Creator', job: 'Director' }] }, production_companies: [{ id: 4, name: 'Studio', logo_path: '/studio.png' }], belongs_to_collection: { id: 7, name: 'Cycle' }, seasons: [{ season_number: 1, name: 'Season 1', episode_count: 2 }] }, 'tv', [{ season_number: 1, episodes: [{ id: 9, episode_number: 2, name: 'Second', still_path: '/still.jpg', air_date: '2026-01-02' }, { id: 8, episode_number: 1, name: 'First', air_date: '2026-02-30' }, { id: 8, episode_number: 1, name: 'Duplicate' }] }]);
		expect(record.kind).toBe('anime');
		expect(record.credits.map(value => value.role)).toEqual(['actor', 'director']);
		expect(record.companies[0].name).toBe('Studio');
		expect(record.collections[0].externalId).toBe('7');
		expect(record.seasons[0].episodes.map(value => value.episodeNumber)).toEqual([1, 2]);
		expect(record.seasons[0].episodes[0].airDate).toBeNull();
	});

	test('missing ID/title and non-HTTPS credentials in image URLs are rejected', () => {
		expect(() => normalizeTmdbRecord({ title: 'No id' }, 'movie')).toThrow('malformed-response');
		expect(() => normalizeKinopoiskRecord({ kinopoiskId: 1 })).toThrow('malformed-response');
		expect(safeImportUrl('http://example.com/image.jpg')).toBeNull();
		expect(safeImportUrl('https://user:password@example.com/image.jpg')).toBeNull();
		expect(safeImportUrl('https://example.com/image.jpg?token=fixture')).toBeNull();
		expect(safeImportUrl('https://127.0.0.1/image.jpg')).toBeNull();
		expect(safeImportUrl('https://[::1]/image.jpg')).toBeNull();
		expect(safeImportUrl('https://api.local/image.jpg')).toBeNull();
		expect(safeImportUrl('https://example.com:444/image.jpg')).toBeNull();
	});

	test('Kinopoisk parses people, ratings and seasons independently of local user ratings', () => {
		const record = normalizeKinopoiskRecord({ kinopoiskId: 10, nameRu: 'Сериал', nameOriginal: 'Series', type: 'TV_SERIES', year: 2024, ratingKinopoisk: 8.1, ratingImdb: 7.8, genres: [{ genre: 'драма' }], countries: [{ country: 'Россия' }], coverUrl: 'https://images.example.org/cover.jpg', ratingAgeLimits: 'age16' }, [{ staffId: 2, nameRu: 'Автор', professionKey: 'WRITER' }, { staffId: 3, nameRu: 'Актёр', professionKey: 'ACTOR', description: 'Герой' }], { items: [{ number: 1, episodes: [{ episodeNumber: 1, nameRu: 'Начало', nameEn: 'Beginning', synopsis: 'Description', releaseDate: '2024-05-01' }] }] });
		expect(record.ref).toEqual({ source: 'kinopoisk', externalId: '10', mediaType: 'tv' });
		expect(record.genres).toEqual(['драма']);
		expect(record.credits.map(value => value.role)).toEqual(['writer', 'actor']);
		expect(record.seasons[0].episodes[0].originalTitle).toBe('Beginning');
		expect(record.ratings.map(value => value.source)).toEqual(['kinopoisk', 'imdb']);
	});

	test('Collaps keeps only configured players, roles, translations and external IDs', () => {
		const record = normalizeCollapsRecord({ id: 50, name: 'Сериал', type: 'serials', kinopoisk_id: '10', imdb_id: 'tt1234567', poster: 'https://images.example.org/poster.jpg', iframe_url: 'https://api.nextembed.ws/embed/movie/50', actors: [{ id: 6, name: 'Actor' }], director: ['Director'], voiceActing: [{ id: 5, name: 'Studio' }], seasons: [{ season: 1, episodes: [{ episode: 1, name: 'First' }] }] });
		expect(record.identities).toContainEqual({ provider: 'kinopoisk', externalId: '10', entityType: 'tv' });
		expect(record.credits.map(value => value.role)).toEqual(['actor', 'director']);
		expect(record.players[0].translations).toEqual([{ id: '5', name: 'Studio', iframe: 'https://api.nextembed.ws/embed/movie/50?oneSound=Studio', episodes: [] }]);
		expect(record.players[0].episodes).toEqual([{ seasonNumber: 1, episodeNumber: 1 }]);
		const rejected = normalizeCollapsRecord({ id: 50, name: 'Film', iframe_url: 'https://untrusted.example.org/embed/50' });
		expect(rejected.players).toEqual([]);
		expect(rejected.warnings).toContain('collaps-player-url-rejected');
		expect(rejected.complete).toBe(false);
	});

	test('Alloha uses a typed TMDB key and validates the provider category', () => {
		const ref = { source: 'alloha', externalId: 'tmdb:tv:123', mediaType: 'tv' } as const;
		const record = normalizeAllohaRecord({ data: { category: { slug: 'serial' }, iframe: 'https://ascorbic-as.stravers.live/?tmdb=123', translations: [{ id: 3, name: 'Studio', iframe: 'https://ascorbic-as.stravers.live/?translation=3' }] } }, ref);
		expect(record.identities).toContainEqual({ provider: 'tmdb', externalId: '123', entityType: 'tv' });
		expect(record.players[0].translations).toEqual([{ id: '3', name: 'Studio', iframe: 'https://ascorbic-as.stravers.live/?translation=3', quality: null, resolutions: [] }]);
		expect(record.complete).toBe(false);
		expect(() => normalizeAllohaRecord({ data: { category: { slug: 'movie' } } }, ref)).toThrow('not-found');
	});

	test('Alloha retains distinct validated voice iframes and bounded quality metadata for later selection', () => {
		const ref = { source: 'alloha', externalId: 'tmdb:tv:123', mediaType: 'tv' } as const;
		const record = normalizeAllohaRecord({ data: {
			category: { slug: 'serial' }, iframe: 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&token=api-fixture',
			translations: [
				{ id: 3, name: 'Первый голос', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-one&translation=3&token=api-fixture', quality: 'HD', resolutions: ['1080p', '720p', '1080p', null] },
				{ id: 4, name: 'Второй голос', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-two&translation=4&token=api-fixture', quality: '4K', resolutions: ['2160p'] },
				{ id: 5, name: 'Unsafe', iframe: 'https://untrusted.example.org/embed/5?token=api-fixture' },
			],
		} }, ref, ['ascorbic-as.stravers.live'], 'public-player-fixture');
		expect(record.players[0].translations).toEqual([
			{ id: '3', name: 'Первый голос', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-one&translation=3&token=public-player-fixture', quality: 'HD', resolutions: ['1080p', '720p'] },
			{ id: '4', name: 'Второй голос', iframe: 'https://ascorbic-as.stravers.live/?token_movie=voice-two&translation=4&token=public-player-fixture', quality: '4K', resolutions: ['2160p'] },
		]);
		expect(JSON.stringify(record)).not.toContain('api-fixture');
	});

	test('Collaps selects a full Cyrillic voice name using documented oneSound without Alloha selectors', () => {
		const record = normalizeCollapsRecord({ id: 50, name: 'Сериал', type: 'serials', iframe_url: 'https://api.nextembed.ws/embed/movie/50?season=1&episode=2', voiceActing: [{ id: 5, name: 'Творческая студия МИР' }] });
		const iframe = new URL(record.players[0].translations[0].iframe!);
		expect(iframe.searchParams.get('oneSound')).toBe('Творческая студия МИР');
		expect(iframe.searchParams.get('translation')).toBeNull();
		expect(iframe.searchParams.get('season')).toBe('1');
		expect(iframe.searchParams.get('episode')).toBe('2');
		expect(iframe.href).not.toContain(' ');
	});

	test('Collaps accepts real string voices with stable IDs and full encoded oneSound names', () => {
		const voiceActing = ['Творческая студия МИР', 'Дубляж & оригинал'];
		const input = { id: 50, name: 'Сериал', type: 'serials', iframe_url: 'https://api.nextembed.ws/embed/movie/50?season=2&episode=3', voiceActing };
		const voices = normalizeCollapsRecord(input).players[0].translations;
		expect(voices.map(voice => voice.name)).toEqual(voiceActing);
		for (const voice of voices) {
			expect(voice.id).toMatch(/^name:[a-f0-9]{64}$/u);
			const url = new URL(voice.iframe!);
			expect(url.searchParams.get('oneSound')).toBe(voice.name);
			expect(url.searchParams.get('season')).toBe('2');
			expect(url.searchParams.get('episode')).toBe('3');
			expect(url.searchParams.has('translation')).toBe(false);
		}
		const reversed = normalizeCollapsRecord({ ...input, voiceActing: [...voiceActing].reverse() }).players[0].translations;
		expect(reversed.map(voice => voice.id)).toEqual(voices.map(voice => voice.id).reverse());
		expect(input.voiceActing).toEqual(voiceActing);
	});

	test('Collaps trims mixed objects without duplicate voice names or IDs and preserves exact inner spacing', () => {
		const input = { id: 50, name: 'Сериал', iframe_url: 'https://api.nextembed.ws/embed/movie/50', voice_acting: [
			'  Studio One  ', { id: 5, name: 'Studio One' },
			{ id: 6, name: ' Второй голос ' }, 'Второй голос',
			{ id: 6, name: 'Conflicting provider ID' }, { id: '7', name: 'Original' },
			{ name: 'Without ID' }, { name: 'Without ID' }, ' Студия\t \nМИР ', '<Studio>',
		] };
		const voices = normalizeCollapsRecord(input).players[0].translations;
		expect(voices.map(voice => voice.name)).toEqual(['Studio One', 'Второй голос', 'Original', 'Without ID', 'Студия\t \nМИР', '<Studio>']);
		expect(voices.map(voice => voice.id)).toEqual([expect.stringMatching(/^name:[a-f0-9]{64}$/u), '6', '7', expect.stringMatching(/^name:[a-f0-9]{64}$/u), expect.stringMatching(/^name:[a-f0-9]{64}$/u), expect.stringMatching(/^name:[a-f0-9]{64}$/u)]);
		for (const voice of voices) expect(new URL(voice.iframe!).searchParams.get('oneSound')).toBe(voice.name);
		const equivalent = normalizeCollapsRecord({ ...input, voice_acting: ['Studio One'] }).players[0].translations[0];
		expect(voices[0].id).toBe(equivalent.id);
	});

	test('Collaps bounds voice lists and names, rejects malformed labels and avoids prefix-ID collisions', () => {
		const prefix = 'А'.repeat(255);
		const input = { id: 50, name: 'Film', iframe_url: 'https://api.nextembed.ws/embed/movie/50', voiceActing: [
			null, 5, true, ['not a voice'], {}, { id: 10 }, '', '   ', 'Bad\u0000name',
			'A'.repeat(257), `${prefix}1`, `${prefix}2`,
		] };
		const voices = normalizeCollapsRecord(input).players[0].translations;
		expect(voices.map(voice => voice.name)).toEqual([`${prefix}1`, `${prefix}2`]);
		expect(voices[0].id).not.toBe(voices[1].id);
		expect(voices.every(voice => voice.id.length <= 100)).toBe(true);
		const bounded = normalizeCollapsRecord({ ...input, voiceActing: Array.from({ length: 101 }, (_, index) => `Voice ${index}`) }).players[0].translations;
		expect(bounded).toHaveLength(100);
		expect(bounded.at(-1)?.name).toBe('Voice 99');
		const rejected = normalizeCollapsRecord({ ...input, iframe_url: 'https://untrusted.example.org/embed/50', voiceActing: ['Studio'] });
		expect(rejected.players).toEqual([]);
		expect(rejected.warnings).toContain('collaps-player-url-rejected');
	});

	test('Collaps binds each full voice to only its confirmed canonical episode links, including specials', () => {
		const iframe = 'https://api.nextembed.ws/embed/movie/50';
		const episode = (season: number, number: number, voices: unknown[], extra = {}) => ({ episode: number, iframe_url: `${iframe}?season=${season}&episode=${number}`, voiceActing: voices, ...extra });
		const input = { id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voiceActing: [{ id: 5, name: 'First Studio' }, { id: 6, name: 'Second Studio' }], seasons: [
			{ season: 1, episodes: [episode(1, 3, ['FIRST STUDIO', 'Second Studio']), episode(1, 2, [{ name: 'Second Studio' }]), episode(1, 1, ['First Studio']), episode(1, 4, ['First Studio'], { availability: false })] },
			{ season: 0, episodes: [episode(0, 0, ['First Studio'])] },
		] };
		const result = normalizeCollapsRecord(input);
		expect(result.players[0].translations).toEqual([
			{ id: '5', name: 'First Studio', iframe: `${iframe}?oneSound=First+Studio`, episodes: [{ seasonNumber: 0, episodeNumber: 0 }, { seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 3 }] },
			{ id: '6', name: 'Second Studio', iframe: `${iframe}?oneSound=Second+Studio`, episodes: [{ seasonNumber: 1, episodeNumber: 2 }, { seasonNumber: 1, episodeNumber: 3 }] },
		]);
		expect(result.players[0].episodes).toHaveLength(5);
		expect(input.seasons[0].episodes[0].voiceActing).toEqual(['FIRST STUDIO', 'Second Studio']);
	});

	test('Collaps never infers coverage from global voices or unknown per-episode voice metadata', () => {
		const iframe = 'https://api.nextembed.ws/embed/movie/50';
		const episode = (number: number, extra = {}) => ({ episode: number, iframe_url: `${iframe}?season=1&episode=${number}`, ...extra });
		const record = normalizeCollapsRecord({ id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voiceActing: ['Studio'], seasons: [{ season: 1, episodes: [
			episode(1), episode(2, { voiceActing: null }), episode(3, { voiceActing: [] }), episode(4, { voiceActing: 'Studio' }),
			episode(5, { voiceActing: [{ id: 5 }] }), episode(6, { voiceActing: ['Studio', null] }), { episode: 7, voiceActing: ['Studio'] },
		] }] });
		expect(record.players[0].translations[0].episodes).toEqual([]);
		expect(record.players[0].episodes).toHaveLength(7);
	});

	test('Collaps requires a unique case-insensitive full-name substring match in both global and episode lists', () => {
		const iframe = 'https://api.nextembed.ws/embed/movie/50';
		const make = (global: string[], voices: string[]) => normalizeCollapsRecord({ id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voiceActing: global, seasons: [{ season: 1, episodes: [{ episode: 1, iframe_url: `${iframe}?season=1&episode=1`, voiceActing: voices }] }] }).players[0].translations;
		expect(make(['Studio'], ['Studio', 'Studio Extra'])[0].episodes).toEqual([]);
		expect(make(['Studio'], ['Studio Extra'])[0].episodes).toEqual([]);
		expect(make(['Studio'], ['Studio', 'studio'])[0].episodes).toEqual([]);
		expect(make(['Studio', 'Studio Extra'], ['Studio'])[0].episodes).toEqual([]);
		expect(make(['Studio', 'STUDIO'], ['Studio']).every(voice => voice.episodes?.length === 0)).toBe(true);
		expect(make(['Studio Extra'], ['studio extra'])[0].episodes).toEqual([{ seasonNumber: 1, episodeNumber: 1 }]);
	});

	test('Collaps accepts existing voice aliases but not unchecked episode URLs or coordinates derived from query fields', () => {
		const iframe = 'https://api.nextembed.ws/embed/movie/50';
		const urls = [
			undefined, 'http://api.nextembed.ws/embed/movie/50?season=1&episode=1',
			'https://untrusted.example.org/embed/movie/50?season=1&episode=1',
			'https://api.nextembed.ws/embed/movie/51?season=1&episode=1',
			`${iframe}?season=2&episode=1`, `${iframe}?season=1&episode=2`, `${iframe}?season=1&season=1&episode=1`,
			`${iframe}?season=1&episode=1&episode=1`, `${iframe}?season=1`, `${iframe}?season=1&episode=1&token=private-fixture`,
		];
		for (const url of urls) {
			const record = normalizeCollapsRecord({ id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voice_acting: ['Studio'], seasons: [{ number: 1, episodes: [{ number: 1, iframe_url: url, voice_acting: ['Studio'] }] }] });
			expect(record.players[0].translations[0].episodes).toEqual([]);
		}
		const record = normalizeCollapsRecord({ id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voice_acting: ['Studio'], seasons: [{ number: 1, episodes: [{ number: 1, iframe_url: `${iframe}?season=1&episode=1`, voice_acting: ['Studio'], availability: 1 }] }] });
		expect(record.players[0].translations[0].episodes).toEqual([{ seasonNumber: 1, episodeNumber: 1 }]);
		expect(JSON.stringify(record)).not.toContain('private-fixture');
	});

	test('Collaps does not claim unique coverage from duplicate canonical rows or truncated voice metadata', () => {
		const iframe = 'https://api.nextembed.ws/embed/movie/50';
		const episode = { episode: 1, iframe_url: `${iframe}?season=1&episode=1`, voiceActing: ['Studio'] };
		const make = (seasons: unknown[], global: unknown[] = ['Studio']) => normalizeCollapsRecord({ id: 50, name: 'Series', type: 'serials', iframe_url: iframe, voiceActing: global, seasons }).players[0].translations[0].episodes;
		expect(make([{ season: 1, episodes: [episode, { ...episode, voiceActing: ['Other'] }] }])).toEqual([]);
		expect(make([{ season: 1, episodes: [episode] }, { season: 1, episodes: [] }])).toEqual([]);
		expect(make([{ season: 1, episodes: [{ ...episode, voiceActing: ['Studio', ...Array.from({ length: 99 }, (_, i) => `Other ${i}`), 'Studio Extra'] }] }])).toEqual([]);
		expect(make([{ season: 1, episodes: [episode] }], ['Studio', ...Array.from({ length: 99 }, (_, i) => `Other ${i}`), 'Studio Extra'])).toEqual([]);
	});

	test('Collaps movie voices retain their original identity and iframe without invented episode coverage', () => {
		const record = normalizeCollapsRecord({ id: 50, name: 'Film', type: 'films', iframe_url: 'https://api.nextembed.ws/embed/movie/50', voiceActing: [{ id: 5, name: 'Studio' }] });
		expect(record.players[0].translations).toEqual([{ id: '5', name: 'Studio', iframe: 'https://api.nextembed.ws/embed/movie/50?oneSound=Studio' }]);
	});

	test('episode limits are explicit rather than silently claiming complete coverage', () => {
		const episodes = Array.from({ length: 1001 }, (_, index) => ({ episode: index + 1, name: `Episode ${index + 1}` }));
		const result = normalizeCollapsRecord({ id: 1, name: 'Long show', type: 'serials', seasons: [{ season: 1, episodes }] });
		expect(result.seasons[0].episodes).toHaveLength(1000);
		expect(result.warnings).toContain('collaps-episode-limit');
		expect(result.complete).toBe(false);
	});

	test('Kinopoisk handles an absent localized title and explicit anime genre', () => {
		const record = normalizeKinopoiskRecord({ kinopoiskId: 1, nameRu: '', nameOriginal: 'Original', type: 'FILM', genres: [{ genre: 'аниме' }] });
		expect(record.title).toBe('Original');
		expect(record.kind).toBe('anime');
	});
});

describe('importer adapter contracts', () => {
	test('Collaps string voices use the existing detail request without an additional dictionary lookup', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ id: 50, name: 'Film', type: 'films', genre: [], iframe_url: 'https://api.nextembed.ws/embed/movie/50', voiceActing: ['Первый голос', 'Original'] });
		const record = await createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps.fetch({ source: 'collaps', externalId: '50', mediaType: 'movie' }, ['players']);
		expect(record.players[0].translations.map(voice => voice.name)).toEqual(['Первый голос', 'Original']);
		expect(record.players[0].translations.every(voice => new URL(voice.iframe!).searchParams.get('oneSound') === voice.name)).toBe(true);
		expect(transport).toHaveBeenCalledOnce();
		expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/franchise/details');
	});

	test('Collaps dictionary is a typed paginated resource and discards token-bearing next URLs', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ results: [{ id: 12, name: 'Подборка', token: 'fixture-never-store' }], next_page: 'https://evil.example/?token=fixture-never-store' });
		const provider = createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps;
		const page = await provider.collectionDictionary!(1, 20);
		expect(page).toEqual({ items: [{ externalId: '12', name: 'Подборка' }], page: 1, hasMore: true, warnings: [] });
		expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/collection');
		await provider.collectionDictionary!(2, 20);
		expect(new URL(transport.mock.calls[1][0]).origin).toBe('https://api.bhcesh.me');
		expect(JSON.stringify(page)).not.toContain('fixture-never-store');
	});

	test('Collaps membership uses exact identities, real series type and no fake movie refs', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ results: [{ id: 5, type: 'series', kinopoisk_id: '123', imdb_id: 'tt1234567' }], next_page: null });
		const page = await createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps.collectionMembers!('12', 1, 20);
		expect(page.items).toEqual([{ externalId: '5', mediaType: 'tv', identities: [{ provider: 'collaps', externalId: '5', entityType: 'tv' }, { provider: 'kinopoisk', externalId: '123', entityType: 'tv' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'tv' }] }]);
		expect(new URL(transport.mock.calls[0][0]).searchParams.get('join_seasons')).toBe('false');
	});

	test('maintenance contracts reject bad IDs, unbounded rows and unknown work types', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ results: Array.from({ length: 21 }, (_, index) => ({ id: index + 1, name: 'Collection' })) });
		const provider = createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps;
		await expect(provider.collectionDictionary!(1, 20)).rejects.toMatchObject({ code: 'malformed-response' });
		await expect(provider.collectionMembers!('../bad', 1, 20)).rejects.toMatchObject({ code: 'invalid-ref' });
		await expect(provider.collectionDictionary!(1, 500)).rejects.toMatchObject({ code: 'invalid-ref' });
		transport.mockResolvedValue({ results: [{ id: 1, type: 'unknown' }] });
		await expect(provider.collectionMembers!('1', 1, 20)).rejects.toMatchObject({ code: 'malformed-response' });
	});
	test('queued IMDb references resolve by exact ID inside the provider worker', async () => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).pathname.startsWith('/3/find/')
			? { movie_results: [{ id: 278 }], tv_results: [] }
			: { id: 278, title: 'Film', imdb_id: 'tt0111161', genres: [], production_companies: [] });
		const result = await createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.fetch({ source: 'tmdb', externalId: 'imdb:tt0111161', mediaType: 'movie' }, ['title']);
		expect(result.ref).toEqual({ source: 'tmdb', externalId: '278', mediaType: 'movie' });
		expect(transport.mock.calls).toHaveLength(2);
		await expect(createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.fetch({ source: 'tmdb', externalId: 'imdb:tt0111161', mediaType: 'tv' }, ['title'])).rejects.toMatchObject({ code: 'not-found' });
	});

	test('field selection avoids season, cast and extra artwork requests', async () => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).origin === 'https://api.themoviedb.org'
			? { id: 1, name: 'Show', genres: [], production_companies: [], seasons: [{ season_number: 1 }] }
			: { kinopoiskId: 1, nameRu: 'Show', type: 'TV_SERIES', genres: [] });
		const providers = createImportProviders({ tmdbApiKey: 'fixture', kinopoiskApiKey: 'fixture' }, transport);
		await providers.tmdb.fetch({ source: 'tmdb', externalId: '1', mediaType: 'tv' }, ['title', 'description']);
		await providers.kinopoisk.fetch({ source: 'kinopoisk', externalId: '1', mediaType: 'tv' }, ['title', 'description']);
		expect(transport.mock.calls).toHaveLength(2);
		expect(new URL(transport.mock.calls[0][0]).searchParams.get('append_to_response')).toBe('external_ids');
	});

	test('Kinopoisk fills a missing backdrop from safe stills without overwriting the poster', async () => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).pathname.endsWith('/images')
			? { items: [{ imageUrl: 'https://images.example.org/frame.jpg' }, { imageUrl: 'https://images.example.org/frame.jpg' }, { imageUrl: 'https://images.example.org/frame.jpg?api_key=fixture' }] }
			: { kinopoiskId: 1, nameRu: 'Film', type: 'FILM', genres: [], posterUrl: 'https://images.example.org/poster.jpg' });
		const result = await createImportProviders({ kinopoiskApiKey: 'fixture' }, transport).kinopoisk.fetch({ source: 'kinopoisk', externalId: '1', mediaType: 'movie' }, ['backdropUrl', 'galleryUrls']);
		expect(result.posterUrl).toBe('https://images.example.org/poster.jpg');
		expect(result.backdropUrl).toBe('https://images.example.org/frame.jpg');
		expect(result.galleryUrls).toEqual(['https://images.example.org/frame.jpg']);
		expect(transport.mock.calls).toHaveLength(2);
	});

	test('TMDB picture choices share the one detail request and preserve dimensions and language', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ id: 1, title: 'Film', genres: [], production_companies: [], images: { posters: [{ file_path: '/poster.jpg', width: 600, height: 900, iso_639_1: 'ru', id: 'untrusted' }], backdrops: [{ file_path: '/frame.jpg', width: 1920, height: 1080 }], logos: [{ file_path: '/logo.png', iso_639_1: 'en' }] } }));
		const result = await createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.fetch({ source: 'tmdb', externalId: '1', mediaType: 'movie' }, ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls']);
		expect(transport).toHaveBeenCalledTimes(1);
		expect(new URL(transport.mock.calls[0][0]).searchParams.get('append_to_response')).toBe('external_ids,images');
		expect(result.artworkCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ source: 'tmdb', field: 'posterUrl', width: 600, height: 900, language: 'ru', url: 'https://image.tmdb.org/t/p/original/poster.jpg' })]));
		expect(result.artworkCandidates?.every(value => /^[a-f0-9]{64}$/u.test(value.id))).toBe(true);
	});

	test('Kinopoisk picture choices request only selected roles and still expose alternate frames when a cover exists', async () => {
		const transport = vi.fn<ImportTransport>(async raw => {
			const url = new URL(raw);
			if (!url.pathname.endsWith('/images')) return { kinopoiskId: 1, nameRu: 'Film', type: 'FILM', genres: [], posterUrl: 'https://st.kp.yandex.net/main.jpg', coverUrl: 'https://st.kp.yandex.net/cover.jpg' };
			return { items: [{ imageUrl: `https://st.kp.yandex.net/${url.searchParams.get('type')}.jpg`, previewUrl: 'https://st.kp.yandex.net/small.jpg' }] };
		});
		const provider = createImportProviders({ kinopoiskApiKey: 'fixture' }, transport).kinopoisk;
		const result = await provider.fetch({ source: 'kinopoisk', externalId: '1', mediaType: 'movie' }, ['posterUrl', 'backdropUrl']);
		expect(transport.mock.calls).toHaveLength(3);
		expect(transport.mock.calls.slice(1).map(([raw]) => new URL(raw).searchParams.get('type'))).toEqual(['POSTER', 'STILL']);
		expect(result.backdropUrl).toBe('https://st.kp.yandex.net/cover.jpg');
		expect(result.artworkCandidates).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'backdropUrl', url: 'https://st.kp.yandex.net/STILL.jpg' }), expect.objectContaining({ field: 'posterUrl', url: 'https://st.kp.yandex.net/POSTER.jpg' })]));
		expect(result.artworkCandidates?.some(value => value.field === 'galleryUrls')).toBe(false);
	});

	test('an artwork failure cannot hide a quota pause or leak upstream errors', async () => {
		const transport = vi.fn<ImportTransport>(async url => {
			if (new URL(url).pathname.endsWith('/images')) throw new ImportProviderError('quota-exceeded');
			return { kinopoiskId: 1, nameRu: 'Film', type: 'FILM', genres: [] };
		});
		await expect(createImportProviders({ kinopoiskApiKey: 'fixture' }, transport).kinopoisk.fetch({ source: 'kinopoisk', externalId: '1', mediaType: 'movie' }, ['backdropUrl'])).rejects.toMatchObject({ code: 'quota-exceeded' });
	});

	test('health checks use fixed endpoints and discard returned metadata', async () => {
		const transport = vi.fn<ImportTransport>(async url => {
			switch (new URL(url).origin) {
				case 'https://api.themoviedb.org': return { images: { secure_base_url: 'https://image.tmdb.org/' } };
				case 'https://kinopoiskapiunofficial.tech': return { kinopoiskId: 301 };
				case 'https://apbugall.org': return { data: { category: { slug: 'movie' } } };
				default: return { results: [] };
			}
		});
		const providers = createImportProviders({ tmdbApiKey: 'fixture', kinopoiskApiKey: 'fixture', allohaApiToken: 'fixture', collapsApiToken: 'fixture', kodikApiToken: 'fixture' }, transport);
		for (const provider of Object.values(providers)) await expect(provider.check?.()).resolves.toBeUndefined();
		expect(transport.mock.calls).toHaveLength(5);
	});

	test.each([
		{ name: 'absent', hosts: undefined },
		{ name: 'empty array', hosts: [] },
		{ name: 'empty environment value', hosts: [''] },
		{ name: 'whitespace environment values', hosts: [' ', '\t'] },
	])('uses safe iframe defaults for $name configuration', async ({ hosts }) => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).origin === 'https://apbugall.org'
			? { data: { category: { slug: 'movie' }, iframe: 'https://ascorbic-as.stravers.live/embed/1' } }
			: { id: 1, name: 'Film', type: 'films', genres: [], iframe_url: 'https://api.nextembed.ws/embed/movie/1' });
		const providers = createImportProviders({ allohaApiToken: 'fixture', collapsApiToken: 'fixture', allohaIframeHosts: hosts, collapsIframeHosts: hosts }, transport);
		const alloha = await providers.alloha.fetch({ source: 'alloha', externalId: 'tmdb:movie:1', mediaType: 'movie' });
		const collaps = await providers.collaps.fetch({ source: 'collaps', externalId: '1', mediaType: 'movie' });
		expect(alloha.players[0]?.iframeUrl).toBe('https://ascorbic-as.stravers.live/embed/1');
		expect(collaps.players[0]?.iframeUrl).toBe('https://api.nextembed.ws/embed/movie/1');
		expect(alloha.warnings).not.toContain('alloha-player-url-rejected');
		expect(collaps.warnings).not.toContain('collaps-player-url-rejected');
	});

	test('normalizes configured iframe hosts without adding defaults or accepting other hosts', async () => {
		let iframe = 'https://player.example.org/embed/1';
		const transport = vi.fn<ImportTransport>(async url => new URL(url).origin === 'https://apbugall.org'
			? { data: { category: { slug: 'movie' }, iframe } }
			: { id: 1, name: 'Film', type: 'films', genres: [], iframe_url: iframe });
		const providers = createImportProviders({ allohaApiToken: 'fixture', collapsApiToken: 'fixture', allohaIframeHosts: [' PLAYER.EXAMPLE.ORG '], collapsIframeHosts: [' PLAYER.EXAMPLE.ORG '] }, transport);
		expect((await providers.alloha.fetch({ source: 'alloha', externalId: 'tmdb:movie:1', mediaType: 'movie' })).players).toHaveLength(1);
		expect((await providers.collaps.fetch({ source: 'collaps', externalId: '1', mediaType: 'movie' })).players).toHaveLength(1);
		iframe = 'https://ascorbic-as.stravers.live/embed/1';
		expect((await providers.alloha.fetch({ source: 'alloha', externalId: 'tmdb:movie:1', mediaType: 'movie' })).players).toEqual([]);
		iframe = 'https://api.nextembed.ws/embed/movie/1';
		expect((await providers.collaps.fetch({ source: 'collaps', externalId: '1', mediaType: 'movie' })).players).toEqual([]);
	});

	test('status never includes credentials and undocumented Alloha search is unavailable', async () => {
		const providers = createImportProviders({ tmdbApiKey: 'fixture', allohaApiToken: 'fixture', kinopoiskApiKey: 'fixture', collapsApiToken: 'fixture' });
		expect(providers.kinopoisk.status().dailyLimit).toBeNull();
		expect(providers.alloha.status().capabilities.search).toBe(false);
		expect(JSON.stringify(Object.values(providers).map(provider => provider.status()))).not.toContain('fixture');
		await expect(providers.alloha.search('Title')).rejects.toMatchObject({ code: 'unsupported' });
	});

	test('missing credentials and invalid refs do not send requests', async () => {
		const transport = vi.fn<ImportTransport>();
		const providers = createImportProviders({}, transport);
		await expect(providers.tmdb.fetch({ source: 'tmdb', externalId: '1', mediaType: 'movie' })).rejects.toMatchObject({ code: 'not-configured' });
		await expect(providers.collaps.fetch({ source: 'collaps', externalId: '../../secret', mediaType: 'movie' })).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(transport).not.toHaveBeenCalled();
	});

	test('TMDB searches return only works, not people', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ results: [{ id: 1, media_type: 'movie', title: 'Film' }, { id: 2, media_type: 'tv', name: 'Show' }, { id: 3, media_type: 'person', name: 'Person' }], total_pages: 2 });
		const result = await createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.search('Title');
		expect(result.items.map(value => value.ref.mediaType)).toEqual(['movie', 'tv']);
		expect(result.hasMore).toBe(true);
		const url = new URL(transport.mock.calls[0][0]);
		expect(url.origin).toBe('https://api.themoviedb.org');
		expect(url.searchParams.get('include_adult')).toBe('false');
	});

	test('TMDB fetches typed seasons and does not follow upstream-provided URLs', async () => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).pathname.endsWith('/season/1') ? { season_number: 1, episodes: [{ id: 2, episode_number: 1, name: 'First' }] } : { id: 1, name: 'Show', seasons: [{ season_number: 1 }], next_page: 'https://evil.example.org/' });
		const result = await createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.fetch({ source: 'tmdb', externalId: '1', mediaType: 'tv' });
		expect(result.seasons[0].episodes).toHaveLength(1);
		expect(transport.mock.calls).toHaveLength(2);
		expect(transport.mock.calls.every(([url]) => new URL(url).origin === 'https://api.themoviedb.org')).toBe(true);
	});

	test('provider errors cannot reveal URLs or credentials from transport exceptions', async () => {
		const transport: ImportTransport = async () => { throw new Error('https://api.bhcesh.me/?token=fixture-secret'); };
		try {
			await createImportProviders({ collapsApiToken: 'fixture-secret' }, transport).collaps.search('Film');
			throw new Error('Expected rejection');
		} catch (error) {
			expect(error).toBeInstanceOf(ImportProviderError);
			expect(String(error)).toBe('ImportProviderError: upstream-failure');
			expect(JSON.stringify(error)).not.toContain('fixture-secret');
		}
	});

	test('compact TMDB detail responses are partial and cannot erase missing credit or genre memberships', async () => {
		const transport: ImportTransport = async () => ({ id: 1, title: 'Compact film' });
		const record = await createImportProviders({ tmdbApiKey: 'fixture' }, transport).tmdb.fetch({ source: 'tmdb', externalId: '1', mediaType: 'movie' });
		expect(record.complete).toBe(false);
		expect(record.warnings).toContain('tmdb-metadata-partial');
	});

	test('Kinopoisk uses a header credential and fetches cast separately', async () => {
		const transport = vi.fn<ImportTransport>(async url => new URL(url).pathname === '/api/v1/staff' ? [{ staffId: 2, nameRu: 'Actor', professionKey: 'ACTOR' }] : { kinopoiskId: 1, nameRu: 'Film', type: 'FILM' });
		const result = await createImportProviders({ kinopoiskApiKey: 'fixture-key' }, transport).kinopoisk.fetch({ source: 'kinopoisk', externalId: '1', mediaType: 'movie' });
		expect(result.credits[0].name).toBe('Actor');
		expect(transport.mock.calls[0][1]).toEqual({ 'X-API-KEY': 'fixture-key' });
		expect(transport.mock.calls.every(([url]) => !url.includes('fixture-key'))).toBe(true);
	});

	test('Alloha enrichment looks up only the exact typed TMDB identity', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ data: { category: { slug: 'serial' }, iframe: 'https://ascorbic-as.stravers.live/?id=1' } });
		const result = await createImportProviders({ allohaApiToken: 'fixture-key' }, transport).alloha.lookup?.([{ provider: 'tmdb', externalId: '1', entityType: 'movie' }, { provider: 'tmdb', externalId: '2', entityType: 'tv' }], 'tv');
		expect(result?.ref.externalId).toBe('tmdb:tv:2');
		expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/v2/movies/tmdb/2');
		expect(transport.mock.calls[0][1]).toEqual({ Authorization: 'Bearer fixture-key' });
	});

	test('Collaps pagination constructs its own request; next_page never becomes a request URL', async () => {
		const transport = vi.fn<ImportTransport>().mockResolvedValue({ results: [{ id: 1, name: 'Film', type: 'films' }], next_page: 'https://evil.example.org/?token=fixture' });
		const provider = createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps;
		expect((await provider.search('Film', 1)).hasMore).toBe(true);
		await provider.search('Film', 2);
		expect(new URL(transport.mock.calls[1][0]).searchParams.get('page')).toBe('2');
		expect(transport.mock.calls.every(([url]) => new URL(url).origin === 'https://api.bhcesh.me')).toBe(true);
	});

	test('Collaps lookup refuses a mismatched identity', async () => {
		const transport: ImportTransport = async () => ({ id: 1, name: 'Wrong film', type: 'films', kinopoisk_id: 99 });
		await expect(createImportProviders({ collapsApiToken: 'fixture' }, transport).collaps.lookup?.([{ provider: 'kinopoisk', externalId: '1', entityType: 'movie' }], 'movie')).rejects.toMatchObject({ code: 'malformed-response' });
	});

	test('collection and update requests stay on fixed documented endpoints', async () => {
		const transport = vi.fn<ImportTransport>(async url => {
			const parsed = new URL(url);
			if (parsed.pathname.startsWith('/3/collection/')) return { parts: [{ id: 3, title: 'Movie' }] };
			if (parsed.pathname.startsWith('/api/')) return { items: [{ kinopoiskId: 4, nameRu: 'Фильм', type: 'FILM' }], totalPages: 50 };
			return { results: [{ id: 5, name: 'Film', type: 'films' }], next_page: null };
		});
		const providers = createImportProviders({ tmdbApiKey: 'fixture', kinopoiskApiKey: 'fixture', collapsApiToken: 'fixture' }, transport);
		expect((await providers.tmdb.collection?.('1'))?.items[0].ref.externalId).toBe('3');
		expect((await providers.kinopoisk.collection?.('TOP_250_MOVIES', 25))?.hasMore).toBe(true);
		expect((await providers.collaps.collection?.('1'))?.items[0].ref.externalId).toBe('5');
		await providers.collaps.updates?.();
		expect(new URL(transport.mock.calls[3][0]).pathname).toBe('/video/news');
	});

	test('pacing shares an origin gate across transport instances', async () => {
		vi.useFakeTimers();
		const started: number[] = [];
		const transport: ImportTransport = async () => { started.push(Date.now()); return {}; };
		const first = pacedImportTransport(transport);
		const second = pacedImportTransport(transport);
		const requests = [first('https://pace.example.org/one', {}), second('https://pace.example.org/two', {}), first('https://pace.example.org/three', {})];
		await vi.runAllTimersAsync();
		await Promise.all(requests);
		expect(started[1] - started[0]).toBeGreaterThanOrEqual(250);
		expect(started[2] - started[1]).toBeGreaterThanOrEqual(250);
	});
});

describe('safe default HTTP transport', () => {
	test('configurable API origins reject path, credentials, explicit ports and local targets', () => {
		expect(normalizeImportApiOrigin('https://Api.Example.org/')).toBe('https://api.example.org');
		for (const value of ['http://api.example.org', 'https://api.example.org:443', 'https://api.example.org:8443', 'https://api.example.org/path', 'https://api.example.org/?key=fixture', 'https://user:pass@api.example.org', 'https://127.0.0.1', 'https://[::1]', 'https://metadata.internal', 'https://localhost', ' https://api.example.org']) expect(() => normalizeImportApiOrigin(value)).toThrow('invalid-ref');
	});

	test('configured transport permits only exact selected origins and pins public DNS answers', async () => {
		mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 1 }) });
		const transport = createConfiguredImportTransport({ apiOrigins: { alloha: 'https://mirror.example.org' } });
		await expect(transport('https://mirror.example.org/v2/movies/tmdb/1', {})).resolves.toEqual({ id: 1 });
		await expect(transport('https://mirror.example.org.evil.org/path', {})).rejects.toMatchObject({ code: 'invalid-ref' });
		await expect(transport('https://apbugall.org/path', {})).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(mockedFetch).toHaveBeenCalledTimes(1);
		const agent = mockedFetch.mock.calls[0][1].agent;
		const resolve = () => new Promise((accept, reject) => agent.options.lookup('mirror.example.org', { all: true }, (error: Error | null, addresses: unknown) => error ? reject(error) : accept(addresses)));
		mockedLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
		await expect(resolve()).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
		for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
			mockedLookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }]);
			await expect(resolve()).rejects.toThrow('IMPORT_ADDRESS_REJECTED');
		}
	});

	test('cached player mirror and public token changes preserve episode selection but reject unknown hosts', () => {
		const raw = 'https://ascorbic-as.stravers.live/?token_movie=title-fixture&translation=246&season=1&episode=2&token=old-fixture-token';
		const config = { allohaPlayerOrigin: 'https://mirror.example.org', allohaPlayerToken: 'new-public-fixture' };
		const result = new URL(configuredImportPlayerUrl(raw, 'alloha', config)!);
		expect(result.origin).toBe('https://mirror.example.org');
		expect(result.searchParams.get('episode')).toBe('2');
		expect(result.searchParams.get('token')).toBe('new-public-fixture');
		expect(result.toString()).not.toContain('old-fixture-token');
		expect(configuredImportPlayerUrl(raw.replace('ascorbic-as.stravers.live', 'untrusted.example.org'), 'alloha', config)).toBeNull();
		expect(configuredImportPlayerUrl('https://api.nextembed.ws/embed/1', 'collaps', { collapsPlayerOrigin: 'https://mirror.example.org' })).toBe('https://mirror.example.org/embed/1');
	});
	test('rejects non-provider hosts before fetch', async () => {
		await expect(defaultImportTransport('https://evil.example.org/path', {})).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(mockedFetch).not.toHaveBeenCalled();
	});

	test('invalid URL parsing has no raw input in its error', async () => {
		await expect(defaultImportTransport('not-a-url-with-fixture-secret', {})).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(mockedFetch).not.toHaveBeenCalled();
	});

	test('forbids redirects and bounds body size while clearing its timeout', async () => {
		mockedFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 1 }) });
		expect(await defaultImportTransport('https://api.themoviedb.org/3/movie/1', {})).toEqual({ id: 1 });
		expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', size: 2 * 1024 * 1024 });
	});

	test.each([[402, 'quota-exceeded', 86400000], [429, 'rate-limited', 2000], [404, 'not-found', undefined], [500, 'upstream-failure', undefined]] as const)('maps HTTP %s into a safe retryable code', async (status, code, retryAfterMs) => {
		mockedFetch.mockResolvedValue({ ok: false, status, headers: { get: () => '2' } });
		await expect(defaultImportTransport('https://kinopoiskapiunofficial.tech/api/v2.2/films/1', {})).rejects.toMatchObject({ code, retryAfterMs });
	});
});
