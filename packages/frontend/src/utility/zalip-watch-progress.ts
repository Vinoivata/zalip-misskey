/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { PlaybackProvider } from '@/utility/zalip-playback.js';
import { zalipWorkRoute } from '@/utility/zalip-work-route.js';

export type WatchProgress = {
	workId: string;
	episodeId: string | null;
	seasonNumber: number | null;
	episodeNumber: number | null;
	provider: PlaybackProvider;
	translationId: string | null;
	mode: 'time' | 'episode';
	positionSeconds: number | null;
	durationSeconds: number | null;
	completed: boolean;
	lastPlayedAt: string;
};
export type ContinueWatchingItem = WatchProgress & {
	work: { id: string; slug: string; title: string; posterPath: string | null; backdropPath: string | null };
	episode: { id: string; title: string; stillPath: string | null } | null;
};
export type WatchTarget = Pick<WatchProgress, 'workId' | 'episodeId' | 'provider' | 'translationId'>;
export type ProgressPatch = { positionSeconds?: number; durationSeconds?: number; completed?: boolean };
export type ProgressUpdate = ProgressPatch & { workId: string; sessionId: string; sequence: number };
export type ProgressUpdateResult = { accepted: boolean; progress: WatchProgress | null };

/** A history link selects a canonical episode but never starts playback or trusts an offset in the URL. */
export function continueWatchingRoute(item: ContinueWatchingItem): string {
	return zalipWorkRoute(item.work.slug, item.seasonNumber, item.episodeNumber);
}

export function sameWatchTarget(left: WatchTarget, right: WatchTarget): boolean {
	return left.workId === right.workId && left.episodeId === right.episodeId && left.provider === right.provider && left.translationId === right.translationId;
}

