/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { Window as HappyWindow } from 'happy-dom';
import Work from '@/pages/zalip/work.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import type { LegacyAllohaPlayback, PlaybackProviderSetting, PlaybackSource } from '@/utility/zalip-playback.js';

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
const legacy: LegacyAllohaPlayback = { available: true, label: 'Legacy Alloha', iframe: 'https://legacy.example/?token_movie=fixture', translations: [{ id: 246, name: 'Legacy First', iframe: 'https://legacy.example/?token_movie=fixture&translation=246', quality: null, resolutions: [] }, { id: 247, name: 'Legacy Second', iframe: 'https://legacy.example/?token_movie=fixture&translation=247', quality: null, resolutions: [] }], lastCheckedAt: null };
let sources: PlaybackSource[];
let legacyPlayback: LegacyAllohaPlayback;
let providers: PlaybackProviderSetting[] | undefined;
let failLegacy: boolean;
let failSources: boolean;

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
	(window as unknown as HappyWindow).happyDOM.settings.navigation.disableChildFrameNavigation = true;
	sources = structuredClone([alloha, collaps]);
	legacyPlayback = { ...legacy, available: false, iframe: null, translations: [] };
	providers = undefined;
	failLegacy = false;
	failSources = false;
	HTMLElement.prototype.scrollTo = vi.fn();
	HTMLElement.prototype.scrollIntoView = vi.fn();
	vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
		if (endpoint === 'zalip/works/show') return serial;
		if (endpoint === 'zalip/seasons/episodes') return testEpisodes;
		if (endpoint === 'zalip/discussions/show') return { noteId: null };
		if (endpoint === 'zalip/library/list') return [];
		if (endpoint === 'zalip/taxonomy/show') return { entries: [] };
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
