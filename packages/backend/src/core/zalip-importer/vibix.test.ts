/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { configuredImportPlayerUrl, createImportProviders, ImportProviderError, normalizeVibixEmbed, normalizeVibixRecord, type ImportTransport } from './providers.js';
import { validImportRef } from './types.js';

// Entirely synthetic: API IDs and SDK IDs intentionally use different namespaces.
function movie(patch: Record<string, unknown> = {}) {
	return { id: 200, name: 'Название', name_rus: 'Название', name_eng: 'English', name_original: 'Original', type: 'movie', kp_id: 100, imdb_id: 'tt1234567', year: 2024, duration: 95, description: '<b>Описание</b>', genre: ['Драма'], country: ['Россия'], kp_rating: 8.1, kp_votes: 20, imdb_rating: 7.2, imdb_votes: 10, poster_url: 'https://image.tmdb.org/t/p/original/poster.jpg', backdrop_url: 'https://image.tmdb.org/t/p/original/backdrop.jpg', quality: 'WEB-DL', voiceovers: [{ id: 5, name: 'Озвучка' }], persons: [{ id: 8, name: 'Актёр', occupation: 'actor' }], iframe_url: '', embed_code: '<ins data-publisher-id="10" data-type="movie" data-id="30"></ins>', ...patch };
}

const ref = { source: 'vibix', externalId: '100', mediaType: 'movie' } as const;

