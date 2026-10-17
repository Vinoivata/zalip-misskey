/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Window as HappyWindow } from 'happy-dom';
import Work from '@/pages/zalip/work.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import type { LegacyAllohaPlayback, PlaybackProviderSetting, PlaybackSource } from '@/utility/zalip-playback.js';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { enablePullToRefresh: false } } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }) }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ZalipDiscussionPanel.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/ZalipRatingDialog.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/MkModal.vue', () => ({ default: defineComponent({ emits: ['closed', 'click', 'esc'], setup(_, { slots, emit, expose }) {
	expose({ close: () => emit('closed') });
	return () => h('div', slots.default?.({ maxHeight: null }));
} }) }));

const serial = { id: 'work', slug: 'serial', kind: 'series', title: 'Series', originalTitle: null, description: 'Description', releaseYear: 2026, genres: [], runtimeMinutes: 40, posterPath: null, backdropPath: null, logoPath: null, seasons: [{ id: 'season2', seasonNumber: 2, title: 'Season 2', episodeCount: 3 }], galleryPaths: [], communityRating: null, ratingCount: 0, trailerYoutubeKey: 'fixtureTrailer' };
const testEpisodes = [1, 2, 3].map(number => ({ id: `episode${number}`, episodeNumber: number, title: `Episode ${number}`, stillPath: null, description: `Description ${number}`, airDate: null, runtimeMinutes: 40, discussionNoteId: null }));
const alloha: PlaybackSource = { source: 'alloha', label: 'Alloha Cinema', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture', quality: 'HD', translations: [{ id: '246', name: 'First Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=246', quality: 'HD' }, { id: '247', name: 'Second Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=247', quality: 'Full HD' }], episodes: [] };
const collaps: PlaybackSource = { source: 'collaps', label: 'Collaps Cinema', iframe: 'https://collaps.example/embed/fixture', quality: null, translations: [{ id: 'studio-one', name: 'Collaps One', iframe: 'https://collaps.example/embed/fixture?oneSound=Collaps%20One' }, { id: 'studio-two', name: 'Collaps Two', iframe: 'https://collaps.example/embed/fixture?oneSound=Collaps%20Two' }], episodes: [] };
const kodik: PlaybackSource = { source: 'kodik', label: 'Kodik Cinema', iframe: 'https://kodik.example/serial/123/default/720p', quality: 'HD', translations: [{ id: 'serial-123', name: 'Kodik One', iframe: 'https://kodik.example/serial/123/voice-one/720p', episodes: [{ seasonNumber: 2, episodeNumber: 1 }] }, { id: 'serial-456', name: 'Kodik Two', iframe: 'https://kodik.example/serial/456/voice-two/720p', episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] }], episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] };
const legacy: LegacyAllohaPlayback = { available: true, label: 'Legacy Alloha', iframe: 'https://legacy.example/?token_movie=fixture', translations: [{ id: 246, name: 'Legacy First', iframe: 'https://legacy.example/?token_movie=fixture&translation=246', quality: null, resolutions: [] }, { id: 247, name: 'Legacy Second', iframe: 'https://legacy.example/?token_movie=fixture&translation=247', quality: null, resolutions: [] }], lastCheckedAt: null };
let sources: PlaybackSource[];
let legacyPlayback: LegacyAllohaPlayback;
let providers: PlaybackProviderSetting[] | undefined;
let failLegacy: boolean;
let failSources: boolean;
let workData: typeof serial;
let savedProgress: WatchProgress | null;

function setup() {
	return render(Work, { props: { slug: serial.slug }, global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

function player(view: ReturnType<typeof setup>) {
	return within(view.getByRole('region', { name: i18n.ts.zalip.playerTab }));
}

function iframe(view: ReturnType<typeof setup>): HTMLIFrameElement {
	return view.container.querySelector(`iframe[title="${i18n.ts.zalip.playerTab}: ${serial.title}"]`)!;
}

async function play(view: ReturnType<typeof setup>) {
	await view.findByRole('heading', { name: serial.title, level: 1 });
	await fireEvent.click(player(view).getByRole('button', { name: i18n.ts.zalip.watchTitle }));
	await waitFor(() => expect(iframe(view)).not.toBeNull());
}

async function chooseEpisode(view: ReturnType<typeof setup>, number: number) {
	await fireEvent.click(player(view).getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 1 }), expanded: false }));
	await fireEvent.click(within(view.getByRole('dialog', { name: i18n.ts.zalip.workEpisodes })).getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number }) }));
}

