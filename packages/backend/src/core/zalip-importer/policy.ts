/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { importFields, importSources, type ImportField, type ImportFilters, type ImportOptions, type ImportRecord, type ImportSource, type ImportWorkState } from './types.js';

/** Service callers and persisted JSON receive the same validation as the HTTP boundary. */
export function normalizeImportOptions(input?: ImportOptions): ImportOptions {
	if (input === undefined) return {};
	if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['sources', 'fields', 'fieldSources', 'filters', 'artwork'].includes(key))) throw new Error('INVALID_IMPORT_OPTIONS');
	const result: ImportOptions = {};
	if (input.artwork !== undefined) {
		if (!['remote', 'local-webp'].includes(input.artwork)) throw new Error('INVALID_IMPORT_OPTIONS');
		result.artwork = input.artwork;
	}
	if (input.sources !== undefined) {
		if (!Array.isArray(input.sources) || input.sources.length > importSources.length || input.sources.some(source => !importSources.includes(source))) throw new Error('INVALID_IMPORT_OPTIONS');
		result.sources = importSources.filter(source => input.sources!.includes(source));
	}
	if (input.fields !== undefined) {
		if (!Array.isArray(input.fields) || input.fields.length > importFields.length || input.fields.some(field => !importFields.includes(field))) throw new Error('INVALID_IMPORT_OPTIONS');
		result.fields = importFields.filter(field => input.fields!.includes(field));
	}
	if (input.fieldSources !== undefined) {
		if (!input.fieldSources || typeof input.fieldSources !== 'object' || Array.isArray(input.fieldSources) || Object.entries(input.fieldSources).some(([field, source]) => !importFields.includes(field as ImportField) || !importSources.includes(source as ImportSource))) throw new Error('INVALID_IMPORT_OPTIONS');
		result.fieldSources = Object.fromEntries(importFields.filter(field => input.fieldSources![field] !== undefined).map(field => [field, input.fieldSources![field]]));
	}
	if (input.filters !== undefined) {
		const filters = input.filters;
		if (!filters || typeof filters !== 'object' || Array.isArray(filters) || Object.keys(filters).some(key => !['mediaTypes', 'kinds', 'yearFrom', 'yearTo', 'genres', 'countries', 'ratingMin'].includes(key))) throw new Error('INVALID_IMPORT_OPTIONS');
		const normalized: ImportFilters = {};
		if (filters.mediaTypes !== undefined) {
			if (!Array.isArray(filters.mediaTypes) || filters.mediaTypes.length > 2 || filters.mediaTypes.some(type => !['movie', 'tv'].includes(type))) throw new Error('INVALID_IMPORT_OPTIONS');
			normalized.mediaTypes = (['movie', 'tv'] as const).filter(type => filters.mediaTypes!.includes(type));
		}
		if (filters.kinds !== undefined) {
			if (!Array.isArray(filters.kinds) || filters.kinds.length > 4 || filters.kinds.some(kind => !['movie', 'series', 'anime', 'animation'].includes(kind))) throw new Error('INVALID_IMPORT_OPTIONS');
			normalized.kinds = (['movie', 'series', 'anime', 'animation'] as const).filter(kind => filters.kinds!.includes(kind));
		}
		for (const field of ['yearFrom', 'yearTo'] as const) {
			if (filters[field] === undefined) continue;
			if (!Number.isInteger(filters[field]) || filters[field]! < 1888 || filters[field]! > 3000) throw new Error('INVALID_IMPORT_OPTIONS');
			normalized[field] = filters[field];
		}
		if (normalized.yearFrom !== undefined && normalized.yearTo !== undefined && normalized.yearFrom > normalized.yearTo) throw new Error('INVALID_IMPORT_OPTIONS');
		for (const field of ['genres', 'countries'] as const) {
			const values = filters[field];
			if (values === undefined) continue;
			if (!Array.isArray(values) || values.length > 50 || values.some(value => typeof value !== 'string' || !value.trim() || value.trim().length > 100)) throw new Error('INVALID_IMPORT_OPTIONS');
			normalized[field] = [...new Set(values.map(value => value.trim().replace(/\s+/gu, ' ')))];
		}
		if (filters.ratingMin !== undefined) {
			if (!Number.isFinite(filters.ratingMin) || filters.ratingMin < 0 || filters.ratingMin > 10) throw new Error('INVALID_IMPORT_OPTIONS');
			normalized.ratingMin = filters.ratingMin;
		}
		result.filters = normalized;
	}
	return result;
}

/** All supplied criteria must match; values within a genre/country group are alternatives. */
export function matchesImportFilters(record: ImportRecord, filters?: ImportFilters): boolean {
	if (!filters) return true;
	if (filters.mediaTypes?.length && !filters.mediaTypes.includes(record.ref.mediaType)) return false;
	if (filters.kinds?.length && !filters.kinds.includes(record.kind)) return false;
	if (filters.yearFrom !== undefined && (record.releaseYear === null || record.releaseYear < filters.yearFrom)) return false;
	if (filters.yearTo !== undefined && (record.releaseYear === null || record.releaseYear > filters.yearTo)) return false;
	const comparable = (value: string) => value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru');
	for (const field of ['genres', 'countries'] as const) {
		if (filters[field]?.length && !filters[field]!.some(value => record[field].some(candidate => comparable(candidate) === comparable(value)))) return false;
	}
	if (filters.ratingMin !== undefined) {
		// Prefer the authoritative KP rating, then TMDB/IMDb; do not pick the highest score.
		const rating = ['kinopoisk', 'tmdb', 'imdb'].map(source => record.ratings.find(item => item.source === source)).find(item => item !== undefined) ?? record.ratings[0];
		if (!rating || rating.value < filters.ratingMin) return false;
	}
	return true;
}

