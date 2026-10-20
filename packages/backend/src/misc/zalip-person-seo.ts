/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { PackedZalipCatalogEntry } from '@/core/ZalipTaxonomyService.js';

function text(value: unknown, limit: number): string | null {
	return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/gu, ' ').slice(0, limit) : null;
}

function date(value: unknown): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00.000Z`);
	return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function imageUrl(value: string | null, origin: string): string | null {
	if (!value || value.length > 1024 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
	try {
		const url = value.startsWith('/') && !value.startsWith('//') ? new URL(value, origin) : new URL(value);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
	} catch {
		return null;
	}
}

/** Only an already-public catalogue projection is accepted; no raw provider/editorial JSON is emitted. */
export function zalipPersonSeo(entry: PackedZalipCatalogEntry, origin: string, instanceName: string) {
	if (entry.type !== 'person' || !entry.slug || entry.slug.length > 160) throw new Error('INVALID_PERSON_PAGE');
	const canonical = new URL(`/zalip/taxonomy/person/${encodeURIComponent(entry.slug)}`, origin).href;
	const biography = text(entry.data.biography, 200) ?? text(entry.description, 200) ?? entry.name;
	const image = imageUrl(entry.imageUrl, origin);
	const aliases = [...new Set([
		text(entry.data.originalName, 256),
		...(Array.isArray(entry.data.aliases) ? entry.data.aliases.slice(0, 30).map(alias => text(alias, 256)) : []),
	].filter((alias): alias is string => alias !== null && alias !== entry.name))];
	const birthDate = date(entry.data.birthday);
	const deathDate = date(entry.data.deathday);
	const birthPlace = text(entry.data.placeOfBirth, 256);
	const sameAs: string[] = [];
	if (/^[1-9]\d{0,15}$/u.test(entry.externalIds.tmdb ?? '')) sameAs.push(`https://www.themoviedb.org/person/${entry.externalIds.tmdb}`);
	if (/^[1-9]\d{0,15}$/u.test(entry.externalIds.kinopoisk ?? '')) sameAs.push(`https://www.kinopoisk.ru/name/${entry.externalIds.kinopoisk}/`);
	if (/^nm\d{1,16}$/u.test(entry.externalIds.imdb ?? '')) sameAs.push(`https://www.imdb.com/name/${entry.externalIds.imdb}/`);
	return {
		title: `${entry.name} | ${instanceName}`,
		description: biography,
		canonical,
		image,
		structuredData: {
			'@context': 'https://schema.org',
			'@type': 'Person',
			'@id': `${canonical}#person`,
			url: canonical,
			name: entry.name,
			description: biography,
			...(image ? { image } : {}),
			...(aliases.length ? { alternateName: aliases } : {}),
			...(birthDate ? { birthDate } : {}),
			...(deathDate && (!birthDate || deathDate >= birthDate) ? { deathDate } : {}),
			...(birthPlace ? { birthPlace: { '@type': 'Place', name: birthPlace } } : {}),
			...(sameAs.length ? { sameAs } : {}),
		},
	};
}
