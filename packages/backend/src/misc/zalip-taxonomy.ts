/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type { MiZalipCatalogEntry, ZalipCatalogEntryType } from '@/models/ZalipCatalogEntry.js';

const personRoleAliases = {
	actor: ['actor', 'actress', 'cast', 'himself', 'herself', 'voice male', 'voice female', 'voice actor', 'актёр', 'актер'],
	director: ['director', 'режиссёр', 'режиссер'],
	writer: ['writer', 'screenplay', 'screenwriter', 'writing', 'story', 'сценарист'],
	producer: ['producer', 'executive producer', 'producer ussr', 'продюсер'],
	composer: ['composer', 'original music composer', 'music', 'композитор'],
	cinematographer: ['operator', 'director of photography', 'cinematography', 'cinematographer', 'оператор'],
	editor: ['editor', 'editing', 'монтажёр', 'монтажер'],
	designer: ['design', 'designer', 'production design', 'art direction', 'character design', 'художник'],
	creator: ['creator', 'created by', 'original creator', 'original story', 'author', 'автор'],
} as const;
export const zalipPersonRoles = ['actor', 'director', 'writer', 'producer', 'composer', 'cinematographer', 'editor', 'designer', 'creator', 'participant'] as const;
export type ZalipPersonRole = typeof zalipPersonRoles[number];
export const zalipFilmographySorts = ['newest', 'oldest', 'title'] as const;
export type ZalipFilmographySort = typeof zalipFilmographySorts[number];
export type ZalipFilmographyFilters = { role?: ZalipPersonRole; kind?: 'movie' | 'series' | 'anime' | 'animation'; yearFrom?: number; yearTo?: number; sort?: ZalipFilmographySort };

/** Exactly the presentation classifications; arbitrary stored jobs never become query syntax. */
export function zalipPersonRole(value: string): ZalipPersonRole {
	const normalized = value.trim().toLowerCase().replace(/[_-]+/gu, ' ');
	return (Object.entries(personRoleAliases).find(([, aliases]) => (aliases as readonly string[]).includes(normalized))?.[0] as ZalipPersonRole | undefined) ?? 'participant';
}

/** Only internal, fixed aliases are accepted. Every interpolated role literal is a source constant. */
export function zalipPersonRoleSql(alias: 'relation' | 'profession' | 'bounded'): string {
	const normalized = `LOWER(regexp_replace(TRIM(COALESCE(${alias}.role, '')), '[_-]+', ' ', 'g'))`;
	return `CASE ${Object.entries(personRoleAliases).map(([role, aliases]) => `WHEN ${normalized} IN (${aliases.map(value => `'${value}'`).join(',')}) THEN '${role}'`).join(' ')} ELSE 'participant' END`;
}

export function normalizeZalipFilmographyFilters(input: ZalipFilmographyFilters): Required<Pick<ZalipFilmographyFilters, 'sort'>> & Omit<ZalipFilmographyFilters, 'sort'> {
	if (input.role !== undefined && !zalipPersonRoles.includes(input.role) || input.kind !== undefined && !['movie', 'series', 'anime', 'animation'].includes(input.kind) || input.sort !== undefined && !zalipFilmographySorts.includes(input.sort)) throw new Error('INVALID_CATALOG_LOOKUP');
	for (const year of [input.yearFrom, input.yearTo]) if (year !== undefined && (!Number.isInteger(year) || year < 1800 || year > 3000)) throw new Error('INVALID_CATALOG_LOOKUP');
	if (input.yearFrom !== undefined && input.yearTo !== undefined && input.yearFrom > input.yearTo) throw new Error('INVALID_CATALOG_LOOKUP');
	return { role: input.role, kind: input.kind, yearFrom: input.yearFrom, yearTo: input.yearTo, sort: input.sort ?? 'newest' };
}

export function zalipFilmographyScope(entryId: string, publishedOnly: boolean, filters: ZalipFilmographyFilters): string {
	const normalized = normalizeZalipFilmographyFilters(filters);
	return createHash('sha256').update(JSON.stringify([entryId, publishedOnly, normalized.role ?? null, normalized.kind ?? null, normalized.yearFrom ?? null, normalized.yearTo ?? null, normalized.sort])).digest('hex');
}

