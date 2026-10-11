/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { MiZalipCatalogEntry, ZalipCatalogEntryType } from '@/models/ZalipCatalogEntry.js';

export type ZalipCatalogEntryInput = {
	type: ZalipCatalogEntryType;
	name: string;
	slug?: string;
	description?: string | null;
	imageUrl?: string | null;
	externalIds?: Record<string, string>;
	data?: Record<string, unknown>;
	parentId?: string | null;
};

export type ZalipCategoryRules = {
	all?: boolean;
	kinds?: string[];
	genres?: string[];
	countries?: string[];
	yearFrom?: number;
	yearTo?: number;
};

/** A small explicit projection prevents arbitrary provider/editor JSON from becoming executable rules. */
export function normalizeZalipCategoryRules(rules: unknown): ZalipCategoryRules | null {
	if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return null;
	const input = rules as Record<string, unknown>;
	const result: ZalipCategoryRules = {};
	if (input.all !== undefined) {
		if (typeof input.all !== 'boolean') return null;
		result.all = input.all;
	}
	for (const key of ['kinds', 'genres', 'countries'] as const) {
		const value = input[key];
		if (value === undefined) continue;
		if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item.trim() || item.trim().length > 256)) return null;
		const list = [...new Set((value as string[]).map(item => item.trim()))];
		if (key === 'kinds' && list.some(item => !['movie', 'series', 'anime', 'animation'].includes(item))) return null;
		result[key] = list;
	}
	for (const key of ['yearFrom', 'yearTo'] as const) {
		const value = input[key];
		if (value === undefined) continue;
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 1800 || value > 3000) return null;
		result[key] = value;
	}
	if (result.yearFrom !== undefined && result.yearTo !== undefined && result.yearFrom > result.yearTo) return null;
	return result;
}

/** All configured dimensions narrow membership; values within one dimension are alternatives. */
export function matchesZalipCategoryRules(
	rules: unknown,
	work: { kind: string; genres: string[]; countries: string[]; releaseYear: number | null },
): boolean {
	const candidate = normalizeZalipCategoryRules(rules);
	if (!candidate) return false;
	const lists = ['kinds', 'genres', 'countries'] as const;
	if (!candidate.all && !lists.some(key => (candidate[key]?.length ?? 0) > 0) && candidate.yearFrom === undefined && candidate.yearTo === undefined) return false;
	if (candidate.kinds?.length && !candidate.kinds.includes(work.kind)) return false;
	if (candidate.genres?.length && !candidate.genres.some(genre => work.genres.some(value => normalizeZalipCatalogLabel(genre, 'genre') === normalizeZalipCatalogLabel(value, 'genre')))) return false;
	if (candidate.countries?.length && !candidate.countries.some(country => work.countries.some(value => normalizeZalipCatalogLabel(country) === normalizeZalipCatalogLabel(value)))) return false;
	if (candidate.yearFrom !== undefined && (work.releaseYear === null || work.releaseYear < candidate.yearFrom)) return false;
	if (candidate.yearTo !== undefined && (work.releaseYear === null || work.releaseYear > candidate.yearTo)) return false;
	return true;
}

type EditorialData = {
	manualFields: string[];
	fieldSources: Record<string, string>;
};

const editableFields = ['name', 'slug', 'description', 'imageUrl', 'data', 'parentId'] as const;
const genreAliases: Record<string, string> = {
	'sci-fi': 'фантастика',
	'science fiction': 'фантастика',
	'научная фантастика': 'фантастика',
	'action': 'боевик',
	'adventure': 'приключения',
	'comedy': 'комедия',
	'crime': 'криминал',
	'documentary': 'документальный',
	'drama': 'драма',
	'fantasy': 'фэнтези',
	'history': 'история',
	'horror': 'ужасы',
	'music': 'музыка',
	'mystery': 'детектив',
	'romance': 'мелодрама',
	'thriller': 'триллер',
	'war': 'военный',
	'western': 'вестерн',
};

/** Stable keys for catalogue labels; names of people are never used for identity matching. */
export function normalizeZalipCatalogLabel(value: string, type?: ZalipCatalogEntryType): string {
	const normalized = value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
	return type === 'genre' ? genreAliases[normalized] ?? normalized : normalized;
}

