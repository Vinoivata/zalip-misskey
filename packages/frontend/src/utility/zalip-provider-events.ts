/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type ProviderEventBinding = {
	origin: string;
	source: MessageEventSource | null;
	generation: number;
};

export type AllohaEvent = {
	type: 'play' | 'pause' | 'seek' | 'time' | 'duration' | 'enterfullscreen' | 'exitfullscreen';
	seconds: number;
};

export type CollapsEvent =
	| { type: 'progress'; id: number; seconds: number; durationSeconds: number }
	| { type: 'episode'; id: number; season: number; episode: number }
	| { type: 'started'; id: number }
	| { type: 'ready' | 'adStart' | 'adStop' | 'ended' };

type ProviderMessage = Pick<MessageEvent, 'origin' | 'source' | 'data'>;
const maximumSeconds = 48 * 60 * 60;
const maximumJsonLength = 4096;

/** A parser never derives a trusted frame or origin from the untrusted message itself. */
function currentFrame(event: ProviderMessage, binding: ProviderEventBinding, generation: number): boolean {
	if (!Number.isSafeInteger(generation) || generation < 0 || binding.generation !== generation || !binding.source || event.source !== binding.source || event.origin !== binding.origin) return false;
	try {
		const origin = new URL(binding.origin);
		return origin.protocol === 'https:' && origin.origin === binding.origin;
	} catch { return false; }
}

/** Structured-clone objects and decoded JSON must contain only the documented own data fields. */
function envelope(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return false;
	return Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
}

function seconds(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximumSeconds;
}

function positiveId(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function coordinate(value: unknown, maximum: number): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

/** Alloha documents JSON strings, not Kodik-style objects or getTimeSave storage payloads. */
export function parseAllohaEvent(event: ProviderMessage, binding: ProviderEventBinding, generation: number): AllohaEvent | null {
	if (!currentFrame(event, binding, generation) || typeof event.data !== 'string' || event.data.length > maximumJsonLength) return null;
	try {
		const data: unknown = JSON.parse(event.data);
		if (!envelope(data, ['event', 'time']) || !seconds(data.time)) return null;
		switch (data.event) {
			case 'play':
			case 'pause':
			case 'seek':
			case 'enterfullscreen':
			case 'exitfullscreen':
				return { type: data.event, seconds: data.time };
			case 'timeupdate':
				return { type: 'time', seconds: data.time };
			case 'duration':
				return data.time > 0 ? { type: 'duration', seconds: data.time } : null;
			default:
				return null;
		}
	} catch { return null; }
}

/** IDs and coordinates are observations only; the caller must verify their canonical playback context. */
export function parseCollapsEvent(event: ProviderMessage, binding: ProviderEventBinding, generation: number): CollapsEvent | null {
	if (!currentFrame(event, binding, generation)) return null;
	try {
		const data: unknown = event.data;
		if (envelope(data, ['event', 'id', 'time', 'duration']) && data.event === 'viewProgress') {
			return positiveId(data.id) && seconds(data.time) && seconds(data.duration) && data.duration > 0 && data.time <= data.duration
				? { type: 'progress', id: data.id, seconds: data.time, durationSeconds: data.duration } : null;
		}
		if (envelope(data, ['event', 'id', 'season', 'episode']) && data.event === 'changeEpisode') {
			return positiveId(data.id) && coordinate(data.season, 1000) && coordinate(data.episode, 100000)
				? { type: 'episode', id: data.id, season: data.season, episode: data.episode } : null;
		}
		if (envelope(data, ['event', 'id']) && data.event === 'startWatching') return positiveId(data.id) ? { type: 'started', id: data.id } : null;
		if (!envelope(data, ['event'])) return null;
		switch (data.event) {
			case 'playerReady': return { type: 'ready' };
			case 'adStart':
			case 'adStop':
			case 'ended': return { type: data.event };
			default: return null;
		}
	} catch { return null; }
}
