/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, ref } from 'vue';
import Catalogue from '@/pages/zalip/catalogue.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

vi.mock('@/i.js', async () => {
	const { reactive } = await import('vue');
	const account = reactive({ current: null as { id: string; token: string } | null });
	return { get $i() { return account.current; }, catalogueTestAccount: account };
});
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: () => null, setItem: vi.fn() } }));

function work(id: number) {
	return { id: String(id), slug: `title-${id}`, kind: 'movie', title: `Title ${id}`, releaseYear: 2026, posterPath: null, genres: [], description: null, originalTitle: null, communityRating: null };
}

function setup(props = {}) {
	return render(Catalogue, { props, global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
		if (endpoint === 'zalip/genres/list') return ['Drama'];
		if (endpoint === 'zalip/works/page') return { items: [work(1)], total: 1, nextCursor: null };
		throw new Error(`Unexpected endpoint: ${endpoint}`);
	});
});
afterEach(cleanup);

describe('Zalip paged catalogue', () => {
	it('requests server-wide sorting and shows all pages beyond the old fifty-title limit', async () => {
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, data) => {
			if (endpoint === 'zalip/genres/list') return [];
			const cursor = data?.cursor;
			const offset = cursor === 'page3' ? 48 : cursor === 'page2' ? 24 : 0;
			return { items: Array.from({ length: offset === 48 ? 5 : 24 }, (_, n) => work(offset + n + 1)), total: 53, nextCursor: offset === 0 ? 'page2' : offset === 24 ? 'page3' : null };
		});
		const view = setup({ sort: 'title' });
		await view.findByRole('heading', { name: 'Title 24' });
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/works/page', { limit: 24, sort: 'title' });
		expect(view.getByText(i18n.tsx.zalip.catalogueResultCount({ shown: '24', total: '53' }))).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore }));
		await view.findByRole('heading', { name: 'Title 48' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore }));
		await view.findByRole('heading', { name: 'Title 53' });
		expect(view.getByText(i18n.tsx.zalip.catalogueResultCount({ shown: '53', total: '53' }))).toBeTruthy();
		expect(view.queryByRole('button', { name: i18n.ts.loadMore })).toBeNull();
	});

	it('keeps the loaded page visible when loading more fails and retries the same cursor', async () => {
		let failMore = true;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, data) => {
			if (endpoint === 'zalip/genres/list') return [];
			if (!data?.cursor) return { items: [work(1)], total: 2, nextCursor: 'next' };
			if (failMore) throw new Error('Temporary failure');
			return { items: [work(2)], total: 2, nextCursor: null };
		});
		const view = setup();
		await view.findByRole('heading', { name: 'Title 1' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore }));
		await view.findByRole('alert');
		expect(view.getByRole('heading', { name: 'Title 1' })).toBeTruthy();
		failMore = false;
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.catalogueRetry }));
		await view.findByRole('heading', { name: 'Title 2' });
		expect(misskeyApiZalip).toHaveBeenLastCalledWith('zalip/works/page', { limit: 24, sort: 'newest', cursor: 'next' });
	});

	it('resets the cursor for a changed sort and ignores an older next-page response', async () => {
		let resolveOld!: (value: unknown) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, data) => {
			if (endpoint === 'zalip/genres/list') return [];
			if (data?.cursor) return new Promise(resolve => { resolveOld = resolve; });
			return { items: [work(data?.sort === 'year-desc' ? 9 : 1)], total: 2, nextCursor: 'next' };
		});
		const view = setup();
		await view.findByRole('heading', { name: 'Title 1' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore }));
		await view.rerender({ sort: 'year-desc' });
		await view.findByRole('heading', { name: 'Title 9' });
		resolveOld({ items: [work(2)], total: 2, nextCursor: null });
		await waitFor(() => expect(view.queryByRole('heading', { name: 'Title 2' })).toBeNull());
		expect(misskeyApiZalip).toHaveBeenLastCalledWith('zalip/works/page', { limit: 24, sort: 'year-desc' });
		expect(view.getByRole('button', { name: i18n.ts.loadMore })).toBeTruthy();
	});

	it('validates query-driven sort values before sending them to the server', async () => {
		const view = setup({ sort: 'not-a-sort' });
		await view.findByRole('heading', { name: 'Title 1' });
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/works/page', { limit: 24, sort: 'newest' });
	});
});

