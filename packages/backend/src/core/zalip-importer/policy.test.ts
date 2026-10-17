/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { canUpdateField, importFieldSelected, matchesCreatePlayerFilter, matchesImportFilters, mergeImportRecords, normalizeImportArtworkSettings, normalizeImportOptions, readImportState, selectedImportSources } from './policy.js';
import type { ImportOptions, ImportRecord } from './types.js';

function record(source: ImportRecord['ref']['source'], values: Partial<ImportRecord> = {}): ImportRecord {
	return { ref: { source, externalId: '100', mediaType: 'movie' }, identities: [{ provider: source, externalId: '100', entityType: 'movie' }], title: source, originalTitle: null, description: null, releaseYear: 2020, runtimeMinutes: null, kind: 'movie', genres: [], countries: [], posterUrl: null, backdropUrl: null, logoUrl: null, galleryUrls: [], trailerYoutubeKey: null, ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [], ...values };
}

describe('Zalip import ownership', () => {
	test('requiring a player is explicit and affects only new-title creation', () => {
		expect(normalizeImportOptions({ filters: { requirePlayer: true } })).toEqual({ filters: { requirePlayer: true } });
		expect(() => normalizeImportOptions({ filters: { requirePlayer: 'yes' } } as never)).toThrow('INVALID_IMPORT_OPTIONS');
		expect(matchesCreatePlayerFilter(record('tmdb'), false, { requirePlayer: true })).toBe(false);
		expect(matchesCreatePlayerFilter(record('tmdb'), true, { requirePlayer: true })).toBe(true);
		expect(matchesCreatePlayerFilter(record('tmdb'), false, {})).toBe(true);
		expect(matchesCreatePlayerFilter(record('collaps', { players: [{ source: 'collaps', externalId: '100', iframeUrl: 'https://api.nextembed.ws/embed/100', translations: [], quality: null, episodes: [] }] }), false, { requirePlayer: true })).toBe(true);
	});
	test('updates unchanged provider fields, never overwrites manual changes', () => {
		expect(canUpdateField('old', 'old', 'new', false)).toBe(true);
		expect(canUpdateField('manual', 'old', 'new', false)).toBe(false);
		expect(canUpdateField(null, 'old', 'new', false)).toBe(false);
		expect(canUpdateField([], ['old'], ['new'], false)).toBe(false);
		expect(canUpdateField('legacy', undefined, 'new', false)).toBe(false);
		expect(canUpdateField(null, undefined, 'new', false)).toBe(true);
		expect(canUpdateField('old', 'old', null, false)).toBe(false);
		expect(canUpdateField('old', 'old', 'new', true)).toBe(false);
	});
	test('missing state is safe for legacy titles', () => {
		expect(readImportState(undefined).locks).toEqual([]);
	});
	test('merges per-field priorities, keeps separate rating systems and typed IDs', () => {
		const result = mergeImportRecords([
			record('tmdb', { posterUrl: 'https://image.tmdb.org/poster.jpg', ratings: [{ source: 'tmdb', value: 8, votes: 10 }] }),
			record('kinopoisk', { description: 'Russian description', ratings: [{ source: 'kinopoisk', value: 7, votes: 20 }] }),
		]);
		expect(result.record.title).toBe('kinopoisk');
		expect(result.sources.posterUrl).toBe('tmdb');
		expect(result.record.ratings).toHaveLength(2);
		expect(result.record.identities).toHaveLength(2);
	});

	test('normalizes bounded policy without including arbitrary provider parameters', () => {
		expect(normalizeImportOptions()).toEqual({});
		expect(normalizeImportOptions({ sources: ['collaps', 'tmdb', 'tmdb'], fields: ['ratings', 'title', 'ratings'], fieldSources: { description: 'tmdb' }, artwork: 'local-webp' })).toEqual({ sources: ['tmdb', 'collaps'], fields: ['title', 'ratings'], fieldSources: { description: 'tmdb' }, artwork: 'local-webp' });
		for (const input of [{ token: 'fixture' }, { sources: ['unknown'] }, { fields: ['unknown'] }, { fieldSources: { raw: 'tmdb' } }, { fieldSources: { title: 'unknown' } }, { artwork: 'arbitrary-url' }]) expect(() => normalizeImportOptions(input as ImportOptions)).toThrow('INVALID_IMPORT_OPTIONS');
	});

	test('configurable artwork preserves legacy policy and validates every conversion setting', () => {
		expect(normalizeImportArtworkSettings()).toMatchObject({ format: 'webp', quality: 85, galleryLimit: 18, keepOriginal: true, sizes: { posterUrl: { width: 780, height: 1170, fit: 'inside' } } });
		expect(normalizeImportArtworkSettings(undefined, true)).toMatchObject({ quality: 80, galleryLimit: 12 });
		const normalized = normalizeImportOptions({ artwork: 'local', artworkSettings: { format: 'avif', quality: 100, galleryLimit: 0, keepOriginal: false, sizes: { posterUrl: { width: 0, height: 5000, fit: 'cover' } } } });
		expect(normalized.artworkSettings).toMatchObject({ format: 'avif', quality: 100, galleryLimit: 0, keepOriginal: false, sizes: { posterUrl: { width: 0, height: 5000, fit: 'cover' }, logoUrl: { width: 1000, height: 600, fit: 'inside' } } });
		for (const settings of [null, [], { format: 'svg' }, { quality: 0 }, { quality: 101 }, { quality: 50.5 }, { keepOriginal: 'yes' }, { galleryLimit: 19 }, { galleryLimit: -1 }, { unknown: true }, { sizes: [] }, { sizes: { posterUrl: null } }, { sizes: { posterUrl: { width: -1 } } }, { sizes: { posterUrl: { height: 5001 } } }, { sizes: { posterUrl: { width: 10.5 } } }, { sizes: { posterUrl: { fit: 'fill' } } }, { sizes: { posterUrl: { background: 'black' } } }, { sizes: { random: {} } }]) expect(() => normalizeImportOptions({ artworkSettings: settings } as ImportOptions)).toThrow('INVALID_IMPORT_OPTIONS');
		const fresh = normalizeImportArtworkSettings();
		fresh.sizes.posterUrl.width = 42;
		expect(normalizeImportArtworkSettings().sizes.posterUrl.width).toBe(780);
	});

	test('artwork choices contain IDs only and bind one unambiguous exact reference', () => {
		const ref = { source: 'tmdb', externalId: '100', mediaType: 'movie' } as const;
		const id = 'a'.repeat(64);
		const selection = { ref, choices: { posterUrl: id, galleryUrls: ['b'.repeat(64)] } };
		expect(normalizeImportOptions({ artworkSelections: [selection] }).artworkSelections).toEqual([selection]);
		for (const selections of [null, {}, [selection, selection], Array.from({ length: 101 }, () => selection), [{ ...selection, url: 'https://127.0.0.1' }], [{ ...selection, ref: { ...ref, externalId: '../admin' } }], [{ ...selection, ref: { ...ref, source: 'unknown' } }], [{ ...selection, ref: { ...ref, mediaType: 'person' } }], [{ ...selection, choices: {} }], [{ ...selection, choices: { posterUrl: 'https://image.tmdb.org/poster.jpg' } }], [{ ...selection, choices: { posterUrl: 'a'.repeat(65) } }], [{ ...selection, choices: { galleryUrls: [id, id] } }], [{ ...selection, choices: { galleryUrls: Array.from({ length: 19 }, (_, i) => i.toString(16).padStart(64, '0')) } }], [{ ...selection, choices: { galleryUrls: id } }], [{ ...selection, choices: { stillUrl: id } }]]) expect(() => normalizeImportOptions({ artworkSelections: selections } as ImportOptions)).toThrow('INVALID_IMPORT_OPTIONS');
	});

	test('primary is mandatory while an empty enrichment selection means primary only', () => {
		expect(selectedImportSources('kinopoisk', {})).toEqual(['tmdb', 'kinopoisk', 'alloha', 'collaps', 'kodik']);
		expect(selectedImportSources('kinopoisk', { sources: [] })).toEqual(['kinopoisk']);
		expect(selectedImportSources('kinopoisk', { sources: ['collaps'] })).toEqual(['kinopoisk', 'collaps']);
		expect(importFieldSelected('description', { fields: [] })).toBe(false);
		expect(importFieldSelected('title', { fields: [] }, true)).toBe(true);
		expect(importFieldSelected('kind', { fields: [] }, true)).toBe(true);
		expect(importFieldSelected('title', { fields: [] }, false)).toBe(false);
	});

	test('per-field priorities fall back when the preferred source is missing or empty', () => {
		const records = [record('kinopoisk', { description: 'KP text', posterUrl: 'kp-poster' }), record('tmdb', { description: 'TMDB text', posterUrl: 'tmdb-poster' })];
		const preferred = mergeImportRecords(records, { fieldSources: { description: 'tmdb', posterUrl: 'kinopoisk', logoUrl: 'alloha' } });
		expect(preferred.record).toMatchObject({ description: 'TMDB text', posterUrl: 'kp-poster', logoUrl: null });
		expect(mergeImportRecords(records, { fieldSources: { description: 'alloha' } }).record.description).toBe('KP text');
		expect(mergeImportRecords([record('tmdb', { description: null }), records[0]], { fieldSources: { description: 'tmdb' } }).record.description).toBe('KP text');
	});

	test('Kodik metadata is fallback-only unless explicitly selected, with all player providers retained', () => {
		const kodik = record('kodik', { description: 'Kodik text', posterUrl: 'kodik-poster', ratings: [{ source: 'kinopoisk', value: 6, votes: 5 }], players: [{ source: 'kodik', externalId: 'movie-1', iframeUrl: 'https://kodikplayer.com/video/1/hash/720p', translations: [], quality: null, episodes: [] }] });
		const kp = record('kinopoisk', { description: 'KP text', ratings: [{ source: 'kinopoisk', value: 8, votes: 500 }] });
		const tmdb = record('tmdb', { posterUrl: 'tmdb-poster', players: [{ source: 'collaps', externalId: '2', iframeUrl: 'https://api.nextembed.ws/embed/2', translations: [], quality: null, episodes: [] }] });
		const merged = mergeImportRecords([kodik, kp, tmdb]);
		expect(merged.record).toMatchObject({ title: 'kinopoisk', description: 'KP text', posterUrl: 'tmdb-poster', ratings: [{ source: 'kinopoisk', value: 8, votes: 500 }] });
		expect(merged.record.players.map(value => value.source)).toEqual(['kodik', 'collaps']);
		expect(mergeImportRecords([kp, tmdb, kodik], { fieldSources: { description: 'kodik', ratings: 'kodik' } }).record).toMatchObject({ description: 'Kodik text', ratings: [{ source: 'kinopoisk', value: 6, votes: 5 }] });
		const ref = { source: 'kodik', externalId: 'serial-123', mediaType: 'tv' } as const;
		expect(normalizeImportOptions({ artworkSelections: [{ ref, choices: { posterUrl: 'a'.repeat(64) } }] }).artworkSelections?.[0].ref).toEqual(ref);
		for (const externalId of ['shikimori-46569', 'kinopoisk-123', 'imdb-tt1234567']) expect(normalizeImportOptions({ artworkSelections: [{ ref: { ...ref, externalId }, choices: { posterUrl: 'a'.repeat(64) } }] }).artworkSelections?.[0].ref.externalId).toBe(externalId);
		for (const invalid of [{ ...ref, externalId: '123' }, { ...ref, externalId: 'movie-123' }, { ...ref, source: 'tmdb' }]) expect(() => normalizeImportOptions({ artworkSelections: [{ ref: invalid as never, choices: { posterUrl: 'a'.repeat(64) } }] })).toThrow('INVALID_IMPORT_OPTIONS');
	});

	test('authoritative KP ratings beat a cached Collaps copy regardless of record order', () => {
		const kp = record('kinopoisk', { ratings: [{ source: 'kinopoisk', value: 7.5, votes: 500 }, { source: 'imdb', value: 8, votes: 400 }] });
		const cached = record('collaps', { ratings: [{ source: 'kinopoisk', value: 6, votes: 10 }, { source: 'imdb', value: 7, votes: 10 }] });
		const forward = mergeImportRecords([cached, kp]);
		const reverse = mergeImportRecords([kp, cached]);
		expect(forward.record.ratings).toEqual(reverse.record.ratings);
		expect(forward.record.ratings).toContainEqual({ source: 'kinopoisk', value: 7.5, votes: 500 });
		expect(forward.sources.ratings).toBe('kinopoisk');
		expect(mergeImportRecords([kp, cached], { fieldSources: { ratings: 'collaps' } }).record.ratings).toContainEqual({ source: 'kinopoisk', value: 6, votes: 10 });
	});

	test('union-field preferences order and deduplicate without hiding another source', () => {
		const player: ImportRecord['players'][number] = { source: 'collaps', externalId: '10', iframeUrl: 'https://player.example.test/old', quality: null, translations: [], episodes: [] };
		const collection: ImportRecord['collections'][number] = { source: 'tmdb', externalId: '30', name: 'Old collection' };
		const first = record('tmdb', { players: [player], collections: [collection] });
		const preferred = record('collaps', { players: [{ ...player, iframeUrl: 'https://player.example.test/preferred' }, { ...player, source: 'alloha', externalId: '20' }], collections: [{ ...collection, name: 'Preferred collection' }, { source: 'collaps', externalId: '40', name: 'Other collection' }] });
		const defaults = mergeImportRecords([first, preferred]);
		expect(defaults.record.players[0].iframeUrl).toBe(player.iframeUrl);
		expect(defaults.record.collections[0].name).toBe(collection.name);
		const result = mergeImportRecords([first, preferred], { fieldSources: { players: 'collaps', collections: 'collaps' } });
		expect(result.record.players).toHaveLength(2);
		expect(result.record.players[0].iframeUrl).toBe('https://player.example.test/preferred');
		expect(result.record.collections).toHaveLength(2);
		expect(result.record.collections[0].name).toBe('Preferred collection');
		expect(result.sources).toMatchObject({ players: 'collaps', collections: 'collaps' });
		expect(mergeImportRecords([record('kinopoisk'), preferred], { fieldSources: { players: 'kinopoisk', collections: 'kinopoisk' } }).sources).toMatchObject({ players: 'collaps', collections: 'collaps' });
	});

	test('normalizes local filters and rejects unbounded or reversed criteria', () => {
		expect(normalizeImportOptions({ filters: { mediaTypes: ['tv', 'movie'], kinds: ['anime', 'movie'], genres: [' драма ', 'драма'], countries: [' Южная   Корея '], yearFrom: 2000, yearTo: 2026, ratingMin: 7.5 } }).filters).toEqual({ mediaTypes: ['movie', 'tv'], kinds: ['movie', 'anime'], genres: ['драма'], countries: ['Южная Корея'], yearFrom: 2000, yearTo: 2026, ratingMin: 7.5 });
		for (const filters of [{ yearFrom: 1887 }, { yearTo: 3001 }, { yearFrom: 2026, yearTo: 2000 }, { yearFrom: 2000.5 }, { ratingMin: NaN }, { ratingMin: 11 }, { genres: [' '] }, { countries: ['x'.repeat(101)] }, { genres: Array.from({ length: 51 }, () => 'драма') }, { arbitrary: true }, { mediaTypes: ['anime'] }]) expect(() => normalizeImportOptions({ filters } as ImportOptions)).toThrow('INVALID_IMPORT_OPTIONS');
	});

	test('filters require all groups with alternatives inside genre and country lists', () => {
		const movie = record('tmdb', { genres: ['Драма'], countries: ['Южная Корея'], ratings: [{ source: 'tmdb', value: 9, votes: 1 }, { source: 'kinopoisk', value: 7, votes: 1 }] });
		expect(matchesImportFilters(movie)).toBe(true);
		expect(matchesImportFilters(movie, { mediaTypes: [], genres: [], countries: [] })).toBe(true);
		expect(matchesImportFilters(movie, { mediaTypes: ['movie'], kinds: ['movie'], yearFrom: 2020, yearTo: 2020, genres: ['комедия', ' драма '], countries: ['южная   корея'], ratingMin: 7 })).toBe(true);
		for (const filters of [{ mediaTypes: ['tv'] }, { kinds: ['anime'] }, { yearFrom: 2021 }, { yearTo: 2019 }, { genres: ['комедия'] }, { countries: ['Япония'] }, { ratingMin: 8 }] as const) expect(matchesImportFilters(movie, filters as never)).toBe(false);
		expect(matchesImportFilters(record('tmdb', { releaseYear: null }), { yearFrom: 2000 })).toBe(false);
		expect(matchesImportFilters(record('tmdb'), { ratingMin: 0 })).toBe(false);
	});
});
