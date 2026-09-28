/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import Work from '@/pages/zalip/work.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import * as os from '@/os.js';
import type { MenuItem, MenuSwitch } from '@/types/menu.js';

vi.mock('@/i.js', () => ({ $i: { id: 'viewer' } }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), toast: vi.fn(), post: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn().mockResolvedValue(true) }));
vi.mock('@/components/ZalipDiscussionPanel.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/ZalipRatingDialog.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));
vi.mock('@/components/MkModal.vue', () => ({ default: defineComponent({ setup: () => () => null }) }));

const title = { id: 'work', slug: 'film', kind: 'movie', title: 'Film', originalTitle: 'Original', description: 'Description', releaseYear: 2027, genres: ['Drama'], runtimeMinutes: 100, seasons: [], galleryPaths: [], communityRating: 8, ratingCount: 2 };
let entry: { status: string | null; episodesWatched: number; personalRating: number | null; isFavorite: boolean; isReleaseSubscribed: boolean; work: { id: string } };
let workKind = 'movie';
let available = false;
let failUpdate = false;

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
	entry = { status: 'watching', episodesWatched: 4, personalRating: 8, isFavorite: false, isReleaseSubscribed: false, work: { id: title.id } };
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, data) => {
		if (endpoint === 'zalip/works/show') return { ...title, kind: workKind };
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
		await view.findByRole('button', { name: i18n.ts.zalip.addToList });
		expect(entry).toMatchObject({ status: null, personalRating: 8, episodesWatched: 4, isFavorite: true, isReleaseSubscribed: true });
		view.unmount();
		const restored = setup();
		const addButton = await restored.findByRole('button', { name: i18n.ts.zalip.addToList });
		expect(addButton.querySelector('.ti-bookmark-plus')).not.toBeNull();
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
		const items = vi.mocked(os.popupMenu).mock.calls.at(-1)![0] as MenuItem[];
		const item = items.find(item => item && 'type' in item && item.type === 'switch' && item.icon === 'ti ti-bell') as MenuSwitch;
		expect(item.ref.value).toBe(true);
		item.ref.value = false;
		await waitFor(() => expect(entry.isReleaseSubscribed).toBe(false));
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
