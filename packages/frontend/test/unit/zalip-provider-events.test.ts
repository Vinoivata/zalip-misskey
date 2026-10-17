/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { ProviderEventBinding } from '@/utility/zalip-provider-events.js';
import { parseAllohaEvent, parseCollapsEvent } from '@/utility/zalip-provider-events.js';

const source = {} as Window;
const binding: ProviderEventBinding = { origin: 'https://player.example', source, generation: 3 };
const message = (data: unknown) => ({ source, origin: binding.origin, data });
const alloha = (event: string, time: unknown = 0) => message(JSON.stringify({ event, time }));
const collaps = (event: string, fields: Record<string, unknown> = {}) => message({ event, ...fields });

describe.each([
	['Alloha', parseAllohaEvent, alloha('play')],
	['Collaps', parseCollapsEvent, collaps('playerReady')],
] as const)('%s iframe trust boundary', (_provider, parse, event) => {
	it.each(['https://player.example.evil.test', 'https://sub.player.example', 'http://player.example', 'https://player.example:444', 'null', '', 'https://other.example'])('rejects another or opaque message origin: %s', origin => {
		expect(parse({ ...event, origin }, binding, 3)).toBeNull();
	});
	it('requires the exact current iframe window', () => {
		expect(parse({ ...event, source: {} as Window }, binding, 3)).toBeNull();
		expect(parse({ ...event, source: null }, binding, 3)).toBeNull();
		expect(parse(event, { ...binding, source: null }, 3)).toBeNull();
	});
	it('rejects stale, missing or invalid generations', () => {
		for (const generation of [4, -1, 3.5, NaN, Infinity, undefined]) expect(parse(event, binding, generation as number)).toBeNull();
		expect(parse(event, { ...binding, generation: 2 }, 3)).toBeNull();
		expect(parse(event, { ...binding, generation: -1 }, -1)).toBeNull();
	});
	it.each(['*', 'http://player.example', 'https://player.example/', 'https://player.example/path', 'https://player.example?x=1', 'https://user:password@player.example', 'not a URL'])('requires a normalized HTTPS binding origin: %s', origin => {
		expect(parse({ ...event, origin }, { ...binding, origin }, 3)).toBeNull();
	});
	it('accepts an exact explicitly configured HTTPS port but not a sibling port', () => {
		const origin = 'https://player.example:8443';
		expect(parse({ ...event, origin }, { ...binding, origin }, 3)).not.toBeNull();
		expect(parse({ ...event, origin: 'https://player.example:8444' }, { ...binding, origin }, 3)).toBeNull();
	});
});

describe('Alloha documented JSON messages', () => {
	it.each(['play', 'pause', 'seek', 'enterfullscreen', 'exitfullscreen'] as const)('accepts %s without inventing identity fields', event => {
		expect(parseAllohaEvent(alloha(event, 12.5), binding, 3)).toEqual({ type: event, seconds: 12.5 });
	});
	it('distinguishes duration.time from playback time and accepts valid time boundaries', () => {
		expect(parseAllohaEvent(alloha('duration', 6531.48), binding, 3)).toEqual({ type: 'duration', seconds: 6531.48 });
		expect(parseAllohaEvent(alloha('timeupdate', 0), binding, 3)).toEqual({ type: 'time', seconds: 0 });
		expect(parseAllohaEvent(alloha('timeupdate', 172800), binding, 3)).toEqual({ type: 'time', seconds: 172800 });
		expect(parseAllohaEvent(alloha('duration', 0), binding, 3)).toBeNull();
	});
	it.each([null, undefined, 12, true, [], { event: 'play', time: 12 }, '', '{', '[{"event":"play","time":12}]', 'null', '"play"'])('rejects non-JSON-object string envelopes: %j', data => {
		expect(parseAllohaEvent(message(data), binding, 3)).toBeNull();
	});
	it('rejects oversized strings before accepting any decoded event', () => {
		expect(parseAllohaEvent(message(`${' '.repeat(4096)}{"event":"play","time":1}`), binding, 3)).toBeNull();
	});
	it('requires exactly the documented event and time fields', () => {
		for (const data of [
			{ event: 'play' }, { time: 12 }, { event: 'play', time: 12, id: 1 },
			{ event: 'timeupdate', time: 12, duration: 100 }, { event: 'play', time: 12, url: 'https://other.example' },
			{ event: 'play', time: 12, __proto__: null, workId: 'other' },
		]) expect(parseAllohaEvent(message(JSON.stringify(data)), binding, 3)).toBeNull();
	});
	it('ignores storage callbacks, unknown event names and protocol lookalikes', () => {
		for (const event of ['getTimeSave', 'ready', 'ended', 'timeUpdate', 'viewProgress', 'kodik_player_time_update', 'setTime']) expect(parseAllohaEvent(alloha(event, 12), binding, 3)).toBeNull();
		expect(parseAllohaEvent(message(JSON.stringify({ key: 'kodik_player_play' })), binding, 3)).toBeNull();
	});
	it('rejects nonfinite, negative, oversized and coerced numbers', () => {
		for (const time of [-1, 172800.1, '12', null, {}, [], NaN, Infinity, -Infinity]) expect(parseAllohaEvent(alloha('timeupdate', time), binding, 3)).toBeNull();
		expect(parseAllohaEvent(message('{"event":"duration","time":1e309}'), binding, 3)).toBeNull();
	});
});

