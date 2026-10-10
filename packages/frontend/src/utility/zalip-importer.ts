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
export type ImportPreview = { record: ImportRecord; workId: string | null; changes: { field: string; before: unknown; after: unknown; protected: boolean }[]; warnings: string[] };
export type ImportRun = { id: string; state: string; mode: 'import' | 'sync' | 'availability'; createdAt: string; updatedAt: string; total: number; completed: number; failed: number; error: string | null; profileId: string | null };
export type ImportRunItem = { id: string; position: number; state: string; ref: ImportRef; workId: string | null; error: string | null };
export type TaxonomyType = 'person' | 'studio' | 'genre' | 'category' | 'collection';
export type TaxonomyEntry = { id: string; type: TaxonomyType; slug: string; name: string; description: string | null; imageUrl: string | null; parentId: string | null; externalIds?: Record<string, unknown>; data?: Record<string, unknown> };
export type TaxonomyWork = { id: string; slug: string; title: string; originalTitle?: string | null; releaseYear: number | null; posterPath: string | null; kind: string; role?: string | null; character?: string | null; position?: number };
export type ImportProfile = { id: string; name: string; enabled: boolean; source: ImportSource; mode: 'metadata' | 'availability' | 'collection'; intervalMinutes: number; collectionId: string | null; lockedFields: string[]; categoryIds: string[]; lastRunAt: string | null; nextRunAt: string | null; lastError: string | null };

export const importerSources: ImportSource[] = ['tmdb', 'kinopoisk', 'alloha', 'collaps'];
export const importerFields = ['title', 'originalTitle', 'description', 'releaseYear', 'runtimeMinutes', 'kind', 'genres', 'countries', 'posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'ratings', 'ageRating', 'credits', 'companies', 'collections', 'seasons', 'players'] as const;
export const taxonomyTypes: TaxonomyType[] = ['person', 'studio', 'genre', 'category', 'collection'];

export function importerSourceLabel(source: ImportSource): string {
	return ({ tmdb: 'TMDB', kinopoisk: i18n.ts.zalip._importer.sourceKinopoisk, alloha: 'Alloha', collaps: 'Collaps' })[source];
}

export function importerFieldLabel(field: string): string {
	return ({ title: i18n.ts.zalip._importer.name, originalTitle: i18n.ts.zalip._importer.originalTitle, description: i18n.ts.zalip._importer.description, releaseYear: i18n.ts.zalip._importer.year, runtimeMinutes: i18n.ts.zalip._importer.runtime, kind: i18n.ts.zalip._importer.type, genres: i18n.ts.zalip._importer.genres, countries: i18n.ts.zalip._importer.countries, posterUrl: i18n.ts.zalip._importer.poster, backdropUrl: i18n.ts.zalip._importer.backdrop, logoUrl: i18n.ts.zalip._importer.logo, galleryUrls: i18n.ts.zalip._importer.gallery, trailerYoutubeKey: i18n.ts.zalip._importer.trailer, ratings: i18n.ts.zalip._importer.ratings, ageRating: i18n.ts.zalip._importer.ageRating, credits: i18n.ts.zalip._importer.people, companies: i18n.ts.zalip._importer.studios, collections: i18n.ts.zalip._importer.collections, seasons: i18n.ts.zalip._importer.seasonsAndEpisodes, players: i18n.ts.zalip._importer.players } as Record<string, string>)[field] ?? field;
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

/** URLs are accepted only for the explicitly supported providers and converted to IDs. */
export function importerReference(source: ImportSource, mediaType: ImportMediaType, value: string): ImportRef | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
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
