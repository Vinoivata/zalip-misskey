/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { fetchImportedPerson, normalizeKinopoiskPerson, normalizeTmdbPerson, parseImportPersonReference } from './persons.js';
import { ImportProviderError } from './providers.js';

describe('explicit person references', () => {
	test('accepts bounded IDs and official person pages without fetching their URLs', () => {
		for (const reference of ['10', ' 10 ', 'https://www.themoviedb.org/person/10-name', 'https://themoviedb.org/person/10/', 'https://www.themoviedb.org/person/10-Имя']) expect(parseImportPersonReference('tmdb', reference)).toBe('10');
		for (const reference of ['20', 'https://www.kinopoisk.ru/name/20/', 'https://kinopoisk.ru/name/20']) expect(parseImportPersonReference('kinopoisk', reference)).toBe('20');
	});

	test('rejects other media, authorities, credentials, encoded or ambiguous references', () => {
		for (const source of ['tmdb', 'kinopoisk'] as const) {
			for (const reference of ['', '0', '01', '9007199254740992', '-10', '1e2', '10\n', 'a'.repeat(1025), 'https://127.0.0.1/person/10', 'https://api.themoviedb.org/3/person/10', 'https://www.themoviedb.org/movie/10', 'https://www.kinopoisk.ru/film/20/', 'https://www.kinopoisk.ru/name/20/?token=fixture', 'https://www.themoviedb.org/person/10?language=ru', 'https://www.themoviedb.org/person/10#', 'http://www.themoviedb.org/person/10', 'https://www.themoviedb.org:443/person/10', 'https://user:password@www.themoviedb.org/person/10', 'https://www.themoviedb.org.evil.org/person/10', 'https://www.themoviedb.org/person/%31%30', 'https://www.themoviedb.org/person/x/../10', '//www.themoviedb.org/person/10']) expect(() => parseImportPersonReference(source, reference)).toThrow('invalid-ref');
		}
		expect(() => parseImportPersonReference('kinopoisk', 'https://www.themoviedb.org/person/10')).toThrow('invalid-ref');
		expect(() => parseImportPersonReference('tmdb', 'https://www.kinopoisk.ru/name/20/')).toThrow('invalid-ref');
	});
});

describe('person import projection', () => {
	test('TMDB prefers Russian biography and uses English only for missing details', () => {
		const result = normalizeTmdbPerson({ id: 10, name: 'Имя', biography: 'Русская биография', birthday: '1970-01-01', deathday: '2026-02-30', place_of_birth: 'Москва', also_known_as: ['Имя', ' Имя '], profile_path: '/portrait.jpg', homepage: 'https://example.com/person', external_ids: { imdb_id: 'nm123', facebook_id: 'not-persisted' }, secret: 'do-not-persist' }, { id: 10, name: 'Name', biography: 'English biography', also_known_as: ['Alias'] });
		expect(result).toMatchObject({ type: 'person', name: 'Имя', description: 'Русская биография', imageUrl: 'https://image.tmdb.org/t/p/w500/portrait.jpg', externalIds: { tmdb: '10', imdb: 'nm123' }, data: { birthday: '1970-01-01', originalName: 'Name', aliases: ['Имя', 'Alias'], identityQuality: 'verified' } });
		expect(result.data).not.toHaveProperty('deathday');
		expect(JSON.stringify(result)).not.toContain('do-not-persist');
		expect(normalizeTmdbPerson({ id: 10, name: 'Имя', biography: '' }, { id: 10, name: 'Name', biography: 'Fallback' }).description).toBe('Fallback');
	});

	test('bounded facts and public URLs exclude credential URLs and arbitrary JSON', () => {
		const result = normalizeTmdbPerson({ id: 10, name: 'Name', biography: 'b'.repeat(20000), profile_path: '/../../unsafe.jpg', homepage: 'https://example.com/person?api_key=do-not-persist', also_known_as: Array.from({ length: 200 }, (_, index) => `Alias ${index}`), payload: { token: 'do-not-persist' } });
		expect(result.description).toHaveLength(8192);
		expect(result.data?.biography).toHaveLength(16384);
		expect(result.data?.aliases).toHaveLength(30);
		expect(result).not.toHaveProperty('imageUrl');
		expect(result.data).not.toHaveProperty('homepage');
		expect(JSON.stringify(result)).not.toContain('do-not-persist');
		expect(normalizeTmdbPerson({ id: 10, name: 'Name', external_ids: { imdb_id: 'tt123' } }).externalIds).toEqual({ tmdb: '10' });
	});

	test('Kinopoisk normalizes dates, facts, Russian names and safe photographs', () => {
		const result = normalizeKinopoiskPerson({ personId: 20, nameRu: 'Имя', nameEn: 'Name', birthday: '1980-02-29', death: '2025-01-01', birthplace: 'Ленинград', facts: ['Fact one', 'Fact two'], posterUrl: 'https://images.example.com/portrait.jpg', webUrl: 'https://www.kinopoisk.ru/name/20/', spouses: [{ personId: 30 }], token: 'do-not-persist' });
		expect(result).toMatchObject({ externalIds: { kinopoisk: '20' }, description: 'Fact one\n\nFact two', data: { birthday: '1980-02-29', deathday: '2025-01-01', originalName: 'Name' } });
		expect(result.data).not.toHaveProperty('spouses');
		expect(JSON.stringify(result)).not.toContain('do-not-persist');
	});

	test('malformed persons and mismatched fallback IDs are never matched by name', () => {
		for (const input of [{ name: 'Missing ID' }, { id: 0, name: 'Zero' }, { id: 10 }, { id: '1/other', name: 'Name' }]) expect(() => normalizeTmdbPerson(input)).toThrow('malformed-response');
		expect(() => normalizeTmdbPerson({ id: 10, name: 'Name' }, { id: 11, name: 'Other' })).toThrow('malformed-response');
		expect(() => normalizeKinopoiskPerson({ personId: 10 })).toThrow('malformed-response');
	});
});

