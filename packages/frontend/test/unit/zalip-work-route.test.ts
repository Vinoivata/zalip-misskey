/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { zalipEpisodeQuery, zalipWorkRoute } from '@/utility/zalip-work-route.js';

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
