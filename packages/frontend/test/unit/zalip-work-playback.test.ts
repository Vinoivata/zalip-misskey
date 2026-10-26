/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick } from 'vue';
import type { Window as HappyWindow } from 'happy-dom';
import Work from '@/pages/zalip/work.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import type { LegacyAllohaPlayback, PlaybackProviderSetting, PlaybackSource } from '@/utility/zalip-playback.js';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
const mockedPreferences = vi.hoisted(() => ({ enablePullToRefresh: false }));
vi.mock('@/preferences.js', () => ({ prefer: { s: mockedPreferences } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: defineComponent({ props: ['refresher'], setup: (props, { slots }) => () => h('div', [h('button', { onClick: props.refresher }, 'Refresh work'), slots.default?.()]) }) }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ZalipDiscussionPanel.vue', () => ({ default: defineComponent({ props: ['noteId', 'heading'], setup: props => () => h('section', { 'data-testid': 'work-comments', 'data-note-id': props.noteId }, props.heading) }) }));
vi.mock('@/components/MkZalipReviewsPanel.vue', () => ({ default: defineComponent({ props: ['workId', 'workTitle', 'personalRating'], setup: props => () => h('div', { 'data-testid': 'work-reviews' }, props.workTitle) }) }));
vi.mock('@/components/ZalipRatingDialog.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/MkZalipImageGallery.vue', () => ({ default: defineComponent({ setup: () => () => h('div') }) }));
vi.mock('@/components/MkModal.vue', () => ({ default: defineComponent({ emits: ['closed', 'click', 'esc'], setup(_, { slots, emit, expose }) {
	expose({ close: () => emit('closed') });
	return () => h('div', slots.default?.({ maxHeight: null }));
} }) }));

const serial = { id: 'work', slug: 'serial', kind: 'series', title: 'Series', originalTitle: null, description: 'Description', releaseYear: 2026, genres: [], runtimeMinutes: 40, posterPath: null, backdropPath: null, logoPath: null, seasons: [{ id: 'season2', seasonNumber: 2, title: 'Season 2', episodeCount: 3 }], galleryPaths: [], communityRating: null, ratingCount: 0, trailerYoutubeKey: 'fixtureTrailer' };
const testEpisodes = [1, 2, 3].map(number => ({ id: `episode${number}`, episodeNumber: number, title: `Episode ${number}`, stillPath: null, description: `Description ${number}`, airDate: null, runtimeMinutes: 40, discussionNoteId: null }));
const alloha: PlaybackSource = { source: 'alloha', label: 'Alloha Cinema', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture', quality: 'HD', translations: [{ id: '246', name: 'First Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=246', quality: 'HD' }, { id: '247', name: 'Second Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=247', quality: 'Full HD' }], episodes: [] };
const collaps: PlaybackSource = { source: 'collaps', label: 'Collaps Cinema', iframe: 'https://collaps.example/embed/fixture', quality: null, translations: [{ id: 'studio-one', name: 'Collaps One', iframe: 'https://collaps.example/embed/fixture?oneSound=Collaps%20One' }, { id: 'studio-two', name: 'Collaps Two', iframe: 'https://collaps.example/embed/fixture?oneSound=Collaps%20Two' }], episodes: [] };
const kodik: PlaybackSource = { source: 'kodik', label: 'Kodik Cinema', iframe: 'https://kodik.example/serial/123/default/720p', quality: 'HD', translations: [{ id: 'serial-123', name: 'Kodik One', iframe: 'https://kodik.example/serial/123/voice-one/720p', episodes: [{ seasonNumber: 2, episodeNumber: 1 }] }, { id: 'serial-456', name: 'Kodik Two', iframe: 'https://kodik.example/serial/456/voice-two/720p', episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] }], episodes: [{ seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] };
const vibix: PlaybackSource = { source: 'vibix', label: 'Vibix Cinema', iframe: '', vibixEmbed: { publisherId: '123456789', type: 'series', id: '12345' }, quality: 'HD', translations: [{ id: '26', name: 'Vibix One' }, { id: '42', name: 'Vibix Two' }], episodes: [] };
const legacy: LegacyAllohaPlayback = { available: true, label: 'Legacy Alloha', iframe: 'https://legacy.example/?token_movie=fixture', translations: [{ id: 246, name: 'Legacy First', iframe: 'https://legacy.example/?token_movie=fixture&translation=246', quality: null, resolutions: [] }, { id: 247, name: 'Legacy Second', iframe: 'https://legacy.example/?token_movie=fixture&translation=247', quality: null, resolutions: [] }], lastCheckedAt: null };
let sources: PlaybackSource[];
let legacyPlayback: LegacyAllohaPlayback;
let providers: PlaybackProviderSetting[] | undefined;
let failLegacy: boolean;
let failSources: boolean;
let workData: typeof serial & { mediaType?: 'movie' | 'tv' | null };
let savedProgress: WatchProgress | null;
let previousDisabledLoadingPolicy: boolean;

const pageStubs = {
	PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
	MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
};

function setup(props: { initialSeason?: string; initialEpisode?: string; initialProvider?: string; initialTranslation?: string; watchPage?: boolean } = {}) {
	return render(Work, { props: { slug: serial.slug, watchPage: true, ...props }, global: { stubs: pageStubs } });
}

function player(view: ReturnType<typeof setup>) {
	return within(view.getByRole('region', { name: i18n.ts.zalip.playerTab }));
}

function iframe(view: ReturnType<typeof setup>): HTMLIFrameElement {
	return view.container.querySelector(`iframe[title="${i18n.ts.zalip.playerTab}: ${serial.title}"]`)!;
}

function episodeDetails(view: ReturnType<typeof setup>): HTMLDetailsElement {
	return view.container.querySelector('details[class*=episodeGuide]')!;
}

async function selectSeason(view: ReturnType<typeof setup>, number: number): Promise<void> {
	await fireEvent.update(player(view).getByRole('combobox', { name: i18n.ts.zalip.workSeason }), String(number));
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

function editionTrigger(view: ReturnType<typeof setup>, label: string, provider = alloha.label) {
	return player(view).getByRole('button', { name: `${i18n.ts.zalip.playerVoices}: ${label}, ${provider}` });
}

async function openVoices(view: ReturnType<typeof setup>, label: string, provider = alloha.label) {
	await fireEvent.click(editionTrigger(view, label, provider));
	return within(view.getByRole('dialog', { name: i18n.ts.zalip.playerVoices }));
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedPreferences.enablePullToRefresh = false;
	Object.defineProperty(window.crypto, 'subtle', { configurable: true, value: webcrypto.subtle });
	(window as unknown as HappyWindow).happyDOM.settings.navigation.disableChildFrameNavigation = true;
	// srcdoc is parsed, but external SDK scripts stay disabled in unit tests.
	previousDisabledLoadingPolicy = (window as unknown as HappyWindow).happyDOM.settings.handleDisabledFileLoadingAsSuccess;
	(window as unknown as HappyWindow).happyDOM.settings.handleDisabledFileLoadingAsSuccess = true;
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
		if (endpoint === 'zalip/progress/start') return { sessionId: 'session', sequence: 0, progress: { ...savedProgress, ...params, ...(params?.provider === 'vibix' ? { mode: 'episode', positionSeconds: null, durationSeconds: null } : {}), completed: false } };
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
afterEach(() => { cleanup(); (window as unknown as HappyWindow).happyDOM.settings.handleDisabledFileLoadingAsSuccess = previousDisabledLoadingPolicy; });

describe('Zalip work playback selection', () => {
	it('keeps the informational title free of a player and links to the separate watch page', async () => {
		const view = setup({ watchPage: false });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		expect(view.queryByRole('region', { name: i18n.ts.zalip.playerTab })).toBeNull();
		expect(view.container.querySelector('iframe')).toBeNull();
		expect(view.getAllByRole('link', { name: i18n.ts.zalip.watchTitle })[0].getAttribute('href')).toContain('/zalip/serial/watch');
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/start', expect.anything());
	});

	it('opens a direct watch target without autoplay and keeps its edition and episode together', async () => {
		const view = setup({ initialSeason: '2', initialEpisode: '3', initialProvider: 'collaps', initialTranslation: 'studio-two' });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		await waitFor(() => expect(player(view).getByRole('button', { name: 'Collaps Cinema', pressed: true })).toBeTruthy());
		expect(iframe(view)).toBeNull();
		expect(view.getByText('Description 3')).toBeTruthy();
		await play(view);
		expect(new URL(iframe(view).src).searchParams.get('oneSound')).toBe('Collaps Two');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		expect(view.emitted().watchSelection?.at(-1)).toEqual([{ seasonNumber: 2, episodeNumber: 3, provider: 'collaps', translationId: 'studio-two' }]);
	});

	it.each([{ initialSeason: '2', initialEpisode: '999' }, { initialSeason: '99', initialEpisode: '1' }, { initialSeason: 'bad', initialEpisode: '2' }, { initialSeason: '2', initialEpisode: '1,3' }])('never plays a different episode for an unavailable exact watch target %j', async props => {
		const view = setup(props);
		await view.findByRole('heading', { name: serial.title, level: 1 });
		await waitFor(() => expect(player(view).getByRole('alert').textContent).toContain(i18n.ts.zalip.playerEpisodeUnavailable));
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		expect(iframe(view)).toBeNull();
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/start', expect.anything());
	});

	it('ignores a late season response from an older watch URL instead of rejecting the current edition', async () => {
		let resolveOld!: (episodes: typeof testEpisodes) => void;
		const oldSeason = new Promise<typeof testEpisodes>(resolve => { resolveOld = resolve; });
		const previousApi = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		let requests = 0;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' && ++requests === 1 ? oldSeason : previousApi(endpoint, params));
		const view = setup({ initialSeason: '2', initialEpisode: '1' });
		await waitFor(() => expect(requests).toBe(1));
		await view.rerender({ initialEpisode: '3', initialProvider: 'collaps', initialTranslation: 'studio-two' });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		resolveOld(testEpisodes);
		await new Promise(resolve => setTimeout(resolve, 0));
		await play(view);
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		expect(new URL(iframe(view).src).searchParams.get('oneSound')).toBe('Collaps Two');
	});

	it.each(['resume', 'reset'])('does not reopen a cached inactive watch page after delayed %s finishes', async action => {
		savedProgress = { workId: 'work', episodeId: 'episode3', seasonNumber: 2, episodeNumber: 3, provider: 'alloha', translationId: '246', mode: 'time', positionSeconds: 600, durationSeconds: 2400, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z' };
		let resolveOld!: (value: unknown) => void;
		const delayed = new Promise(resolve => { resolveOld = resolve; });
		const previousApi = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		let seasonRequests = 0;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => {
			if (endpoint === 'zalip/seasons/episodes' && action === 'resume' && ++seasonRequests === 2) return delayed;
			if (endpoint === 'zalip/progress/reset' && action === 'reset') return delayed;
			return previousApi(endpoint, params);
		});
		const Cached = defineComponent({ props: ['visible'], setup: props => () => h(KeepAlive, null, { default: () => props.visible ? h(Work, { slug: serial.slug, watchPage: true }) : h('p', 'Title information') }) });
		const view = render(Cached, { props: { visible: true }, global: { stubs: pageStubs } });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		const cachedArticle = view.container.querySelector('article')!;
		await fireEvent.click(view.getByRole('button', { name: action === 'resume' ? i18n.tsx.zalip._progress.resumeAt({ time: '10:00' }) : i18n.ts.zalip._progress.startOver }));
		await view.rerender({ visible: false });
		resolveOld(action === 'resume' ? testEpisodes : { cleared: true });
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(cachedArticle.querySelector('iframe')).toBeNull();
		await view.rerender({ visible: true });
		expect(view.container.querySelector('iframe')).toBeNull();
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/start', expect.anything());
	});

	it.each(['movie', 'series'] as const)('retains invalid-coordinate errors when choosing a %s provider without canonical seasons', async kind => {
		workData = { ...serial, kind, seasons: [] };
		const view = setup({ initialSeason: '1', initialEpisode: '999' });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		await fireEvent.click(player(view).getByRole('button', { name: 'Alloha Cinema', pressed: true }));
		await fireEvent.click((await openVoices(view, 'First Studio')).getByRole('button', { name: 'Second Studio Full HD' }));
		expect(player(view).getByRole('alert').textContent).toContain(i18n.ts.zalip.playerEpisodeUnavailable);
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		expect(iframe(view)).toBeNull();
	});

	it('refreshes the currently selected watch episode and voice rather than the original link', async () => {
		mockedPreferences.enablePullToRefresh = true;
		const view = setup({ initialSeason: '2', initialEpisode: '1' });
		await play(view);
		await chooseEpisode(view, 3);
		await fireEvent.click((await openVoices(view, 'First Studio')).getByRole('button', { name: 'Second Studio Full HD' }));
		await fireEvent.click(view.getByRole('button', { name: 'Refresh work' }));
		await view.findByRole('heading', { name: serial.title, level: 1 });
		await play(view);
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
	});

	it('mounts exact catalogue SDK movie IDs per serial episode/voice and falls back safely for an unknown pair', async () => {
		sources = [{ ...structuredClone(vibix), vibixEpisodeMap: { publisherId: '123456789', seriesId: '12345', items: [{ seasonNumber: 2, episodeNumber: 1, translationId: '26', movieId: '701' }, { seasonNumber: 2, episodeNumber: 3, translationId: '26', movieId: '703' }, { seasonNumber: 2, episodeNumber: 3, translationId: '42', movieId: '704' }] } }];
		const view = setup(); await play(view); const ins = () => new DOMParser().parseFromString(iframe(view).srcdoc, 'text/html').querySelector('ins')!;
		expect(ins().getAttribute('data-type')).toBe('movie'); expect(ins().getAttribute('data-id')).toBe('701'); expect(ins().hasAttribute('data-season')).toBe(false); const first = iframe(view);
		await chooseEpisode(view, 3); expect(iframe(view)).not.toBe(first); expect(ins().getAttribute('data-id')).toBe('703'); const third = iframe(view);
		await fireEvent.click((await openVoices(view, 'Vibix One', vibix.label)).getByRole('button', { name: 'Vibix Two' })); expect(iframe(view)).not.toBe(third); expect(ins().getAttribute('data-id')).toBe('704'); expect(ins().getAttribute('data-voiceover')).toBe('42');
		await fireEvent.click(player(view).getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 3 }), expanded: false }));
		await fireEvent.click(within(view.getByRole('dialog', { name: i18n.ts.zalip.workEpisodes })).getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 2 }) }));
		expect(ins().getAttribute('data-type')).toBe('series'); expect(ins().getAttribute('data-id')).toBe('12345'); expect(ins().getAttribute('data-episodes')).toBe('2'); expect(iframe(view).getAttribute('sandbox')).not.toContain('allow-same-origin');
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', { workId: 'work', episodeId: 'episode2', provider: 'vibix', translationId: '42' }));
	});
	it('renders SDK-only Vibix in an opaque srcdoc sandbox and changes canonical episodes/voices without outer scripts', async () => {
		sources = [structuredClone(vibix), structuredClone(alloha)]; const view = setup(); await play(view);
		const first = iframe(view); const document = () => new DOMParser().parseFromString(iframe(view).srcdoc, 'text/html');
		expect(first.hasAttribute('src')).toBe(false); expect(first.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-presentation'); expect(document().querySelector('ins')!.getAttribute('data-id')).toBe('12345'); expect(document().querySelector('ins')!.getAttribute('data-season')).toBe('2'); expect(document().querySelector('ins')!.getAttribute('data-episodes')).toBe('1'); expect(document().querySelector('ins')!.getAttribute('data-voiceover')).toBe('26'); expect(view.container.querySelector('script')).toBeNull();
		await waitFor(() => expect(player(view).getByText(i18n.ts.zalip._progress.episodeHint)).toBeTruthy());
		await chooseEpisode(view, 3); expect(iframe(view)).not.toBe(first); expect(document().querySelector('ins')!.getAttribute('data-episodes')).toBe('3'); const episodeFrame = iframe(view);
		await fireEvent.click((await openVoices(view, 'Vibix One', vibix.label)).getByRole('button', { name: 'Vibix Two' })); expect(iframe(view)).not.toBe(episodeFrame); expect(document().querySelector('ins')!.getAttribute('data-voiceover')).toBe('42'); expect(document().querySelector('ins')!.getAttribute('data-episodes')).toBe('3');
		await fireEvent.click(player(view).getByRole('button', { name: 'Alloha Cinema', pressed: false })); expect(iframe(view).src).toContain('https://alloha.example/'); expect(iframe(view).hasAttribute('srcdoc')).toBe(false); expect(iframe(view).hasAttribute('sandbox')).toBe(false);
	});
	it('opens a Vibix movie without invented coordinates or timestamp restoration', async () => {
		workData = { ...serial, kind: 'movie', seasons: [] }; sources = [{ ...structuredClone(vibix), vibixEmbed: { ...vibix.vibixEmbed!, type: 'movie' } }]; const view = setup(); await play(view);
		const document = new DOMParser().parseFromString(iframe(view).srcdoc, 'text/html'); expect(document.querySelector('ins')!.getAttribute('data-type')).toBe('movie'); expect(document.querySelector('ins')!.hasAttribute('data-season')).toBe(false); expect(document.querySelector('ins')!.hasAttribute('data-episodes')).toBe(false);
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', { workId: 'work', episodeId: null, provider: 'vibix', translationId: '26' })); expect(await player(view).findByText(i18n.ts.zalip._progress.movieHint)).toBeTruthy();
	});
	it('retains the exact saved Vibix episode and voice without pretending that an SDK time seek exists', async () => {
		sources = [structuredClone(vibix)]; savedProgress = { workId: 'work', episodeId: 'episode3', seasonNumber: 2, episodeNumber: 3, provider: 'vibix', translationId: '42', mode: 'episode', positionSeconds: null, durationSeconds: null, completed: false, lastPlayedAt: '2026-10-20T00:00:00Z' }; const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip._progress.resume })); await waitFor(() => expect(iframe(view)).not.toBeNull()); const document = new DOMParser().parseFromString(iframe(view).srcdoc, 'text/html'); expect(document.querySelector('ins')!.getAttribute('data-season')).toBe('2'); expect(document.querySelector('ins')!.getAttribute('data-episodes')).toBe('3'); expect(document.querySelector('ins')!.getAttribute('data-voiceover')).toBe('42'); expect(iframe(view).srcdoc).not.toContain('data-time');
	});
	it('unmounts the Vibix document for the trailer and rebuilds only inside the opaque frame when returning', async () => {
		sources = [structuredClone(vibix)]; const view = setup(); await play(view); const first = iframe(view); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.trailerTab })); expect(iframe(view)).toBeNull();
		await fireEvent.click(player(view).getByRole('button', { name: 'Vibix Cinema', pressed: true })); expect(iframe(view)).not.toBe(first); expect(iframe(view).getAttribute('sandbox')).not.toContain('allow-same-origin'); expect(iframe(view).srcdoc).toContain('https://graphicslab.io/sdk/v2/rendex-sdk.min.js'); view.unmount(); expect(view.container.querySelector('iframe')).toBeNull();
	});
	it('does not mount a default Vibix episode while another canonical season is loading', async () => {
		sources = [structuredClone(vibix)]; workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 }); const view = setup(); await play(view);
		let release!: (episodes: typeof testEpisodes) => void; const pending = new Promise<typeof testEpisodes>(resolve => { release = resolve; }); const original = vi.mocked(misskeyApiZalip).getMockImplementation()!; vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' ? pending : original(endpoint, params));
		await selectSeason(view, 3); expect(iframe(view)).toBeNull(); expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoading); release(testEpisodes.map(episode => ({ ...episode, id: `s3-${episode.id}` }))); await waitFor(() => expect(iframe(view)).not.toBeNull()); expect(new DOMParser().parseFromString(iframe(view).srcdoc, 'text/html').querySelector('ins')!.getAttribute('data-season')).toBe('3');
	});
	it('keeps one episode discussion area and compact details without remounting the active player', async () => {
		const view = setup(); await play(view);
		const activePlayer = iframe(view);
		expect(view.queryByRole('button', { name: i18n.ts.zalip._reviews.reviews })).toBeNull();
		expect(view.queryByRole('group', { name: i18n.ts.zalip.discussionContext })).toBeNull();
		expect(view.container.querySelectorAll('#discussion')).toHaveLength(1);
		const details = episodeDetails(view);
		expect(details.open).toBe(false);
		await fireEvent.click(details.querySelector('summary')!);
		expect(details.open).toBe(true);
		expect(iframe(view)).toBe(activePlayer);
	});
	it('keeps review and work-comment switching on the informational title without mounting playback', async () => {
		const view = setup({ watchPage: false });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.reviews }));
		expect(view.getByTestId('work-reviews').textContent).toBe(serial.title);
		const scope = view.getByRole('group', { name: i18n.ts.zalip.discussionContext });
		await fireEvent.click(within(scope).getByRole('button', { name: i18n.ts.zalip.comments }));
		expect(view.queryByTestId('work-reviews')).toBeNull();
		expect(view.container.querySelector('iframe')).toBeNull();
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/start', expect.anything());
	});
	it.each([false, true])('keeps review hash links on the informational title and exact episode comments on watch (watch page: %s)', async watchPage => {
		const previousUrl = window.location.href;
		window.history.replaceState(null, '', '#review-fixture');
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => {
			if (endpoint === 'zalip/discussions/show') return Promise.resolve({ noteId: 'work-root' });
			if (endpoint === 'zalip/seasons/episodes') return Promise.resolve(testEpisodes.map(episode => ({ ...episode, discussionNoteId: `episode-root-${episode.episodeNumber}` })));
			return fallback(endpoint, params);
		});
		try {
			const view = setup({ watchPage, initialSeason: '2', initialEpisode: '3' });
			await view.findByRole('heading', { name: serial.title, level: 1 });
			if (watchPage) {
				await waitFor(() => expect(view.getByTestId('work-comments').getAttribute('data-note-id')).toBe('episode-root-3'));
				expect(view.queryByTestId('work-reviews')).toBeNull();
				expect(view.queryByRole('group', { name: i18n.ts.zalip.discussionContext })).toBeNull();
			} else {
				expect(await view.findByTestId('work-reviews')).toBeTruthy();
				expect(view.queryByTestId('work-comments')).toBeNull();
				await fireEvent.click(within(view.getByRole('group', { name: i18n.ts.zalip.discussionContext })).getByRole('button', { name: i18n.ts.zalip.comments }));
				expect(view.getByTestId('work-comments').getAttribute('data-note-id')).toBe('work-root');
			}
			expect(view.container.querySelector('iframe')).toBeNull();
			expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/start', expect.anything());
		} finally {
			window.history.replaceState(null, '', previousUrl);
		}
	});

	it('keeps the title readable until its exact logo loads and restores text after an artwork error', async () => {
		Object.assign(workData, { logoPath: '/logo.png', posterPath: '/poster.jpg', backdropPath: '/cover.jpg', countries: ['Россия'], ageRating: 'age18' });
		const view = setup({ watchPage: false });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		const hero = view.container.querySelector('article > section')!;
		const logo = hero.querySelector('[class*=titleLogo] img')!;
		expect(hero.className).not.toContain('hasLogo');
		await fireEvent.load(logo);
		expect(hero.className).toContain('hasLogo');
		await fireEvent.error(logo);
		expect(hero.className).not.toContain('hasLogo');
		expect(hero.querySelector('[class*=titleLogo]')).toBeNull();
		expect(hero.querySelector('[class*=compactFacts]')?.textContent).toContain('Россия');
		expect(hero.querySelector('[class*=compactFacts]')?.textContent).toContain('18+');
		await fireEvent.error(hero.querySelector('[class*=mobileArtworkBackdrop] img')!);
		expect(hero.querySelector('[class*=mobileArtworkBackdrop] img')?.getAttribute('src')).toContain('/poster.jpg');
		await fireEvent.error(hero.querySelector('[class*=mobileArtworkPoster]')!);
		expect(hero.querySelector('[class*=missingArtwork]')?.textContent).toContain(serial.title);
	});

	it('offers mobile primary actions and places discussion before the image gallery', async () => {
		Object.assign(workData, { galleryPaths: ['/gallery.jpg'] });
		const view = setup({ watchPage: false });
		await view.findByRole('heading', { name: serial.title, level: 1 });
		const actions = within(view.getByRole('group', { name: i18n.ts.zalip.watchTitle }));
		expect(actions.getByRole('link', { name: i18n.ts.zalip.watchTitle }).getAttribute('href')).toContain('/zalip/serial/watch');
		expect(actions.getByRole('button', { name: i18n.ts.zalip.discussTitle })).toBeTruthy();
		const discussion = view.container.querySelector('[class*=discussionArea]')!;
		const gallery = view.container.querySelector('[class*=gallery]')!;
		expect(discussion.compareDocumentPosition(gallery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('locks a standalone movie clip and claims timestamp progress without invented episode coordinates', async () => {
		workData = { ...serial, kind: 'movie', seasons: [] };
		sources = [structuredClone(collaps)];
		const view = setup();
		await play(view);
		const url = new URL(iframe(view).src);
		expect(url.searchParams.get('showMenu')).toBe('false');
		expect(url.searchParams.get('showPreNext')).toBe('false');
		expect(url.searchParams.has('season')).toBe(false);
		expect(url.searchParams.has('episode')).toBe(false);
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ workId: 'work', episodeId: null, provider: 'collaps', translationId: 'studio-one', expectedResourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) })));
	});
	it.each(['animation', 'anime'])('does not hide native selectors for an ambiguous %s title without cached episodes', async kind => {
		workData = { ...serial, kind, seasons: [] };
		sources = [structuredClone(collaps)];
		const view = setup(); await play(view);
		expect(new URL(iframe(view).src).searchParams.has('showMenu')).toBe(false);
		await nextTick();
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/progress/start')).toBe(false);
	});
	it.each(['animation', 'anime'])('locks a confirmed %s feature on both balancers and supplies the exact fingerprint', async kind => {
		workData = { ...serial, kind, mediaType: 'movie', seasons: [] };
		const movieAlloha = structuredClone(alloha);
		movieAlloha.iframe = movieAlloha.iframe.replace('token_movie=fixture', 'token_movie=fixtureMovie');
		for (const translation of movieAlloha.translations) translation.iframe = translation.iframe!.replace('token_movie=fixture', 'token_movie=fixtureMovie');
		sources = [movieAlloha, structuredClone(collaps)];
		const view = setup(); await play(view);
		const allohaUrl = new URL(iframe(view).src);
		expect(allohaUrl.searchParams.get('hidden')).toBe('episode,season,translation');
		expect(allohaUrl.searchParams.has('season')).toBe(false);
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ episodeId: null, provider: 'alloha', translationId: '246', expectedResourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) })));
		await fireEvent.click(player(view).getByRole('button', { name: 'Collaps Cinema', pressed: false }));
		const collapsUrl = new URL(iframe(view).src);
		expect(collapsUrl.searchParams.get('showMenu')).toBe('false');
		expect(collapsUrl.searchParams.get('showPreNext')).toBe('false');
		expect(collapsUrl.searchParams.has('episode')).toBe(false);
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/start', expect.objectContaining({ episodeId: null, provider: 'collaps', translationId: 'studio-one', expectedResourceFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u) })));
	});
	it('retains native episode selectors for a confirmed anime serial with no cached seasons', async () => {
		workData = { ...serial, kind: 'anime', mediaType: 'tv', seasons: [] };
		sources = [structuredClone(collaps)];
		const view = setup(); await play(view); await nextTick();
		expect(new URL(iframe(view).src).searchParams.has('showMenu')).toBe(false);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/progress/start')).toBe(false);
	});
	it('shows a recoverable season error rather than an empty-season claim and retries the same season', async () => {
		let fail = true;
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes'
			? fail ? Promise.reject(new Error('Offline')) : Promise.resolve(testEpisodes)
			: fallback(endpoint, params));
		const view = setup();
		const error = await view.findByRole('alert');
		expect(error.textContent).toContain(i18n.ts.zalip.playerEpisodesLoadFailed);
		expect(player(view).queryByText(i18n.ts.zalip.playerEpisodesEmpty)).toBeNull();
		fail = false;
		await fireEvent.click(within(error).getByRole('button', { name: i18n.ts.retry }));
		await waitFor(() => expect(view.queryByRole('alert')).toBeNull());
		expect(episodeDetails(view).querySelector('summary')?.textContent).toMatch(/Episode 1/u);
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/seasons/episodes').map(call => call[1])).toEqual([{ slug: serial.slug, seasonNumber: 2 }, { slug: serial.slug, seasonNumber: 2 }]);
	});
	it('never exposes or ensures title comments while canonical episode loading fails or retries', async () => {
		let seasonRequests = 0;
		let finishRetry!: (episodes: typeof testEpisodes) => void;
		const retryEpisodes = new Promise<typeof testEpisodes>(resolve => { finishRetry = resolve; });
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => {
			if (endpoint === 'zalip/discussions/show') return Promise.resolve({ noteId: 'work-root' });
			if (endpoint === 'zalip/seasons/episodes') return ++seasonRequests === 1 ? Promise.reject(new Error('Offline')) : retryEpisodes;
			if (endpoint === 'zalip/episodes/discussions/ensure') return Promise.resolve({ noteId: 'episode-root-3' });
			if (endpoint === 'zalip/discussions/ensure') return Promise.resolve({ noteId: 'wrong-work-root' });
			return fallback(endpoint, params);
		});
		const view = setup({ initialSeason: '2', initialEpisode: '3' });
		const error = await view.findByRole('alert');
		const discussion = within(view.container.querySelector<HTMLElement>('#discussion')!);
		const startDiscussion = () => discussion.getByRole('button', { name: i18n.ts.zalip.startDiscussion }) as HTMLButtonElement;
		expect(view.queryByTestId('work-comments')).toBeNull();
		expect(startDiscussion().disabled).toBe(true);
		await fireEvent.click(startDiscussion());
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/discussions/ensure', expect.anything());
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/episodes/discussions/ensure', expect.anything());
		await fireEvent.click(within(error).getByRole('button', { name: i18n.ts.retry }));
		expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoading);
		expect(startDiscussion().disabled).toBe(true);
		expect(view.queryByTestId('work-comments')).toBeNull();
		await fireEvent.click(startDiscussion());
		expect(view.container.querySelector('iframe')).toBeNull();
		finishRetry(structuredClone(testEpisodes));
		await waitFor(() => expect(startDiscussion().disabled).toBe(false));
		await fireEvent.click(startDiscussion());
		await waitFor(() => expect(view.getByTestId('work-comments').getAttribute('data-note-id')).toBe('episode-root-3'));
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/episodes/discussions/ensure', { episodeId: 'episode3' });
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/discussions/ensure', expect.anything());
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/episodes/discussions/ensure')).toHaveLength(1);
		expect(episodeDetails(view).querySelector('summary')?.textContent).toContain('Episode 3');
	});
	it('keeps season loading and retry inside the episode popup without playing or commenting on a fallback episode', async () => {
		workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 });
		let rejectSeason!: (error: Error) => void;
		const failedSeason = new Promise<typeof testEpisodes>((_, reject) => { rejectSeason = reject; });
		let finishRetry!: (episodes: typeof testEpisodes) => void;
		const retrySeason = new Promise<typeof testEpisodes>(resolve => { finishRetry = resolve; });
		let seasonRequests = 0;
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => {
			if (endpoint === 'zalip/discussions/show') return Promise.resolve({ noteId: 'work-root' });
			if (endpoint === 'zalip/seasons/episodes' && params?.seasonNumber === 3) return ++seasonRequests === 1 ? failedSeason : retrySeason;
			if (endpoint === 'zalip/episodes/discussions/ensure') return Promise.resolve({ noteId: 'season3-episode-root' });
			return fallback(endpoint, params);
		});
		const view = setup();
		await play(view);
		const originalFrame = iframe(view);
		await fireEvent.click(player(view).getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 1 }), expanded: false }));
		const popup = within(view.getByRole('dialog', { name: i18n.ts.zalip.workEpisodes }));
		await fireEvent.update(popup.getByRole('combobox', { name: i18n.ts.zalip.workSeason }), '3');
		expect(popup.getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoading);
		expect(popup.queryByText(i18n.ts.zalip.searchNoResults)).toBeNull();
		expect(iframe(view)).toBeNull();
		expect(view.queryByTestId('work-comments')).toBeNull();
		rejectSeason(new Error('New season offline'));
		const error = await popup.findByRole('alert');
		expect(error.textContent).toContain(i18n.ts.zalip.playerEpisodesLoadFailed);
		expect(popup.queryByText(i18n.ts.zalip.searchNoResults)).toBeNull();
		expect(iframe(view)).toBeNull();
		expect(view.queryByTestId('work-comments')).toBeNull();
		await fireEvent.click(within(error).getByRole('button', { name: i18n.ts.retry }));
		expect(popup.getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoading);
		expect(popup.queryByText(i18n.ts.zalip.searchNoResults)).toBeNull();
		expect(iframe(view)).toBeNull();
		expect(view.queryByTestId('work-comments')).toBeNull();
		finishRetry(testEpisodes.map(episode => ({ ...episode, id: `season3-${episode.id}` })));
		await waitFor(() => expect(iframe(view)).not.toBeNull());
		expect(iframe(view)).not.toBe(originalFrame);
		expect(new URL(iframe(view).src).searchParams.get('season')).toBe('3');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('1');
		expect((popup.getByRole('combobox', { name: i18n.ts.zalip.workSeason }) as HTMLSelectElement).value).toBe('3');
		expect(popup.queryByRole('alert')).toBeNull();
		await fireEvent.click(popup.getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 1 }), pressed: true }));
		await fireEvent.click(within(view.container.querySelector<HTMLElement>('#discussion')!).getByRole('button', { name: i18n.ts.zalip.startDiscussion }));
		await waitFor(() => expect(view.getByTestId('work-comments').getAttribute('data-note-id')).toBe('season3-episode-root'));
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/episodes/discussions/ensure', { episodeId: 'season3-episode1' });
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/discussions/ensure', expect.anything());
		expect(misskeyApiZalip).not.toHaveBeenCalledWith('zalip/progress/reset', expect.anything());
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/seasons/episodes' && call[1]?.seasonNumber === 3).map(call => call[1])).toEqual([{ slug: serial.slug, seasonNumber: 3 }, { slug: serial.slug, seasonNumber: 3 }]);
	});
	it('keeps a successfully empty season distinct from a failed request', async () => {
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' ? Promise.resolve([]) : fallback(endpoint, params));
		const view = setup();
		await view.findByRole('heading', { name: serial.title, level: 1 });
		expect(await player(view).findByText(i18n.ts.zalip.playerEpisodesEmpty)).toBeTruthy();
		expect(view.queryByRole('alert')).toBeNull();
	});
	it('does not replace the current season with an error from an older loading season', async () => {
		workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 }, { id: 'season4', seasonNumber: 4, title: 'Season 4', episodeCount: 3 });
		const view = setup(); await play(view);
		let rejectOld!: (error: Error) => void;
		const delayed = new Promise<never>((_, reject) => { rejectOld = reject; });
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' && params?.seasonNumber === 3 ? delayed : fallback(endpoint, params));
		await selectSeason(view, 3);
		await selectSeason(view, 4);
		await waitFor(() => expect(episodeDetails(view)?.querySelector('summary')?.textContent).toMatch(/Episode 1/u));
		rejectOld(new Error('Late offline failure')); await nextTick(); await nextTick();
		expect(view.queryByRole('alert')).toBeNull();
		expect((player(view).getByRole('combobox', { name: i18n.ts.zalip.workSeason }) as HTMLSelectElement).value).toBe('4');
		expect(new URL(iframe(view).src).searchParams.get('season')).toBe('4');
	});
	it('ignores a previous title\'s delayed episode response after a route change', async () => {
		workData.seasons.push({ id: 'season3', seasonNumber: 3, title: 'Season 3', episodeCount: 3 });
		const view = setup(); await play(view);
		let resolveOld!: (episodes: typeof testEpisodes) => void;
		const delayed = new Promise<typeof testEpisodes>(resolve => { resolveOld = resolve; });
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes' && params?.slug === serial.slug && params.seasonNumber === 3 ? delayed : fallback(endpoint, params));
		await selectSeason(view, 3);
		workData = { ...serial, id: 'other-work', slug: 'other-series', title: 'Other Series' };
		await view.rerender({ slug: 'other-series' });
		await view.findByRole('heading', { name: 'Other Series', level: 1 });
		resolveOld(testEpisodes.map(episode => ({ ...episode, title: 'Stale Episode', id: `stale-${episode.id}` })));
		await nextTick(); await nextTick();
		expect(view.container.textContent).not.toContain('Stale Episode');
		expect(episodeDetails(view).querySelector('summary')?.textContent).toMatch(/Episode 1/u);
		expect(view.queryByRole('alert')).toBeNull();
	});
	it('keeps the player preview image-free while episode details fall back through cover and poster without an error loop', async () => {
		Object.assign(workData, { backdropPath: 'https://social.example/files/cover.webp', posterPath: 'https://social.example/files/poster.webp' });
		const fallback = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/seasons/episodes'
			? Promise.resolve(testEpisodes.map(episode => ({ ...episode, stillPath: `https://social.example/files/${episode.id}.webp` }))) : fallback(endpoint, params));
		const view = setup();
		await waitFor(() => expect(episodeDetails(view)?.querySelector('summary')?.textContent).toMatch(/Episode 1/u));
		await fireEvent.click(episodeDetails(view).querySelector('summary')!);
		expect(episodeDetails(view).open).toBe(true);
		const preview = () => view.container.querySelector('[class*=playerPreview] > img') as HTMLImageElement | null;
		const guide = () => view.container.querySelector('[class*=episodeGuideStill]') as HTMLImageElement | null;
		expect(preview()).toBeNull();
		expect(guide()?.src).toBe('https://social.example/files/episode1.webp');
		await fireEvent.error(guide()!);
		expect(guide()?.src).toBe('https://social.example/files/cover.webp');
		await fireEvent.error(guide()!);
		expect(guide()?.src).toBe('https://social.example/files/poster.webp');
		const tile = player(view).getByRole('button', { name: /1.*Episode 1/u });
		// The compact episode grid keeps the canonical selection in a text row;
		// artwork fallback belongs to the optional episode details.
		expect(tile.querySelector('img')).toBeNull();
		expect(tile.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.error(guide()!);
		expect(preview()).toBeNull();
		expect(guide()).toBeNull();
		expect(tile.querySelector('img')).toBeNull();
		expect(tile.textContent).toContain(i18n.tsx.zalip.playerEpisodeNumber({ number: 1 }));
		expect(player(view).getByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeTruthy();
	});
	it.each(['series', 'anime'])('keeps an unbound %s serial playable without inventing a canonical progress target', async kind => {
		workData = { ...serial, kind, seasons: [] };
		sources = [{ ...structuredClone(collaps), episodes: [{ seasonNumber: 2, episodeNumber: 1 }] }];
		const view = setup();
		await play(view); await nextTick();
		expect(iframe(view)).not.toBeNull();
		expect(new URL(iframe(view).src).searchParams.has('episode')).toBe(false);
		expect(new URL(iframe(view).src).searchParams.has('showMenu')).toBe(false);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/progress/start')).toBe(false);
		expect(player(view).getByText(i18n.ts.zalip._progress.episodeHint)).toBeTruthy();
	});
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
		expect(editionTrigger(view, 'Second Studio')).toBeTruthy();
		expect(player(view).queryByText(i18n.ts.zalip._importer.nativeVoicesHint)).toBeNull();
	});

	it('switches modern Collaps voices using the server iframe, including nonnumeric IDs', async () => {
		sources = [structuredClone(collaps)];
		const view = setup();
		await play(view);
		const voices = await openVoices(view, 'Collaps One', collaps.label);
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
		await fireEvent.click((await openVoices(view, 'Kodik One', kodik.label)).getByRole('button', { name: 'Kodik Two' }));
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
		await fireEvent.click((await openVoices(view, 'Kodik One', kodik.label)).getByRole('button', { name: 'Kodik Two' }));
		await fireEvent.click(player(view).getByRole('button', { name: i18n.ts.zalip.watchTitle }));
		expect(new URL(iframe(view).src).pathname).toBe('/serial/456/voice-two/720p');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('1');
	});
	it('distinguishes Kodik subtitles from voices without altering the edition ID or iframe', async () => {
		sources = [{ ...structuredClone(kodik), translations: [{ ...kodik.translations[0], type: 'subtitles' }, { ...kodik.translations[1], type: 'voice' }] }];
		const view = setup();
		await play(view);
		const label = `Kodik One · ${i18n.ts.zalip.playerSubtitles}`;
		const voices = await openVoices(view, label, kodik.label);
		expect(voices.getByRole('button', { name: 'Kodik One', pressed: true }).getAttribute('title')).toBe(label);
		expect(voices.getByRole('button', { name: `${i18n.ts.zalip.playerSubtitles} 1`, pressed: true })).toBeTruthy();
		await fireEvent.update(voices.getByRole('searchbox', { name: i18n.ts.zalip.playerVoiceSearch }), 'Kodik One');
		expect(voices.queryByRole('button', { name: 'Kodik Two' })).toBeNull();
		await fireEvent.update(voices.getByRole('searchbox', { name: i18n.ts.zalip.playerVoiceSearch }), '');
		await fireEvent.click(voices.getByRole('button', { name: `${i18n.ts.zalip.playerVoices} 1`, pressed: false }));
		await fireEvent.click(voices.getByRole('button', { name: 'Kodik Two' }));
		expect(new URL(iframe(view).src).pathname).toBe('/serial/456/voice-two/720p');
		expect(editionTrigger(view, 'Kodik Two', kodik.label)).toBeTruthy();
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
		await selectSeason(view, 3);
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
		await selectSeason(view, 3);
		await waitFor(() => expect(player(view).getByRole('status').textContent).toContain(i18n.ts.zalip.playerEpisodesLoadFailed));
		expect(iframe(view)).toBeNull();
		expect(player(view).queryByRole('button', { name: i18n.ts.zalip.watchTitle })).toBeNull();
		vi.mocked(misskeyApiZalip).mockImplementation(previousApi);
		await selectSeason(view, 2);
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
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.trailerTab }));
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
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.trailerTab }));
		await fireEvent.click(player(view).getByRole('button', { name: 'Alloha Cinema', pressed: true }));
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
		expect(new URL(iframe(view).src).searchParams.get('episode')).toBe('3');
	});

	it('explains native voice controls without rendering an empty voice search', async () => {
		sources = [{ ...collaps, translations: [{ id: 'metadata-only', name: 'Inside the player' }] }];
		const view = setup();
		await play(view);
		const voices = await openVoices(view, collaps.label, collaps.label);
		expect(voices.getByText(i18n.ts.zalip._importer.nativeVoicesHint)).toBeTruthy();
		expect(voices.queryByRole('searchbox')).toBeNull();
		expect(voices.queryByRole('group', { name: i18n.ts.zalip.playerVoices })).toBeNull();
		expect(voices.getByRole('button', { name: collaps.label, pressed: true })).toBeTruthy();
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
	});

	it('keeps provider switching available for native-only playback without displaying empty voice search', async () => {
		sources = [{ ...collaps, translations: [] }, structuredClone(alloha)];
		const view = setup();
		await play(view);
		const voices = await openVoices(view, 'Collaps Cinema', collaps.label);
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
		await fireEvent.click((await openVoices(view, 'Legacy First', legacy.label)).getByRole('button', { name: 'Legacy Second' }));
		expect(new URL(iframe(view).src).hostname).toBe('legacy.example');
		expect(new URL(iframe(view).src).searchParams.get('translation')).toBe('247');
	});

	it('makes legacy Alloha selectable beside imported Collaps without replacing Collaps playback', async () => {
		sources = [structuredClone(collaps)];
		legacyPlayback = structuredClone(legacy);
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).hostname).toBe('collaps.example');
		const voices = await openVoices(view, 'Collaps One', collaps.label);
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
		expect(editionTrigger(view, 'First Studio')).toBeTruthy();
	});

	it('keeps legacy playback available if the sources endpoint fails', async () => {
		failSources = true;
		legacyPlayback = structuredClone(legacy);
		const view = setup();
		await play(view);
		expect(new URL(iframe(view).src).hostname).toBe('legacy.example');
	});
});
