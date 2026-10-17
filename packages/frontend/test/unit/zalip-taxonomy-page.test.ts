/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { TaxonomyEntry, TaxonomyWork } from '@/utility/zalip-importer.js';
import Taxonomy from '@/pages/zalip/taxonomy.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/router.js', () => ({ useRouter: () => router }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));

function entry(id = 'person', type: TaxonomyEntry['type'] = 'person'): TaxonomyEntry {
	return { id, type, slug: id, name: `Name ${id}`, description: 'Public description', imageUrl: null, parentId: null };
}

function work(id: string, role: string): TaxonomyWork {
	return { id, slug: id, title: `Title ${id}`, kind: 'movie', posterPath: null, releaseYear: 2026, role };
}

function setup(props: { type?: string; slug?: string; query?: string } = { type: 'person', slug: 'person' }) {
	return render(Taxonomy, { props, global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

describe('taxonomy public profiles and directory cards', () => {
	it('merges filmography roles across pages without changing the backend cursor', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entry: entry(), works: [work('a', 'actor'), work('b', 'writer')], nextCursor: 'raw-relation-cursor' });
		const view = setup();
		await view.findByRole('heading', { name: 'Name person', level: 1 });
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entry: entry(), works: [work('a', 'director')], nextCursor: null });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.showMore }));
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenLastCalledWith('zalip/taxonomy/show', expect.objectContaining({ cursor: 'raw-relation-cursor' })));
		await waitFor(() => expect(view.container.querySelectorAll('a[href="/zalip/a"]')).toHaveLength(1));
		expect(view.getByText(`${i18n.ts.zalip._taxonomy._roles.actor} / ${i18n.ts.zalip._taxonomy._roles.director}`)).toBeTruthy();
		expect(view.container.querySelectorAll('a[href="/zalip/b"]')).toHaveLength(1);
		expect(view.queryByRole('button', { name: i18n.ts.zalip._importer.showMore })).toBeNull();
	});
	it('keeps a loaded profile and retries a failed next page with the same cursor', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entry: entry(), works: [work('a', 'actor')], nextCursor: 'retry-cursor' });
		const view = setup();
		await view.findByRole('heading', { name: 'Name person', level: 1 });
		vi.mocked(misskeyApiZalip).mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.showMore }));
		await view.findByRole('alert');
		expect(view.getByRole('heading', { name: 'Title a' })).toBeTruthy();
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entry: entry(), works: [work('b', 'director')], nextCursor: null });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.retry }));
		await view.findByRole('heading', { name: 'Title b' });
		expect(misskeyApiZalip).toHaveBeenLastCalledWith('zalip/taxonomy/show', expect.objectContaining({ cursor: 'retry-cursor' }));
	});
	it('uses a theme icon after a real image fails instead of a broken image or unrelated title', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entry: { ...entry('studio', 'studio'), imageUrl: 'https://social.example/files/logo.png' }, works: [], nextCursor: null });
		const view = setup({ type: 'studio', slug: 'studio' });
		const image = await view.findByRole('img', { name: 'Name studio' });
		await fireEvent.error(image);
		expect(view.queryByRole('img', { name: 'Name studio' })).toBeNull();
		expect(view.container.querySelector('.ti-building')).toBeTruthy();
	});
	it('advances directory offsets by raw rows even when duplicate cards are omitted', async () => {
		const first = Array.from({ length: 50 }, (_, index) => entry(`first${index}`));
		const second = [first[0], ...Array.from({ length: 49 }, (_, index) => entry(`second${index}`))];
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entries: first });
		const view = setup({ type: 'person' });
		await view.findByRole('heading', { name: first[0].name });
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entries: second });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.showMore }));
		await view.findByRole('heading', { name: second[1].name });
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entries: [] });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.showMore }));
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenLastCalledWith('zalip/taxonomy/list', expect.objectContaining({ offset: 100 })));
		expect(view.container.querySelectorAll('a[href="/zalip/taxonomy/person/first0"]')).toHaveLength(1);
	});
	it('preserves directory query navigation and never renders executable image URLs', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValueOnce({ entries: [{ ...entry('category', 'category'), imageUrl: 'javascript:alert(1)' }] });
		const view = setup({ type: 'category', query: 'initial' });
		await view.findByRole('heading', { name: 'Name category' });
		expect(view.container.querySelector('img')).toBeNull();
		await fireEvent.update(view.getByRole('searchbox'), 'New category');
		await fireEvent.submit(view.getByRole('searchbox').closest('form')!);
		expect(router.push).toHaveBeenCalledWith('/zalip/taxonomy', { query: { type: 'category', q: 'New category' } });
	});
});
