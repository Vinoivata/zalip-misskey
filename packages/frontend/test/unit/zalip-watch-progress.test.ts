/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import type { ContinueWatchingItem, ProgressUpdate, ProgressUpdateResult } from '@/utility/zalip-watch-progress.js';
import { continueWatchingRoute, kodikResourceFingerprint, parseKodikEvent, sameWatchTarget, WatchProgressWriter, watchProgressPercent, watchTimeLabel } from '@/utility/zalip-watch-progress.js';

const source = {} as Window;
const binding = { origin: 'https://kodik.example', source, generation: 3 };
const message = (key: string, value?: unknown) => ({ source, origin: binding.origin, data: { key, value } });
const accepted = { accepted: true, progress: null };
afterEach(() => vi.useRealTimers());

describe('Kodik progress messages', () => {
	it('accepts documented numeric, seek and canonical context payloads', () => {
		expect(parseKodikEvent(message('kodik_player_time_update', 14), binding, 3)).toEqual({ type: 'time', seconds: 14 });
		expect(parseKodikEvent(message('kodik_player_time', 14.5), binding, 3)).toEqual({ type: 'time', seconds: 14.5 });
		expect(parseKodikEvent(message('kodik_player_duration_update', 6531.48), binding, 3)).toEqual({ type: 'duration', seconds: 6531.48 });
		expect(parseKodikEvent(message('kodik_player_seek', { time: 342.54 }), binding, 3)).toEqual({ type: 'seek', seconds: 342.54 });
		expect(parseKodikEvent(message('kodik_player_current_episode', { season: 0, episode: 1, translation: { id: 718, title: 'Studio' } }), binding, 3)).toEqual({ type: 'episode', season: 0, episode: 1, translationId: 718 });
		expect(parseKodikEvent(message('kodik_player_current_episode', { season: null, episode: null, translation: { id: 718 } }), binding, 3)).toEqual({ type: 'episode', season: null, episode: null, translationId: 718 });
	});
	it('requires both exact HTTPS origin and the current iframe window and generation', () => {
		const event = message('kodik_player_pause');
		expect(parseKodikEvent(event, binding, 3)).toEqual({ type: 'pause' });
		for (const origin of ['https://kodik.example.evil.test', 'http://kodik.example', 'null', 'https://kodik.example:444']) expect(parseKodikEvent({ ...event, origin }, binding, 3)).toBeNull();
		expect(parseKodikEvent({ ...event, source: {} as Window }, binding, 3)).toBeNull();
		expect(parseKodikEvent(event, { ...binding, source: null }, 3)).toBeNull();
		expect(parseKodikEvent(event, binding, 4)).toBeNull();
	});
	it('rejects unsupported envelopes, identities, values and events', () => {
		for (const data of [null, [], JSON.stringify({ key: 'kodik_player_play' }), { key: 'kodik_player_ready' }, { key: 'kodik_player_play', value: { workId: 'other' } }, { key: 'kodik_player_play', url: 'https://evil.test' }]) expect(parseKodikEvent({ ...message(''), data }, binding, 3)).toBeNull();
		for (const value of [-1, Infinity, NaN, '14', { time: 14 }, 172801]) expect(parseKodikEvent(message('kodik_player_time_update', value), binding, 3)).toBeNull();
		for (const value of [{ season: null, episode: 1, translation: { id: 718 } }, { season: -1, episode: 1, translation: { id: 718 } }, { season: 1, episode: 1, translation: { id: '718' } }]) expect(parseKodikEvent(message('kodik_player_current_episode', value), binding, 3)).toBeNull();
	});
});