describe('Vibix importer boundaries', () => {
	test('checks connectivity using the supported default twenty-item API page', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ success: true, data: [] }));
		await createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix.check!();
		const url = new URL(transport.mock.calls[0][0]);
		expect(url.pathname).toBe('/api/v1/publisher/videos/links');
		expect(url.searchParams.get('page')).toBe('1');
		expect(url.searchParams.get('limit')).toBe('20');
		expect(transport.mock.calls[0][1]).toEqual({ Authorization: 'Bearer fixture' });
	});

	test('projects documented metadata, exact identities and inert SDK attributes only', () => {
		const result = normalizeVibixRecord({ success: true, data: movie({ secret: 'private-fixture', api_token: 'private-fixture', nested: { token: 'private-fixture' } }) });
		expect(result).toMatchObject({ ref, title: 'Название', originalTitle: 'Original', description: 'Описание', releaseYear: 2024, runtimeMinutes: 95, kind: 'movie', genres: ['Драма'], countries: ['Россия'], complete: false });
		expect(result.identities).toEqual([{ provider: 'vibix', externalId: '100', entityType: 'movie' }, { provider: 'kinopoisk', externalId: '100', entityType: 'movie' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'movie' }]);
		expect(result.players).toEqual([{ source: 'vibix', externalId: '200', iframeUrl: '', vibixEmbed: { publisherId: '10', type: 'movie', id: '30' }, quality: 'WEB-DL', translations: [{ id: '5', name: 'Озвучка' }], episodes: [] }]);
		expect(result.credits).toEqual([{ source: 'vibix', externalId: '8', name: 'Актёр', role: 'actor', character: null, imageUrl: null }]);
		expect(result.ratings).toEqual([{ source: 'kinopoisk', value: 8.1, votes: 20 }, { source: 'imdb', value: 7.2, votes: 10 }]);
		expect(result.warnings).toEqual(['vibix-metadata-partial']);
		for (const key of ['private-fixture', '<ins', 'embed_code', 'api_token']) expect(JSON.stringify(result)).not.toContain(key);
	});
	test('does not fabricate an iframe for empty URLs, plain HTML, unsupported embed types or absent credentials', () => {
		for (const embed_code of [undefined, '', '<iframe src="https://example.org"></iframe>', '<ins data-publisher-id="10" data-type="kp" data-id="100"></ins>']) {
			const result = normalizeVibixRecord(movie({ embed_code })); expect(result.players).toEqual([]); expect(result.warnings).toContain('vibix-player-url-missing');
		}
		expect(configuredImportPlayerUrl('', 'vibix', {})).toBeNull();
		expect(createImportProviders({}).vibix.status()).toMatchObject({ source: 'vibix', configured: false, capabilities: { search: true, collections: false, updates: false } });
	});
	test('accepts only the exact public three-key SDK object without executing getters', () => {
		const embed = { publisherId: '10', type: 'movie', id: '30' }; expect(normalizeVibixEmbed(embed)).toEqual(embed); expect(normalizeVibixEmbed(embed)).not.toBe(embed);
		const getter = vi.fn(() => '30'); const accessor = Object.defineProperty({ publisherId: '10', type: 'movie' }, 'id', { get: getter, enumerable: true });
		for (const value of [null, [], 'markup', { ...embed, script: 'bad' }, { ...embed, id: 30 }, { ...embed, id: '0' }, { ...embed, id: '01' }, { ...embed, id: '9007199254740992' }, { ...embed, publisherId: '-1' }, { ...embed, type: 'serial' }, { ...embed, [Symbol('extra')]: 'bad' }, Object.create(embed), accessor]) expect(normalizeVibixEmbed(value)).toBeNull();
		expect(getter).not.toHaveBeenCalled();
	});
	test('rejects script-bearing, ambiguous, duplicate or extra tag attributes and mismatched media types', () => {
		const invalid = ['<script>throw 1</script><ins data-publisher-id="10" data-type="movie" data-id="30"></ins>', '<ins data-publisher-id="10" data-type="movie" data-id="30" onclick="bad()"></ins>', '<ins data-publisher-id="10" data-type="movie" data-id="30" data-id="31"></ins>', '<ins data-publisher-id="10" data-type="movie" data-id="30"data-id="31"></ins>', '<ins data-publisher-id="10" data-type="movie" data-id="30">text</ins>', '<ins data-publisher-id="10" data-type="series" data-id="30"></ins>', '<ins data-publisher-id="10" data-type="movie" data-id="&#51;0"></ins>', `<ins ${' '.repeat(4096)}></ins>`];
		for (const embed_code of invalid) { const result = normalizeVibixRecord(movie({ embed_code })); expect(result.players).toEqual([]); expect(result.warnings).toContain('vibix-embed-rejected'); }
		const valid = normalizeVibixRecord(movie({ embed_code: " <ins\n data-id='30' data-type='movie' data-publisher-id='10' > </ins> " })); expect(valid.players[0].vibixEmbed?.id).toBe('30');
	});
	test('keeps iframe-only responses metadata-only even with an approved host and never invents SDK selectors', () => {
		const url = 'https://player.example.org/embed/30'; const record = normalizeVibixRecord(movie({ iframe_url: url, embed_code: undefined }), ['player.example.org']);
		expect(record).toMatchObject({ title: 'Название', description: 'Описание', releaseYear: 2024, posterUrl: 'https://image.tmdb.org/t/p/original/poster.jpg', players: [] });
		expect(record.identities).toEqual(expect.arrayContaining([{ provider: 'kinopoisk', externalId: '100', entityType: 'movie' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'movie' }]));
		expect(record.credits).toHaveLength(1); expect(record.ratings).toHaveLength(2);
		expect(record.warnings).toEqual(expect.arrayContaining(['vibix-player-url-missing', 'vibix-voice-control-unavailable']));
		for (const embed_code of ['', '<iframe src="https://player.example.org/embed/30"></iframe>', '<ins data-publisher-id="10" data-type="movie" data-id="30" onclick="bad()"></ins>']) {
			const result = normalizeVibixRecord(movie({ iframe_url: url, embed_code }), ['player.example.org']); expect(result.players).toEqual([]); expect(result.title).toBe('Название'); expect(result.warnings).toContain('vibix-player-url-missing');
		}
		const sdk = normalizeVibixRecord(movie({ iframe_url: url }), ['player.example.org']);
		expect(sdk.players[0]).toMatchObject({ iframeUrl: '', vibixEmbed: { publisherId: '10', type: 'movie', id: '30' }, translations: [{ id: '5', name: 'Озвучка' }], episodes: [] });
		expect(sdk.players[0].translations[0]).not.toHaveProperty('iframe'); expect(JSON.stringify(sdk)).not.toContain(url);
		for (const iframe_url of [url, 'http://player.example.org/embed/30', 'https://player.example.org.evil.org/embed/30', 'https://player.example.org/embed/30?token=private', 'https://user:pass@player.example.org/embed/30', 'https://127.0.0.1/embed/30', 'https://player.example.org:8443/embed/30', `${url}#fragment`]) {
			const result = normalizeVibixRecord(movie({ iframe_url, embed_code: undefined }), iframe_url === url ? [] : ['player.example.org']); expect(result.players).toEqual([]); expect(result.warnings).toContain('vibix-player-url-rejected');
		}
		expect(configuredImportPlayerUrl(url, 'vibix', {})).toBeNull();
		expect(configuredImportPlayerUrl(url, 'vibix', { vibixIframeHosts: ['player.example.org'], vibixPlayerOrigin: 'https://mirror.example.org' })).toBe('https://mirror.example.org/embed/30');
	});
	test('preserves serial typing without fabricating canonical episodes or interpreting provider-private IDs', () => {
		const result = normalizeVibixRecord(movie({ type: 'serial', embed_code: '<ins data-publisher-id="10" data-type="series" data-id="40"></ins>', uploaded_episodes: { 999: { 888: { 777: 1 } } }, seasons: [{ name: 'Season X', series: [{ id: 999, name: 'Opening' }] }] }));
		expect(result.ref.mediaType).toBe('tv'); expect(result.kind).toBe('series'); expect(result.seasons).toEqual([]); expect(result.players[0].episodes).toEqual([]); expect(result.players[0].translations[0]).not.toHaveProperty('episodes'); expect(result.warnings).toContain('vibix-episode-data-unavailable');
	});
	test('bounds projected people and voices and omits nameless or unidentified credits', () => {
		const result = normalizeVibixRecord(movie({ persons: [{ name: 'No stable identity' }, ...Array.from({ length: 301 }, (_, index) => ({ id: index + 1, name: `Person ${index}`, occupation: 'actor' }))], voiceovers: Array.from({ length: 101 }, (_, index) => ({ id: index + 1, name: `Voice ${index}` })) }));
		expect(result.credits).toHaveLength(299); expect(result.players[0].translations).toHaveLength(100); expect(result.warnings).toEqual(expect.arrayContaining(['vibix-person-limit', 'vibix-voice-limit', 'vibix-people-without-identities']));
	});
	test('rejects missing/contradictory identities, malformed provider rows and inconsistent voice IDs', () => {
		for (const patch of [{ id: null }, { type: 'tv' }, { name: '', name_rus: '', name_eng: '', name_original: '' }, { kp_id: null, imdb_id: null }, { kp_id: 100, kinopoisk_id: 101 }, { kp_id: 'bad' }, { imdb_id: '1234567' }, { voiceovers: [{ id: 1, name: 'First' }, { id: 1, name: 'Different' }] }]) expect(() => normalizeVibixRecord(movie(patch))).toThrow('malformed-response');
		expect(() => normalizeVibixRecord({ success: false, data: movie() })).toThrow('malformed-response');
	});
	test('supports explicit KP and IMDb references only, preserving the fetchable bound namespace', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ data: movie() })); const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix;
		const result = await provider.fetch({ ...ref, externalId: 'imdb:tt1234567' });
		expect(result.ref.externalId).toBe('imdb:tt1234567'); expect(result.identities[0].externalId).toBe('imdb:tt1234567'); expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/api/v1/publisher/videos/imdb/tt1234567');
		for (const externalId of ['tmdb:movie:100', 'serial-100', 'movie-100', 'tt1234567', '0', '01', '100/path', '9007199254740992']) await expect(provider.fetch({ ...ref, externalId })).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(validImportRef(ref)).toBe(true); expect(validImportRef({ ...ref, externalId: 'imdb:tt1234567' })).toBe(true); expect(validImportRef({ ...ref, externalId: 'tmdb:movie:100' })).toBe(false); expect(transport).toHaveBeenCalledOnce();
	});
	test('searches with documented POST query parameters and bearer auth through process pacing', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ success: true, data: [movie(), movie(), movie({ kp_id: 101, type: 'serial' }), movie({ kp_id: null, imdb_id: null })], meta: { current_page: 2, last_page: 3 }, links: { next: 'https://evil.example.org/next?token=fixture' } }));
		const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix; const page = await provider.search('Название', 2, 'movie');
		expect(page).toMatchObject({ page: 2, hasMore: true }); expect(page.items).toHaveLength(1); expect(page.items[0].ref).toEqual(ref);
		const [rawUrl, headers, options] = transport.mock.calls[0]; const url = new URL(rawUrl); expect(url.origin).toBe('https://vibix.org'); expect(url.pathname).toBe('/api/v1/publisher/videos/search'); expect(Object.fromEntries(url.searchParams)).toEqual({ name: 'Название', page: '2', limit: '20' }); expect(headers).toEqual({ Authorization: 'Bearer fixture' }); expect(options).toEqual({ method: 'POST' }); expect(transport).toHaveBeenCalledOnce();
		expect(provider.updates).toBeUndefined(); expect(provider.collection).toBeUndefined();
	});
	test('bounds search pages, ignores upstream next links and never imports more than twenty rows', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ data: Array.from({ length: 25 }, (_, index) => movie({ kp_id: index + 1 })), meta: { current_page: 1, last_page: 1 }, links: { next: 'https://evil.example.org/next' } })); const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix;
		expect(await provider.search('Test')).toMatchObject({ page: 1, hasMore: false, items: expect.any(Array) }); expect((await provider.search('Test')).items).toHaveLength(20);
		for (const page of [0, -1, 1.5, 1001]) await expect(provider.search('Test', page)).rejects.toMatchObject({ code: 'invalid-ref' });
		transport.mockResolvedValueOnce({ data: [], meta: { current_page: 2, last_page: 2 } }); await expect(provider.search('Test')).rejects.toMatchObject({ code: 'malformed-response' });
	});
	test('uses exact KP/IMDb lookups, checking every supplied identity and movie/serial type', async () => {
		const transport = vi.fn<ImportTransport>(async () => ({ data: movie() })); const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix;
		const identities = [{ provider: 'kinopoisk', externalId: '100', entityType: 'movie' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'movie' }] as const;
		expect((await provider.lookup!([...identities], 'movie'))?.ref).toEqual(ref); expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/api/v1/publisher/videos/kp/100');
		await expect(provider.lookup!([{ ...identities[0], externalId: '101' }, identities[1]], 'movie')).rejects.toMatchObject({ code: 'malformed-response' });
		await expect(provider.lookup!([{ ...identities[1], externalId: 'tt7654321' }, identities[0]], 'movie')).rejects.toMatchObject({ code: 'malformed-response' });
		await expect(provider.fetch({ ...ref, mediaType: 'tv' })).rejects.toMatchObject({ code: 'malformed-response' });
		const before = transport.mock.calls.length; expect(await provider.lookup!([{ provider: 'tmdb', externalId: '100', entityType: 'movie' }], 'movie')).toBeNull(); expect(transport).toHaveBeenCalledTimes(before);
		await expect(provider.lookup!([identities[0], { ...identities[0], externalId: '101' }], 'movie')).rejects.toMatchObject({ code: 'malformed-response' });
	});
	test('reuses a bound IMDb ref, never interprets an API video ID as a documented own-ID lookup', async () => {
		const transport = vi.fn<ImportTransport>(async () => movie()); const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix;
		const result = await provider.lookup!([{ provider: 'vibix', externalId: 'imdb:tt1234567', entityType: 'movie' }, { provider: 'kinopoisk', externalId: '100', entityType: 'movie' }], 'movie');
		expect(result?.ref.externalId).toBe('imdb:tt1234567'); expect(new URL(transport.mock.calls[0][0]).pathname).toBe('/api/v1/publisher/videos/imdb/tt1234567');
	});
	test('falls back to the other exact external ID only on not-found and never on auth/quota failures', async () => {
		const identities = [{ provider: 'kinopoisk', externalId: '100', entityType: 'movie' }, { provider: 'imdb', externalId: 'tt1234567', entityType: 'movie' }] as const;
		const transport = vi.fn<ImportTransport>().mockRejectedValueOnce(new ImportProviderError('not-found')).mockResolvedValueOnce(movie()); const provider = createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix;
		expect((await provider.lookup!([...identities], 'movie'))?.title).toBe('Название'); expect(transport).toHaveBeenCalledTimes(2); expect(new URL(transport.mock.calls[1][0]).pathname).toContain('/imdb/');
		for (const code of ['not-configured', 'quota-exceeded', 'rate-limited'] as const) { transport.mockRejectedValueOnce(new ImportProviderError(code)); const before = transport.mock.calls.length; await expect(provider.lookup!([...identities], 'movie')).rejects.toMatchObject({ code }); expect(transport).toHaveBeenCalledTimes(before + 1); }
		transport.mockRejectedValueOnce(new ImportProviderError('not-found')); expect(await provider.lookup!([identities[0]], 'movie')).toBeNull();
	});
	test('never makes an authenticated request when unconfigured and sanitizes arbitrary upstream errors', async () => {
		const transport = vi.fn<ImportTransport>(); const provider = createImportProviders({}, transport).vibix;
		await expect(provider.fetch(ref)).rejects.toMatchObject({ code: 'not-configured' }); await expect(provider.search('Test')).rejects.toMatchObject({ code: 'not-configured' }); await expect(provider.check!()).rejects.toMatchObject({ code: 'not-configured' }); expect(transport).not.toHaveBeenCalled();
		transport.mockRejectedValue(new Error('URL and private fixture credentials')); await expect(createImportProviders({ vibixApiToken: 'fixture' }, transport).vibix.fetch(ref)).rejects.toThrow(/^upstream-failure$/u);
	});
	test('keeps validated SDK embeds when a configurable player origin exists, without manufacturing a URL', async () => {
		const transport = vi.fn<ImportTransport>(async () => movie()); const result = await createImportProviders({ vibixApiToken: 'fixture', vibixPlayerOrigin: 'https://mirror.example.org' }, transport).vibix.fetch(ref);
		expect(result.players[0]).toMatchObject({ iframeUrl: '', vibixEmbed: { publisherId: '10', type: 'movie', id: '30' } });
	});
});
