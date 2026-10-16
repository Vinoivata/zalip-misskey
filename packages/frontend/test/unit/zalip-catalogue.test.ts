/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import Catalogue from '@/pages/zalip/catalogue.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

vi.mock('@/i.js', () => ({ $i: null }));
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
