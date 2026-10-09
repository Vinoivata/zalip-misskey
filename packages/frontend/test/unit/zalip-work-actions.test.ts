/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import Work from '@/pages/zalip/work.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import * as os from '@/os.js';
import type { MenuItem, MenuSwitch } from '@/types/menu.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { enablePullToRefresh: true } } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: defineComponent({ props: ['refresher'], setup: (props, { slots }) => () => h('div', [h('button', { onClick: props.refresher }, 'test-refresh'), slots.default?.()]) }) }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ZalipDiscussionPanel.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/ZalipRatingDialog.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/MkModal.vue', () => ({ default: defineComponent({ emits: ['closed'], setup(_, { slots, emit, expose }) {
	expose({ close: () => emit('closed') });
	return () => h('div', slots.default?.({ maxHeight: null }));
} }) }));

const title = { id: 'work', slug: 'film', kind: 'movie', title: 'Film', originalTitle: 'Original', description: 'Description', releaseYear: 2027, genres: ['Drama'], runtimeMinutes: 100, seasons: [], galleryPaths: [], communityRating: 8, ratingCount: 2 };
let entry: { status: string | null; episodesWatched: number; personalRating: number | null; isFavorite: boolean; isReleaseSubscribed: boolean; work: { id: string } };
let workKind = 'movie';
let available = false;
let failUpdate = false;
let withEpisodes = false;
let posterPath: string | null;
let backdropPath: string | null;
const testEpisodes = [1, 2, 3].map(n => ({ id: `ep${n}`, episodeNumber: n, title: `Episode ${n}`, stillPath: `/frame${n}.jpg`, description: `Description ${n}`, airDate: `2026-09-0${n}`, runtimeMinutes: 40, discussionNoteId: null }));
const scrollTo = vi.fn();

