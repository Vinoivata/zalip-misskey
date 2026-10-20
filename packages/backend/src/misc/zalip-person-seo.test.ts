/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import type { PackedZalipCatalogEntry } from '@/core/ZalipTaxonomyService.js';
import { htmlSafeJsonStringify } from '@/misc/json-stringify-html-safe.js';
import { zalipPersonSeo } from './zalip-person-seo.js';

function entry(overrides: Partial<PackedZalipCatalogEntry> = {}): PackedZalipCatalogEntry {
	return { id: 'person1', type: 'person', slug: 'person-tmdb-63', name: 'Test Person', description: 'Biography', imageUrl: 'https://social.example/files/person.webp', parentId: null, externalIds: { tmdb: '63', kinopoisk: '100', imdb: 'nm0000100' }, data: {}, ...overrides };
}

describe('Zalip person public metadata', () => {
	test('canonical excludes navigation filters and uses the stable current slug', () => {
		const result = zalipPersonSeo(entry(), 'https://social.example', 'Zalip');
		expect(result.canonical).toBe('https://social.example/zalip/taxonomy/person/person-tmdb-63');
		expect(result.title).toBe('Test Person | Zalip');
		expect(result.structuredData).toMatchObject({ '@type': 'Person', '@context': 'https://schema.org', name: 'Test Person' });
		expect(result.structuredData.sameAs).toEqual(['https://www.themoviedb.org/person/63', 'https://www.kinopoisk.ru/name/100/', 'https://www.imdb.com/name/nm0000100/']);
	});

	test('only explicitly projected public facts reach JSON-LD', () => {
		const result = zalipPersonSeo(entry({ data: { biography: '  Public\n biography ', birthday: '1960-04-07', deathday: '2020-05-06', placeOfBirth: 'A city', aliases: ['Original', 'Original', 'Test Person', null, { secret: 'private' }], originalName: 'Original', _zalip: { credential: 'secret-marker' }, apiKey: 'secret-marker', homepage: 'https://source.example/?token=secret-marker' } }), 'https://social.example', 'Zalip');
		expect(result.description).toBe('Public biography');
		expect(result.structuredData).toMatchObject({ alternateName: ['Original'], birthDate: '1960-04-07', deathDate: '2020-05-06', birthPlace: { '@type': 'Place', name: 'A city' } });
		expect(JSON.stringify(result)).not.toContain('secret-marker');
	});

	test.each(['2020-02-30', '2020-2-2', 'not-a-date', '', '2000-01-01T00:00:00Z'])('omits malformed dates: %s', birthday => {
		expect(zalipPersonSeo(entry({ data: { birthday } }), 'https://social.example', 'Zalip').structuredData).not.toHaveProperty('birthDate');
	});

	test('omits death date preceding birth date', () => {
		expect(zalipPersonSeo(entry({ data: { birthday: '2000-01-01', deathday: '1900-01-01' } }), 'https://social.example', 'Zalip').structuredData).not.toHaveProperty('deathDate');
	});

	test.each(['javascript:alert(1)', 'data:image/png,123', 'https://user:pass@cdn.example/a.jpg', 'https://cdn.example/a b.jpg', '//untrusted.example/a.jpg'])('rejects unsafe image values: %s', imageUrl => {
		const result = zalipPersonSeo(entry({ imageUrl }), 'https://social.example', 'Zalip');
		expect(result.image).toBeNull();
		expect(result.structuredData).not.toHaveProperty('image');
	});

	test('supports local root-relative Drive images', () => {
		expect(zalipPersonSeo(entry({ imageUrl: '/files/person.webp' }), 'https://social.example', 'Zalip').image).toBe('https://social.example/files/person.webp');
	});

	test('ignores arbitrary external IDs and never emits a supplied external URL', () => {
		const result = zalipPersonSeo(entry({ externalIds: { tmdb: 'https://source.example/?token=private', kinopoisk: '-7', imdb: 'tt1234', random: 'private' } }), 'https://social.example', 'Zalip');
		expect(result.structuredData).not.toHaveProperty('sameAs');
		expect(JSON.stringify(result)).not.toContain('private');
	});

	test('uses the existing HTML-safe serializer for hostile names and biography', () => {
		const marker = '</script><script>alert("x")</script>\u2028&';
		const result = zalipPersonSeo(entry({ name: marker, data: { biography: marker } }), 'https://social.example', 'Zalip');
		const serialized = htmlSafeJsonStringify(result.structuredData);
		expect(serialized).not.toContain('</script>');
		expect(serialized).not.toContain('\u2028');
		expect(JSON.parse(serialized).name).toBe(marker);
	});

	test('bounds the description and rejects non-person entries', () => {
		expect(zalipPersonSeo(entry({ description: 'a'.repeat(1000) }), 'https://social.example', 'Zalip').description).toHaveLength(200);
		expect(() => zalipPersonSeo(entry({ type: 'studio' }), 'https://social.example', 'Zalip')).toThrow('INVALID_PERSON_PAGE');
	});
});