export function selectedImportSources(primary: ImportSource, options: ImportOptions): ImportSource[] {
	return importSources.filter(source => source === primary || options.sources === undefined || options.sources.includes(source));
}

export function importFieldSelected(field: ImportField, options: ImportOptions, creating = false): boolean {
	return (creating && (field === 'title' || field === 'kind')) || options.fields === undefined || options.fields.includes(field);
}

export function nonEmpty(value: unknown): boolean {
	return value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

export function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Without an ownership baseline existing nonempty data is treated as editorial. */
export function canUpdateField(current: unknown, previous: unknown, incoming: unknown, locked: boolean): boolean {
	return !locked && nonEmpty(incoming) && (previous !== undefined ? sameValue(current, previous) : !nonEmpty(current));
}

export function readImportState(data: Record<string, unknown> | undefined): ImportWorkState {
	const value = data ?? {};
	return {
		locks: Array.isArray(value.locks) ? value.locks.filter((item): item is string => typeof item === 'string') : [],
		values: value.values && typeof value.values === 'object' ? value.values as Record<string, unknown> : {},
		sources: value.sources && typeof value.sources === 'object' ? value.sources as Record<string, string> : {},
		countries: Array.isArray(value.countries) ? value.countries as string[] : [],
		ratings: Array.isArray(value.ratings) ? value.ratings as ImportRecord['ratings'] : [],
		ageRating: typeof value.ageRating === 'string' ? value.ageRating : null,
	};
}

export function mergeImportRecords(records: ImportRecord[], inputOptions?: ImportOptions): { record: ImportRecord; sources: Record<string, string> } {
	if (records.length === 0) throw new Error('Import needs at least one normalized record.');
	const options = normalizeImportOptions(inputOptions);
	const first = records[0];
	const record = structuredClone(first);
	const sources: Record<string, string> = {};
	const artwork = new Set(['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'seasons']);
	for (const field of importFields) {
		const defaults: ImportSource[] = artwork.has(field) ? ['tmdb', 'kinopoisk', 'collaps', 'alloha'] : ['kinopoisk', 'tmdb', 'collaps', 'alloha'];
		const preferred = options.fieldSources?.[field];
		const priority = preferred ? [preferred, ...defaults.filter(source => source !== preferred)] : defaults;
		const candidates = [...records].sort((left, right) => priority.indexOf(left.ref.source) - priority.indexOf(right.ref.source));
		const selected = candidates.find(candidate => nonEmpty(candidate[field]));
		if (selected) {
			(record as unknown as Record<ImportField, unknown>)[field] = structuredClone(selected[field]);
			sources[field] = selected.ref.source;
		}
	}
	const identities = new Map<string, ImportRecord['identities'][number]>();
	for (const item of records.flatMap(item => item.identities)) identities.set(`${item.provider}/${item.entityType}/${item.externalId}`, item);
	record.identities = [...identities.values()];
	// Union fields retain all providers. An explicit preference controls ordering and which
	// duplicate wins, not the removal of another available player or provider collection.
	const prioritizedUnion = (field: 'players' | 'collections') => {
		const preferred = options.fieldSources?.[field];
		if (!preferred) return records; // Preserve the established default union order.
		const order = [preferred, ...(['kinopoisk', 'tmdb', 'collaps', 'alloha'] as const).filter(source => source !== preferred)];
		return [...records].sort((left, right) => order.indexOf(left.ref.source) - order.indexOf(right.ref.source));
	};
	const playerRecords = prioritizedUnion('players');
	record.players = playerRecords.flatMap(item => item.players).filter((item, index, all) => all.findIndex(other => other.source === item.source && other.externalId === item.externalId) === index);
	if (options.fieldSources?.players && record.players.length) sources.players = playerRecords.find(item => item.players.length > 0)!.ref.source;
	// The authoritative metadata API wins over a player's cached copy, independent of import origin.
	const ratingPriority: ImportSource[] = ['kinopoisk', 'tmdb', 'collaps', 'alloha'];
	const ratingPreferred = options.fieldSources?.ratings;
	const orderedRatings = [...records].sort((left, right) => {
		const order = ratingPreferred ? [ratingPreferred, ...ratingPriority.filter(source => source !== ratingPreferred)] : ratingPriority;
		return order.indexOf(left.ref.source) - order.indexOf(right.ref.source);
	});
	record.ratings = orderedRatings.flatMap(item => item.ratings).filter((item, index, all) => all.findIndex(other => other.source === item.source) === index).sort((left, right) => left.source.localeCompare(right.source));
	if (record.ratings.length) sources.ratings = orderedRatings.find(item => item.ratings.length > 0)!.ref.source;
	const collectionRecords = prioritizedUnion('collections');
	record.collections = collectionRecords.flatMap(item => item.collections).filter((item, index, all) => all.findIndex(other => other.source === item.source && other.externalId === item.externalId) === index);
	if (options.fieldSources?.collections && record.collections.length) sources.collections = collectionRecords.find(item => item.collections.length > 0)!.ref.source;
	record.complete = records.every(item => item.complete);
	record.warnings = [...new Set(records.flatMap(item => item.warnings))];
	return { record, sources };
}
