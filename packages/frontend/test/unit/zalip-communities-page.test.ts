/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Ref } from 'vue';
import Communities from '@/pages/channels.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), session: null as Ref<{ id: string; token: string; policies: { canCreateChannel: boolean } } | null> | null }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref(null); return { get $i() { return controls.session!.value; } }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/components/MkChannelPreview.vue', () => ({ default: { props: ['channel'], template: '<article>{{ channel.name }}</article>' } }));
const stubs = { PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }), MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) };

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.session!.value = { id: 'viewer', token: 'fixture-token', policies: { canCreateChannel: true } }; controls.api.mockResolvedValue([{ id: 'new', name: 'New community without posts', lastNotedAt: null }]); });
afterEach(cleanup);

describe('public communities directory page', () => {
	it('includes empty new communities and offers creation to a normal capable user', async () => {
		const view = render(Communities, { global: { stubs } }); await settle();
		expect(view.getByText('New community without posts')).toBeTruthy(); expect(view.getByRole('link', { name: i18n.ts.zalip._communities.create }).getAttribute('href')).toBe('/channels/new');
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/search', { limit: 21, query: '', type: 'nameAndDescription' }, 'fixture-token');
	});
	it('respects a disabled native creation policy without granting or changing permissions', async () => {
		controls.session!.value!.policies.canCreateChannel = false; const view = render(Communities, { global: { stubs } }); await settle();
		expect(view.queryByRole('link', { name: i18n.ts.zalip._communities.create })).toBeNull(); expect(view.getByText(i18n.ts.zalip._communities.createUnavailable)).toBeTruthy();
		expect(controls.api.mock.calls.every(call => call[0] === 'channels/search')).toBe(true);
	});
	it('switches discovery, followed, owned and unpaged native favourites', async () => {
		const view = render(Communities, { global: { stubs } }); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.following })); await settle(); expect(controls.api.mock.lastCall![0]).toBe('channels/followed');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.owned })); await settle(); expect(controls.api.mock.lastCall![0]).toBe('channels/owned');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.favorites })); await settle(); expect(controls.api.mock.lastCall![0]).toBe('channels/my-favorites');
		await fireEvent.update(view.getByRole('searchbox'), 'Science fiction'); await fireEvent.submit(view.getByRole('searchbox').closest('form')!); await settle(); expect(controls.api.mock.lastCall).toEqual(['channels/search', { limit: 21, query: 'Science fiction', type: 'nameAndDescription' }, 'fixture-token']);
	});
	it('allows guests to browse but hides authenticated tabs and creation', async () => {
		controls.session!.value = null; const view = render(Communities, { global: { stubs } }); await settle();
		expect(view.queryByRole('button', { name: i18n.ts.zalip._communities.following })).toBeNull(); expect(view.queryByRole('link', { name: i18n.ts.zalip._communities.create })).toBeNull(); expect(controls.api.mock.calls[0][2]).toBeNull();
	});
});
