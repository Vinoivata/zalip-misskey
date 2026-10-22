/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Kinopoisk's machine age keys are presentation aliases, not text for the title page. */
export function zalipAgeRatingLabel(value: string | null | undefined): string | null {
	const label = value?.trim();
	if (!label) return null;
	const age = /^age(0|6|12|16|18)$/iu.exec(label)?.[1];
	return age ? `${age}+` : label;
}

/** Artistic categories do not prove a movie/serial identity. A known serial always wins. */
export function zalipWorkMediaType(work: { kind: string; mediaType?: 'movie' | 'tv' | null; seasons: readonly unknown[] } | null): 'movie' | 'tv' | null {
	if (!work) return null;
	if (work.mediaType === 'tv' || work.kind === 'series' || work.seasons.length > 0) return 'tv';
	if (work.mediaType === 'movie' || work.kind === 'movie') return 'movie';
	return null;
}
