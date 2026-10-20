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
const allohaTarget: WatchPlayerContext = { ...target, provider: 'alloha', translationId: '246', providerTranslationId: null, iframeUrl: 'https://alloha.example/player?token_movie=title-fixture&token=public-fixture&translation=246&hidden=episode,season,translation&season=2&episode=1' };
const collapsTarget: WatchPlayerContext = { ...target, provider: 'collaps', translationId: 'voice-one', providerTranslationId: null, iframeUrl: 'https://collaps.example/embed/movie/50?oneSound=Studio&showMenu=false&showPreNext=false&season=2&episode=1' };
const collapsMovieTarget: WatchPlayerContext = { ...collapsTarget, workId: 'movie315635', episodeId: null, seasonNumber: null, episodeNumber: null, iframeUrl: 'https://collaps.example/embed/movie/50?oneSound=Studio&showMenu=false&showPreNext=false' };
const progress = { ...target, mode: 'time', positionSeconds: null, durationSeconds: null, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z' };
const nativeSubtle = webcrypto.subtle;

function setup(withRemount = true) {
	const context = ref<WatchPlayerContext | null>(null);
	const overrideUrl = ref<string | null>(null);
	const revision = ref(0);
	const saved = vi.fn();
	let tracker!: ReturnType<typeof useZalipWatchProgress>;
	const Host = defineComponent({ setup() {
		const iframe = ref<HTMLIFrameElement | null>(null);
		const remount = async (url: string) => { overrideUrl.value = url; revision.value++; await nextTick(); };
		tracker = useZalipWatchProgress(context, iframe, saved, withRemount ? remount : undefined);
		return () => h('iframe', { ref: iframe, src: overrideUrl.value ?? context.value?.iframeUrl, srcdoc: context.value?.iframeDocument, key: [context.value?.provider, context.value?.translationId, context.value?.episodeId ?? 'movie', revision.value].join(':') });
	} });
	const view = render(Host);
	const frame = () => view.container.querySelector('iframe')!;
	function dispatch(data: unknown, options: Partial<MessageEventInit> = {}) { window.dispatchEvent(new MessageEvent('message', { origin: new URL(frame().src).origin, source: frame().contentWindow, data, ...options })); }
	const event = (key: string, value?: unknown, options: Partial<MessageEventInit> = {}) => dispatch({ key, value }, options);
	const alloha = (event: string, time: number, options: Partial<MessageEventInit> = {}) => dispatch(JSON.stringify({ event, time }), options);
	const collaps = (event: string, fields: Record<string, unknown> = {}, options: Partial<MessageEventInit> = {}) => dispatch({ event, ...fields }, options);
	async function start(value: WatchPlayerContext = target) {
		overrideUrl.value = null;
		context.value = { ...value };
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ episodeId: value.episodeId, provider: value.provider, translationId: value.translationId })));
		await nextTick(); await Promise.resolve();
	}
	const identity = (season: number | null = 2, episode: number | null = 1, translationId = 718) => event('kodik_player_current_episode', { season, episode, translation: { id: translationId, title: 'Studio' } });
	return { view, context, saved, frame, dispatch, event, alloha, collaps, identity, start, tracker: () => tracker };
}

const updates = () => vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/update');
function content(host: ReturnType<typeof setup>, value: WatchPlayerContext, position = 25, options: Partial<MessageEventInit> = {}): void {
	if (value.provider === 'alloha') {
		host.alloha('duration', 1000, options); host.alloha('play', position, options); host.alloha('timeupdate', position, options); host.alloha('pause', position, options);
	} else if (value.provider === 'collaps') {
		host.collaps('startWatching', { id: 7 }, options); host.collaps('viewProgress', { id: 7, time: position, duration: 1000 }, options); host.tracker().flush();
	} else {
		host.event('kodik_player_current_episode', { season: value.seasonNumber, episode: value.episodeNumber, translation: { id: 718 } }, options);
		host.event('kodik_player_duration_update', 1000, options); host.event('kodik_player_play', undefined, options); host.event('kodik_player_time_update', position, options); host.event('kodik_player_pause', undefined, options);
	}
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(misskeyApiZalip).mockReset();
	$i!.id = 'viewer';
	Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: nativeSubtle });
	(window as unknown as HappyWindow).happyDOM.settings.navigation.disableChildFrameNavigation = true;
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => {
		if (endpoint === 'zalip/progress/start') return { sessionId: `session-${params?.episodeId}`, sequence: 0, progress: { ...progress, ...params, mode: params?.expectedResourceFingerprint ? 'time' : 'episode' } };
		if (endpoint === 'zalip/progress/update') return { accepted: true, progress: { ...progress, ...params } };
		throw new Error(`Unexpected endpoint: ${endpoint}`);
	});
});
afterEach(() => { cleanup(); Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: nativeSubtle }); });

