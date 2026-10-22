/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Ref } from 'vue';
import Community from '@/pages/channel.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), confirm: vi.fn(), alert: vi.fn(), cacheDelete: vi.fn(), session: null as Ref<{ id: string; token: string } | null> | null }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref(null); return { get $i() { return controls.session!.value; }, iAmModerator: false }; });
vi.mock('@@/js/use-interval.js', () => ({ useInterval: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/utility/check-permissions.js', () => ({ notesSearchAvailable: false }));
vi.mock('@/cache.js', () => ({ favoritedChannelsCache: { delete: controls.cacheDelete } }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItemAsJson: () => null, setItemAsJson: vi.fn() } }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/os.js', () => ({ confirm: controls.confirm, alert: controls.alert, post: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { r: { showFixedPostFormInChannel: { value: false } } } }));
vi.mock('@/components/MkPostForm.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkNote.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkNotesTimeline.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkStreamingNotesTimeline.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkChannelFollowButton.vue', () => ({ default: { template: '<span/>' } }));
vi.mock('@/components/MkInput.vue', () => ({ default: { template: '<input/>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot/></button>' } }));
vi.mock('@/components/MkInfo.vue', () => ({ default: { template: '<aside><slot/></aside>' } }));
vi.mock('@/components/MkFoldableSection.vue', () => ({ default: { template: '<div><slot/></div>' } }));
const stubs = { PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }), MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }), Mfm: true };

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

function channel(id: string, isFavorited = false) { return { id, name: 'Community ' + id, isFavorited, isFollowing: false, description: '', pinnedNotes: [], isArchived: false, usersCount: 1, notesCount: 1 }; }

beforeEach(() => { vi.clearAllMocks(); controls.session!.value = { id: 'viewer', token: 'fixture-token' }; controls.api.mockImplementation(async (endpoint, params) => endpoint === 'channels/show' ? channel(params.channelId) : undefined); controls.confirm.mockResolvedValue({ canceled: false }); });
afterEach(cleanup);

describe('community page delayed actions', () => {
	it('does not unfavourite a different community after confirming a stale dialog', async () => {
		let finish!: (value: { canceled: boolean }) => void; controls.confirm.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
		controls.api.mockImplementation(async (endpoint, params) => endpoint === 'channels/show' ? channel(params.channelId, params.channelId === 'a') : undefined);
		const view = render(Community, { props: { channelId: 'a' }, global: { stubs } }); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.unfavorite }));
		await view.rerender({ channelId: 'b' }); await settle(); finish({ canceled: false }); await settle(); expect(controls.api.mock.calls.filter(call => call[0] !== 'channels/show')).toEqual([]); expect(view.getByRole('heading', { name: 'Community b' })).toBeTruthy(); expect(view.getByRole('button', { name: i18n.ts.favorite, pressed: false })).toBeTruthy();
	});
	it('does not apply a completed favourite for A to a newly opened community B', async () => {
		let finish!: () => void; controls.api.mockImplementation((endpoint, params) => endpoint === 'channels/show' ? Promise.resolve(channel(params.channelId)) : new Promise<void>(resolve => { finish = resolve; }));
		const view = render(Community, { props: { channelId: 'a' }, global: { stubs } }); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.favorite }));
		expect(controls.api.mock.lastCall).toEqual(['channels/favorite', { channelId: 'a' }, 'fixture-token']); await view.rerender({ channelId: 'b' }); await settle(); finish(); await settle(); expect(view.getByRole('button', { name: i18n.ts.favorite, pressed: false })).toBeTruthy(); expect(controls.cacheDelete).not.toHaveBeenCalled();
	});
	it('blocks duplicate favourite mutations and pins the account token in the native API payload', async () => {
		let finish!: () => void; controls.api.mockImplementation((endpoint, params) => endpoint === 'channels/show' ? Promise.resolve(channel(params.channelId)) : new Promise<void>(resolve => { finish = resolve; }));
		const view = render(Community, { props: { channelId: 'a' }, global: { stubs } }); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.favorite })); await fireEvent.click(view.getByRole('button', { name: i18n.ts.favorite })); expect(controls.api.mock.calls.filter(call => call[0] === 'channels/favorite')).toHaveLength(1); finish(); await settle(); expect(view.getByRole('button', { name: i18n.ts.unfavorite, pressed: true })).toBeTruthy();
	});
});
