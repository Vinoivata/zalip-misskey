/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cleanup, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import type { Window as HappyWindow } from 'happy-dom';
import type { WatchPlayerContext } from '@/composables/use-zalip-watch-progress.js';
import { useZalipWatchProgress } from '@/composables/use-zalip-watch-progress.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
const target: WatchPlayerContext = { workId: 'work', episodeId: 'episode1', provider: 'kodik', translationId: 'serial-123', iframeUrl: 'https://kodik.example/serial/123/code/720p?season=2&episode=1', seasonNumber: 2, episodeNumber: 1, providerTranslationId: '718', resumeSeconds: null };
const progress = { ...target, mode: 'time', positionSeconds: null, durationSeconds: null, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z' };
const nativeSubtle = webcrypto.subtle;

function setup() {
	const context = ref<WatchPlayerContext | null>(null);
	const saved = vi.fn();
	let tracker!: ReturnType<typeof useZalipWatchProgress>;
	const Host = defineComponent({ setup() {
		const iframe = ref<HTMLIFrameElement | null>(null);
		tracker = useZalipWatchProgress(context, iframe, saved);
		return () => h('iframe', { ref: iframe, src: context.value?.iframeUrl, key: context.value?.episodeId ?? 'movie' });
	} });
	const view = render(Host);
	const frame = () => view.container.querySelector('iframe')!;
	function event(key: string, value?: unknown, options: Partial<MessageEventInit> = {}) {
		window.dispatchEvent(new MessageEvent('message', { origin: 'https://kodik.example', source: frame().contentWindow, data: { key, value }, ...options }));
	}
	async function start(value: WatchPlayerContext = target) {
		context.value = { ...value };
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ episodeId: value.episodeId })));
		await nextTick(); await Promise.resolve();
	}
	const identity = (season: number | null = 2, episode: number | null = 1, translationId = 718) => event('kodik_player_current_episode', { season, episode, translation: { id: translationId, title: 'Studio' } });
	return { view, context, saved, frame, event, identity, start, tracker: () => tracker };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(misskeyApiZalip).mockReset();
	$i!.id = 'viewer';
	Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: nativeSubtle });
	(window as unknown as HappyWindow).happyDOM.settings.navigation.disableChildFrameNavigation = true;
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => {
		if (endpoint === 'zalip/progress/start') return { sessionId: `session-${params?.episodeId}`, sequence: 0, progress: { ...progress, ...params } };
		if (endpoint === 'zalip/progress/update') return { accepted: true, progress: { ...progress, ...params } };
		throw new Error(`Unexpected endpoint: ${endpoint}`);
	});
});
afterEach(() => { cleanup(); Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: nativeSubtle }); });