describe('watch progress single-flight queue', () => {
	it('coalesces at 15 seconds, preserves backwards seeks and sends increasing sequences', async () => {
		vi.useFakeTimers();
		const send = vi.fn().mockResolvedValue(accepted);
		const writer = new WatchProgressWriter({ workId: 'work', sessionId: 'session' }, send, vi.fn());
		writer.push({ positionSeconds: 100, durationSeconds: 1000 });
		await vi.advanceTimersByTimeAsync(0);
		expect(send).toHaveBeenCalledWith({ workId: 'work', sessionId: 'session', sequence: 1, positionSeconds: 100, durationSeconds: 1000 }, false);
		writer.push({ positionSeconds: 110 });
		writer.push({ positionSeconds: 20 });
		await vi.advanceTimersByTimeAsync(14999);
		expect(send).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(send.mock.calls[1][0]).toMatchObject({ sequence: 2, positionSeconds: 20 });
	});
	it('never overlaps updates and flushes the latest pending sample on close', async () => {
		vi.useFakeTimers();
		let resolve!: (result: ProgressUpdateResult) => void;
		const send = vi.fn<(value: ProgressUpdate, keepalive: boolean) => Promise<ProgressUpdateResult>>().mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(accepted);
		const writer = new WatchProgressWriter({ workId: 'work', sessionId: 'session' }, send, vi.fn());
		writer.push({ positionSeconds: 100, durationSeconds: 1000 }); writer.flush();
		writer.push({ positionSeconds: 125 }); writer.finish(true);
		expect(send).toHaveBeenCalledTimes(1);
		resolve(accepted);
		await vi.advanceTimersByTimeAsync(0);
		expect(send).toHaveBeenCalledTimes(2);
		expect(send.mock.calls[1]).toEqual([{ workId: 'work', sessionId: 'session', sequence: 2, positionSeconds: 125 }, true]);
		writer.push({ positionSeconds: 150 });
		await vi.advanceTimersByTimeAsync(30000);
		expect(send).toHaveBeenCalledTimes(2);
	});
	it('stops after a revoked session without reclaiming it from timers', async () => {
		vi.useFakeTimers();
		const send = vi.fn().mockResolvedValue({ accepted: false, progress: null });
		const writer = new WatchProgressWriter({ workId: 'work', sessionId: 'session' }, send, vi.fn());
		writer.push({ positionSeconds: 5, durationSeconds: 100 }); writer.flush();
		await vi.advanceTimersByTimeAsync(0);
		writer.push({ positionSeconds: 6 }); writer.flush();
		await vi.advanceTimersByTimeAsync(30000);
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe('continue watching presentation', () => {
	it('binds the mounted edition path to the server digest without including mirrors or public URL tokens', async () => {
		const subtle = webcrypto.subtle as unknown as SubtleCrypto;
		const actual = await kodikResourceFingerprint('serial-123', 'https://kodik.example/serial/123/cut-one/720p?token=public-fixture&season=2', '718', subtle);
		expect(actual).toBe(createHash('sha256').update(JSON.stringify(['serial-123', '/serial/123/cut-one/720p', '718'])).digest('hex'));
		expect(await kodikResourceFingerprint('serial-123', 'https://mirror.example/serial/123/cut-one/720p?episode=3', '718', subtle)).toBe(actual);
		expect(await kodikResourceFingerprint('serial-123', 'https://kodik.example/serial/123/cut-two/720p', '718', subtle)).not.toBe(actual);
		expect(await kodikResourceFingerprint('serial-123', 'http://kodik.example/serial/123/cut-one/720p', '718', subtle)).toBeNull();
	});
	it('uses exact canonical episode links without autoplay or time URL parameters', () => {
		expect(continueWatchingRoute({ work: { slug: 'a/b' }, seasonNumber: 0, episodeNumber: 3 } as ContinueWatchingItem)).toBe('/zalip/a%2Fb?season=0&episode=3');
		expect(continueWatchingRoute({ work: { slug: 'movie' }, seasonNumber: null, episodeNumber: null } as ContinueWatchingItem)).toBe('/zalip/movie');
	});
	it('does not treat provider or voice editions as interchangeable', () => {
		const target = { workId: 'w', episodeId: 'e', provider: 'kodik' as const, translationId: 'serial-123' };
		expect(sameWatchTarget(target, { ...target })).toBe(true);
		expect(sameWatchTarget(target, { ...target, translationId: 'serial-456' })).toBe(false);
		expect(sameWatchTarget(target, { ...target, provider: 'alloha' })).toBe(false);
	});
	it('does not invent a time bar for unknown position or duration', () => {
		expect(watchProgressPercent({ positionSeconds: null, durationSeconds: null })).toBeNull();
		expect(watchProgressPercent({ positionSeconds: 10, durationSeconds: 0 })).toBeNull();
		expect(watchProgressPercent({ positionSeconds: 10, durationSeconds: 40 })).toBe(25);
		expect(watchTimeLabel(3674.8)).toBe('1:01:14');
	});
});
