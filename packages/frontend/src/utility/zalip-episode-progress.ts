/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Library progress is cumulative; episode numbers restart in each season. */
export function getEpisodeProgress(seasons: readonly { seasonNumber: number; episodeCount: number | null }[], seasonNumber: number | null, episodeNumber: number | null): number | null {
	if (seasonNumber == null || episodeNumber == null || !Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber) || seasonNumber < 1 || episodeNumber < 1) return null;
	if (!seasons.some(season => season.seasonNumber === seasonNumber)) return null;
	let progress = episodeNumber;
	for (let number = 1; number < seasonNumber; number++) {
		const count = seasons.find(season => season.seasonNumber === number)?.episodeCount;
		// Never guess progress when earlier season metadata is incomplete.
		if (count == null || !Number.isInteger(count) || count < 0) return null;
		progress += count;
	}
	return progress;
}
