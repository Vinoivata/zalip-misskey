/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { importArtworkUrl } from './artwork.js';

export const artworkLocalizationKinds = ['work', 'season', 'episode', 'catalog'] as const;
export type ArtworkLocalizationKind = typeof artworkLocalizationKinds[number];
export const artworkLocalizationFields = ['posterPath', 'backdropPath', 'logoPath', 'galleryPaths', 'stillPath', 'imageUrl'] as const;
export type ArtworkLocalizationField = typeof artworkLocalizationFields[number];
export type ArtworkLocalizationValue = string | string[] | null;
export const artworkLocalizationRoleFields: Record<ArtworkLocalizationKind, readonly ArtworkLocalizationField[]> = {
	work: ['posterPath', 'backdropPath', 'logoPath', 'galleryPaths'], season: ['posterPath'], episode: ['stillPath'], catalog: ['imageUrl'],
};

export function artworkLocalizationRevision(kind: ArtworkLocalizationKind, id: string, field: ArtworkLocalizationField, value: ArtworkLocalizationValue): string {
	return createHash('sha256').update(JSON.stringify([1, kind, id, field, value])).digest('hex');
}

/** A bare TMDB basename is interpreted only when the owning record has a stable TMDB identity. */
export function existingArtworkSource(value: string, tmdbOwned: boolean): URL | null {
	if (tmdbOwned && /^\/[A-Za-z0-9._-]{1,256}$/u.test(value)) return importArtworkUrl(`https://image.tmdb.org/t/p/original${value}`);
	return importArtworkUrl(value);
}

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Preserve every editorial lock/source and never claim an importer baseline belonging to a different image. */
export function localizeArtworkOwnership(kind: ArtworkLocalizationKind, metadata: Record<string, unknown>, field: ArtworkLocalizationField, before: ArtworkLocalizationValue, after: ArtworkLocalizationValue): Record<string, unknown> {
	const same = (value: unknown) => JSON.stringify(value) === JSON.stringify(before);
	if (kind === 'work') {
		const names = { posterPath: 'posterUrl', backdropPath: 'backdropUrl', logoPath: 'logoUrl', galleryPaths: 'galleryUrls' } as const;
		const key = names[field as keyof typeof names];
		const values = { ...object(metadata.values) };
		if (Object.hasOwn(values, key) && same(values[key])) values[key] = structuredClone(after);
		return { ...metadata, ...(Object.hasOwn(metadata, 'values') ? { values } : {}), localArtwork: { ...object(metadata.localArtwork), [key]: structuredClone(after) } };
	}
	if (kind === 'catalog') {
		const editorial = object(metadata._zalip);
		return { ...metadata, _zalip: { ...editorial, localArtwork: { ...object(editorial.localArtwork), imageUrl: after } } };
	}
	return { ...metadata, ...(Object.hasOwn(metadata, field) && same(metadata[field]) ? { [field]: after } : {}), _zalipLocalArtwork: { ...object(metadata._zalipLocalArtwork), [field]: after } };
}
