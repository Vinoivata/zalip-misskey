/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { canUpdateField, mergeImportRecords, readImportState } from './policy.js';
import type { ImportRecord } from './types.js';

function record(source: ImportRecord['ref']['source'], values: Partial<ImportRecord> = {}): ImportRecord {
	return { ref: { source, externalId: '100', mediaType: 'movie' }, identities: [{ provider: source, externalId: '100', entityType: 'movie' }], title: source, originalTitle: null, description: null, releaseYear: 2020, runtimeMinutes: null, kind: 'movie', genres: [], countries: [], posterUrl: null, backdropUrl: null, logoUrl: null, galleryUrls: [], trailerYoutubeKey: null, ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [], ...values };
}

describe('Zalip import ownership', () => {
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
});
