/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { WatchProgress, WatchTarget } from '@/utility/zalip-watch-progress.js';
import { kodikResourceFingerprint, parseKodikEvent, sameWatchTarget, WatchProgressWriter } from '@/utility/zalip-watch-progress.js';
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
export function useZalipWatchProgress(context: Readonly<Ref<WatchPlayerContext | null>>, iframe: Readonly<Ref<HTMLIFrameElement | null>>, saved: (progress: WatchProgress) => void): { state: Ref<'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unmapped'>; flush: () => void } {
	const state = ref<'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'unmapped'>('idle');
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
	}

	async function bind(): Promise<void> {
		stop();
		state.value = 'idle';
		const value = context.value;
		const accountId = $i?.id;
		if (!active || !value || !accountId) return;
		const epoch = generation;
		await nextTick();
		const frame = iframe.value;
		if (epoch !== generation || !frame?.contentWindow || context.value !== value) return;
		const source = frame.contentWindow;
		const mountedIframeUrl = frame.src;
		const origin = new URL(mountedIframeUrl).origin;
		const current = () => active && epoch === generation && $i?.id === accountId && iframe.value === frame && frame.src === mountedIframeUrl;
		let duration: number | null = null;
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
		const command = (method: string, extra: Record<string, number> = {}) => {
			if (value.provider !== 'kodik' || !current() || iframe.value !== frame) return false;
			try { source.postMessage({ key: 'kodik_player_api', value: { method, ...extra } }, origin); return true; } catch { return false; } // Redirected/closed frames do not justify widening the target origin.
		};
		const sample = () => {
			if (!current() || interrupted || !verified || pendingSeek || position == null || duration == null || position > duration) return;
			writer?.push({ positionSeconds: position, durationSeconds: duration, completed });
		};
		const seekIfReady = () => {
			if (!sessionReady || !pendingSeek || seekSent || !verified || duration == null || interrupted) return;
			if (resumeSeconds == null || resumeSeconds >= duration) { interrupted = true; state.value = 'unmapped'; return; }
			seekSent = true;
			if (!command('seek', { seconds: resumeSeconds })) { interrupted = true; state.value = 'failed'; return; }
			seekTimer = window.setTimeout(() => { if (current() && pendingSeek) { interrupted = true; state.value = 'failed'; } }, 10000);
		};
		const onMessage = (message: MessageEvent) => {
			if (!current() || value.provider !== 'kodik' || interrupted) return;
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
				}
				const start = await misskeyApiZalip<{ sessionId: string; sequence: 0; progress: WatchProgress }>('zalip/progress/start', { workId: value.workId, episodeId: value.episodeId, provider: value.provider, translationId: value.translationId, ...(expectedResourceFingerprint ? { expectedResourceFingerprint } : {}) });
				if (!current()) return;
				if (!sameWatchTarget(start.progress, value)) { interrupted = true; state.value = 'failed'; return; }
				// A provider's media path may change after show(). The server validates its fingerprint on start.
				if (pendingSeek) {
					resumeSeconds = start.progress.mode === 'time' && !start.progress.completed ? start.progress.positionSeconds : null;
					pendingSeek = resumeSeconds != null && resumeSeconds > 0;
				}
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
	return { state, flush: () => flushCurrent() };
}
