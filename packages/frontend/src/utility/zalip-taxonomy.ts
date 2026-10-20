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
export const taxonomyRoles: TaxonomyRole[] = ['actor', 'director', 'writer', 'producer', 'composer', 'cinematographer', 'editor', 'designer', 'creator', 'participant'];
export type TaxonomyWorkFilters = { role?: TaxonomyRole; kind?: 'movie' | 'series' | 'anime' | 'animation'; yearFrom?: number; yearTo?: number; sort?: 'newest' | 'oldest' | 'title' };
export type PersonImportResult = { preview: boolean; source: 'tmdb' | 'kinopoisk'; externalId: string; person: { type: 'person'; name: string; description: string | null; imageUrl: string | null; externalIds: Record<string, string>; data: Record<string, unknown> }; existingEntry: TaxonomyEntry | null; entry: TaxonomyEntry | null; created: boolean; changedFields: string[]; warnings: string[] };

/** Accept complete real calendar dates only; Date's rollover must not invent a birthday. */
export function taxonomyPersonDate(value: unknown): Date | null {
	if (typeof value !== 'string' || !/^[1-2][0-9]{3}-[0-9]{2}-[0-9]{2}$/u.test(value)) return null;
	const date = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

/** Never show an age for contradictory, future or incomplete provider dates. */
export function taxonomyPersonAge(data: Record<string, unknown> | undefined, now = new Date()): { age: number | null; deceased: boolean } {
	const birthday = taxonomyPersonDate(data?.birthday);
	const deathday = taxonomyPersonDate(data?.deathday);
	const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const deceased = deathday != null && deathday <= today;
	if (!birthday || !Number.isFinite(today.getTime()) || birthday > today || (data?.deathday != null && data.deathday !== '' && (!deathday || deathday < birthday || deathday > today))) return { age: null, deceased };
	const end = deathday ?? today;
	const anniversaryNotReached = end.getUTCMonth() < birthday.getUTCMonth() || (end.getUTCMonth() === birthday.getUTCMonth() && end.getUTCDate() < birthday.getUTCDate());
	return { age: end.getUTCFullYear() - birthday.getUTCFullYear() - Number(anniversaryNotReached), deceased };
}

export function taxonomyPersonDateLabel(value: unknown, locale?: string): string | null {
	const date = taxonomyPersonDate(value);
	if (!date) return null;
	try { return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date); } catch { return date.toISOString().slice(0, 10); }
}

/** Query props are untrusted. Invalid years never become NaN API parameters. */
export function taxonomyWorkFilters(input: { role?: string; kind?: string; yearFrom?: string; yearTo?: string; sort?: string }, defaultSort?: TaxonomyWorkFilters['sort']): TaxonomyWorkFilters {
	const year = (value: string | undefined): number | undefined => value && /^[0-9]{4}$/u.test(value) && Number(value) >= 1800 && Number(value) <= 3000 ? Number(value) : undefined;
	const yearFrom = year(input.yearFrom); const yearTo = year(input.yearTo);
	return {
		...(taxonomyRoles.includes(input.role as TaxonomyRole) ? { role: input.role as TaxonomyRole } : {}),
		...(['movie', 'series', 'anime', 'animation'].includes(input.kind ?? '') ? { kind: input.kind as TaxonomyWorkFilters['kind'] } : {}),
		...(yearFrom !== undefined && (yearTo === undefined || yearFrom <= yearTo) ? { yearFrom } : {}),
		...(yearTo !== undefined && (yearFrom === undefined || yearFrom <= yearTo) ? { yearTo } : {}),
		...(['newest', 'oldest', 'title'].includes(input.sort ?? '') ? { sort: input.sort as TaxonomyWorkFilters['sort'] } : defaultSort ? { sort: defaultSort } : {}),
	};
}

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
		if (row.credits) {
			for (const credit of row.credits) addCredit(work.credits, credit.role, credit.character);
		} else if (row.role || row.character) addCredit(work.credits, row.role, row.character);
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