describe('person provider requests', () => {
	test('TMDB uses two fixed person routes and preserves the requested identity', async () => {
		const transport = vi.fn().mockImplementation(async (request: string) => {
			const url = new URL(request);
			expect(url.origin).toBe('https://api.themoviedb.org');
			expect(url.pathname).toBe('/3/person/10');
			expect(url.searchParams.get('api_key')).toBe('fixture-key');
			if (url.searchParams.get('language') === 'ru-RU') expect(url.searchParams.get('append_to_response')).toBe('external_ids');
			return { id: 10, name: url.searchParams.get('language') === 'ru-RU' ? 'Имя' : 'Name', biography: 'Bio' };
		});
		const result = await fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'fixture-key' }, transport);
		expect(transport).toHaveBeenCalledTimes(2);
		expect(result.externalIds).toEqual({ tmdb: '10' });
		expect(JSON.stringify(result)).not.toContain('fixture-key');
	});

	test('Kinopoisk uses the staff-details endpoint with private header credentials', async () => {
		const transport = vi.fn().mockResolvedValue({ personId: 20, nameRu: 'Имя' });
		await fetchImportedPerson('kinopoisk', '20', { kinopoiskApiKey: 'fixture-key' }, transport);
		expect(transport).toHaveBeenCalledWith('https://kinopoiskapiunofficial.tech/api/v1/staff/20', { 'X-API-KEY': 'fixture-key' });
	});

	test('missing credentials and invalid IDs reject before a network request', async () => {
		const transport = vi.fn();
		await expect(fetchImportedPerson('tmdb', '10', {}, transport)).rejects.toMatchObject({ code: 'not-configured' });
		for (const id of ['0', '01', '10/other', 'https://example.com', '10?token=fixture']) await expect(fetchImportedPerson('tmdb', id, { tmdbApiKey: 'fixture' }, transport)).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(transport).not.toHaveBeenCalled();
	});

	test('rejects different returned identities instead of corrupting the selected person', async () => {
		await expect(fetchImportedPerson('kinopoisk', '20', { kinopoiskApiKey: 'fixture' }, vi.fn().mockResolvedValue({ personId: 21, nameRu: 'Other' }))).rejects.toMatchObject({ code: 'malformed-response' });
		await expect(fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'fixture' }, vi.fn().mockResolvedValue({ id: 11, name: 'Other' }))).rejects.toMatchObject({ code: 'malformed-response' });
	});

	test('a missing fallback is tolerated but quota and rate failures are propagated', async () => {
		const createTransport = (error: ImportProviderError) => vi.fn().mockResolvedValueOnce({ id: 10, name: 'Имя', biography: 'Russian' }).mockRejectedValueOnce(error);
		await expect(fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'fixture' }, createTransport(new ImportProviderError('not-found')))).resolves.toMatchObject({ description: 'Russian' });
		await expect(fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'fixture' }, createTransport(new ImportProviderError('quota-exceeded')))).rejects.toMatchObject({ code: 'quota-exceeded' });
		await expect(fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'fixture' }, createTransport(new ImportProviderError('rate-limited')))).rejects.toMatchObject({ code: 'rate-limited' });
	});

	test('unexpected transport errors never expose keys or request URLs', async () => {
		await expect(fetchImportedPerson('tmdb', '10', { tmdbApiKey: 'do-not-return' }, vi.fn().mockRejectedValue(new Error('https://api.themoviedb.org/?api_key=do-not-return')))).rejects.toMatchObject({ code: 'upstream-failure', message: 'upstream-failure' });
	});
});