describe('secure playback progress lifecycle', () => {
	it.each([null, 'episode1'])('keeps Vibix %s progress episode-only and ignores every other provider event or seek command', async episodeId => {
		const vibix: WatchPlayerContext = { ...target, provider: 'vibix', episodeId, translationId: '26', providerTranslationId: null, iframeUrl: 'blob:https://zalip.example/vibix-fixture', resumeSeconds: 120 };
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'vibix-session', sequence: 0, progress: { ...progress, ...vibix, mode: 'episode', positionSeconds: null, durationSeconds: null } });
		const host = setup(); await host.start(vibix); const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.alloha('play', 120, { origin: 'null' }); host.alloha('duration', 1000, { origin: 'null' }); host.alloha('timeupdate', 121, { origin: 'null' }); host.collaps('viewProgress', { id: 7, time: 121, duration: 1000 }, { origin: 'null' }); host.identity(); host.event('kodik_player_duration_update', 1000); host.event('kodik_player_play'); host.event('kodik_player_time_update', 120); host.event('kodik_player_pause'); host.tracker().flush(); host.view.unmount();
		expect(post).not.toHaveBeenCalled(); expect(updates()).toHaveLength(0); expect(host.saved).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ provider: 'vibix', mode: 'episode', positionSeconds: null, durationSeconds: null }));
		expect(vi.mocked(misskeyApiZalip)).toHaveBeenCalledExactlyOnceWith('zalip/progress/start', { workId: 'work', episodeId, provider: 'vibix', translationId: '26' });
	});
	it('rejects a fabricated Vibix time-mode claim without accepting any provider messages', async () => {
		const vibix: WatchPlayerContext = { ...target, provider: 'vibix', translationId: '26', providerTranslationId: null, iframeUrl: 'blob:https://zalip.example/vibix-fixture', resumeSeconds: 120 };
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'bad-mode', sequence: 0, progress: { ...progress, ...vibix, mode: 'time' } });
		const host = setup(); await host.start(vibix); expect(host.tracker().state.value).toBe('failed'); expect(host.saved).not.toHaveBeenCalled(); expect(updates()).toHaveLength(0);
	});
	it.each(['account', 'document'] as const)('discards a pending Vibix claim when its %s identity changes', async changed => {
		const vibix: WatchPlayerContext = { ...target, provider: 'vibix', translationId: '26', providerTranslationId: null, iframeUrl: 'about:srcdoc', iframeDocument: '<!doctype html><p>Fixture only</p>' };
		let release!: (value: unknown) => void; vi.mocked(misskeyApiZalip).mockImplementationOnce(() => new Promise(resolve => { release = resolve; })); const host = setup(); await host.start(vibix);
		if (changed === 'account') $i!.id = 'other-viewer'; else host.frame().srcdoc = '<p>Replaced document</p>';
		release({ sessionId: 'stale-vibix', sequence: 0, progress: { ...progress, ...vibix, mode: 'episode', positionSeconds: null, durationSeconds: null } }); await nextTick(); await Promise.resolve(); await Promise.resolve();
		expect(host.saved).not.toHaveBeenCalled(); expect(updates()).toHaveLength(0);
	});
	it('saves Alloha main-content time but not duration, fullscreen or storage-callback clocks', async () => {
		const host = setup(); await host.start(allohaTarget);
		host.alloha('duration', 1000); host.alloha('enterfullscreen', 900); host.dispatch(JSON.stringify({ event: 'getTimeSave', time: 800 }));
		host.tracker().flush(); expect(updates()).toHaveLength(0);
		host.alloha('timeupdate', 25); host.alloha('pause', 25);
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ positionSeconds: 25, durationSeconds: 1000 });
		expect(host.tracker().mode.value).toBe('time');
	});
	it('restores Alloha through one exact-origin JSON seek only after fresh claim and main-content duration/time', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'session', sequence: 0, progress: { ...progress, ...allohaTarget, positionSeconds: 120, durationSeconds: 1000 } });
		const host = setup(); await host.start({ ...allohaTarget, resumeSeconds: 999 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.alloha('duration', 1000); host.alloha('timeupdate', 0); host.alloha('pause', 0);
		expect(post.mock.calls.filter(call => JSON.parse(String(call[0])).api === 'seek')).toHaveLength(0);
		expect(updates()).toHaveLength(0);
		host.alloha('timeupdate', 1);
		expect(post).toHaveBeenCalledWith(JSON.stringify({ api: 'seek', value: 120 }), 'https://alloha.example');
		host.alloha('duration', 1000); host.alloha('timeupdate', 0); host.alloha('pause', 0);
		expect(updates()).toHaveLength(0);
		host.alloha('timeupdate', 121); host.alloha('pause', 121);
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ positionSeconds: 121 });
		expect(post.mock.calls.filter(call => JSON.parse(String(call[0])).api === 'seek')).toHaveLength(1);
		expect(post.mock.calls.some(call => JSON.parse(String(call[0])).api === 'play')).toBe(false);
	});
	it('saves a locked Alloha movie with null coordinates and a mounted resource fingerprint', async () => {
		const movie = { ...allohaTarget, episodeId: null, seasonNumber: null, episodeNumber: null, iframeUrl: allohaTarget.iframeUrl.replace('&season=2&episode=1', '') };
		const host = setup(); await host.start(movie);
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		content(host, movie);
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(vi.mocked(misskeyApiZalip).mock.calls[0][1]).toMatchObject({ episodeId: null, expectedResourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
		expect(host.tracker().mode.value).toBe('time');
		expect(updates()[0][1]).toMatchObject({ positionSeconds: 25, durationSeconds: 1000 });
		expect(post.mock.calls.some(call => JSON.parse(String(call[0])).api === 'seek')).toBe(false);
	});
	it('restores an Alloha movie only after its saved duration is observed, then saves the confirmed seek', async () => {
		const movie = { ...allohaTarget, episodeId: null, seasonNumber: null, episodeNumber: null, iframeUrl: allohaTarget.iframeUrl.replace('&season=2&episode=1', '') };
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'movie-session', sequence: 0, progress: { ...progress, ...movie, positionSeconds: 120, durationSeconds: 1000 } });
		const host = setup(); await host.start({ ...movie, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		host.alloha('duration', 1000); host.alloha('timeupdate', 1);
		expect(post).toHaveBeenCalledWith(JSON.stringify({ api: 'seek', value: 120 }), 'https://alloha.example');
		host.alloha('timeupdate', 121); host.alloha('pause', 121);
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ sessionId: 'movie-session', positionSeconds: 121, durationSeconds: 1000 });
	});
	it.each([{ ...allohaTarget, episodeId: null, seasonNumber: null, episodeNumber: null, iframeUrl: allohaTarget.iframeUrl.replace('&season=2&episode=1', '') }, collapsMovieTarget])('does not apply a saved offset to a different observed $provider cut', async value => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'session', sequence: 0, progress: { ...progress, ...value, positionSeconds: 120, durationSeconds: 900 } });
		const host = setup(); await host.start({ ...value, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		content(host, value, 120);
		expect(host.tracker().state.value).toBe('unmapped');
		expect(updates()).toHaveLength(0);
		expect(post.mock.calls.some(call => typeof call[0] === 'string' && JSON.parse(String(call[0])).api === 'seek')).toBe(false);
	});
	it('suppresses Collaps ad clocks and resumes saving main-content samples after midroll', async () => {
		const host = setup(); await host.start(collapsTarget);
		content(host, collapsTarget, 25); await waitFor(() => expect(updates()).toHaveLength(1));
		await nextTick(); await Promise.resolve(); await Promise.resolve();
		host.collaps('adStart'); host.collaps('viewProgress', { id: 7, time: 3, duration: 15 }); host.collaps('ended'); host.tracker().flush();
		expect(updates()).toHaveLength(1);
		host.collaps('adStop'); host.collaps('viewProgress', { id: 7, time: 26, duration: 1000 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(2));
		expect(updates()[1][1]).toMatchObject({ positionSeconds: 26, durationSeconds: 1000, completed: false });
	});
	it('stops Alloha attribution when the observed main-content duration changes', async () => {
		const host = setup(); await host.start(allohaTarget);
		host.alloha('duration', 1000); host.alloha('duration', 1100); content(host, allohaTarget);
		expect(host.tracker().state.value).toBe('unmapped'); expect(updates()).toHaveLength(0);
	});
	it('does not seek a stale Alloha show offset when the accepted fresh claim has no saved position', async () => {
		const host = setup(); await host.start({ ...allohaTarget, resumeSeconds: 120 });
		const post = vi.spyOn(host.frame().contentWindow!, 'postMessage').mockImplementation(() => {});
		content(host, allohaTarget);
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(post.mock.calls.some(call => JSON.parse(String(call[0])).api === 'seek')).toBe(false);
		expect(updates()[0][1]).toMatchObject({ positionSeconds: 25 });
	});
	it.each(['id', 'episode', 'duration'] as const)('stops Collaps attribution on a changed %s without guessing a new context', async changed => {
		const host = setup(); await host.start(collapsTarget);
		content(host, collapsTarget, 25); await waitFor(() => expect(updates()).toHaveLength(1));
		if (changed === 'id') host.collaps('startWatching', { id: 8 });
		else if (changed === 'episode') host.collaps('changeEpisode', { id: 7, season: 2, episode: 2 });
		else host.collaps('viewProgress', { id: 7, time: 26, duration: 1100 });
		host.collaps('viewProgress', { id: 7, time: 30, duration: 1000 }); host.tracker().flush();
		expect(host.tracker().state.value).toBe('unmapped'); expect(updates()).toHaveLength(1);
	});
	it.each(['initial', 'repeated'] as const)('keeps saving when Collaps announces the same canonical episode (%s)', async announcement => {
		const host = setup(); await host.start(collapsTarget);
		if (announcement === 'repeated') {
			content(host, collapsTarget, 25); await waitFor(() => expect(updates()).toHaveLength(1));
			await nextTick(); await Promise.resolve(); await Promise.resolve();
		}
		host.collaps('changeEpisode', { id: 7, season: 2, episode: 1 });
		if (announcement === 'initial') { host.tracker().flush(); expect(updates()).toHaveLength(0); }
		host.collaps('viewProgress', { id: 7, time: 30, duration: 1000 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(announcement === 'initial' ? 1 : 2));
		expect(updates().at(-1)![1]).toMatchObject({ positionSeconds: 30, durationSeconds: 1000 });
		expect(host.tracker().state.value).toBe('saved');
	});
	it.each(['id', 'season', 'movie'] as const)('rejects a Collaps episode announcement with a changed or unbound %s', async mismatch => {
		const host = setup(); await host.start(mismatch === 'movie' ? collapsMovieTarget : collapsTarget);
		host.collaps('startWatching', { id: 7 });
		host.collaps('changeEpisode', { id: mismatch === 'id' ? 8 : 7, season: mismatch === 'season' ? 3 : 2, episode: 1 });
		host.collaps('viewProgress', { id: 7, time: 30, duration: 1000 }); host.tracker().flush();
		expect(host.tracker().state.value).toBe('unmapped'); expect(updates()).toHaveLength(0);
	});
	it('retains the Collaps content-duration identity across midroll instead of accepting a new timeline', async () => {
		const host = setup(); await host.start(collapsTarget);
		content(host, collapsTarget, 25); await waitFor(() => expect(updates()).toHaveLength(1));
		host.collaps('adStart'); host.collaps('adStop'); host.collaps('viewProgress', { id: 7, time: 26, duration: 1100 }); host.tracker().flush();
		expect(host.tracker().state.value).toBe('unmapped'); expect(updates()).toHaveLength(1);
	});
	it('adds Collaps URL time only after the fresh accepted claim and ignores zero until restoration is confirmed', async () => {
		let release!: (result: unknown) => void;
		vi.mocked(misskeyApiZalip).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
		const host = setup(); await host.start({ ...collapsTarget, resumeSeconds: 999 });
		const oldFrame = host.frame();
		const oldSource = oldFrame.contentWindow;
		expect(new URL(host.frame().src).searchParams.has('time')).toBe(false);
		host.collaps('viewProgress', { id: 7, time: 0, duration: 1000 }); expect(updates()).toHaveLength(0);
		release({ sessionId: 'session', sequence: 0, progress: { ...progress, ...collapsTarget, positionSeconds: 120, durationSeconds: 1000 } });
		await waitFor(() => expect(new URL(host.frame().src).searchParams.get('time')).toBe('120'));
		await waitFor(() => expect(host.tracker().mode.value).toBe('time'));
		expect(host.frame()).not.toBe(oldFrame);
		expect(new URL(oldFrame.src).searchParams.has('time')).toBe(false);
		expect(vi.mocked(misskeyApiZalip).mock.calls[0][1]).toMatchObject({ expectedResourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
		expect(JSON.stringify(vi.mocked(misskeyApiZalip).mock.calls[0][1])).not.toContain('https://');
		host.collaps('adStart', {}, { source: oldSource });
		host.collaps('viewProgress', { id: 99, time: 120, duration: 1000 }, { source: oldSource });
		host.tracker().flush(); expect(updates()).toHaveLength(0);
		host.collaps('viewProgress', { id: 7, time: 0, duration: 1000 }); host.tracker().flush(); expect(updates()).toHaveLength(0);
		host.collaps('viewProgress', { id: 7, time: 121, duration: 1000 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(1)); expect(updates()[0][1]).toMatchObject({ positionSeconds: 121 });
	});
	it('saves a selected Collaps movie with a null canonical episode as confirmed time progress', async () => {
		const host = setup(); await host.start(collapsMovieTarget);
		await waitFor(() => expect(host.tracker().mode.value).toBe('time'));
		const claim = vi.mocked(misskeyApiZalip).mock.calls.find(call => call[0] === 'zalip/progress/start')?.[1];
		expect(claim).toMatchObject({ workId: 'movie315635', episodeId: null, provider: 'collaps', translationId: 'voice-one', expectedResourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
		expect(host.saved).toHaveBeenCalledWith(expect.objectContaining({ workId: 'movie315635', episodeId: null, provider: 'collaps', mode: 'time' }));
		const mounted = new URL(host.frame().src);
		expect(mounted.searchParams.has('season')).toBe(false);
		expect(mounted.searchParams.has('episode')).toBe(false);
		host.collaps('startWatching', { id: 7 });
		host.collaps('viewProgress', { id: 7, time: 120, duration: 7200 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ workId: 'movie315635', sessionId: 'session-null', sequence: 1, positionSeconds: 120, durationSeconds: 7200, completed: false });
	});
	it('restores a Collaps movie in a fresh iframe only after a fresh null-episode claim confirms the saved offset', async () => {
		let release!: (result: unknown) => void;
		vi.mocked(misskeyApiZalip).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
		const host = setup(); await host.start({ ...collapsMovieTarget, resumeSeconds: 999 });
		const oldFrame = host.frame();
		const oldSource = oldFrame.contentWindow;
		expect(new URL(oldFrame.src).searchParams.has('time')).toBe(false);
		host.collaps('viewProgress', { id: 7, time: 120, duration: 7200 }); host.tracker().flush();
		expect(updates()).toHaveLength(0);
		release({ sessionId: 'movie-resume-session', sequence: 0, progress: { ...progress, ...collapsMovieTarget, positionSeconds: 120, durationSeconds: 7200 } });
		await waitFor(() => expect(new URL(host.frame().src).searchParams.get('time')).toBe('120'));
		await waitFor(() => expect(host.tracker().mode.value).toBe('time'));
		expect(host.frame()).not.toBe(oldFrame);
		expect(host.frame().contentWindow === oldSource).toBe(false);
		expect(new URL(oldFrame.src).searchParams.has('time')).toBe(false);
		const resumed = new URL(host.frame().src);
		expect(resumed.searchParams.has('season')).toBe(false);
		expect(resumed.searchParams.has('episode')).toBe(false);
		expect(host.saved).toHaveBeenCalledWith(expect.objectContaining({ workId: 'movie315635', episodeId: null, provider: 'collaps', mode: 'time', positionSeconds: 120, durationSeconds: 7200 }));
		expect(vi.mocked(misskeyApiZalip).mock.calls[0][1]).toMatchObject({ workId: 'movie315635', episodeId: null, provider: 'collaps', expectedResourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) });
		expect(JSON.stringify(vi.mocked(misskeyApiZalip).mock.calls[0][1])).not.toContain('https://');
		host.collaps('adStart', {}, { source: oldSource });
		host.collaps('viewProgress', { id: 99, time: 120, duration: 7200 }, { source: oldSource });
		host.tracker().flush(); expect(updates()).toHaveLength(0);
		host.collaps('playerReady');
		host.collaps('startWatching', { id: 7 });
		host.collaps('viewProgress', { id: 7, time: 0, duration: 7200 }); host.tracker().flush();
		expect(updates()).toHaveLength(0);
		host.collaps('viewProgress', { id: 7, time: 120, duration: 7200 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ workId: 'movie315635', sessionId: 'movie-resume-session', sequence: 1, positionSeconds: 120, durationSeconds: 7200, completed: false });
		expect(host.tracker().state.value).not.toBe('unmapped');
	});
	it.each([61, 181, 242, 1000])('accepts a sparse or deliberately sought Collaps movie sample at %s without requiring an invented seek acknowledgement', async seconds => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'sparse-resume', sequence: 0, progress: { ...progress, ...collapsMovieTarget, positionSeconds: 120, durationSeconds: 7200 } });
		const host = setup(); await host.start({ ...collapsMovieTarget, resumeSeconds: 120 });
		await waitFor(() => expect(new URL(host.frame().src).searchParams.get('time')).toBe('120'));
		await waitFor(() => expect(host.tracker().mode.value).toBe('time'));
		host.collaps('viewProgress', { id: 7, time: 0, duration: 7200 }); host.tracker().flush();
		expect(updates()).toHaveLength(0);
		const timeout = vi.spyOn(window, 'setTimeout');
		host.collaps('viewProgress', { id: 7, time: seconds, duration: 7200 }); host.tracker().flush();
		await waitFor(() => expect(updates()).toHaveLength(1));
		expect(updates()[0][1]).toMatchObject({ positionSeconds: seconds, durationSeconds: 7200 });
		expect(timeout.mock.calls.some(call => call[1] === 15000)).toBe(false);
		expect(host.tracker().state.value).not.toBe('failed');
		timeout.mockRestore();
	});
	it('fails closed when Collaps resume cannot remount a new iframe window', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'session', sequence: 0, progress: { ...progress, ...collapsTarget, positionSeconds: 120, durationSeconds: 1000 } });
		const host = setup(false); await host.start({ ...collapsTarget, resumeSeconds: 120 });
		await waitFor(() => expect(host.tracker().state.value).toBe('failed'));
		expect(new URL(host.frame().src).searchParams.has('time')).toBe(false);
		content(host, collapsTarget, 120); expect(updates()).toHaveLength(0);
	});
	it.each([null, 'reject'] as const)('never restores a stale Collaps show offset when the fresh claim returns %s', async result => {
		if (result === 'reject') vi.mocked(misskeyApiZalip).mockRejectedValueOnce({ code: 'ZALIP_PROGRESS_UNAVAILABLE' });
		const host = setup(); await host.start({ ...collapsTarget, resumeSeconds: 120 });
		expect(new URL(host.frame().src).searchParams.has('time')).toBe(false);
		if (result === 'reject') { content(host, collapsTarget); expect(updates()).toHaveLength(0); expect(host.tracker().state.value).toBe('failed'); }
	});
	it('never stores seconds for a server episode-mode Collaps target without verified voice coverage', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ sessionId: 'session', sequence: 0, progress: { ...progress, ...collapsTarget, mode: 'episode' } });
		const host = setup(); await host.start({ ...collapsTarget, resumeSeconds: 120 });
		content(host, collapsTarget); expect(updates()).toHaveLength(0); expect(host.tracker().mode.value).toBe('episode');
		expect(new URL(host.frame().src).searchParams.has('time')).toBe(false);
	});
	it.each([allohaTarget, collapsTarget, target])('rejects wrong origins, other windows, old iframe windows and changed accounts for $provider', async value => {
		const host = setup(); await host.start(value);
		content(host, value, 25, { origin: `${new URL(value.iframeUrl).origin}.evil.test` });
		content(host, value, 25, { source: window }); expect(updates()).toHaveLength(0);
		const oldSource = host.frame().contentWindow;
		const next = { ...value, episodeId: 'episode2', episodeNumber: 2, iframeUrl: value.iframeUrl.replace('episode=1', 'episode=2') };
		await host.start(next); content(host, next, 25, { source: oldSource }); expect(updates()).toHaveLength(0);
		content(host, next, 25); await waitFor(() => expect(updates()).toHaveLength(1));
		$i!.id = 'another-viewer'; content(host, next, 30); host.tracker().flush(); expect(updates()).toHaveLength(1);
	});
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