export function encodeZalipFilmographyCursor(scope: string, value: string | number | null, id: string): string {
	return Buffer.from(JSON.stringify([2, scope, value, id])).toString('base64url');
}

export function decodeZalipFilmographyCursor(cursor: string, scope: string, sort: ZalipFilmographySort): { value: string | number | null; id: string } {
	let value: unknown;
	try {
		if (!cursor || cursor.length > 2048 || !/^[a-zA-Z0-9_-]+$/u.test(cursor)) throw new Error();
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) throw new Error();
		value = JSON.parse(bytes.toString('utf8'));
	} catch { throw new Error('INVALID_CATALOG_CURSOR'); }
	if (!Array.isArray(value) || value.length !== 4 || value[0] !== 2 || value[1] !== scope || typeof value[3] !== 'string' || !/^[a-zA-Z0-9]{1,32}$/u.test(value[3]) || (sort === 'title' ? typeof value[2] !== 'string' || Array.from(value[2]).length > 256 : value[2] !== null && (!Number.isInteger(value[2]) || value[2] < 1800 || value[2] > 3000))) throw new Error('INVALID_CATALOG_CURSOR');
	return { value: value[2] as string | number | null, id: value[3] };
}

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

export const zalipCollectionSemanticKinds = ['theme', 'platform', 'franchise'] as const;
export type ZalipCollectionSemanticKind = typeof zalipCollectionSemanticKinds[number];

/** Semantic settings are separate from collectionKind, which records editorial/provider provenance. */
export function getZalipCollectionSettings(data: Record<string, unknown>): { semanticKind: ZalipCollectionSemanticKind; isEnabled: boolean } {
	return {
		semanticKind: zalipCollectionSemanticKinds.includes(data.semanticKind as ZalipCollectionSemanticKind) ? data.semanticKind as ZalipCollectionSemanticKind : 'theme',
		isEnabled: data.isEnabled !== false,
	};
}

type CatalogCursor = { position: number; id: string };

/** A scoped keyset cursor contains no provider credentials and is never interpreted as SQL. */
export function encodeZalipCatalogCursor(entryId: string, publishedOnly: boolean, relation: CatalogCursor): string {
	return Buffer.from(JSON.stringify([1, entryId, publishedOnly, relation.position, relation.id])).toString('base64url');
}

export function decodeZalipCatalogCursor(cursor: string, entryId: string, publishedOnly: boolean): CatalogCursor {
	if (!cursor || cursor.length > 256 || !/^[a-zA-Z0-9_-]+$/u.test(cursor)) throw new Error('INVALID_CATALOG_CURSOR');
	let value: unknown;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) throw new Error();
		value = JSON.parse(bytes.toString('utf8'));
	} catch {
		throw new Error('INVALID_CATALOG_CURSOR');
	}
	if (!Array.isArray(value) || value.length !== 5 || value[0] !== 1 || value[1] !== entryId || value[2] !== publishedOnly || !Number.isInteger(value[3]) || value[3] < 0 || value[3] > 100000 || typeof value[4] !== 'string' || !/^[a-zA-Z0-9]{1,32}$/u.test(value[4])) throw new Error('INVALID_CATALOG_CURSOR');
	return { position: value[3], id: value[4] };
}

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
	localArtwork?: Record<string, string>;
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
		...(metadata.localArtwork && typeof metadata.localArtwork === 'object' && !Array.isArray(metadata.localArtwork) ? { localArtwork: Object.fromEntries(Object.entries(metadata.localArtwork).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) } : {}),
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
	const localArtwork = { ...editorial.localArtwork };
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
		if (field === 'imageUrl' && source !== 'manual' && localArtwork.imageUrl && localArtwork.imageUrl === existing.imageUrl) continue;
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
		if (field === 'imageUrl' && value !== existing.imageUrl) delete localArtwork.imageUrl;
		fieldSources[field] = source;
		if (field === 'name' || field === 'slug') {
			merged[field] = String(value).trim();
		} else {
			merged[field] = value as string | null;
		}
	}
	merged.data._zalip = { manualFields: [...manualFields], fieldSources, ...(editorial.localArtwork ? { localArtwork } : {}) };
	return merged;
}

export function packZalipCatalogFacts(data: Record<string, unknown>): Record<string, unknown> {
	return publicFacts(data);
}
