/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { TaxonomyEntry, TaxonomyType, TaxonomyWork } from '@/utility/zalip-importer.js';
import { i18n } from '@/i18n.js';

export type TaxonomyLink = { entry: TaxonomyEntry; role: string; character: string | null; position: number };
export type TaxonomySectionId = 'cast' | 'creators' | 'studios' | 'categories' | 'collections';
export type TaxonomyRole = 'actor' | 'director' | 'writer' | 'producer' | 'composer' | 'cinematographer' | 'editor' | 'designer' | 'creator' | 'participant';
export type TaxonomyCredit = { role: TaxonomyRole; character: string | null };
export type TaxonomyCard = { entry: TaxonomyEntry; credits: TaxonomyCredit[]; position: number };
export type TaxonomySection = { id: TaxonomySectionId; entries: TaxonomyCard[] };
export type GroupedTaxonomyWork = TaxonomyWork & { credits: TaxonomyCredit[] };

/** Providers normalize most roles; manual links and older imports can still use aliases. */
export function taxonomyRole(value: string | null | undefined): TaxonomyRole {
	const role = value?.trim().toLowerCase().replace(/[_-]+/gu, ' ') ?? '';
	if (['actor', 'actress', 'cast', 'himself', 'herself', 'voice male', 'voice female', 'voice actor', 'актёр', 'актер'].includes(role)) return 'actor';
	if (['director', 'режиссёр', 'режиссер'].includes(role)) return 'director';
	if (['writer', 'screenplay', 'screenwriter', 'writing', 'story', 'сценарист'].includes(role)) return 'writer';
	if (['producer', 'executive producer', 'producer ussr', 'продюсер'].includes(role)) return 'producer';
	if (['composer', 'original music composer', 'music', 'композитор'].includes(role)) return 'composer';
	if (['operator', 'director of photography', 'cinematography', 'cinematographer', 'оператор'].includes(role)) return 'cinematographer';
	if (['editor', 'editing', 'монтажёр', 'монтажер'].includes(role)) return 'editor';
	if (['design', 'designer', 'production design', 'art direction', 'character design', 'художник'].includes(role)) return 'designer';
	if (['creator', 'created by', 'original creator', 'original story', 'author', 'автор'].includes(role)) return 'creator';
	return 'participant';
}

function addCredit(credits: TaxonomyCredit[], role: string | null | undefined, character: string | null | undefined): void {
	const credit = { role: taxonomyRole(role), character: character?.trim() || null };
	if (!credits.some(previous => previous.role === credit.role && previous.character === credit.character)) credits.push(credit);
}

/** One card per entity within a section; actors who also create retain both sections. */
export function taxonomyLinkSections(links: readonly TaxonomyLink[]): TaxonomySection[] {
	const sections = new Map<TaxonomySectionId, Map<string, TaxonomyCard>>([
		['cast', new Map()], ['creators', new Map()], ['studios', new Map()], ['categories', new Map()], ['collections', new Map()],
	]);
	for (const link of links) {
		const section: TaxonomySectionId | null = link.entry.type === 'person' ? taxonomyRole(link.role) === 'actor' ? 'cast' : 'creators'
			: link.entry.type === 'studio' ? 'studios' : link.entry.type === 'category' ? 'categories' : link.entry.type === 'collection' ? 'collections' : null;
		if (!section) continue; // Genres stay in the compact title metadata, not the people directory.
		const cards = sections.get(section)!;
		const card = cards.get(link.entry.id) ?? { entry: link.entry, credits: [], position: link.position };
		card.position = Math.min(card.position, link.position);
		if (link.entry.type === 'person') addCredit(card.credits, link.role, link.character);
		cards.set(link.entry.id, card);
	}
	return [...sections].filter(([, entries]) => entries.size > 0).map(([id, entries]) => ({ id, entries: [...entries.values()].sort((left, right) => left.position - right.position) }));
}

/** Presentation only: keep the raw relation rows and server cursor for subsequent pages. */
export function taxonomyGroupWorks(rows: readonly TaxonomyWork[]): GroupedTaxonomyWork[] {
	const works = new Map<string, GroupedTaxonomyWork>();
	for (const row of rows) {
		const work = works.get(row.id) ?? { ...row, credits: [] };
		if (row.role || row.character) addCredit(work.credits, row.role, row.character);
		works.set(row.id, work);
	}
	return [...works.values()];
}

export function taxonomyCreditCaption(credits: readonly TaxonomyCredit[]): string {
	return [...new Set(credits.map(credit => [i18n.ts.zalip._taxonomy._roles[credit.role], credit.character].filter(Boolean).join(' · ')))].join(' / ');
}

export function taxonomySectionLabel(section: TaxonomySectionId): string {
	return ({ cast: i18n.ts.zalip._taxonomy.cast, creators: i18n.ts.zalip._importer.people, studios: i18n.ts.zalip._importer.studios, categories: i18n.ts.zalip._importer.categories, collections: i18n.ts.zalip._importer.collections })[section];
}

export function taxonomyTypeIcon(type: TaxonomyType): string {
	return ({ person: 'ti ti-user', studio: 'ti ti-building', genre: 'ti ti-tag', category: 'ti ti-folders', collection: 'ti ti-stack-2' })[type];
}

export function taxonomyProfileLabel(type: TaxonomyType): string {
	return i18n.ts.zalip._taxonomy[type];
}
