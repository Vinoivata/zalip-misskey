/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { getEpisodeProgress } from '../../src/utility/zalip-episode-progress.js';

describe('cumulative episode progress', () => {
	it('counts prior regular seasons, not specials', () => {
		expect(getEpisodeProgress([{ seasonNumber: 0, episodeCount: 3 }, { seasonNumber: 1, episodeCount: 10 }, { seasonNumber: 2, episodeCount: 8 }], 2, 4)).toBe(14);
	});
	it('allows first-season progress without an episode total', () => {
		expect(getEpisodeProgress([{ seasonNumber: 1, episodeCount: null }], 1, 3)).toBe(3);
	});
	it('does not invent missing prior season counts', () => {
		expect(getEpisodeProgress([{ seasonNumber: 1, episodeCount: null }, { seasonNumber: 2, episodeCount: 8 }], 2, 4)).toBeNull();
		expect(getEpisodeProgress([{ seasonNumber: 3, episodeCount: 8 }], 3, 4)).toBeNull();
	});
	it('rejects specials, absent selection and invalid numbers', () => {
		const seasons = [{ seasonNumber: 1, episodeCount: 10 }];
		expect(getEpisodeProgress(seasons, 0, 1)).toBeNull();
		expect(getEpisodeProgress(seasons, null, 1)).toBeNull();
		expect(getEpisodeProgress(seasons, 1, null)).toBeNull();
		expect(getEpisodeProgress(seasons, 1, NaN)).toBeNull();
		expect(getEpisodeProgress(seasons, 1, -1)).toBeNull();
		expect(getEpisodeProgress(seasons, 2, 1)).toBeNull();
	});
});
