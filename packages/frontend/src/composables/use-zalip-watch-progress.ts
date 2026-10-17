/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { WatchProgress, WatchTarget } from '@/utility/zalip-watch-progress.js';
import { balancerResourceFingerprint, kodikResourceFingerprint, parseKodikEvent, sameWatchTarget, WatchProgressWriter } from '@/utility/zalip-watch-progress.js';
import { parseAllohaEvent, parseCollapsEvent } from '@/utility/zalip-provider-events.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';

export type WatchPlayerContext = WatchTarget & {
	iframeUrl: string;
	seasonNumber: number | null;
	episodeNumber: number | null;
	providerTranslationId: string | null;
	resumeSeconds: number | null;
};

/** A cached page and a replaced iframe must never keep writing under the next playback context. */
export function useZalipWatchProgress(context: Readonly<Ref<WatchPlayerContext | null>>, iframe: Readonly<Ref<HTMLIFrameElement | null>>, saved: (progress: WatchProgress) => void, remount?: (url: string) => Promise<void>): { state: Ref<'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unmapped'>; mode: Ref<'time' | 'episode' | null>; flush: () => void } {
	const state = ref<'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unmapped'>('idle');
	const mode = ref<'time' | 'episode' | null>(null);
	let generation = 0;
	let active = true;
	let dispose: (() => void) | null = null;
	let writer: WatchProgressWriter | null = null;
	let startQueue: Promise<void> = Promise.resolve();
	let flushCurrent: (keepalive?: boolean) => void = () => {};

	function stop(keepalive = false): void {
		dispose?.();
		generation++;
		dispose = null;
		writer?.finish(keepalive);
		writer = null;
		flushCurrent = () => {};
		mode.value = null;
	}

	async function bind(): Promise<void> {
		stop();
		state.value = 'idle';
		const value = context.value;
		const accountId = $i?.id;
		if (!active || !value || !accountId) return;
		const epoch = generation;
		await nextTick();
		const initialFrame = iframe.value;
		if (epoch !== generation || !initialFrame?.contentWindow || context.value !== value) return;
		let frame: HTMLIFrameElement = initialFrame;
		let source: Window = initialFrame.contentWindow;
		let mountedIframeUrl = frame.src;
		const origin = new URL(mountedIframeUrl).origin;
		const alive = () => active && epoch === generation && $i?.id === accountId && context.value === value;
		const current = () => alive() && iframe.value === frame && frame.src === mountedIframeUrl;
		let duration: number | null = null;
		let contentDuration: number | null = null;
		let position: number | null = null;
		let playing = false;
		let completed = false;
		let verified = false;
		let interrupted = false;
		let resumeSeconds = value.resumeSeconds;
		let pendingSeek = resumeSeconds != null && resumeSeconds > 0;
		let sessionReady = false;
		let seekSent = false;
		let seekTimer: number | null = null;
		let adActive = false;
		let collapsId: number | null = null;
		let balancerBound = false;
		const command = (method: string, extra: Record<string, number> = {}) => {
			if (!current() || iframe.value !== frame || value.provider === 'collaps') return false;
			try {
				if (value.provider === 'kodik') source.postMessage({ key: 'kodik_player_api', value: { method, ...extra } }, origin);
				else source.postMessage(JSON.stringify({ api: method, ...(extra.seconds == null ? {} : { value: extra.seconds }) }), origin);
				return true;
			} catch { return false; } // Redirected/closed frames do not justify widening the target origin.
		};
		const sample = () => {
			if (!current() || !sessionReady || mode.value !== 'time' || interrupted || adActive || !verified || pendingSeek || position == null || duration == null || position > duration) return;
			writer?.push({ positionSeconds: position, durationSeconds: duration, completed });
		};
		const seekIfReady = () => {
			if (value.provider === 'collaps') return;
			if (!sessionReady || !pendingSeek || seekSent || !verified || duration == null || interrupted) return;
			if (resumeSeconds == null || resumeSeconds >= duration) { interrupted = true; state.value = 'unmapped'; return; }
			seekSent = true;
			if (!command('seek', { seconds: resumeSeconds })) { interrupted = true; state.value = 'failed'; return; }
			seekTimer = window.setTimeout(() => { if (current() && pendingSeek) { interrupted = true; state.value = 'failed'; } }, 10000);
		};
		const interrupt = () => { interrupted = true; verified = false; writer?.finish(); state.value = 'unmapped'; };
		const confirmSeek = (seconds: number) => {
			if (!pendingSeek) return true;
			const close = resumeSeconds != null && (value.provider === 'collaps' ? seconds >= resumeSeconds - 1 && seconds <= resumeSeconds + 10 : Math.abs(seconds - resumeSeconds) <= 4);
			if (!seekSent || !close) {
				if (value.provider === 'collaps' && seekSent && seekTimer == null) seekTimer = window.setTimeout(() => { if (current() && pendingSeek) { interrupted = true; state.value = 'failed'; } }, 15000);
				return false;
			}
			pendingSeek = false;
			if (seekTimer != null) window.clearTimeout(seekTimer);
			seekTimer = null;
			return true;
		};
		const onMessage = (message: MessageEvent) => {
			if (!current() || interrupted) return;
			const binding = { origin, source, generation: epoch };
			if (value.provider !== 'kodik') {
				if (!sessionReady || mode.value !== 'time' || !balancerBound) return;
				if (value.provider === 'alloha') {
					const event = parseAllohaEvent(message, binding, generation);
					if (!event) return;
					if (event.type === 'duration') {
						if (duration != null && Math.abs(duration - event.seconds) > 2) { interrupt(); return; }
						duration = event.seconds;
						verified = position != null && position > 0 && position <= duration;
						seekIfReady();
						return;
					}
					if (event.type === 'enterfullscreen' || event.type === 'exitfullscreen') return;
					if (event.type === 'play') { playing = true; completed = false; command('duration'); return; }
					if (event.type === 'pause') {
						playing = false;
						if (verified && duration != null && event.seconds <= duration && confirmSeek(event.seconds)) { position = event.seconds; sample(); writer?.flush(); }
						return;
					}
					// Alloha's bridge reads the main media element; its ad video has a separate clock.
					if (duration == null) { position = event.seconds; command('duration'); return; }
					if (event.seconds > duration) { interrupt(); return; }
					position = event.seconds;
					verified = position > 0;
					if (event.type === 'time') playing = true;
					seekIfReady();
					if (!confirmSeek(position)) return;
					completed ||= position >= duration - Math.min(1, duration * 0.01);
					if (playing || event.type === 'seek') sample();
					if (completed) writer?.flush();
					return;
				}
				const event = parseCollapsEvent(message, binding, generation);
				if (!event) return;
				if (event.type === 'episode') { interrupt(); return; }
				if (event.type === 'adStart') {
					adActive = true; playing = false; position = null; duration = null; verified = false;
					if (seekTimer != null) window.clearTimeout(seekTimer);
					seekTimer = null;
					return;
				}
				if (event.type === 'adStop') { adActive = false; return; }
				if (event.type === 'ready') { position = null; duration = null; verified = false; return; }
				if (event.type === 'started') {
					if (collapsId != null && collapsId !== event.id) { interrupt(); return; }
					collapsId = event.id;
					return;
				}
				if (event.type === 'ended') {
					if (!adActive && verified && position != null && duration != null && position >= duration * 0.9) { completed = true; sample(); writer?.flush(); }
					playing = false;
					return;
				}
				if (event.type !== 'progress' || adActive) return;
				// The URL is clip-locked (no playlist), and the server verified its exact voice coverage.
				// This opaque ID is only a consistency check, never a canonical episode ID.
				if (collapsId != null && collapsId !== event.id) { interrupt(); return; }
				collapsId = event.id;
				if (contentDuration != null && Math.abs(contentDuration - event.durationSeconds) > 2) { interrupt(); return; }
				contentDuration = event.durationSeconds;
				duration = event.durationSeconds; position = event.seconds; verified = true; playing = true;
				if (!confirmSeek(position)) return;
				sample();
				return;
			}
			const event = parseKodikEvent(message, { origin, source, generation: epoch }, generation);
			if (!event) return;
			if (event.type === 'episode') {
				// Concrete-episode embeds report null/null; their app-owned canonical target remains intact.
				if (String(event.translationId) !== value.providerTranslationId || (event.season != null && (event.season !== value.seasonNumber || event.episode !== value.episodeNumber))) {
					interrupted = true; verified = false; writer?.finish(); state.value = 'unmapped'; return;
				}
				verified = true;
				seekIfReady();
			} else if (event.type === 'duration') {
				duration = event.seconds;
				seekIfReady();
			} else if (event.type === 'time' || event.type === 'seek') {
				if (!verified || duration == null || event.seconds > duration) return;
				if (pendingSeek) {
					if (!seekSent || resumeSeconds == null || Math.abs(event.seconds - resumeSeconds) > 4) return;
					pendingSeek = false;
					if (seekTimer != null) window.clearTimeout(seekTimer);
				}
				position = event.seconds;
				if (playing || event.type === 'seek') sample();
			} else if (event.type === 'play' || event.type === 'started') {
				playing = true;
				completed = false;
				seekIfReady();
			} else if (event.type === 'pause') {
				playing = false;
				sample(); writer?.flush();
			} else {
				playing = false;
				completed = true;
				sample(); writer?.flush();
			}
		};
		window.addEventListener('message', onMessage);
		flushCurrent = (keepalive = false) => { sample(); writer?.flush(keepalive); };
		dispose = () => {
			command('pause');
			window.removeEventListener('message', onMessage);
			if (seekTimer != null) window.clearTimeout(seekTimer);
		};
		if (value.provider === 'kodik' && !value.providerTranslationId) { interrupted = true; state.value = 'unmapped'; }
		// Serialize claims too: a delayed old start must not revoke a newer selected episode's session.
		startQueue = startQueue.catch(() => {}).then(async () => {
			if (!current()) return;
			try {
				state.value = interrupted ? 'unmapped' : 'saving';
				let expectedResourceFingerprint: string | undefined;
				if (value.provider === 'kodik' && value.providerTranslationId) {
					const fingerprint = await kodikResourceFingerprint(value.translationId ?? '', mountedIframeUrl, value.providerTranslationId);
					if (!current()) return;
					if (!fingerprint) { interrupted = true; state.value = 'failed'; return; }
					expectedResourceFingerprint = fingerprint;
				} else if (value.provider !== 'kodik') {
					expectedResourceFingerprint = await balancerResourceFingerprint(value.provider, value.translationId, mountedIframeUrl, value.seasonNumber, value.episodeNumber) ?? undefined;
					if (!current()) return;
				}
				const start = await misskeyApiZalip<{ sessionId: string; sequence: 0; progress: WatchProgress }>('zalip/progress/start', { workId: value.workId, episodeId: value.episodeId, provider: value.provider, translationId: value.translationId, ...(expectedResourceFingerprint ? { expectedResourceFingerprint } : {}) });
				if (!current()) return;
				if (!sameWatchTarget(start.progress, value)) { interrupted = true; state.value = 'failed'; return; }
				balancerBound = expectedResourceFingerprint != null && value.provider !== 'kodik' && start.progress.mode === 'time';
				if (value.provider !== 'kodik' && start.progress.mode === 'time' && !balancerBound) { interrupted = true; state.value = 'failed'; return; }
				// A provider's media path may change after show(). The server validates its fingerprint on start.
				if (pendingSeek) {
					resumeSeconds = start.progress.mode === 'time' && !start.progress.completed ? start.progress.positionSeconds : null;
					pendingSeek = resumeSeconds != null && resumeSeconds > 0;
				}
				if (balancerBound && value.provider === 'collaps' && pendingSeek && resumeSeconds != null) {
					// Recreate the DOM iframe: navigation on the same WindowProxy would accept queued old-load messages.
					if (!remount) { interrupted = true; state.value = 'failed'; return; }
					const resumed = new URL(mountedIframeUrl);
					resumed.searchParams.set('time', String(resumeSeconds));
					const oldFrame = frame;
					await remount(resumed.toString());
					if (!alive()) return;
					const nextFrame = iframe.value;
					if (!nextFrame?.contentWindow || nextFrame === oldFrame || nextFrame.src !== resumed.toString() || new URL(nextFrame.src).origin !== origin) { interrupted = true; state.value = 'failed'; return; }
					frame = nextFrame; source = nextFrame.contentWindow; mountedIframeUrl = nextFrame.src;
					position = null; duration = null; contentDuration = null; verified = false; collapsId = null; adActive = false; seekSent = true;
				}
				mode.value = start.progress.mode;
				sessionReady = true;
				saved(start.progress);
				writer = new WatchProgressWriter({ workId: value.workId, sessionId: start.sessionId }, (update, keepalive) => $i?.id === accountId ? misskeyApiZalip('zalip/progress/update', update, { keepalive }) : Promise.resolve({ accepted: false, progress: null }), result => {
					if (!current() || interrupted) return;
					state.value = result == null ? 'failed' : result.accepted ? 'saved' : 'conflict';
					if (result?.accepted && result.progress) saved(result.progress);
				});
				if (!interrupted) state.value = 'saved';
				seekIfReady();
				if (playing) sample();
			} catch { if (current()) state.value = 'failed'; }
		});
	}

	// Invalidate synchronously, but bind only after Vue has replaced the keyed iframe.
	watch(context, () => stop(), { flush: 'sync' });
	watch(context, () => { void bind(); }, { flush: 'post' });
	onActivated(() => { active = true; if (context.value) void bind(); });
	onDeactivated(() => { flushCurrent(true); stop(true); active = false; });
	const visibility = () => { if (window.document.visibilityState === 'hidden') flushCurrent(true); };
	const pagehide = () => { flushCurrent(true); };
	window.document.addEventListener('visibilitychange', visibility);
	window.addEventListener('pagehide', pagehide);
	onBeforeUnmount(() => {
		flushCurrent(true); stop(true); active = false;
		window.document.removeEventListener('visibilitychange', visibility);
		window.removeEventListener('pagehide', pagehide);
	});
	return { state, mode, flush: () => flushCurrent() };
}