describe('Collaps documented object messages', () => {
	it('accepts bounded progress, including fractional seconds and a backwards seek sample', () => {
		expect(parseCollapsEvent(collaps('viewProgress', { id: 123, time: 40.5, duration: 100 }), binding, 3)).toEqual({ type: 'progress', id: 123, seconds: 40.5, durationSeconds: 100 });
		expect(parseCollapsEvent(collaps('viewProgress', { id: 123, time: 12, duration: 100 }), binding, 3)).toEqual({ type: 'progress', id: 123, seconds: 12, durationSeconds: 100 });
		expect(parseCollapsEvent(collaps('viewProgress', { id: 123, time: 0, duration: 172800 }), binding, 3)).not.toBeNull();
		expect(parseCollapsEvent(collaps('viewProgress', { id: 123, time: 172800, duration: 172800 }), binding, 3)).not.toBeNull();
	});
	it('preserves observed episode coordinates and numeric identity without canonical remapping', () => {
		expect(parseCollapsEvent(collaps('changeEpisode', { id: 123, season: 2, episode: 3 }), binding, 3)).toEqual({ type: 'episode', id: 123, season: 2, episode: 3 });
		expect(parseCollapsEvent(collaps('changeEpisode', { id: 123, season: 0, episode: 0 }), binding, 3)).toEqual({ type: 'episode', id: 123, season: 0, episode: 0 });
		expect(parseCollapsEvent(collaps('startWatching', { id: 123 }), binding, 3)).toEqual({ type: 'started', id: 123 });
	});
	it.each([['playerReady', 'ready'], ['adStart', 'adStart'], ['adStop', 'adStop'], ['ended', 'ended']] as const)('accepts the exact %s signal', (event, type) => {
		expect(parseCollapsEvent(collaps(event), binding, 3)).toEqual({ type });
		expect(parseCollapsEvent(collaps(event, { id: 123 }), binding, 3)).toBeNull();
	});
	it.each([null, undefined, 12, true, [], JSON.stringify({ event: 'playerReady' }), new Date(), new Map()])('rejects non-plain-object envelopes: %j', data => {
		expect(parseCollapsEvent(message(data), binding, 3)).toBeNull();
	});
	it('rejects inherited fields, accessors and symbol or extra fields without running getters', () => {
		const inherited = Object.create({ event: 'playerReady' });
		let getterCalled = false;
		const accessor = { get event() { getterCalled = true; return 'playerReady'; } };
		for (const data of [inherited, accessor, { event: 'playerReady', [Symbol('identity')]: 123 }, { event: 'viewProgress', id: 123, time: 1, duration: 100, workId: 'other' }]) expect(parseCollapsEvent(message(data), binding, 3)).toBeNull();
		expect(getterCalled).toBe(false);
	});
	it('requires a positive safe-integer numeric id for every identity-bearing event', () => {
		for (const id of [undefined, null, '123', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
			for (const data of [{ event: 'startWatching', id }, { event: 'viewProgress', id, time: 1, duration: 100 }, { event: 'changeEpisode', id, season: 1, episode: 1 }]) expect(parseCollapsEvent(message(data), binding, 3)).toBeNull();
		}
	});
	it('requires all progress fields and rejects impossible or unbounded timelines', () => {
		for (const fields of [
			{ id: 123, time: 1 }, { id: 123, duration: 100 }, { id: 123, time: 101, duration: 100 },
			{ id: 123, time: -1, duration: 100 }, { id: 123, time: 0, duration: 0 }, { id: 123, time: 1, duration: 172801 },
			{ id: 123, time: '1', duration: 100 }, { id: 123, time: 1, duration: '100' }, { id: 123, time: Infinity, duration: 100 },
			{ id: 123, time: 1, duration: NaN }, { id: 123, time: 1, duration: -1 },
		]) expect(parseCollapsEvent(collaps('viewProgress', fields), binding, 3)).toBeNull();
	});
	it('requires bounded integer coordinates and does not guess missing episode metadata', () => {
		for (const fields of [{ id: 123, season: 1 }, { id: 123, episode: 1 }, { id: 123, season: null, episode: null }, { id: 123, season: -1, episode: 1 }, { id: 123, season: 1, episode: -1 }, { id: 123, season: '1', episode: 1 }, { id: 123, season: 1, episode: 1.5 }, { id: 123, season: 1001, episode: 1 }, { id: 123, season: 1, episode: 100001 }]) expect(parseCollapsEvent(collaps('changeEpisode', fields), binding, 3)).toBeNull();
	});
	it('rejects unknown signals, Alloha/Kodik lookalikes and hostile objects', () => {
		for (const data of [{ event: 'play' }, { event: 'timeupdate', time: 1 }, { event: 'viewprogress', id: 123, time: 1, duration: 100 }, { key: 'kodik_player_play' }, new Proxy({}, { ownKeys() { throw new Error('invalid clone'); } })]) expect(parseCollapsEvent(message(data), binding, 3)).toBeNull();
	});
});
