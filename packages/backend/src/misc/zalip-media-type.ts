/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type ZalipMediaType = 'movie' | 'tv';

/** Verified serial evidence wins; an uncached anime is not necessarily a feature. */
export function zalipMediaType(
	work: { kind: string; tmdbMediaType?: string | null },
	identities: ReadonlyArray<{ entityType: string }>,
	hasSeasons: boolean,
): ZalipMediaType | null {
	if (work.kind === 'series' || work.tmdbMediaType === 'tv' || hasSeasons || identities.some(identity => identity.entityType === 'tv')) return 'tv';
	if (work.kind === 'movie' || work.tmdbMediaType === 'movie' || identities.some(identity => identity.entityType === 'movie')) return 'movie';
	return null;
}
