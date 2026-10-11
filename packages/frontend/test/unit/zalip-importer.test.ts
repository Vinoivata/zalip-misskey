/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { i18n } from '../../src/i18n.js';
import { formatImporterValue, importerFieldGroups, importerFields, importerFiltersValid, importerImageUrl, importerImdbId, importerOptions, importerProgress, importerReference, importerReferenceKey, importerSelection, importerWarningLabel, importerWarningLabels, importerWorkIds, splitImporterReferenceLines, taxonomyBaseChanges, taxonomyFacts, taxonomyPersonChanges } from '../../src/utility/zalip-importer.js';

describe('importer presentation helpers', () => {
	it('trims and deduplicates references without splitting provider URLs', () => {
		expect(splitImporterReferenceLines('  movie:11\r\n\nmovie:11\nhttps://provider.example/a,b  ')).toEqual(['movie:11', 'https://provider.example/a,b']);
	});
	it('accepts image paths and public web URLs but not executable or credential-bearing URLs', () => {
		expect(importerImageUrl('/poster.jpg')).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
		expect(importerImageUrl('https://example.org/poster.jpg')).toBe('https://example.org/poster.jpg');
		expect(importerImageUrl('javascript:alert(1)')).toBeNull();
		expect(importerImageUrl('https://token@example.org/poster.jpg')).toBeNull();
		expect(importerImageUrl('//example.org/poster.jpg')).toBeNull();
		expect(importerImageUrl('/../poster.jpg')).toBeNull();
		expect(importerImageUrl(null)).toBeNull();
	});
	it('keeps movie and TV namespaces separate and reads only supported card URLs', () => {
		expect(importerReference('tmdb', 'movie', 'https://www.themoviedb.org/tv/11-title')).toEqual({ source: 'tmdb', mediaType: 'tv', externalId: '11' });
		expect(importerReference('kinopoisk', 'movie', 'https://www.kinopoisk.ru/series/123/')).toEqual({ source: 'kinopoisk', mediaType: 'tv', externalId: '123' });
		expect(importerReference('collaps', 'movie', 'https://www.themoviedb.org/movie/11')).toBeNull();
		expect(importerReference('tmdb', 'movie', 'https://themoviedb.org.evil.example/movie/11')).toBeNull();
		expect(importerReference('tmdb', 'movie', '0')).toBeNull();
		expect(importerReference('tmdb', 'movie', 'not-an-id')).toBeNull();
		expect(importerReference('alloha', 'tv', 'tmdb:tv:11')).toEqual({ source: 'alloha', mediaType: 'tv', externalId: 'tmdb:tv:11' });
		expect(importerReferenceKey({ source: 'tmdb', mediaType: 'movie', externalId: '11' })).not.toBe(importerReferenceKey({ source: 'tmdb', mediaType: 'tv', externalId: '11' }));
	});
	it('retains zero and shows an explicit empty value in the diff', () => {
		expect(formatImporterValue(0)).toBe('0');
		expect(formatImporterValue([])).toBe('—');
		expect(formatImporterValue(['Драма', 'Комедия'])).toBe('Драма, Комедия');
		expect(formatImporterValue('<script>')).toBe('<script>');
	});
	it('bounds progress for incomplete and interrupted jobs', () => {
		expect(importerProgress(2, 4)).toBe(50);
		expect(importerProgress(8, 4)).toBe(100);
		expect(importerProgress(-1, 4)).toBe(0);
		expect(importerProgress(0, 0)).toBe(0);
		expect(importerProgress(NaN, 4)).toBe(0);
	});
	it('keeps persisted artwork warnings visible with translated field labels', () => {
		const poster = i18n.tsx.zalip._importer.warningArtworkLocal({ field: i18n.ts.zalip._importer.poster });
		const gallery = i18n.tsx.zalip._importer.warningArtworkLocal({ field: i18n.ts.zalip._importer.gallery });
		expect(importerWarningLabels(['artwork-local-unavailable:posterUrl', 'artwork-local-unavailable:galleryUrls', 'artwork-local-unavailable:posterUrl'])).toEqual([poster, gallery]);
		expect(importerWarningLabels(undefined)).toEqual([]);
		expect(importerWarningLabels(null)).toEqual([]);
		expect(importerWarningLabels([])).toEqual([]);
	});
	it('humanizes only closed warning codes without echoing arbitrary provider text', () => {
		expect(importerWarningLabel('tmdb-season-12-unavailable')).toBe(i18n.tsx.zalip._importer.warningSeasonUnavailable({ number: '12' }));
		expect(importerWarningLabel('collaps-metadata-partial')).toBe(i18n.tsx.zalip._importer.warningMetadataPartial({ source: 'Collaps' }));
		expect(importerWarningLabel('alloha-player-url-rejected')).toBe(i18n.tsx.zalip._importer.warningPlayerRejected({ source: 'Alloha' }));
		expect(importerWarningLabel('kinopoisk:quota-exceeded')).toBe(i18n.tsx.zalip._importer.warningSource({ source: i18n.ts.zalip._importer.sourceKinopoisk, reason: i18n.ts.zalip._importer.errorQuota }));
		for (const code of ['artwork-local-unavailable:token', 'tmdb:upstream-failure https://example.org/?token=private', 'tmdb-season-10000-unavailable', '<script>private</script>']) expect(importerWarningLabel(code)).toBe(i18n.ts.zalip._importer.warningGeneric);
		expect(importerWarningLabel({ token: 'private' })).toBe(i18n.ts.zalip._importer.warningGeneric);
		expect(importerWarningLabels(Array.from({ length: 51 }, (_, index) => `tmdb-season-${index}-unavailable`))).toHaveLength(50);
	});
	it('keeps explicit empty options empty and snapshots grouped form values', () => {
		const defaults = importerSelection();
		expect(defaults.fields).toEqual([...importerFields]);
		expect(defaults.sources).toEqual(['tmdb', 'kinopoisk', 'alloha', 'collaps']);
		const selection = importerSelection({ sources: [], fields: [], fieldSources: { title: 'tmdb' } });
		const options = importerOptions(selection);
		expect(options).toEqual({ sources: [], fields: [], fieldSources: { title: 'tmdb' }, artwork: 'remote' });
		selection.sources.push('collaps'); selection.fields.push('title'); selection.fieldSources.title = 'collaps';
		expect(options).toEqual({ sources: [], fields: [], fieldSources: { title: 'tmdb' }, artwork: 'remote' });
		expect(importerFieldGroups.flatMap(group => group.fields).sort()).toEqual([...importerFields].sort());
	});
	it('normalizes compact filters and preserves zero thresholds and local artwork', () => {
		const selection = importerSelection({ filters: { yearFrom: 2020, ratingMin: 0 }, artwork: 'local-webp' });
		selection.filters.genres = ' Драма, Драма,  Научная  фантастика ';
		expect(importerOptions(selection).filters).toEqual({ yearFrom: 2020, ratingMin: 0, genres: ['Драма', 'Научная фантастика'] });
		expect(importerOptions(selection).artwork).toBe('local-webp');
		expect(importerFiltersValid(selection)).toBe(true);
		selection.filters.yearTo = '2019'; expect(importerFiltersValid(selection)).toBe(false);
		selection.filters.yearTo = '2025'; selection.filters.ratingMin = '11'; expect(importerFiltersValid(selection)).toBe(false);
		selection.filters.ratingMin = '8'; selection.filters.genres = 'a'.repeat(101); expect(importerFiltersValid(selection)).toBe(false);
	});
	it('accepts exact IMDb IDs and card links without confusing spoofed hosts', () => {
		expect(importerImdbId('tt1234567')).toBe('tt1234567');
		expect(importerImdbId('tt12345')).toBe('tt12345');
		expect(importerImdbId('https://www.imdb.com/title/tt1234567/?ref=x')).toBe('tt1234567');
		expect(importerImdbId('https://imdb.com.evil.example/title/tt1234567/')).toBeNull();
		expect(importerImdbId('https://token@imdb.com/title/tt1234567/')).toBeNull();
		expect(importerReference('collaps', 'tv', 'tt1234567')).toEqual({ source: 'collaps', mediaType: 'tv', externalId: 'imdb:tt1234567' });
		expect(importerReference('tmdb', 'movie', 'imdb:tt1234567')).toEqual({ source: 'tmdb', mediaType: 'movie', externalId: 'imdb:tt1234567' });
		expect(importerReference('alloha', 'movie', 'tt1234567')).toBeNull();
	});
	it('deduplicates selected work IDs and rejects unbounded or malformed batches', () => {
		expect(importerWorkIds('abc123, def456\nabc123')).toEqual(['abc123', 'def456']);
		expect(importerWorkIds('')).toBeNull();
		expect(importerWorkIds('abc/def')).toBeNull();
		expect(importerWorkIds(Array.from({ length: 101 }, (_, index) => `id${index}`).join('\n'))).toBeNull();
	});
	it('renders only allowed plain facts and safe homepage links', () => {
		expect(taxonomyFacts({ biography: 'Biography', birthday: '2000-01-01', aliases: ['One', 1, 'Two'], homepage: 'https://example.org/person', token: 'secret', _provenance: {} })).toEqual([{ key: 'birthday', value: '2000-01-01' }, { key: 'aliases', value: 'One, Two' }, { key: 'homepage', value: 'example.org', href: 'https://example.org/person' }]);
		expect(taxonomyFacts({ homepage: 'javascript:alert(1)' })).toEqual([]);
		expect(taxonomyFacts({ homepage: 'https://password@example.org' })).toEqual([]);
	});
	it('does not create locks for untouched person facts and supports explicit clearing', () => {
		const form = { originalName: '', birthday: '2000-01-01', deathday: '', placeOfBirth: '', homepage: '', biography: 'Bio', aliases: 'Alias' };
		const original = { birthday: '2000-01-01', biography: 'Bio', aliases: ['Alias'], identityQuality: 'verified' };
		expect(taxonomyPersonChanges(form, original)).toEqual({});
		form.biography = ''; form.aliases = ''; form.originalName = 'New Name';
		expect(taxonomyPersonChanges(form, original)).toEqual({ biography: null, aliases: [], originalName: 'New Name' });
	});
	it('omits untouched optional base fields while preserving explicit clears', () => {
		const form = { slug: 'person', description: 'Imported biography', imageUrl: 'https://example.org/person.jpg', parentId: '' };
		const original = { ...form, parentId: null };
		expect(taxonomyBaseChanges(form, original)).toEqual({});
		form.description = ''; form.imageUrl = ''; form.slug = 'new-slug';
		expect(taxonomyBaseChanges(form, original)).toEqual({ slug: 'new-slug', description: null, imageUrl: null });
		expect(taxonomyBaseChanges({ slug: '', description: '', imageUrl: '', parentId: '' }, null)).toEqual({ description: null, imageUrl: null, parentId: null });
	});
});