describe('secure playback progress lifecycle', () => {
	it('does not create a session on a title view; only an explicit opened player has a target', async () => {
		setup(); await nextTick();
		expect(misskeyApiZalip).not.toHaveBeenCalled();
	});
	it('waits for both the exact voice/canonical context and a valid duration before saving', async () => {
		const host = setup(); await host.start();
		host.event('kodik_player_play'); host.event('kodik_player_time_update', 25); host.event('kodik_player_pause');
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/update', expect.anything(), expect.anything());
		host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 25); host.event('kodik_player_pause');
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/update', expect.objectContaining({ positionSeconds: 25, durationSeconds: 1000 }), { keepalive: false }));
	});
	it('rejects another same-origin window and stale old iframe events after an episode change', async () => {
		const host = setup(); await host.start();
		const oldSource = host.frame().contentWindow;
		host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play');
		host.event('kodik_player_time_update', 50, { source: window }); host.event('kodik_player_pause');
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update')).toHaveLength(0);
		await host.start({ ...target, episodeId: 'episode2', episodeNumber: 2 });
		host.event('kodik_player_current_episode', { season: 2, episode: 1, translation: { id: 718 } }, { source: oldSource });
		host.event('kodik_player_time_update', 90, { source: oldSource });
		expect(host.tracker().state.value).not.toBe('unmapped');
		host.identity(2, 2); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 10); host.event('kodik_player_pause');
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/update', expect.objectContaining({ sessionId: 'session-episode2', positionSeconds: 10 }), { keepalive: false }));
	});
	it('uses an exact-origin one-time seek only after concrete-episode identity and duration, never autoplay', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'session', sequence: 0, progress: { ...progress, positionSeconds: 120, durationSeconds: 1000 } });
		const host = setup(); await host.start({ ...target, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.event('kodik_player_duration_update', 1000);
		expect(post).not.toHaveBeenCalled();
		host.identity(null, null);
		expect(post).toHaveBeenCalledWith({ key: 'kodik_player_api', value: { method: 'seek', seconds: 120 } }, 'https://kodik.example');
		host.event('kodik_player_duration_update', 1000);
		expect(post).toHaveBeenCalledTimes(1);
		host.event('kodik_player_play'); host.event('kodik_player_time_update', 0); host.event('kodik_player_pause');
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update')).toHaveLength(0);
		host.event('kodik_player_play'); host.event('kodik_player_time_update', 121); host.event('kodik_player_pause');
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/update', expect.objectContaining({ positionSeconds: 121 }), { keepalive: false }));
		expect(post.mock.calls.some(call => (call[0] as { value: { method: string } }).value.method === 'play')).toBe(false);
	});
	it('does not seek an old show offset when start invalidates the media fingerprint', async () => {
		const host = setup(); await host.start({ ...target, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.identity(null, null); host.event('kodik_player_duration_update', 1000);
		expect(post).not.toHaveBeenCalled();
	});
	it('does not claim time tracking when browser hashing is unavailable, nor sends any URL in a claim', async () => {
		Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: undefined });
		const host = setup();
		host.context.value = { ...target };
		await waitFor(() => expect(host.tracker().state.value).toBe('failed'));
		expect(misskeyApiZalip).not.toHaveBeenCalled();
	});
	it('does not write seconds or seek when the server rejects the mounted resource fingerprint', async () => {
		vi.mocked(misskeyApiZalip).mockRejectedValueOnce({ code: 'ZALIP_PROGRESS_UNAVAILABLE' });
		const host = setup(); await host.start({ ...target, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.identity(null, null); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 120); host.event('kodik_player_pause');
		expect(host.tracker().state.value).toBe('failed');
		expect(post).not.toHaveBeenCalled();
		const calls = vi.mocked(misskeyApiZalip).mock.calls;
		expect(calls).toHaveLength(1);
		expect(calls[0][1]).toMatchObject({ expectedResourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) });
		expect(JSON.stringify(calls[0][1])).not.toContain('https://');
	});
	it('stops time attribution on an internal different voice or canonical episode and never guesses by title', async () => {
		const host = setup(); await host.start();
		host.identity(2, 1, 999);
		host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 25); host.event('kodik_player_pause');
		expect(host.tracker().state.value).toBe('unmapped');
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update')).toHaveLength(0);
	});
	it('remembers unsupported-provider episode choices without sending invented seconds', async () => {
		const host = setup(); await host.start({ ...target, provider: 'collaps', providerTranslationId: null, iframeUrl: 'https://collaps.example/embed/1' });
		host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 25); host.event('kodik_player_pause');
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update')).toHaveLength(0);
		expect(host.saved).toHaveBeenCalledTimes(1);
	});
	it('serializes start claims so a delayed old start cannot revoke the new episode session', async () => {
		let release!: (result: unknown) => void;
		vi.mocked(misskeyApiZalip).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
		const host = setup(); await host.start();
		host.context.value = { ...target, episodeId: 'episode2', episodeNumber: 2 };
		await nextTick(); await Promise.resolve();
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/start')).toHaveLength(1);
		release({ sessionId: 'old-session', sequence: 0, progress });
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ episodeId: 'episode2' })));
		expect(host.saved.mock.calls.some(call => call[0].episodeId === 'episode1')).toBe(false);
	});
	it('flushes on close with keepalive and removes its message listener', async () => {
		const host = setup(); await host.start();
		host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 50);
		host.view.unmount();
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/update', expect.objectContaining({ positionSeconds: 50 }), { keepalive: true }));
		const count = vi.mocked(misskeyApiZalip).mock.calls.length;
		window.dispatchEvent(new MessageEvent('message', { source: window, origin: 'https://kodik.example', data: { key: 'kodik_player_time_update', value: 100 } }));
		expect(misskeyApiZalip).toHaveBeenCalledTimes(count);
	});
	it('never sends a queued final update using a different account after the original request settles', async () => {
		const host = setup(); await host.start();
		let release!: (result: unknown) => void;
		const previous = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/progress/update' ? new Promise(resolve => { release = resolve; }) : previous(endpoint, params));
		host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 25); host.event('kodik_player_pause');
		host.event('kodik_player_play'); host.event('kodik_player_time_update', 30);
		$i!.id = 'other-viewer';
		host.view.unmount();
		release({ accepted: true, progress });
		await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update')).toHaveLength(1);
	});
	it('does not undo a completed video when pause or pagehide follows the ended event', async () => {
		const host = setup(); await host.start();
		host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 999); host.event('kodik_player_video_ended');
		await Promise.resolve(); await Promise.resolve();
		host.event('kodik_player_pause');
		window.dispatchEvent(new Event('pagehide'));
		await Promise.resolve(); await Promise.resolve();
		const updates = vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update');
		expect(updates.length).toBeGreaterThan(0);
		expect(updates.every(call => call[1]?.completed === true)).toBe(true);
	});
});