/** Match the server's media timeline using only the mounted path/edition; mirrors and public URL tokens are excluded. */
export async function kodikResourceFingerprint(translationId: string, mountedIframeUrl: string, providerTranslationId: string, subtle: SubtleCrypto | null = (window as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle ?? null): Promise<string | null> {
	if (!subtle || !translationId || translationId.length > 100 || !/^[1-9]\d{0,15}$/u.test(providerTranslationId)) return null;
	try {
		const url = new URL(mountedIframeUrl);
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		const input = new TextEncoder().encode(JSON.stringify([translationId, url.pathname, providerTranslationId]));
		return [...new Uint8Array(await subtle.digest('SHA-256', input))].map(byte => byte.toString(16).padStart(2, '0')).join('');
	} catch { return null; }
}

/** Bind a fixed balancer clip/voice to its canonical episode; never hash an authentication token. */
export async function balancerResourceFingerprint(provider: 'alloha' | 'collaps', translationId: string | null, mountedIframeUrl: string, seasonNumber: number | null, episodeNumber: number | null, subtle: SubtleCrypto | null = (window as unknown as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle ?? null): Promise<string | null> {
	if (!subtle || (translationId != null && (!translationId || translationId.length > 100))) return null;
	if ((seasonNumber == null) !== (episodeNumber == null) || (seasonNumber != null && (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 1000 || !Number.isSafeInteger(episodeNumber) || episodeNumber! < 0 || episodeNumber! > 100000))) return null;
	try {
		const url = new URL(mountedIframeUrl);
		if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
		const one = (key: string) => url.searchParams.getAll(key).length === 1 ? url.searchParams.get(key) : null;
		let identity: string | null = null;
		let selector: string | null = null;
		if (provider === 'alloha') {
			// Movie native resume can switch cuts without an identity event. Do not claim a fixed movie cut.
			if (seasonNumber == null || !one('hidden')?.split(',').every(value => ['episode', 'season', 'translation'].includes(value)) || !['episode', 'season', 'translation'].every(value => one('hidden')?.split(',').includes(value))) return null;
			identity = one('token_movie'); selector = one('translation');
			if (!identity || !/^[A-Za-z0-9_-]{8,256}$/u.test(identity) || (translationId != null && selector !== translationId)) return null;
		} else {
			if (one('showMenu') !== 'false' || one('showPreNext') !== 'false' || translationId == null) return null;
			selector = one('oneSound');
			if (!selector || selector.length > 256) return null;
		}
		if (seasonNumber != null && (one('season') !== String(seasonNumber) || one('episode') !== String(episodeNumber))) return null;
		const input = new TextEncoder().encode(JSON.stringify([provider, 'v1', translationId, url.pathname, identity, selector, seasonNumber, episodeNumber]));
		return [...new Uint8Array(await subtle.digest('SHA-256', input))].map(byte => byte.toString(16).padStart(2, '0')).join('');
	} catch { return null; }
}

export function watchProgressPercent(progress: Pick<WatchProgress, 'positionSeconds' | 'durationSeconds'>): number | null {
	return validSeconds(progress.positionSeconds) && validSeconds(progress.durationSeconds) && progress.durationSeconds > 0
		? Math.min(100, progress.positionSeconds / progress.durationSeconds * 100) : null;
}

export function watchTimeLabel(seconds: number): string {
	const value = Math.max(0, Math.floor(seconds));
	return value >= 3600 ? `${Math.floor(value / 3600)}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`
		: `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

const maximumSeconds = 48 * 60 * 60;

function validSeconds(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximumSeconds; }

function record(value: unknown): value is Record<string, unknown> { return value != null && typeof value === 'object' && !Array.isArray(value); }

export type KodikEvent =
	| { type: 'play' | 'pause' | 'started' | 'ended' }
	| { type: 'time' | 'duration' | 'seek'; seconds: number }
	| { type: 'episode'; season: number | null; episode: number | null; translationId: number };

/** Only documented JSAPI envelopes from this exact live iframe are accepted. No URL or identity is taken from a message. */
export function parseKodikEvent(event: Pick<MessageEvent, 'origin' | 'source' | 'data'>, binding: { origin: string; source: MessageEventSource | null; generation: number }, generation: number): KodikEvent | null {
	if (binding.generation !== generation || !binding.source || event.source !== binding.source || event.origin !== binding.origin || event.origin === 'null') return null;
	try { if (new URL(binding.origin).protocol !== 'https:' || new URL(binding.origin).origin !== binding.origin) return null; } catch { return null; }
	const data: unknown = event.data;
	if (!record(data) || Object.keys(data).some(key => key !== 'key' && key !== 'value')) return null;
	const simple = { kodik_player_play: 'play', kodik_player_pause: 'pause', kodik_player_video_started: 'started', kodik_player_video_ended: 'ended' } as const;
	if (typeof data.key !== 'string') return null;
	if (Object.hasOwn(simple, data.key)) return data.value == null ? { type: simple[data.key as keyof typeof simple] } : null;
	if (data.key === 'kodik_player_time_update' || data.key === 'kodik_player_time' || data.key === 'kodik_player_duration_update') {
		if (!validSeconds(data.value) || (data.key === 'kodik_player_duration_update' && data.value === 0)) return null;
		return { type: data.key === 'kodik_player_duration_update' ? 'duration' : 'time', seconds: data.value };
	}
	if (data.key === 'kodik_player_seek') return record(data.value) && validSeconds(data.value.time) ? { type: 'seek', seconds: data.value.time } : null;
	if (data.key === 'kodik_player_current_episode' && record(data.value)) {
		const value = data.value;
		const coordinate = (number: unknown): number is number | null => number === null || (typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 && number <= 10000);
		if (!coordinate(value.season) || !coordinate(value.episode) || (value.season === null) !== (value.episode === null) || !record(value.translation)) return null;
		const id = value.translation.id;
		if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return null;
		return { type: 'episode', season: value.season, episode: value.episode, translationId: id };
	}
	return null;
}

/** One flight and a replaceable latest sample preserve deliberate seeks backwards and monotonic request sequences. */
export class WatchProgressWriter {
	private pending: ProgressPatch | null = null;
	private inFlight = false;
	private sequence = 0;
	private lastSentAt = Number.NEGATIVE_INFINITY;
	private timer: number | null = null;
	private stopped = false;
	private closing = false;
	private keepalive = false;
	constructor(
		private readonly context: { workId: string; sessionId: string },
		private readonly send: (update: ProgressUpdate, keepalive: boolean) => Promise<ProgressUpdateResult>,
		private readonly result: (value: ProgressUpdateResult | null) => void,
		private readonly interval = 15000,
	) {}

	push(patch: ProgressPatch): void {
		if (this.stopped || this.closing) return;
		this.pending = { ...this.pending, ...patch };
		this.schedule();
	}

	flush(keepalive = false): void {
		this.keepalive ||= keepalive;
		if (this.timer != null) window.clearTimeout(this.timer);
		this.timer = null;
		if (this.stopped || this.inFlight || !this.pending) return;
		const patch = this.pending;
		this.pending = null;
		this.inFlight = true;
		this.lastSentAt = Date.now();
		const transportKeepalive = this.keepalive;
		this.keepalive = false;
		void this.send({ ...patch, ...this.context, sequence: ++this.sequence }, transportKeepalive).then(value => {
			if (!value.accepted) { this.stopped = true; this.pending = null; }
			this.result(value);
		}).catch(() => { this.result(null); }).finally(() => {
			this.inFlight = false;
			if (this.closing || this.keepalive) this.flush(this.keepalive);
			else this.schedule();
		});
	}

	finish(keepalive = false): void { this.closing = true; this.flush(keepalive); }

	private schedule(): void {
		if (this.stopped || this.inFlight || !this.pending || this.timer != null) return;
		const delay = Math.max(0, this.interval - (Date.now() - this.lastSentAt));
		this.timer = window.setTimeout(() => { this.timer = null; this.flush(); }, delay);
	}
}