describe('Zalip catalogue library badges', () => {
	async function account(id: string | null, token = 'current-token') {
		const { catalogueTestAccount } = await import('@/i.js') as unknown as { catalogueTestAccount: { current: { id: string; token: string } | null } };
		catalogueTestAccount.current = id ? { id, token } : null;
	}

	beforeEach(async () => { await account('reader'); });
	afterEach(async () => { await account(null); });

	it('shows bookmark-only entries and gives watch statuses precedence over bookmarks', async () => {
		const statuses = ['watching', 'planned', 'completed', 'on_hold', 'dropped'];
		vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
			if (endpoint === 'zalip/genres/list') return [];
			if (endpoint === 'zalip/works/page') return { items: Array.from({ length: 8 }, (_, i) => work(i + 1)), total: 8, nextCursor: null };
			if (endpoint === 'zalip/library/list') return [
				{ work: { id: '1' }, status: null, isFavorite: true },
				...statuses.map((status, i) => ({ work: { id: String(i + 2) }, status, isFavorite: true })),
				{ work: { id: '7' }, status: null, isFavorite: false },
			];
			throw new Error(`Unexpected endpoint: ${endpoint}`);
		});
		const view = setup();
		await view.findByLabelText(i18n.ts.zalip.inBookmarks);
		const icons = ['ti-bookmark', 'ti-eye', 'ti-bookmark', 'ti-check', 'ti-player-pause', 'ti-x'];
		icons.forEach((icon, i) => {
			const card = view.getByRole('link', { name: new RegExp(`Title ${i + 1}\\b`) });
			expect(card.querySelector(`i.${icon}[aria-label]`)).toBeTruthy();
		});
		for (const id of [7, 8]) expect(view.getByRole('link', { name: new RegExp(`Title ${id}\\b`) }).querySelector('i[aria-label]')).toBeNull();
	});

	it('loads once initially and refreshes badges after returning to a cached catalogue', async () => {
		let saved = true;
		vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
			if (endpoint === 'zalip/genres/list') return [];
			if (endpoint === 'zalip/works/page') return { items: [work(1)], total: 1, nextCursor: null };
			return [{ work: { id: '1' }, status: saved ? 'watching' : null, isFavorite: false }];
		});
		const Host = defineComponent({ setup() {
			const visible = ref(true);
			return () => h('div', [h('button', { onClick: () => { visible.value = !visible.value; } }, 'toggle-page'), h(KeepAlive, null, { default: () => visible.value ? h(Catalogue) : h('div', 'Title page') })]);
		} });
		const view = render(Host, { global: { stubs: {
			PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
			MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		} } });
		await view.findByLabelText(i18n.ts.zalip.statusWatching);
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(([endpoint]) => endpoint === 'zalip/library/list')).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		saved = false;
		await fireEvent.click(view.getByRole('button', { name: 'toggle-page' }));
		await waitFor(() => expect(view.queryByLabelText(i18n.ts.zalip.statusWatching)).toBeNull());
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(([endpoint]) => endpoint === 'zalip/library/list')).toHaveLength(2);
	});

	it('discards a previous account response and clears private badges on logout', async () => {
		let resolveOld!: (value: unknown[]) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
			if (endpoint === 'zalip/genres/list') return [];
			if (endpoint === 'zalip/works/page') return { items: [work(1)], total: 1, nextCursor: null };
			return new Promise(resolve => { resolveOld = resolve; });
		});
		const view = setup();
		await view.findByRole('heading', { name: 'Title 1' });
		await account(null);
		resolveOld([{ work: { id: '1' }, status: 'watching', isFavorite: true }]);
		await waitFor(() => expect(view.queryByLabelText(i18n.ts.zalip.statusWatching)).toBeNull());
		expect(view.queryByLabelText(i18n.ts.zalip.inBookmarks)).toBeNull();
	});

	it('ignores an old credential response after rotating the same account token', async () => {
		let resolveOld!: (value: unknown[]) => void;
		let libraryCalls = 0;
		vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
			if (endpoint === 'zalip/genres/list') return [];
			if (endpoint === 'zalip/works/page') return { items: [work(1)], total: 1, nextCursor: null };
			libraryCalls++;
			if (libraryCalls === 1) return new Promise(resolve => { resolveOld = resolve; });
			return [{ work: { id: '1' }, status: 'completed', isFavorite: false }];
		});
		const view = setup();
		await view.findByRole('heading', { name: 'Title 1' });
		await account('reader', 'rotated-token');
		await view.findByLabelText(i18n.ts.zalip.statusCompleted);
		resolveOld([{ work: { id: '1' }, status: 'watching', isFavorite: true }]);
		await waitFor(() => expect(view.queryByLabelText(i18n.ts.zalip.statusWatching)).toBeNull());
		expect(view.getByLabelText(i18n.ts.zalip.statusCompleted)).toBeTruthy();
		expect(libraryCalls).toBe(2);
	});
});
