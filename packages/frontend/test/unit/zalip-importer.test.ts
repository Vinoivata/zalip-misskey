/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { formatImporterValue, importerImageUrl, importerProgress, importerReference, importerReferenceKey, splitImporterReferenceLines } from '../../src/utility/zalip-importer.js';

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
});
