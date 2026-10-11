/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ZalipCatalogEntryInput } from '@/misc/zalip-taxonomy.js';
import { createImportRequest, defaultImportTransport, ImportProviderError, pacedImportTransport, safeImportUrl, type ImportProviderConfig, type ImportTransport } from './providers.js';

export type ImportPersonSource = 'tmdb' | 'kinopoisk';

function object(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, limit = 256): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed ? trimmed.slice(0, limit) : null;
}

function date(value: unknown): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function externalId(value: unknown): string | null {
	const candidate = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
	return typeof candidate === 'string' && /^[1-9]\d{0,15}$/.test(candidate) ? candidate : null;
}

function url(value: unknown): string | null {
	const normalized = safeImportUrl(value);
	return normalized !== null && normalized.length <= 1024 ? normalized : null;
}

function aliases(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [...new Set(value.slice(0, 100).map(name => text(name)).filter((name): name is string => name !== null))].slice(0, 30);
}

function facts(data: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null && value !== undefined && (!Array.isArray(value) || value.length > 0)));
}

/** Fixed projection only; the upstream payload and its credentials are never persisted. */
export function normalizeTmdbPerson(value: unknown, fallback: unknown = {}): ZalipCatalogEntryInput {
	const person = object(value);
	const english = object(fallback);
	const id = externalId(person.id);
	const name = text(person.name) ?? text(english.name);
	if (id === null || name === null || (english.id !== undefined && externalId(english.id) !== id)) throw new ImportProviderError('malformed-response');
	const biography = text(person.biography, 16384) ?? text(english.biography, 16384);
	const profilePath = typeof person.profile_path === 'string' && /^\/[A-Za-z0-9._-]{1,256}$/.test(person.profile_path) ? person.profile_path : null;
	const imdbId = object(person.external_ids).imdb_id;
	return {
		type: 'person', name, externalIds: { tmdb: id, ...(typeof imdbId === 'string' && /^nm\d{1,16}$/.test(imdbId) ? { imdb: imdbId } : {}) },
		...(biography ? { description: biography.slice(0, 8192) } : {}),
		...(profilePath ? { imageUrl: `https://image.tmdb.org/t/p/w500${profilePath}` } : {}),
		data: facts({ biography, birthday: date(person.birthday), deathday: date(person.deathday), placeOfBirth: text(person.place_of_birth), homepage: url(person.homepage), originalName: text(english.name) ?? name, aliases: aliases([...aliases(person.also_known_as), ...aliases(english.also_known_as)]), identityQuality: 'verified' }),
	};
}

export function normalizeKinopoiskPerson(value: unknown): ZalipCatalogEntryInput {
	const person = object(value);
	const id = externalId(person.personId);
	const name = text(person.nameRu) ?? text(person.nameEn);
	if (id === null || name === null) throw new ImportProviderError('malformed-response');
	const biography = Array.isArray(person.facts) ? text(person.facts.slice(0, 100).map(fact => text(fact, 2048)).filter(Boolean).join('\n\n'), 16384) : null;
	const imageUrl = url(person.posterUrl);
	return {
		type: 'person', name, externalIds: { kinopoisk: id },
		...(biography ? { description: biography.slice(0, 8192) } : {}),
		...(imageUrl ? { imageUrl } : {}),
		data: facts({ biography, birthday: date(person.birthday), deathday: date(person.death), placeOfBirth: text(person.birthplace), homepage: url(person.webUrl), originalName: text(person.nameEn), identityQuality: 'verified' }),
	};
}

/** Known person ID only. Name-based matching can merge unrelated namesakes and is not used. */
export async function fetchImportedPerson(source: ImportPersonSource, id: string, config: Pick<ImportProviderConfig, 'tmdbApiKey' | 'kinopoiskApiKey'>, transport: ImportTransport = defaultImportTransport): Promise<ZalipCatalogEntryInput> {
	if (!['tmdb', 'kinopoisk'].includes(source) || externalId(id) !== id) throw new ImportProviderError('invalid-ref');
	const request = createImportRequest(source, source === 'tmdb' ? config.tmdbApiKey : config.kinopoiskApiKey, pacedImportTransport(transport));
	if (source === 'kinopoisk') {
		const result = normalizeKinopoiskPerson(await request(`/api/v1/staff/${id}`));
		if (result.externalIds?.kinopoisk !== id) throw new ImportProviderError('malformed-response');
		return result;
	}
	const localized = await request(`/3/person/${id}`, { language: 'ru-RU', append_to_response: 'external_ids' });
	if (externalId(object(localized).id) !== id) throw new ImportProviderError('malformed-response');
	// English is a bounded fallback for biography and canonical spelling, not an overwrite of Russian text.
	let english: unknown = {};
	try {
		english = await request(`/3/person/${id}`, { language: 'en-US' });
	} catch (error) {
		if (!(error instanceof ImportProviderError) || !['not-found', 'upstream-failure'].includes(error.code)) throw error;
	}
	return normalizeTmdbPerson(localized, english);
}
