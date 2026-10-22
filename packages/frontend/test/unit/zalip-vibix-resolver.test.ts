/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { resolveVibixPlaybackEmbed } from '@/utility/zalip-vibix-resolver.js';
import { vibixPlayerDocument, vibixPlayerSandbox } from '@/utility/zalip-vibix-player.js';
import { playbackEpisodeAvailable, type PlaybackSource } from '@/utility/zalip-playback.js';

const parent = { publisherId: '10', type: 'series' as const, id: '30' };

function source(): PlaybackSource {
	return { source: 'vibix', label: 'Vibix', iframe: '', quality: null, vibixEmbed: parent, translations: [{ id: '5', name: 'First' }, { id: '6', name: 'Second' }], episodes: [], vibixEpisodeMap: { publisherId: '10', seriesId: '30', items: [{ seasonNumber: 1, episodeNumber: 1, translationId: '5', movieId: '701' }, { seasonNumber: 1, episodeNumber: 1, translationId: '6', movieId: '702' }, { seasonNumber: 1, episodeNumber: 2, translationId: '5', movieId: '703' }] } };
}

describe('Vibix exact SDK resource resolution', () => {
	test('selects distinct movie IDs per episode and voice, preserving the public publisher namespace', () => {
		for (const [voice, episode, id] of [['5', 1, '701'], ['6', 1, '702'], ['5', 2, '703']] as const) expect(resolveVibixPlaybackEmbed(source(), voice, 1, episode)).toEqual({ publisherId: '10', type: 'movie', id });
	});
	test('retains unknown legacy series coverage rather than disabling episodes or choosing a different voice', () => {
		expect(resolveVibixPlaybackEmbed(source(), '6', 1, 2)).toEqual(parent);
		expect(playbackEpisodeAvailable(source(), '6', 1, 2)).toBe(true);
		const legacy = source(); delete legacy.vibixEpisodeMap; expect(resolveVibixPlaybackEmbed(legacy, '5', 1, 1)).toEqual(parent);
		expect(resolveVibixPlaybackEmbed(source(), null, 1, 1)).toEqual(parent);
		expect(resolveVibixPlaybackEmbed(source(), '99', 1, 1)).toBeNull();
	});
	test('movie records retain their authoritative SDK movie ID and never use a serial map', () => {
		const movie = source(); movie.vibixEmbed = { ...parent, type: 'movie', id: '900' };
		expect(resolveVibixPlaybackEmbed(movie, '5', null, null)).toEqual(movie.vibixEmbed);
	});
	test('rejects poisoned, wrong-publisher, conflicting or excessive maps without invoking accessors', () => {
		const fixture = source(); const map = fixture.vibixEpisodeMap!; const item = map.items[0]; const getter = vi.fn(() => map.items);
		const accessor = Object.defineProperty({ publisherId: '10', seriesId: '30' }, 'items', { get: getter, enumerable: true });
		for (const value of [accessor, { ...map, publisherId: '11' }, { ...map, seriesId: '200' }, { ...map, token: 'bad' }, { ...map, items: [{ ...item, movieId: '<script>' }] }, { ...map, items: [item, { ...item, movieId: '999' }] }, { ...map, items: Array.from({ length: 1001 }, () => item) }]) expect(resolveVibixPlaybackEmbed({ ...fixture, vibixEpisodeMap: value as never }, '5', 1, 1)).toEqual(parent);
		expect(getter).not.toHaveBeenCalled();
	});
	test('resolved movie documents need no serial selectors and remain isolated, while fallback documents keep selectors', () => {
		const exact = resolveVibixPlaybackEmbed(source(), '5', 1, 1)!;
		const document = vibixPlayerDocument(exact, { seasonNumber: null, episodeNumber: null, translationId: '5' })!;
		expect(document).toContain('data-type="movie" data-id="701"'); expect(document).toContain('data-voiceover="5"'); expect(document).not.toContain('data-season=');
		const fallback = vibixPlayerDocument(resolveVibixPlaybackEmbed(source(), '6', 1, 2), { seasonNumber: 1, episodeNumber: 2, translationId: '6' })!;
		expect(fallback).toContain('data-type="series" data-id="30"'); expect(fallback).toContain('data-season="1" data-episodes="2"');
		expect(vibixPlayerSandbox).not.toContain('allow-same-origin');
	});
});
