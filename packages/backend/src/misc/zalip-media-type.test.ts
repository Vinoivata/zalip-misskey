/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { zalipMediaType } from './zalip-media-type.js';

describe('Zalip verified media type', () => {
	it.each(['movie', 'series', 'anime', 'animation'])('uses verified movie identities for %s without overriding serial evidence', kind => {
		const expected = kind === 'series' ? 'tv' : 'movie';
		expect(zalipMediaType({ kind, tmdbMediaType: 'movie' }, [], false)).toBe(expected);
		expect(zalipMediaType({ kind }, [{ entityType: 'movie' }], false)).toBe(expected);
		for (const serial of [
			{ work: { kind, tmdbMediaType: 'tv' }, identities: [], seasons: false },
			{ work: { kind }, identities: [{ entityType: 'movie' }, { entityType: 'tv' }], seasons: false },
			{ work: { kind, tmdbMediaType: 'movie' }, identities: [], seasons: true },
		]) expect(zalipMediaType(serial.work, serial.identities, serial.seasons)).toBe('tv');
	});

	it.each(['anime', 'animation'])('does not invent a movie timeline for unknown %s', kind => {
		expect(zalipMediaType({ kind }, [], false)).toBeNull();
	});

	it('retains legacy movie and series classifications', () => {
		expect(zalipMediaType({ kind: 'movie' }, [], false)).toBe('movie');
		expect(zalipMediaType({ kind: 'series' }, [], false)).toBe('tv');
	});
});
