/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { i18n } from '@/i18n.js';

export type ImportSource = 'tmdb' | 'kinopoisk' | 'alloha' | 'collaps';
export type ImportMediaType = 'movie' | 'tv';
export type ImportRef = { source: ImportSource; externalId: string; mediaType: ImportMediaType };
export type ImportSearchItem = { ref: ImportRef; title: string; originalTitle: string | null; releaseYear: number | null; posterUrl: string | null };
export type ImportSourceStatus = { source: ImportSource; configured: boolean; capabilities: { search: boolean; collections: boolean; updates: boolean }; dailyLimit: number | null };
export type ImportSourceCheck = { source: ImportSource; configured: boolean; checkedAt: string; latencyMs: number; ok: boolean; error: string | null; cached: boolean };
export type ImportRecord = {
	ref: ImportRef;
	identities: { provider: string; externalId: string; entityType: ImportMediaType }[];
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	runtimeMinutes: number | null;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	genres: string[];
	countries: string[];
	posterUrl: string | null;
	backdropUrl: string | null;
	logoUrl: string | null;
	galleryUrls: string[];
	trailerYoutubeKey: string | null;
	ratings: { source: string; value: number; votes: number | null }[];
	ageRating: string | null;
	credits: { externalId: string | null; source: ImportSource; name: string; role: string; character: string | null; imageUrl: string | null }[];
	companies: { externalId: string | null; source: ImportSource; name: string; imageUrl: string | null }[];
	collections: { externalId: string; source: ImportSource; name: string; description?: string | null; imageUrl?: string | null }[];
	seasons: { seasonNumber: number; title: string; episodeCount?: number | null; episodes: { episodeNumber: number; title: string }[] }[];
	players: { source: 'alloha' | 'collaps'; externalId: string; quality: string | null; translations: { id: string; name: string }[] }[];
	complete: boolean;
	warnings: string[];
};
export type ImportField = typeof importerFields[number];
export type ImportFilters = { mediaTypes?: ImportMediaType[]; kinds?: ('movie' | 'series' | 'anime' | 'animation')[]; yearFrom?: number; yearTo?: number; genres?: string[]; countries?: string[]; ratingMin?: number };
export type ImportOptions = { sources?: ImportSource[]; fields?: ImportField[]; fieldSources?: Partial<Record<ImportField, ImportSource>>; filters?: ImportFilters; artwork?: 'remote' | 'local-webp' };
export type ImportSelection = { sources: ImportSource[]; fields: ImportField[]; fieldSources: Partial<Record<ImportField, ImportSource | ''>>; artwork: 'remote' | 'local-webp'; filters: { mediaTypes: ImportMediaType[]; kinds: NonNullable<ImportFilters['kinds']>; yearFrom: string; yearTo: string; genres: string; countries: string; ratingMin: string } };
export type ImportPreview = { record: ImportRecord; workId: string | null; changes: { field: string; before: unknown; after: unknown; protected: boolean; selected?: boolean }[]; warnings: string[]; locks?: string[]; options?: ImportOptions; matchesFilters?: boolean };
export type ImportWorkState = { workId: string; title: string; locks: string[]; fields: { field: string; source: string | null; editorial: boolean }[] };
export type ImportRun = { id: string; state: string; mode: 'import' | 'sync' | 'availability'; createdAt: string; updatedAt: string; total: number; completed: number; failed: number; error: string | null; profileId: string | null };
export type ImportRunItem = { id: string; position: number; state: string; ref: ImportRef; workId: string | null; error: string | null; warnings: string[] };
export type TaxonomyType = 'person' | 'studio' | 'genre' | 'category' | 'collection';
export type TaxonomyEntry = { id: string; type: TaxonomyType; slug: string; name: string; description: string | null; imageUrl: string | null; parentId: string | null; externalIds?: Record<string, unknown>; data?: Record<string, unknown> };
export type TaxonomyWork = { id: string; slug: string; title: string; originalTitle?: string | null; releaseYear: number | null; posterPath: string | null; kind: string; role?: string | null; character?: string | null; position?: number };
export type ImportProfile = { id: string; name: string; enabled: boolean; source: ImportSource; mode: 'metadata' | 'availability' | 'collection' | 'discovery'; intervalMinutes: number; collectionId: string | null; lockedFields: string[]; categoryIds: string[]; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null; options?: ImportOptions };

