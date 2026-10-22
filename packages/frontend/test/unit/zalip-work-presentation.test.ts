/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { zalipAgeRatingLabel, zalipWorkMediaType } from '@/utility/zalip-work-presentation.js';

describe('title metadata presentation', () => {
	it.each([['age0', '0+'], ['age6', '6+'], ['age12', '12+'], ['age16', '16+'], [' AGE18 ', '18+'], ['TV-MA', 'TV-MA'], ['18+', '18+'], ['PG-13', 'PG-13'], ['', null], [null, null], [undefined, null]])('formats %s as %s without replacing other rating systems', (input, expected) => {
		expect(zalipAgeRatingLabel(input)).toBe(expected);
	});

	it.each(['anime', 'animation'])('uses a confirmed movie identity for a standalone %s, never its artistic kind alone', kind => {
		expect(zalipWorkMediaType({ kind, mediaType: 'movie', seasons: [] })).toBe('movie');
		expect(zalipWorkMediaType({ kind, mediaType: 'tv', seasons: [] })).toBe('tv');
		expect(zalipWorkMediaType({ kind, mediaType: null, seasons: [] })).toBeNull();
		expect(zalipWorkMediaType({ kind, seasons: [] })).toBeNull();
		expect(zalipWorkMediaType({ kind, mediaType: 'movie', seasons: [{}] })).toBe('tv');
	});

	it('retains legacy definite movie/series kinds and rejects a movie hint on a known series', () => {
		expect(zalipWorkMediaType({ kind: 'movie', seasons: [] })).toBe('movie');
		expect(zalipWorkMediaType({ kind: 'series', seasons: [] })).toBe('tv');
		expect(zalipWorkMediaType({ kind: 'series', mediaType: 'movie', seasons: [] })).toBe('tv');
		expect(zalipWorkMediaType({ kind: 'movie', mediaType: 'tv', seasons: [] })).toBe('tv');
		expect(zalipWorkMediaType(null)).toBeNull();
	});
});
