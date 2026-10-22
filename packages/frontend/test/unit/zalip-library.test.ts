/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, ref } from 'vue';
import Library from '@/pages/zalip/library.vue';
import Updates from '@/pages/zalip/updates.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { miLocalStorage } from '@/local-storage.js';

vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { enablePullToRefresh: false } } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: vi.fn(), setItem: vi.fn() } }));

const global = { stubs: {
	PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
	MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
} };
const entry = { status: null, episodesWatched: 0, personalRating: null, isFavorite: false, isReleaseSubscribed: false };
const work = { id: 'work', slug: 'work', kind: 'movie', releaseYear: 2026, posterPath: '/poster.jpg' };
beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(miLocalStorage.getItem).mockReturnValue(null);
	vi.mocked(misskeyApiZalip).mockResolvedValue([
		{ ...entry, isFavorite: true, work: { ...work, id: 'a', slug: 'a', title: 'Bookmark only', description: 'Description of bookmarked title' } },
		{ ...entry, status: 'watching', isReleaseSubscribed: true, work: { ...work, id: 'b', slug: 'b', title: 'Watching title' } },
		{ ...entry, personalRating: 8, work: { ...work, id: 'c', slug: 'c', title: 'Rated title' } },
		{ ...entry, work: { ...work, id: 'd', slug: 'd', title: 'Cleared title' } },
	]);
});
afterEach(cleanup);

describe('Zalip library', () => {
	it('reloads after returning from a cached title without duplicating the initial request', async () => {
		const Host = defineComponent({ setup() {
			const visible = ref(true);
			return () => h('div', [h('button', { onClick: () => { visible.value = !visible.value; } }, 'toggle-page'), h(KeepAlive, null, { default: () => visible.value ? h(Library) : h('div', 'Title page') })]);
		} });
		const view = render(Host, { global });
		await view.findByRole('heading', { name: 'Bookmark only' });
		expect(misskeyApiZalip).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		vi.mocked(misskeyApiZalip).mockResolvedValue([{ ...entry, personalRating: 9, work: { ...work, title: 'Updated title' } }]);
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		await view.findByRole('heading', { name: 'Updated title' });
		expect(view.queryByRole('heading', { name: 'Bookmark only' })).toBeNull();
		expect(misskeyApiZalip).toHaveBeenCalledTimes(2);
	});

	it('does not let an older request restore stale entries after reactivation', async () => {
		let resolveOld!: (entries: unknown[]) => void;
		vi.mocked(misskeyApiZalip).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
		const Host = defineComponent({ setup() {
			const visible = ref(true);
			return () => h('div', [h('button', { onClick: () => { visible.value = !visible.value; } }, 'toggle-page'), h(KeepAlive, null, { default: () => visible.value ? h(Library) : h('div', 'Title page') })]);
		} });
		const view = render(Host, { global });
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		await view.findByRole('heading', { name: 'Bookmark only' });
		resolveOld([{ ...entry, isFavorite: true, work: { ...work, title: 'Stale title' } }]);
		await waitFor(() => expect(view.queryByRole('heading', { name: 'Stale title' })).toBeNull());
	});

	it('opens title bookmarks separately from post bookmarks, including entries without watch status', async () => {
		const view = render(Library, { props: { filter: 'favorites' }, global });
		await view.findByRole('heading', { name: 'Bookmark only' });
		expect(view.queryByRole('heading', { name: 'Watching title' })).toBeNull();
		expect(view.getByRole('link', { name: i18n.ts.zalip.postBookmarks }).getAttribute('href')).toBe('/my/favorites');
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.zalip.librarySubscriptions} · 1` }));
		await view.findByRole('heading', { name: 'Watching title' });
		expect(view.queryByRole('heading', { name: 'Bookmark only' })).toBeNull();
	});

	it('filters rated entries and persists card view without reintroducing cleared entries', async () => {
		const view = render(Library, { global });
		await view.findByRole('heading', { name: 'Bookmark only' });
		expect(view.queryByRole('heading', { name: 'Cleared title' })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.catalogueCards }));
		expect(miLocalStorage.setItem).toHaveBeenCalledWith('zalipLibraryView', 'cards');
		await view.findByText('Description of bookmarked title');
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.zalip.libraryRated} · 1` }));
		await view.findByRole('heading', { name: 'Rated title' });
		expect(view.queryByRole('heading', { name: 'Bookmark only' })).toBeNull();
		await fireEvent.update(view.getByRole('searchbox'), 'absent');
		await view.findByText(i18n.ts.zalip.libraryEmptyFilter);
	});

	it('renders movie availability and episode catalogue events without assuming a season exists', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue([
			{ id: 'm', createdAt: '2026-09-28T10:00:00Z', source: 'playback', work: { ...work, title: 'New movie' }, season: null, episode: null },
			{ id: 'e', createdAt: '2026-09-28T09:00:00Z', source: 'catalogue', work: { ...work, title: 'New series', posterPath: null }, season: { seasonNumber: 1 }, episode: { episodeNumber: 2, title: 'Episode title' } },
		]);
		const view = render(Updates, { global });
		await view.findByRole('heading', { name: i18n.ts.zalip.releaseAvailable });
		expect(view.getByRole('heading', { name: /Episode title/ })).toBeTruthy();
		const release = view.getByRole('link', { name: /New series/ });
		expect(release.getAttribute('href')).toBe('/zalip/work?season=1&episode=2');
		expect(release.firstElementChild?.tagName).toBe('I');
		expect(release.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
		expect(view.getByRole('link', { name: i18n.ts.zalip.librarySubscriptions }).getAttribute('href')).toBe('/library?filter=subscribed');
	});

	it('searches original titles case-insensitively and ignores surrounding whitespace', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue([
			{ ...entry, isFavorite: true, work: { ...work, title: 'Русское название', originalTitle: 'Original Movie' } },
			{ ...entry, status: 'watching', work: { ...work, id: 'other', title: 'Другой фильм', originalTitle: null } },
		]);
		const view = render(Library, { global });
		await view.findByRole('heading', { name: 'Русское название' });
		await fireEvent.update(view.getByRole('searchbox'), '  ORIGINAL  ');
		expect(view.getByRole('heading', { name: 'Русское название' })).toBeTruthy();
		expect(view.queryByRole('heading', { name: 'Другой фильм' })).toBeNull();
		await fireEvent.update(view.getByRole('searchbox'), 'РУССКОЕ');
		expect(view.getByRole('heading', { name: 'Русское название' })).toBeTruthy();
	});
});