async function openVoices(view: ReturnType<typeof setup>, label: string) {
	await fireEvent.click(player(view).getByRole('button', { name: `${i18n.ts.zalip.playerVoices}: ${label}` }));
	return within(view.getByRole('dialog', { name: i18n.ts.zalip.playerVoices }));
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
	(window as unknown as HappyWindow).happyDOM.settings.navigation.disableChildFrameNavigation = true;
	sources = structuredClone([alloha, collaps]);
	legacyPlayback = { ...legacy, available: false, iframe: null, translations: [] };
	providers = undefined;
	failLegacy = false;
	failSources = false;
	workData = structuredClone(serial);
	savedProgress = null;
	HTMLElement.prototype.scrollTo = vi.fn();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => {
		if (endpoint === 'zalip/works/show') return workData;
		if (endpoint === 'zalip/seasons/episodes') return testEpisodes;
		if (endpoint === 'zalip/discussions/show') return { noteId: null };
		if (endpoint === 'zalip/library/list') return [];
		if (endpoint === 'zalip/taxonomy/show') return { entries: [] };
		if (endpoint === 'zalip/progress/show') return { progress: savedProgress };
		if (endpoint === 'zalip/progress/start') return { sessionId: 'session', sequence: 0, progress: { ...savedProgress, ...params, completed: false } };
		if (endpoint === 'zalip/progress/update') return { accepted: true, progress: { ...savedProgress, ...params } };
		if (endpoint === 'zalip/progress/reset') return { cleared: true };
		if (endpoint === 'zalip/playback/alloha/show') {
			if (failLegacy) throw new Error('Legacy unavailable');
			return legacyPlayback;
		}
		if (endpoint === 'zalip/playback/sources') {
			if (failSources) throw new Error('Sources unavailable');
			return { sources, providers };
		}
		throw new Error(`Unexpected endpoint: ${endpoint}`);
	});
});
afterEach(cleanup);

