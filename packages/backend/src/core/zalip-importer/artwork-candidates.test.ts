/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { artworkCandidate, recordArtworkCandidates, selectImportArtwork } from './artwork-candidates.js';
import { normalizeTmdbRecord } from './providers.js';
import type { ImportRecord } from './types.js';

function record(): ImportRecord {
	const result = normalizeTmdbRecord({ id: 100, title: 'Title', poster_path: '/default.jpg', images: { posters: [{ file_path: '/chosen.jpg', width: 600, height: 900, iso_639_1: 'ru' }], backdrops: [{ file_path: '/scene.jpg' }] } }, 'movie');
	result.artworkCandidates = recordArtworkCandidates(result);
	return result;
}

describe('normalized importer artwork candidates', () => {
	test('uses deterministic source/role/URL identifiers, never upstream IDs', () => {
		const candidate = record().artworkCandidates!.find(value => value.url.endsWith('/chosen.jpg'))!;
		expect(candidate.id).toMatch(/^[a-f0-9]{64}$/u);
		expect(artworkCandidate({ ...candidate, language: 'en', width: 1200 }).id).toBe(candidate.id);
		expect(artworkCandidate({ ...candidate, source: 'kinopoisk' }).id).not.toBe(candidate.id);
		expect(artworkCandidate({ ...candidate, field: 'galleryUrls' }).id).not.toBe(candidate.id);
		expect(candidate).toMatchObject({ width: 600, height: 900, language: 'ru', previewUrl: 'https://image.tmdb.org/t/p/w342/chosen.jpg' });
	});

	test('retains the primary image, bounds each role and filters unselected fields', () => {
		const result = normalizeTmdbRecord({ id: 100, title: 'Title', poster_path: '/default.jpg', images: { posters: Array.from({ length: 100 }, (_, index) => ({ file_path: `/p${index}.jpg` })) } }, 'movie');
		const candidates = recordArtworkCandidates(result, ['posterUrl']);
		expect(candidates).toHaveLength(18);
		expect(candidates[0].url).toBe(result.posterUrl);
		expect(candidates.every(value => value.field === 'posterUrl')).toBe(true);
	});

	test('applies only choices bound to the exact source, media type and external ID', () => {
		const original = record();
		const candidate = original.artworkCandidates!.find(value => value.url.endsWith('/chosen.jpg'))!;
		const options = { artworkSelections: [{ ref: original.ref, choices: { posterUrl: candidate.id } }] };
		const selected = selectImportArtwork(original, original.ref, options, { posterUrl: 'tmdb' });
		expect(selected.record.posterUrl).toBe(candidate.url);
		expect(selected.selectedFields).toEqual(['posterUrl']);
		expect(original.posterUrl).toContain('/default.jpg');
		for (const different of [{ ...original.ref, externalId: '101' }, { ...original.ref, mediaType: 'tv' as const }, { ...original.ref, source: 'kinopoisk' as const }]) {
			expect(selectImportArtwork(original, different, options, {}).selectedFields).toEqual([]);
		}
	});

	test('rejects missing, stale and wrong-role IDs before they become download URLs', () => {
		const original = record();
		const backdrop = original.artworkCandidates!.find(value => value.field === 'backdropUrl')!;
		for (const id of ['0'.repeat(64), backdrop.id]) expect(() => selectImportArtwork(original, original.ref, { artworkSelections: [{ ref: original.ref, choices: { posterUrl: id } }] }, {})).toThrow('IMPORT_ARTWORK_SELECTION_STALE');
		const poster = original.artworkCandidates!.find(value => value.field === 'posterUrl')!;
		expect(() => selectImportArtwork(original, original.ref, { fields: ['description'], artworkSelections: [{ ref: original.ref, choices: { posterUrl: poster.id } }] }, {})).toThrow('INVALID_IMPORT_OPTIONS');
	});

	test('preserves gallery ordering and permits an explicit empty gallery', () => {
		const original = record();
		const gallery = original.artworkCandidates!.filter(value => value.field === 'galleryUrls');
		expect(selectImportArtwork(original, original.ref, { artworkSelections: [{ ref: original.ref, choices: { galleryUrls: gallery.map(value => value.id).reverse() } }] }, {}).record.galleryUrls).toEqual(gallery.map(value => value.url).reverse());
		expect(selectImportArtwork(original, original.ref, { artworkSelections: [{ ref: original.ref, choices: { galleryUrls: [] } }] }, {})).toMatchObject({ record: { galleryUrls: [] }, selectedFields: ['galleryUrls'] });
	});
});