export const importerSources: ImportSource[] = ['tmdb', 'kinopoisk', 'alloha', 'collaps'];
export const importerFields = ['title', 'originalTitle', 'description', 'releaseYear', 'runtimeMinutes', 'kind', 'genres', 'countries', 'posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'ratings', 'ageRating', 'credits', 'companies', 'collections', 'seasons', 'players'] as const;
export const taxonomyTypes: TaxonomyType[] = ['person', 'studio', 'genre', 'category', 'collection'];

export const importerFieldGroups: { id: string; fields: ImportField[] }[] = [
	{ id: 'metadata', fields: ['title', 'originalTitle', 'description', 'releaseYear', 'runtimeMinutes', 'kind', 'genres', 'countries', 'ratings', 'ageRating'] },
	{ id: 'artwork', fields: ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey'] },
	{ id: 'directories', fields: ['credits', 'companies', 'collections'] },
	{ id: 'playback', fields: ['seasons', 'players'] },
];

export function importerGroupLabel(group: string): string {
	return ({ metadata: i18n.ts.zalip._importer.metadata, artwork: i18n.ts.zalip._importer.artworkGroup, directories: i18n.ts.zalip._importer.directories, playback: i18n.ts.zalip._importer.playbackGroup } as Record<string, string>)[group] ?? group;
}

/** Omitted settings use defaults; explicit empty selections remain empty. */
export function importerSelection(options?: ImportOptions): ImportSelection {
	const sources = options?.sources;
	const fields = options?.fields;
	return {
		sources: sources ? importerSources.filter(source => sources.includes(source)) : [...importerSources],
		fields: fields ? importerFields.filter(field => fields.includes(field)) : [...importerFields],
		fieldSources: { ...Object.fromEntries(importerFields.map(field => [field, ''])), ...Object.fromEntries(Object.entries(options?.fieldSources ?? {}).filter(([field, source]) => importerFields.includes(field as ImportField) && importerSources.includes(source))) },
		artwork: options?.artwork === 'local-webp' ? 'local-webp' : 'remote',
		filters: { mediaTypes: [...options?.filters?.mediaTypes ?? []], kinds: [...options?.filters?.kinds ?? []], yearFrom: options?.filters?.yearFrom == null ? '' : String(options.filters.yearFrom), yearTo: options?.filters?.yearTo == null ? '' : String(options.filters.yearTo), genres: options?.filters?.genres?.join(', ') ?? '', countries: options?.filters?.countries?.join(', ') ?? '', ratingMin: options?.filters?.ratingMin == null ? '' : String(options.filters.ratingMin) },
	};
}

/** Snapshot form settings so changing controls cannot mutate an already submitted request. */
export function importerOptions(selection: ImportSelection): ImportOptions {
	const filterForm = selection.filters;
	const list = (value: string): string[] => [...new Set(value.split(',').map(item => item.trim().replace(/\s+/gu, ' ')).filter(Boolean))];
	const filters: ImportFilters = {
		...(filterForm.mediaTypes.length ? { mediaTypes: [...filterForm.mediaTypes] } : {}),
		...(filterForm.kinds.length ? { kinds: [...filterForm.kinds] } : {}),
		...(filterForm.yearFrom !== '' ? { yearFrom: Number(filterForm.yearFrom) } : {}),
		...(filterForm.yearTo !== '' ? { yearTo: Number(filterForm.yearTo) } : {}),
		...(list(filterForm.genres).length ? { genres: list(filterForm.genres) } : {}),
		...(list(filterForm.countries).length ? { countries: list(filterForm.countries) } : {}),
		...(filterForm.ratingMin !== '' ? { ratingMin: Number(filterForm.ratingMin) } : {}),
	};
	return {
		sources: importerSources.filter(source => selection.sources.includes(source)),
		fields: importerFields.filter(field => selection.fields.includes(field)),
		fieldSources: Object.fromEntries(Object.entries(selection.fieldSources).filter(([field, source]) => importerFields.includes(field as ImportField) && importerSources.includes(source as ImportSource))),
		artwork: selection.artwork,
		...(Object.keys(filters).length ? { filters } : {}),
	};
}

export function importerFiltersValid(selection: ImportSelection): boolean {
	const { yearFrom, yearTo, ratingMin } = selection.filters;
	const boundedList = (value: string): boolean => { const entries = [...new Set(value.split(',').map(item => item.trim().replace(/\s+/gu, ' ')).filter(Boolean))]; return entries.length <= 50 && entries.every(item => item.length <= 100); };
	return [yearFrom, yearTo].every(value => value === '' || (Number.isInteger(Number(value)) && Number(value) >= 1888 && Number(value) <= 3000)) && (yearFrom === '' || yearTo === '' || Number(yearFrom) <= Number(yearTo)) && (ratingMin === '' || (Number.isFinite(Number(ratingMin)) && Number(ratingMin) >= 0 && Number(ratingMin) <= 10)) && boundedList(selection.filters.genres) && boundedList(selection.filters.countries);
}

export function importerWorkIds(value: string): string[] | null {
	const ids = [...new Set(value.split(/[\s,]+/u).map(id => id.trim()).filter(Boolean))];
	return ids.length > 0 && ids.length <= 100 && ids.every(id => /^[a-zA-Z0-9]{1,32}$/u.test(id)) ? ids : null;
}

/** Public profiles never render arbitrary imported data keys or executable links. */
export function taxonomyFacts(data: Record<string, unknown> | undefined): { key: string; value: string; href?: string }[] {
	const facts: { key: string; value: string; href?: string }[] = [];
	for (const key of ['originalName', 'birthday', 'deathday', 'placeOfBirth', 'aliases', 'homepage']) {
		const raw = data?.[key];
		const value = key === 'aliases' && Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string').join(', ') : typeof raw === 'string' ? raw.trim() : '';
		if (!value) continue;
		if (key !== 'homepage') { facts.push({ key, value }); continue; }
		try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) facts.push({ key, value: url.hostname, href: url.href }); } catch { /* Untrusted links are omitted. */ }
	}
	return facts;
}