function setup() {
	return render(Work, { props: { slug: 'film' }, global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

function menuSwitch(): MenuSwitch {
	const items = vi.mocked(os.popupMenu).mock.calls.at(-1)![0] as MenuItem[];
	const item = items.find(item => item && 'type' in item && item.type === 'switch') as MenuSwitch;
	expect(item).toBeTruthy();
	expect(item).not.toHaveProperty('active');
	return item;
}

beforeEach(() => {
	vi.clearAllMocks();
	available = false;
	failUpdate = false;
	workKind = 'movie';
	withEpisodes = false;
	posterPath = '/poster.jpg';
	backdropPath = null;
	HTMLElement.prototype.scrollTo = scrollTo;
	entry = { status: 'watching', episodesWatched: 4, personalRating: 8, isFavorite: false, isReleaseSubscribed: false, work: { id: title.id } };
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, data) => {
		if (endpoint === 'zalip/works/show') return { ...title, kind: workKind, posterPath, backdropPath, seasons: withEpisodes ? [{ id: 'season', seasonNumber: 1, title: 'Season 1', episodeCount: 3 }] : [] };
		if (endpoint === 'zalip/seasons/episodes') return testEpisodes;
		if (endpoint === 'zalip/discussions/show') return { noteId: null };
		if (endpoint === 'zalip/library/list') return [entry];
		if (endpoint === 'zalip/playback/alloha/show') return { available, translations: [], iframe: null };
		if (endpoint === 'zalip/library/update') {
			if (failUpdate) throw new Error('Network failure');
			entry = { ...entry, ...data };
			return entry;
		}
		throw new Error(`Unexpected endpoint: ${endpoint}`);
	});
});
afterEach(cleanup);

describe('Zalip work actions', () => {
	it.each([
		['watching', 'ti-eye', 'libraryWatching'],
		['planned', 'ti-bookmark', 'libraryPlanned'],
		['completed', 'ti-check', 'libraryCompleted'],
		['on_hold', 'ti-player-pause', 'libraryOnHold'],
		['dropped', 'ti-x', 'libraryDropped'],
	] as const)('renders the %s status icon and a separate personal rating badge', async (status, icon, label) => {
		entry.status = status;
		const view = setup();
		const button = await view.findByRole('button', { name: i18n.ts.zalip[label] });
		expect(button.querySelector(`.${icon}`)).not.toBeNull();
		const rating = view.getByRole('button', { name: `${i18n.ts.zalip.myRating}: 8/10` });
		expect(rating.textContent).toContain('8');
		expect(rating.textContent).toContain(i18n.ts.zalip.myRating);
	});

	it('can add and remove a favorite from the same menu without changing rating or progress', async () => {
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip.libraryWatching }));
		const item = menuSwitch();
		item.ref.value = true;
		await waitFor(() => expect(entry.isFavorite).toBe(true));
		await waitFor(() => expect(item.ref.value).toBe(true));
		item.ref.value = false;
		await waitFor(() => expect(entry.isFavorite).toBe(false));
		expect(entry.personalRating).toBe(8);
		expect(entry.episodesWatched).toBe(4);
	});

	it.each(['planned', 'watching', 'on_hold', 'completed', 'dropped'])('clears the selected %s list status without deleting independent personal state', async (status) => {
		entry.status = status;
		entry.isFavorite = true;
		entry.isReleaseSubscribed = true;
		const view = setup();
		await view.findByRole('button', { name: `${i18n.ts.zalip.myRating}: 8/10` });
		await fireEvent.click(view.getByRole('group', { name: i18n.ts.zalip.workActions }).querySelectorAll('button')[1]);
		const items = vi.mocked(os.popupMenu).mock.calls.at(-1)![0] as MenuItem[];
		const item = items.find(item => item && 'type' in item && item.type === 'switch' && item.text !== i18n.ts.zalip.favoriteTitle && item.ref.value) as MenuSwitch;
		expect(item).toBeTruthy();
		item.ref.value = false;
		await view.findByRole('button', { name: i18n.ts.zalip.inBookmarks });
		expect(entry).toMatchObject({ status: null, personalRating: 8, episodesWatched: 4, isFavorite: true, isReleaseSubscribed: true });
		view.unmount();
		const restored = setup();
		const addButton = await restored.findByRole('button', { name: i18n.ts.zalip.inBookmarks });
		expect(addButton.querySelector('.ti-bookmark')).not.toBeNull();
		await fireEvent.click(addButton);
		const reloadedItems = vi.mocked(os.popupMenu).mock.calls.at(-1)![0] as MenuItem[];
		const planned = reloadedItems.find(item => item && 'type' in item && item.type === 'switch' && item.text === i18n.ts.zalip.libraryPlanned) as MenuSwitch;
		planned.ref.value = true;
		await restored.findByRole('button', { name: i18n.ts.zalip.libraryPlanned });
		expect(entry.status).toBe('planned');
	});

	it('does not re-add a list status when toggling a subscription', async () => {
		entry.status = null;
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip.subscribePremiere }));
		await view.findByRole('button', { name: i18n.ts.zalip.releaseSubscribed, pressed: true });
		expect(entry.status).toBeNull();
	});

	it('offers episode notifications for a series even when playback is available', async () => {
		workKind = 'series';
		available = true;
		const view = setup();
		await view.findByRole('button', { name: i18n.ts.zalip.subscribeEpisodes });
	});

	it('offers premiere rather than episode notifications for a standalone anime', async () => {
		workKind = 'anime';
		const view = setup();
		await view.findByRole('button', { name: i18n.ts.zalip.subscribePremiere });
		expect(view.queryByRole('button', { name: i18n.ts.zalip.subscribeEpisodes })).toBeNull();
	});

	it('hides new-release subscription for an available standalone anime', async () => {
		workKind = 'anime';
		available = true;
		const view = setup();
		await view.findByRole('button', { name: i18n.ts.zalip.libraryWatching });
		expect(view.queryByRole('button', { name: i18n.ts.zalip.subscribePremiere })).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.zalip.subscribeEpisodes })).toBeNull();
	});

	it('toggles premiere notifications beside the player and restores the state after reload', async () => {
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip.subscribePremiere }));
		await view.findByRole('button', { name: i18n.ts.zalip.releaseSubscribed, pressed: true });
		view.unmount();
		const restored = setup();
		await fireEvent.click(await restored.findByRole('button', { name: i18n.ts.zalip.releaseSubscribed, pressed: true }));
		await restored.findByRole('button', { name: i18n.ts.zalip.subscribePremiere, pressed: false });
		expect(entry.isReleaseSubscribed).toBe(false);
	});

	it('also allows disabling an existing subscription from the more menu', async () => {
		entry.isReleaseSubscribed = true;
		available = true;
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip.more }));
		const sheet = within(view.getByRole('dialog', { name: i18n.ts.zalip.more }));
		await fireEvent.click(sheet.getByRole('button', { name: i18n.ts.zalip.subscribePremiere, pressed: true }));
		await waitFor(() => expect(entry.isReleaseSubscribed).toBe(false));
	});

	it('prioritizes the watch status over a bookmark and falls back to the bookmark when cleared', async () => {
		entry.status = null;
		entry.isFavorite = true;
		const view = setup();
		const bookmark = await view.findByRole('button', { name: i18n.ts.zalip.inBookmarks });
		expect(bookmark.querySelector('.ti-bookmark')).toBeTruthy();
		await fireEvent.click(bookmark);
		const items = vi.mocked(os.popupMenu).mock.calls.at(-1)![0] as MenuItem[];
		const watching = items.find(item => item && 'type' in item && item.type === 'switch' && item.text === i18n.ts.zalip.libraryWatching) as MenuSwitch;
		watching.ref.value = true;
		expect((await view.findByRole('button', { name: i18n.ts.zalip.libraryWatching })).querySelector('.ti-eye')).toBeTruthy();
		expect(entry.isFavorite).toBe(true);
	});

	it('renders a mobile poster fallback without a backdrop and restores the repost icon', async () => {
		const view = setup();
		const repost = await view.findByRole('button', { name: i18n.ts.zalip.workRepost });
		expect(repost.querySelector('.ti-repeat')).toBeTruthy();
		expect(view.container.querySelector('[class*=mobileArtworkPoster]')?.getAttribute('src')).toContain('/poster.jpg');
		await fireEvent.click(view.getByRole('button', { name: 'test-refresh' }));
		await view.findByRole('button', { name: i18n.ts.zalip.workRepost });
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(([endpoint]) => endpoint === 'zalip/works/show')).toHaveLength(2);
	});

	it.each([
		['/poster.jpg', '/backdrop.jpg'],
		['/poster.jpg', null],
		[null, '/backdrop.jpg'],
		[null, null],
	])('renders a mobile poster over the cover with safe fallbacks: poster %s, backdrop %s', async (poster, backdrop) => {
		posterPath = poster;
		backdropPath = backdrop;
		const view = setup();
		await view.findByRole('heading', { name: title.title, level: 1 });
		const hero = view.container.querySelector('article > section')!;
		const portrait = hero.querySelector('[class*=mobileArtworkPoster]');
		const background = hero.querySelector('[class*=heroBackground] img');
		const mobileBackground = hero.querySelector('[class*=mobileArtworkBackdrop] img');
		if (poster) expect(portrait?.getAttribute('src')).toContain(poster);
		else expect(portrait).toBeNull();
		if (backdrop) expect(background?.getAttribute('src')).toContain(backdrop);
		else expect(background).toBeNull();
		if (backdrop || poster) expect(mobileBackground?.getAttribute('src')).toContain(backdrop || poster);
		else expect(mobileBackground).toBeNull();
		expect(portrait?.getAttribute('alt') ?? title.title).toBe(title.title);
		expect(!!hero.querySelector('[class*=missingArtwork]')).toBe(!poster && !backdrop);
		expect(hero.getAttribute('style')).toBeNull();
	});

	it('synchronizes dropdown, frame, metadata and rail, with horizontal swipes ignoring vertical movement', async () => {
		withEpisodes = true;
		entry.episodesWatched = 0;
		const view = setup();
		const firstEpisodeLabel = i18n.tsx.zalip.playerEpisodeNumber({ number: 1 });
		const dropdown = await view.findByRole('button', { name: firstEpisodeLabel, expanded: false });
		await fireEvent.click(dropdown);
		const menu = within(view.getByRole('dialog', { name: i18n.ts.zalip.workEpisodes }));
		await fireEvent.click(menu.getByRole('button', { name: i18n.tsx.zalip.playerEpisodeNumber({ number: 3 }) }));
		await waitFor(() => expect(view.container.querySelector('[class*=episodeGuideStill]')?.getAttribute('src')).toContain('/frame3.jpg'));
		expect(view.getByText('Description 3')).toBeTruthy();
		expect(view.container.querySelector('[data-episode-id=ep3]')?.getAttribute('aria-pressed')).toBe('true');
		expect(scrollTo).toHaveBeenCalled();
		const guide = view.container.querySelector('[class*=episodeGuideContent]')!;
		await fireEvent.touchStart(guide, { touches: [{ clientX: 100, clientY: 100 }] });
		await fireEvent.touchEnd(guide, { changedTouches: [{ clientX: 105, clientY: 250 }] });
		expect(view.getByText('Description 3')).toBeTruthy();
		await fireEvent.touchStart(guide, { touches: [{ clientX: 100, clientY: 100 }] });
		await fireEvent.touchEnd(guide, { changedTouches: [{ clientX: 230, clientY: 103 }] });
		await view.findByText('Description 2');
		expect(view.container.querySelector('[class*=episodeGuideStill]')?.getAttribute('src')).toContain('/frame2.jpg');
	});

	it('restores subscription state and permits retry on save failure', async () => {
		failUpdate = true;
		const view = setup();
		await fireEvent.click(await view.findByRole('button', { name: i18n.ts.zalip.subscribePremiere }));
		await waitFor(() => expect(os.toast).toHaveBeenCalledWith(i18n.ts.zalip.libraryUpdateFailed));
		const button = await view.findByRole('button', { name: i18n.ts.zalip.subscribePremiere, pressed: false });
		expect((button as HTMLButtonElement).disabled).toBe(false);
		failUpdate = false;
		await fireEvent.click(button);
		await view.findByRole('button', { name: i18n.ts.zalip.releaseSubscribed, pressed: true });
	});
});
