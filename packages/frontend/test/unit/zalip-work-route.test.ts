/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { parseZalipWatchQuery, zalipEpisodeQuery, zalipWatchRoute, zalipWorkRoute } from '@/utility/zalip-work-route.js';

describe('Zalip release navigation', () => {
	it('links to an exact episode, retaining season-zero specials', () => {
		expect(zalipWorkRoute('show', 2, 7)).toBe('/zalip/show?season=2&episode=7');
		expect(zalipWorkRoute('show', 0, 1)).toBe('/zalip/show?season=0&episode=1');
		expect(zalipWorkRoute('show', 0, 0)).toBe('/zalip/show?season=0&episode=0');
	});

	it('links movie releases and invalid episode numbers to the title', () => {
		expect(zalipWorkRoute('a/b', null, null)).toBe('/zalip/a%2Fb');
		expect(zalipWorkRoute('show', 1, -1)).toBe('/zalip/show');
		expect(zalipWorkRoute('show', -1, 2)).toBe('/zalip/show');
	});

	it.each(['-1', '2x', '2.5', '1e2', '', '999999999', undefined])('rejects malformed query numbers %s', value => {
		expect(zalipEpisodeQuery(value, 0)).toBeNull();
	});

	it('accepts only appropriate season and episode ranges', () => {
		expect(zalipEpisodeQuery('0', 0)).toBe(0);
		expect(zalipEpisodeQuery('0', 1)).toBeNull();
		expect(zalipEpisodeQuery('12', 1)).toBe(12);
	});
});

describe('dedicated playback navigation shared by client and push notifications', () => {
	it('keeps the information page separate from exact episode and movie playback', () => {
		expect(zalipWorkRoute('a/b')).toBe('/zalip/a%2Fb');
		expect(zalipWatchRoute('a/b', 0, 0)).toBe('/zalip/a%2Fb/watch?season=0&episode=0');
		expect(zalipWatchRoute('movie', null, null)).toBe('/zalip/movie/watch');
	});

	it('retains the exact provider and voice without adding offsets or autoplay', () => {
		const route = zalipWatchRoute('show', 2, 7, 'collaps', 'Voice + / original');
		expect(route).toBe('/zalip/show/watch?season=2&episode=7&provider=collaps&translation=Voice+%2B+%2F+original');
		expect(parseZalipWatchQuery(route)).toEqual({ initialSeason: '2', initialEpisode: '7', initialProvider: 'collaps', initialTranslation: 'Voice + / original' });
		expect(route).not.toMatch(/autoplay|offset|time|position/);
		expect(zalipWatchRoute('movie', null, null, 'alloha')).toBe('/zalip/movie/watch?provider=alloha');
	});

	it.each([['0', '0'], ['2x', '4'], ['-1', '3'], ['1e2', '2.5'], ['', '999999999']])('preserves raw selectors %s/%s for the view to reject explicitly', (season, episode) => {
		expect(parseZalipWatchQuery(`/zalip/show/watch?season=${season}&episode=${episode}`)).toMatchObject({ initialSeason: season, initialEpisode: episode });
	});

	it('does not silently accept duplicate numeric selectors or a partial episode', () => {
		expect(parseZalipWatchQuery('/zalip/show/watch?season=2&season=3&episode=4').initialSeason).toBe('2,3');
		expect(parseZalipWatchQuery('/zalip/show/watch?episode=4')).toMatchObject({ initialSeason: undefined, initialEpisode: '4' });
	});

	it.each(['alloha', 'collaps', 'kodik', 'vibix'])('allows the known provider %s only', provider => {
		expect(parseZalipWatchQuery(`/zalip/show/watch?provider=${provider}`).initialProvider).toBe(provider);
	});

	it('ignores unknown and duplicate providers and unbounded or empty translation selectors', () => {
		expect(parseZalipWatchQuery('/zalip/show/watch?provider=https://attacker.invalid&translation=').initialProvider).toBeUndefined();
		expect(parseZalipWatchQuery('/zalip/show/watch?provider=alloha&provider=kodik').initialProvider).toBeUndefined();
		expect(parseZalipWatchQuery(`/zalip/show/watch?translation=${'x'.repeat(101)}`).initialTranslation).toBeUndefined();
		expect(parseZalipWatchQuery(`/zalip/show/watch?translation=${'x'.repeat(100)}`).initialTranslation).toHaveLength(100);
		expect(parseZalipWatchQuery('/zalip/show/watch?translation=a&translation=b').initialTranslation).toBeUndefined();
		expect(parseZalipWatchQuery('/zalip/show/watch?translation=%0A').initialTranslation).toBeUndefined();
		expect(zalipWatchRoute('show', 1, 2, 'unknown', 'unscoped')).toBe('/zalip/show/watch?season=1&episode=2');
	});

	it('reads the route query before its fragment and discards playback commands', () => {
		expect(parseZalipWatchQuery('/zalip/show/watch?season=0&episode=3&offset=120&autoplay=1#discussion')).toEqual({ initialSeason: '0', initialEpisode: '3', initialProvider: undefined, initialTranslation: undefined });
		expect(parseZalipWatchQuery('/zalip/show/watch#discussion?season=2')).toEqual({});
		expect(parseZalipWatchQuery('/zalip/movie/watch')).toEqual({});
	});

	it('never coerces malformed coordinates from a push payload into an episode route', () => {
		expect(zalipWatchRoute('show', '1' as unknown as number, '2' as unknown as number)).toBe('/zalip/show/watch');
		expect(zalipWatchRoute('show', -1, 2)).toBe('/zalip/show/watch');
		expect(zalipWatchRoute('show', 1, Number.NaN)).toBe('/zalip/show/watch');
		expect(zalipWatchRoute('show', 1, 100_000_000)).toBe('/zalip/show/watch');
	});
});