export function taxonomyFactLabel(key: string): string {
	return ({ biography: i18n.ts.zalip._importer.biography, originalName: i18n.ts.zalip._importer.originalName, birthday: i18n.ts.zalip._importer.birthday, deathday: i18n.ts.zalip._importer.deathday, placeOfBirth: i18n.ts.zalip._importer.placeOfBirth, aliases: i18n.ts.zalip._importer.aliases, homepage: i18n.ts.zalip._importer.homepage } as Record<string, string>)[key] ?? key;
}

/** Submit only edited facts: sending untouched facts would create editorial locks. */
export function taxonomyPersonChanges(form: Record<'originalName' | 'birthday' | 'deathday' | 'placeOfBirth' | 'homepage' | 'biography' | 'aliases', string>, original: Record<string, unknown>): Record<string, string | string[] | null> {
	const changes: Record<string, string | string[] | null> = {};
	for (const key of ['originalName', 'birthday', 'deathday', 'placeOfBirth', 'homepage', 'biography', 'aliases'] as const) {
		const current = key === 'aliases' ? [...new Set(form.aliases.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))] : form[key].trim() || null;
		const previous = key === 'aliases' ? Array.isArray(original.aliases) ? original.aliases.filter((value): value is string => typeof value === 'string') : [] : typeof original[key] === 'string' ? (original[key] as string).trim() || null : null;
		if (JSON.stringify(current) !== JSON.stringify(previous)) changes[key] = current;
	}
	return changes;
}

/** Fact-only saves must not also freeze untouched imported descriptions or artwork. */
export function taxonomyBaseChanges(form: { slug: string; description: string; imageUrl: string; parentId: string }, original: Pick<TaxonomyEntry, 'slug' | 'description' | 'imageUrl' | 'parentId'> | null): { slug?: string; description?: string | null; imageUrl?: string | null; parentId?: string | null } {
	const changes: { slug?: string; description?: string | null; imageUrl?: string | null; parentId?: string | null } = {};
	if (form.slug.trim() && form.slug.trim() !== original?.slug) changes.slug = form.slug.trim();
	for (const key of ['description', 'imageUrl', 'parentId'] as const) {
		const value = form[key].trim() || null;
		if (!original || value !== (original[key]?.trim() || null)) changes[key] = value;
	}
	return changes;
}

export function importerSourceLabel(source: ImportSource): string {
	return ({ tmdb: 'TMDB', kinopoisk: i18n.ts.zalip._importer.sourceKinopoisk, alloha: 'Alloha', collaps: 'Collaps' })[source];
}