describe('Zalip work playback selection', () => {
	it('offers real saved playback without autoplay and restores the exact available episode and edition only on a resume click', async () => {
		sources = [structuredClone(kodik)];
		sources[0].translations[1].providerTranslationId = '719';
		savedProgress = { workId: 'work', episodeId: 'episode3', seasonNumber: 2, episodeNumber: 3, provider: 'kodik', translationId: 'serial-456', mode: 'time', positionSeconds: 600, durationSeconds: 2400, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z' };
		const view = setup();
		await view.findByRole('button', { name: i18n.tsx.zalip._progress.resumeAt({ time: '10:00' }) });
		expect(iframe(view)).toBeNull();
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/progress/start')).toBe(false);
		await fireEvent.click(view.getByRole('button', { name: i18n.tsx.zalip._progress.resumeAt({ time: '10:00' }) }));
		await waitFor(() => expect(iframe(view)).not.toBeNull());
		expect(new URL(iframe(view).src).pathname).toBe('/serial/456/voice-two/720p');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		expect(new URL(iframe(view).src).searchParams.get('only_episode')).toBe('true');
		const post = vi.spyOn(iframe(view).contentWindow!, 'postMessage').mockImplementation(() => {});
		const message = (key: string, value: unknown) => window.dispatchEvent(new MessageEvent('message', { source: iframe(view).contentWindow, origin: 'https://kodik.example', data: { key, value } }));
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ workId: 'work', episodeId: 'episode3', provider: 'kodik', translationId: 'serial-456', expectedResourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) })));
		message('kodik_player_current_episode', { season: null, episode: null, translation: { id: 719 } });
		message('kodik_player_duration_update', 2400);
		expect(post).toHaveBeenCalledWith({ key: 'kodik_player_api', value: { method: 'seek', seconds: 600 } }, 'https://kodik.example');
		await fireEvent.click(view.container.querySelector('[data-episode-id="episode1"]')!);
		await nextTick();
		const nextPost = vi.spyOn(iframe(view).contentWindow!, 'postMessage').mockImplementation(() => {});
		message('kodik_player_current_episode', { season: null, episode: null, translation: { id: 719 } });
		message('kodik_player_duration_update', 2400);
		expect(nextPost.mock.calls.some(call => (call[0] as { value: { method: string } }).value.method === 'seek')).toBe(false);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/library/update')).toBe(false);
	});
	it('does not transfer a saved timestamp to another unavailable provider or voice', async () => {
		savedProgress = { workId: 'work', episodeId: 'episode1', seasonNumber: 2, episodeNumber: 1, provider: 'kodik', translationId: 'serial-missing', mode: 'time', positionSeconds: 600, durationSeconds: 2400, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z' };
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.tsx.zalip._progress.resumeAt({ time: '10:00' }) }));
		await view.findByText(i18n.ts.zalip._progress.resumeUnavailable);
		expect(iframe(view)).toBeNull();
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/progress/start')).toBe(false);
	});
	it('switches modern Alloha voice iframe and retains the current season and episode', async () => {
		const view = setup();
		await play(view);
		await chooseEpisode(view, 3);
		const voices = await openVoices(view, 'First Studio');
		await fireEvent.click(voices.getByRole('button', { name: 'Second Studio Full HD' }));
		const url = new URL(iframe(view).src);
		expect(url.searchParams.get('translation')).toBe('247');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('episode')).toBe('3');
		expect(url.searchParams.get('token')).toBe('public-fixture');
		expect(view.queryByRole('dialog', { name: i18n.ts.zalip.playerVoices })).toBeNull();
		expect(player(view).getByRole('button', { name: `${i18n.ts.zalip.playerVoices}: Second Studio` })).toBeTruthy();
		expect(player(view).queryByText(i18n.ts.zalip._importer.nativeVoicesHint)).toBeNull();
	});

	it('switches modern Collaps voices using the server iframe, including nonnumeric IDs', async () => {
		sources = [structuredClone(collaps)];
		const view = setup();
		await play(view);
		const voices = await openVoices(view, 'Collaps One');
		await fireEvent.click(voices.getByRole('button', { name: 'Collaps Two' }));
		const url = new URL(iframe(view).src);
		expect(url.hostname).toBe('collaps.example');
		expect(url.searchParams.get('oneSound')).toBe('Collaps Two');
		expect(url.searchParams.has('translation')).toBe(false);
		expect(url.searchParams.get('episode')).toBe('1');
	});
	it('switches Kodik voice editions without inventing translation parameters or resetting the episode', async () => {
		sources = [structuredClone(kodik)];
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).pathname).toBe('/serial/123/voice-one/720p');
		await chooseEpisode(view, 3);
		expect(iframe(view)).toBeNull();
		expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodeUnavailable);
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		await fireEvent.click((await openVoices(view, 'Kodik One')).getByRole('button', { name: 'Kodik Two' }));
		const url = new URL(iframe(view).src);
		expect(url.pathname).toBe('/serial/456/voice-two/720p');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('episode')).toBe('3');
		expect(url.searchParams.has('translation')).toBe(false);
		expect(url.searchParams.has('oneSound')).toBe(false);
		expect(player(view).queryByText(i18n.ts.zalip.playerEpisodeUnavailable)).toBeNull();
	});
	it('keeps another provider selectable when the selected Kodik voice has no matching episode', async () => {
		sources = structuredClone([alloha, collaps, kodik]);
		const view = setup();
		await play(view);
		await chooseEpisode(view, 3);
		const sourceTabs = within(player(view).getByRole('group', { name: i18n.ts.zalip._importer.workSources }));
		await fireEvent.click(sourceTabs.getByRole('button', { name: 'Kodik Cinema' }));
		expect(iframe(view)).toBeNull();
		expect(player(view).getByText(i18n.ts.zalip.playerEpisodeUnavailable)).toBeTruthy();
		await fireEvent.click(sourceTabs.getByRole('button', { name: 'Collaps Cinema' }));
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		await fireEvent.click(sourceTabs.getByRole('button', { name: 'Alloha Cinema' }));
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('246');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
	});
	it('does not offer play for known empty Kodik coverage but retains working voice choices', async () => {
		sources = [{ ...structuredClone(kodik), translations: [{ ...kodik.translations[0], episodes: [] }, kodik.translations[1]] }];
		const view = setup();
		await view.findByRole('heading', { name: serial.title, level: 1 });
		expect(player(view).getByText(i18n.ts.zalip.playerEpisodeUnavailable)).toBeTruthy();
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		await fireEvent.click((await openVoices(view, 'Kodik One')).getByRole('button', { name: 'Kodik Two' }));
		await fireEvent.click(player(view).getByRole('button', { name: i18n.ts.zalip.watchTitle }));
		expect(new URL(iframe(view).src).pathname).toBe('/serial/456/voice-two/720p');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('1');
	});
	it('distinguishes Kodik subtitles from voices without altering the edition ID or iframe', async () => {
		sources = [{ ...structuredClone(kodik), translations: [{ ...kodik.translations[0], type: 'subtitles' }, { ...kodik.translations[1], type: 'voice' }] }];
		const view = setup();
		await play(view);
		const label = `Kodik One · ${i18n.ts.zalip.playerSubtitles}`;
		const voices = await openVoices(view, label);
		expect(voices.getByRole('button', { name: label, pressed: true })).toBeTruthy();
		await fireEvent.update(voices.getByRole('searchbox', { name: i18n.ts.zalip.playerVoiceSearch }), i18n.ts.zalip.playerSubtitles);
		expect(voices.queryByRole('button', { name: 'Kodik Two' })).toBeNull();
		await fireEvent.update(voices.getByRole('searchbox', { name: i18n.ts.zalip.playerVoiceSearch }), '');
		await fireEvent.click(voices.getByRole('button', { name: 'Kodik Two' }));
		expect(new URL(iframe(view).src).pathname).toBe('/serial/456/voice-two/720p');
		expect(player(view).getByRole('button', { name: `${i18n.ts.zalip.playerVoices}: Kodik Two` })).toBeTruthy();
	});
	it('does not open the Kodik default episode while another canonical season is loading', async () => {
		sources = [{ ...structuredClone(kodik), translations: [{ ...kodik.translations[0], episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 3, episodeNumber: 1 }] }] }];
		workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 });
		const view = setup();
		await play(view);
		let releaseEpisodes: (episodes: typeof testEpisodes) => void = () => { throw new Error('Episode request has not started'); };
		const pendingEpisodes = new Promise<typeof testEpisodes>(resolve => { releaseEpisodes = resolve; });
		const previousApi = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' ? pendingEpisodes : previousApi(endpoint, params));
		await fireEvent.click(player(view).getByRole('button', { name: '3', pressed: false }));
		expect(iframe(view)).toBeNull();
		expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoading);
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		releaseEpisodes(testEpisodes.map(episode => ({ ...episode, id: `season3-${episode.id}` })));
		await waitFor(() => expect(iframe(view)).not.toBeNull());
		expect(new URL(iframe(view).src).searchParams.get('season')).toBe('3');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('1');
	});
	it('keeps Kodik blocked after canonical episode loading fails and permits a successful retry', async () => {
		sources = [structuredClone(kodik)];
		workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 });
		const view = setup();
		await play(view);
		const previousApi = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' ? Promise.reject(new Error('Episode request failed')) : previousApi(endpoint, params));
		await fireEvent.click(player(view).getByRole('button', { name: '3', pressed: false }));
		await waitFor(() => expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodeUnavailable));
		expect(iframe(view)).toBeNull();
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		vi.mocked(misskeyApiZalip).mockImplementation(previousApi);
		await fireEvent.click(player(view).getByRole('button', { name: '2', pressed: false }));
		await waitFor(() => expect(iframe(view)).not.toBeNull());
		expect(new URL(iframe(view).src).searchParams.get('season')).toBe('2');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('1');
	});
	it('keeps native-selector Kodik series without canonical seasons playable', async () => {
		sources = [structuredClone(kodik)];
		workData.seasons = [];
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).pathname).toBe('/serial/123/voice-one/720p');
		expect(new URL(iframe(view).src).searchParams.has('episode')).toBe(false);
		expect(player(view).queryByText(i18n.ts.zalip.playerEpisodeUnavailable)).toBeNull();
	});

	it('changes the playing provider immediately and remembers voices without resetting the episode', async () => {
		const view = setup();
		await play(view);
		await chooseEpisode(view, 3);
		await fireEvent.click((await openVoices(view, 'First Studio')).getByRole('button', { name: 'Second Studio Full HD' }));
		const sourceTabs = within(player(view).getByRole('group', { name: i18n.ts.zalip._importer.workSources }));
		await fireEvent.click(sourceTabs.getByRole('button', { name: 'Collaps Cinema' }));
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		await fireEvent.click(sourceTabs.getByRole('button', { name: 'Alloha Cinema' }));
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
	});

	it('offers provider and voice choices in the same drawer for mobile users', async () => {
		const view = setup();
		await play(view);
		const voices = await openVoices(view, 'First Studio');
		await fireEvent.click(voices.getByRole('button', { name: 'Collaps Cinema' }));
		expect(voices.getByRole('button', { name: 'Collaps One', pressed: true })).toBeTruthy();
		await fireEvent.click(voices.getByRole('button', { name: 'Collaps Two' }));
		expect(new URL(iframe(view).src).searchParams.get('oneSound')).toBe('Collaps Two');
	});

	it('does not close or recreate the iframe when the active provider is selected again', async () => {
		const view = setup();
		await play(view);
		await fireEvent.click((await openVoices(view, 'First Studio')).getByRole('button', { name: 'Second Studio Full HD' }));
		const before = iframe(view);
		await fireEvent.click(player(view).getByRole('button', { name: 'Alloha Cinema', pressed: true }));
		expect(iframe(view)).toBe(before);
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
	});

	it('returns from the trailer to the newly selected provider and current episode', async () => {
		const view = setup();
		await play(view);
		await chooseEpisode(view, 3);
		await fireEvent.click(player(view).getByRole('button', { name: i18n.ts.zalip.trailerTab }));
		expect(view.container.querySelector('iframe')?.src).toContain('youtube-nocookie.com');
		await fireEvent.click(player(view).getByRole('button', { name: 'Collaps Cinema' }));
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
	});

	it('returns from the trailer when the current provider is explicitly selected without resetting its voice', async () => {
		const view = setup();
		await play(view);
		await chooseEpisode(view, 3);
		await fireEvent.click((await openVoices(view, 'First Studio')).getByRole('button', { name: 'Second Studio Full HD' }));
		await fireEvent.click(player(view).getByRole('button', { name: i18n.ts.zalip.trailerTab }));
		await fireEvent.click(player(view).getByRole('button', { name: 'Alloha Cinema', pressed: true }));
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
	});

	it('uses native controls rather than an empty picker when a provider has no controllable voices', async () => {
		sources = [{ ...collaps, translations: [{ id: 'metadata-only', name: 'Inside the player' }] }];
		const view = setup();
		await play(view);
		expect(player(view).getByText(i18n.ts.zalip._importer.nativeVoicesHint)).toBeTruthy();
		expect(player(view).queryByRole('button', { name: `${i18n.ts.zalip.playerVoices}: Collaps Cinema` })).toBeNull();
		expect(view.queryByRole('dialog', { name: i18n.ts.zalip.playerVoices })).toBeNull();
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
	});

	it('keeps provider switching available for native-only playback without displaying empty voice search', async () => {
		sources = [{ ...collaps, translations: [] }, structuredClone(alloha)];
		const view = setup();
		await play(view);
		const voices = await openVoices(view, 'Collaps Cinema');
		expect(voices.queryByRole('searchbox')).toBeNull();
		expect(voices.getByText(i18n.ts.zalip._importer.nativeVoicesHint)).toBeTruthy();
		await fireEvent.click(voices.getByRole('button', { name: 'Alloha Cinema' }));
		expect(voices.getByRole('searchbox', { name: i18n.ts.zalip.playerVoiceSearch })).toBeTruthy();
		await fireEvent.click(voices.getByRole('button', { name: 'Second Studio Full HD' }));
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
	});

	it('retains the legacy Alloha picker and normalizes numeric translation IDs', async () => {
		sources = [];
		legacyPlayback = structuredClone(legacy);
		const view = setup();
		await play(view);
		await fireEvent.click((await openVoices(view, 'Legacy First')).getByRole('button', { name: 'Legacy Second' }));
		expect(new URL(iframe(view).src).hostname).toBe('legacy.example');
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
	});

	it('makes legacy Alloha selectable beside imported Collaps without replacing Collaps playback', async () => {
		sources = [structuredClone(collaps)];
		legacyPlayback = structuredClone(legacy);
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
		const voices = await openVoices(view, 'Collaps One');
		await fireEvent.click(voices.getByRole('button', { name: 'Legacy Alloha' }));
		await fireEvent.click(voices.getByRole('button', { name: 'Legacy Second' }));
		expect(new URL(iframe(view).src).hostname).toBe('legacy.example');
	});

	it('does not resurrect legacy Alloha when the provider policy disables it', async () => {
		sources = [structuredClone(collaps)];
		legacyPlayback = structuredClone(legacy);
		providers = [{ source: 'alloha', label: 'Disabled Alloha', enabled: false, position: 0 }, { source: 'collaps', label: collaps.label, enabled: true, position: 1 }];
		const view = setup();
		await play(view);
		expect(player(view).queryByRole('button', { name: 'Disabled Alloha' })).toBeNull();
		expect(player(view).queryByRole('button', { name: 'Legacy Alloha' })).toBeNull();
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
	});

	it('does not depend on legacy availability for a modern source', async () => {
		failLegacy = true;
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).hostname).toBe('alloha.example');
		expect(player(view).getByRole('button', { name: `${i18n.ts.zalip.playerVoices}: First Studio` })).toBeTruthy();
	});

	it('keeps legacy playback available if the sources endpoint fails', async () => {
		failSources = true;
		legacyPlayback = structuredClone(legacy);
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).hostname).toBe('legacy.example');
	});
});
