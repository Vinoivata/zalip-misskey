/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** A release link selects its exact episode, including season zero specials, without autoplay. */
export function zalipWorkRoute(slug: string, season?: number | null, episode?: number | null): string {
	const path = `/zalip/${encodeURIComponent(slug)}`;
	if (!Number.isSafeInteger(season) || season == null || season < 0 || !Number.isSafeInteger(episode) || episode == null || episode < 0) return path;
	return `${path}?season=${season}&episode=${episode}`;
}

export function zalipEpisodeQuery(value: string | undefined, minimum: 0 | 1): number | null {
	if (value == null || !/^\d{1,8}$/.test(value)) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= minimum ? number : null;
}