export function importerFieldLabel(field: string): string {
	return ({ title: i18n.ts.zalip._importer.name, originalTitle: i18n.ts.zalip._importer.originalTitle, description: i18n.ts.zalip._importer.description, releaseYear: i18n.ts.zalip._importer.year, runtimeMinutes: i18n.ts.zalip._importer.runtime, kind: i18n.ts.zalip._importer.type, genres: i18n.ts.zalip._importer.genres, countries: i18n.ts.zalip._importer.countries, posterUrl: i18n.ts.zalip._importer.poster, backdropUrl: i18n.ts.zalip._importer.backdrop, logoUrl: i18n.ts.zalip._importer.logo, galleryUrls: i18n.ts.zalip._importer.gallery, trailerYoutubeKey: i18n.ts.zalip._importer.trailer, ratings: i18n.ts.zalip._importer.ratings, ageRating: i18n.ts.zalip._importer.ageRating, credits: i18n.ts.zalip._importer.people, companies: i18n.ts.zalip._importer.studios, collections: i18n.ts.zalip._importer.collections, seasons: i18n.ts.zalip._importer.seasonsAndEpisodes, players: i18n.ts.zalip._importer.players } as Record<string, string>)[field] ?? field;
}

/** Translate closed warning codes only; never expose raw provider text, URLs or credentials. */
export function importerWarningLabel(value: unknown): string {
	if (typeof value !== 'string') return i18n.ts.zalip._importer.warningGeneric;
	const artwork = /^artwork-local-unavailable:(posterUrl|backdropUrl|logoUrl|galleryUrls)$/u.exec(value);
	if (artwork) return i18n.tsx.zalip._importer.warningArtworkLocal({ field: importerFieldLabel(artwork[1]) });
	const provider = /^(tmdb|kinopoisk|alloha|collaps):(not-configured|not-found|quota-exceeded|rate-limited|upstream-failure|invalid-ref|unsupported|malformed-response|NO_SUCH_WORK|IMPORT_IDENTITY_CONFLICT|IMPORT_INVALID_RECORD|ZALIP_CATALOG_ENTRY_NOT_FOUND|import-failed)$/u.exec(value);
	if (provider) {
		const reason = ({ 'not-configured': i18n.ts.zalip._importer.errorConfiguration, 'not-found': i18n.ts.zalip._importer.errorNotFound, 'quota-exceeded': i18n.ts.zalip._importer.errorQuota, 'rate-limited': i18n.ts.zalip._importer.errorQuota, 'IMPORT_IDENTITY_CONFLICT': i18n.ts.zalip._importer.errorConflict } as Record<string, string>)[provider[2]] ?? i18n.ts.zalip._importer.warningSourceUnavailable;
		return i18n.tsx.zalip._importer.warningSource({ source: importerSourceLabel(provider[1] as ImportSource), reason });
	}
	const metadata = /^(tmdb|kinopoisk|collaps)-metadata-partial$/u.exec(value);
	if (metadata) return i18n.tsx.zalip._importer.warningMetadataPartial({ source: importerSourceLabel(metadata[1] as ImportSource) });
	const limit = /^(tmdb|kinopoisk|collaps)-(season|episode)-limit$/u.exec(value);
	if (limit) return i18n.tsx.zalip._importer.warningEpisodeLimit({ source: importerSourceLabel(limit[1] as ImportSource) });
	const season = /^tmdb-season-(\d{1,4})-unavailable$/u.exec(value);
	if (season) return i18n.tsx.zalip._importer.warningSeasonUnavailable({ number: String(Number(season[1])) });
	if (value === 'tmdb-seasons-unavailable') return i18n.ts.zalip._importer.warningSeasonsUnavailable;
	if (value === 'kinopoisk-artwork-unavailable') return i18n.ts.zalip._importer.warningKinopoiskArtwork;
	const player = /^(alloha|collaps)-player-url-rejected$/u.exec(value);
	if (player) return i18n.tsx.zalip._importer.warningPlayerRejected({ source: importerSourceLabel(player[1] as ImportSource) });
	return i18n.ts.zalip._importer.warningGeneric;
}

/** Old jobs have no warnings. Bound/deduplicate presentation without dropping nonfatal warnings. */
export function importerWarningLabels(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.slice(0, 50).map(importerWarningLabel))];
}