export function zalipCatalogSlug(value: string): string {
	return normalizeZalipCatalogLabel(value)
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-|-$/gu, '')
		.slice(0, 160)
		.replace(/-$/u, '');
}

export function normalizeZalipExternalIds(input: Record<string, string> = {}): Record<string, string> {
	const pairs = Object.entries(input).map(([key, value]) => [key.trim().toLowerCase(), value.trim()] as const);
	if (pairs.length > 32 || pairs.some(([key, value]) => !/^[a-z0-9:_-]{1,64}$/u.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || !value || value.length > 128)) {
		throw new Error('INVALID_EXTERNAL_IDS');
	}
	return Object.fromEntries(pairs);
}

function publicFacts(data: Record<string, unknown>): Record<string, unknown> {
	const clean = Object.fromEntries(Object.entries(data).filter(([key]) => key !== '_zalip'));
	const serialized = JSON.stringify(clean);
	if (serialized.length > 65536) throw new Error('CATALOG_DATA_TOO_LARGE');
	return JSON.parse(serialized) as Record<string, unknown>;
}

export function getZalipCatalogEditorialData(data: Record<string, unknown>): EditorialData {
	const candidate = data._zalip;
	if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
		return { manualFields: [], fieldSources: {} };
	}
	const metadata = candidate as Partial<EditorialData>;
	return {
		manualFields: Array.isArray(metadata.manualFields) ? metadata.manualFields.filter(field => typeof field === 'string') : [],
		fieldSources: metadata.fieldSources && typeof metadata.fieldSources === 'object' ? metadata.fieldSources : {},
	};
}

/** Partial source responses only add nonempty data and never erase editorial fields. */
export function mergeZalipCatalogEntry(
	existing: Pick<MiZalipCatalogEntry, 'name' | 'slug' | 'description' | 'imageUrl' | 'externalIds' | 'data' | 'parentId'>,
	input: ZalipCatalogEntryInput,
	source: string,
	options: { protectOnlyChangedBaseFields?: boolean } = {},
): Pick<MiZalipCatalogEntry, 'name' | 'slug' | 'description' | 'imageUrl' | 'externalIds' | 'data' | 'parentId'> {
	const editorial = getZalipCatalogEditorialData(existing.data);
	const manualFields = new Set(editorial.manualFields);
	const fieldSources = { ...editorial.fieldSources };
	const externalIds = { ...existing.externalIds };
	for (const [key, value] of Object.entries(normalizeZalipExternalIds(input.externalIds))) {
		if (externalIds[key] && externalIds[key] !== value) throw new Error('CATALOG_ID_CONFLICT');
		externalIds[key] = value;
	}
	const merged = { ...existing, externalIds, data: publicFacts(existing.data) };
	for (const field of editableFields) {
		const value = input[field];
		if (value === undefined) continue;
		// An editor must send a name, even for a fact-only change. Do not claim unchanged
		// imported base fields, while keeping explicit null clears editorially protected.
		if (source === 'manual' && options.protectOnlyChangedBaseFields && field !== 'data' && value !== null && value === existing[field]) continue;
		if (source !== 'manual' && (manualFields.has(field) || value === null || (typeof value === 'string' && !value.trim()) || (field === 'data' && Object.keys(value as object).length === 0))) continue;
		if (field === 'data') {
			// Facts are owned separately: editing a birthday must not freeze a future biography.
			// Preserve the older whole-data lock above for existing editorial records.
			for (const [key, fact] of Object.entries(publicFacts(value as Record<string, unknown>))) {
				const factField = `data.${key}`;
				if (source !== 'manual' && (manualFields.has(factField) || fact === null || fact === '' || (Array.isArray(fact) && fact.length === 0))) continue;
				if (source === 'manual') manualFields.add(factField);
				fieldSources[factField] = source;
				merged.data[key] = fact;
			}
			continue;
		}
		if (source === 'manual') manualFields.add(field);
		fieldSources[field] = source;
		if (field === 'name' || field === 'slug') {
			merged[field] = String(value).trim();
		} else {
			merged[field] = value as string | null;
		}
	}
	merged.data._zalip = { manualFields: [...manualFields], fieldSources };
	return merged;
}

export function packZalipCatalogFacts(data: Record<string, unknown>): Record<string, unknown> {
	return publicFacts(data);
}
