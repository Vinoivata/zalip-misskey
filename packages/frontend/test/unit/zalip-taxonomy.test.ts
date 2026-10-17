/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { TaxonomyEntry, TaxonomyWork } from '@/utility/zalip-importer.js';
import type { TaxonomyLink } from '@/utility/zalip-taxonomy.js';
import { taxonomyAppendWorks } from '@/utility/zalip-importer.js';
import { taxonomyCreditCaption, taxonomyGroupWorks, taxonomyLinkSections, taxonomyRole } from '@/utility/zalip-taxonomy.js';
import { i18n } from '@/i18n.js';

function entry(id: string, type: TaxonomyEntry['type'] = 'person'): TaxonomyEntry {
	return { id, type, slug: id, name: id, imageUrl: null, description: null, parentId: null };
}

function link(id: string, role: string, position = 0, type: TaxonomyEntry['type'] = 'person', character: string | null = null): TaxonomyLink {
	return { entry: entry(id, type), role, character, position };
}

function work(id: string, role: string, character: string | null = null): TaxonomyWork {
	return { id, slug: id, title: id, releaseYear: 2026, kind: 'movie', posterPath: null, role, character };
}

describe('taxonomy image-card view models', () => {
	it('separates cast, creators, studios, categories and collections without mixing genres', () => {
		const result = taxonomyLinkSections([link('genre', '', 0, 'genre'), link('collection', '', 0, 'collection'), link('category', '', 0, 'category'), link('studio', '', 0, 'studio'), link('director', 'director'), link('actor', 'actor')]);
		expect(result.map(section => section.id)).toEqual(['cast', 'creators', 'studios', 'categories', 'collections']);
		expect(result.map(section => section.entries.map(card => card.entry.id))).toEqual([['actor'], ['director'], ['studio'], ['category'], ['collection']]);
	});
	it('combines repeated source links and multiple roles per person inside their section', () => {
		const source = [link('a', 'director', 5), link('b', 'writer', 2), link('a', 'writer', 1), link('a', 'DIRECTOR', 6), link('a', 'actor', 3, 'person', 'Hero'), link('a', 'voice_male', 4, 'person', 'Hero')];
		const snapshot = JSON.stringify(source);
		const result = taxonomyLinkSections(source);
		expect(result[0].entries).toHaveLength(1);
		expect(result[0].entries[0].credits).toEqual([{ role: 'actor', character: 'Hero' }]);
		expect(result[1].entries.map(card => card.entry.id)).toEqual(['a', 'b']);
		expect(result[1].entries[0].credits.map(credit => credit.role)).toEqual(['director', 'writer']);
		expect(JSON.stringify(source)).toBe(snapshot);
	});
	it('keeps different characters and never groups different provider identities by name', () => {
		const source = [link('a', 'actor', 0, 'person', ' First '), link('a', 'actor', 0, 'person', 'Second'), link('b', 'actor')];
		source[2].entry.name = source[0].entry.name;
		const cards = taxonomyLinkSections(source)[0].entries;
		expect(cards).toHaveLength(2);
		expect(cards[0].credits.map(credit => credit.character)).toEqual(['First', 'Second']);
	});
	it('does not create empty sections or invent genre/category membership', () => {
		expect(taxonomyLinkSections([])).toEqual([]);
		expect(taxonomyLinkSections([link('genre', '', 0, 'genre')])).toEqual([]);
	});
	it('groups filmography by work ID across raw pages while retaining all roles', () => {
		const first = [work('a', 'actor', 'Hero'), work('b', 'writer')];
		const second = [work('a', 'director'), work('b', 'writer'), work('c', '')];
		const rows = taxonomyAppendWorks(first, second);
		const result = taxonomyGroupWorks(rows);
		expect(rows).toHaveLength(4); // The view never replaces the raw cursor/page state.
		expect(result.map(card => card.id)).toEqual(['a', 'b', 'c']);
		expect(result[0].credits).toEqual([{ role: 'actor', character: 'Hero' }, { role: 'director', character: null }]);
		expect(result[2].credits).toEqual([]);
		expect(first).toHaveLength(2);
	});
	it('normalizes provider aliases and translates unknown roles without echoing imported text', () => {
		expect(taxonomyRole('EXECUTIVE_PRODUCER')).toBe('producer');
		expect(taxonomyRole('director of photography')).toBe('cinematographer');
		expect(taxonomyRole('voice_female')).toBe('actor');
		expect(taxonomyRole('<untrusted>')).toBe('participant');
		expect(taxonomyCreditCaption([{ role: 'director', character: null }, { role: 'actor', character: 'Hero' }])).toBe(`${i18n.ts.zalip._taxonomy._roles.director} / ${i18n.ts.zalip._taxonomy._roles.actor} · Hero`);
	});
});