export function taxonomyTypeLabel(type: TaxonomyType): string {
	return ({ person: i18n.ts.zalip._importer.people, studio: i18n.ts.zalip._importer.studios, genre: i18n.ts.zalip._importer.genres, category: i18n.ts.zalip._importer.categories, collection: i18n.ts.zalip._importer.collections })[type];
}

export function importerStateLabel(state: string): string {
	return ({ queued: i18n.ts.zalip._importer.queued, pending: i18n.ts.zalip._importer.pending, running: i18n.ts.zalip._importer.running, paused: i18n.ts.zalip._importer.paused, completed: i18n.ts.zalip._importer.completed, failed: i18n.ts.zalip._importer.failed, cancelled: i18n.ts.zalip._importer.cancelled, canceled: i18n.ts.zalip._importer.cancelled, skipped: i18n.ts.zalip._importer.skipped, succeeded: i18n.ts.zalip._importer.succeeded } as Record<string, string>)[state] ?? state;
}

export function importerReferenceKey(ref: ImportRef): string {
	return `${ref.source}:${ref.mediaType}:${ref.externalId}`;
}

export function importerImdbId(value: string): string | null {
	const trimmed = value.trim();
	if (/^tt[0-9]{5,12}$/u.test(trimmed)) return trimmed;
	try {
		const url = new URL(trimmed);
		if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !['imdb.com', 'www.imdb.com'].includes(url.hostname)) return null;
		return /^\/title\/(tt[0-9]{5,12})(?:\/|$)/u.exec(url.pathname)?.[1] ?? null;
	} catch { return null; }
}

/** URLs are accepted only for the explicitly supported providers and converted to IDs. */
export function importerReference(source: ImportSource, mediaType: ImportMediaType, value: string): ImportRef | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const imdbId = importerImdbId(trimmed) ?? /^imdb:(tt[0-9]{5,12})$/u.exec(trimmed)?.[1];
	if (imdbId) return source === 'alloha' ? null : { source, mediaType, externalId: `imdb:${imdbId}` };
	if (!trimmed.includes('://')) {
		if (!/^(?:[1-9][0-9]{0,15}|tmdb:(?:movie|tv):[1-9][0-9]{0,15})$/.test(trimmed)) return null;
		const namespace = /^tmdb:(movie|tv):/.exec(trimmed);
		return { source, mediaType: namespace ? namespace[1] as ImportMediaType : mediaType, externalId: trimmed };
	}
	try {
		const url = new URL(trimmed);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
		if (source === 'tmdb' && ['themoviedb.org', 'www.themoviedb.org'].includes(url.hostname)) {
			const match = /^\/(movie|tv)\/([1-9][0-9]{0,15})(?:-|\/|$)/.exec(url.pathname);
			return match ? { source, mediaType: match[1] as ImportMediaType, externalId: match[2] } : null;
		}
		if (source === 'kinopoisk' && ['kinopoisk.ru', 'www.kinopoisk.ru'].includes(url.hostname)) {
			const match = /^\/(film|series)\/([1-9][0-9]{0,15})(?:\/|$)/.exec(url.pathname);
			return match ? { source, mediaType: match[1] === 'series' ? 'tv' : 'movie', externalId: match[2] } : null;
		}
		return null;
	} catch {
		return null;
	}
}

/** Keep one reference per line: commas can be part of a provider URL. */
export function splitImporterReferenceLines(value: string): string[] {
	return Array.from(new Set(value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)));
}

/** Provider images are either TMDB paths or public HTTP(S) URLs, never executable URLs. */
export function importerImageUrl(value: string | null | undefined, size = 'w500'): string | null {
	if (!value) return null;
	if (/^\/[a-zA-Z0-9._/-]+$/.test(value) && !value.startsWith('//') && !value.includes('..')) {
		return `https://image.tmdb.org/t/p/${size}${value}`;
	}
	try {
		const url = new URL(value);
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
		return url.href;
	} catch {
		return null;
	}
}

/** Diff values are plain text. Do not render untrusted provider text as HTML. */
export function formatImporterValue(value: unknown): string {
	if (value == null || value === '') return '—';
	if (Array.isArray(value)) return value.length ? value.map(formatImporterValue).join(', ') : '—';
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

export function importerProgress(completed: number, total: number): number {
	if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(completed)) return 0;
	return Math.min(100, Math.max(0, completed / total * 100));
}
