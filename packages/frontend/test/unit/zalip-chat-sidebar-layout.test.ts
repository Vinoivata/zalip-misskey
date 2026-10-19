/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import Sidebar from '@/components/MkZalipChatSidebar.vue';
import Home from '@/pages/chat/home.vue';
import Room from '@/pages/chat/room.vue';
import layout from '@/pages/chat/layout.module.scss';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), user: vi.fn(), input: vi.fn(), path: '/chat', router: null as any, account: null as any }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api, misskeyApiZalip: controls.api }));
vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), selectUser: controls.user, inputText: controls.input }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: () => ({ on: vi.fn(), dispose: vi.fn() }) }) }));
vi.mock('@/router.js', async () => {
	const { ref } = await import('vue');
	controls.router = { currentRef: ref({ path: '/chat' }), getCurrentFullPath: () => controls.path, push: vi.fn(), pushByPath: vi.fn() };
	return { useRouter: () => controls.router };
});
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/pages/chat/home.invitations.vue', () => ({ default: { template: '<div data-testid="invitations">Invitations fixture</div>' } }));
vi.mock('@/pages/chat/home.joiningRooms.vue', () => ({ default: { template: '<div data-testid="joined-rooms">Joined fixture</div>' } }));
vi.mock('@/pages/chat/home.ownedRooms.vue', () => ({ default: { template: '<div data-testid="owned-rooms">Owned fixture</div>' } }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: { template: '<div data-testid="message-search">Search fixture</div>' } }));
vi.mock('@/components/MkZalipChatConversation.vue', () => ({ default: { props: ['userId', 'roomId'], template: '<div data-testid="active-conversation" />' } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const peer = { id: 'peer', username: 'peer', name: 'Peer', host: null };
const stubs = { PageWithHeader: defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) }), MkLoading: true, MkAvatar: true, MkTime: true };
const options = { global: { stubs } };

async function settle(): Promise<void> { for (let count = 0; count < 12; count++) { await Promise.resolve(); await nextTick(); } }
async function debounce(): Promise<void> { await vi.advanceTimersByTimeAsync(260); await settle(); }
function primary(view: ReturnType<typeof render>) { return within(view.getByRole('group', { name: i18n.ts.zalip._chatUi.conversations })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
	vi.useFakeTimers(); vi.clearAllMocks(); controls.path = '/chat'; controls.router.currentRef.value = { path: '/chat' };
	controls.account = reactive({ id: 'me', policies: { chatAvailability: 'available' } });
	controls.user.mockResolvedValue(peer); controls.input.mockResolvedValue({ canceled: false, result: 'Movie club' });
	controls.api.mockImplementation(async (endpoint: string) => endpoint === 'chat/rooms/create' ? { id: 'club', name: 'Movie club' } : { items: [], nextCursor: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Notr-style sidebar with unchanged native contracts', () => {
	it('uses a compact local clock for today, short dates otherwise, and a safe invalid-date label', async () => {
		const today = new Date(); today.setHours(13, 7, 0, 0);
		const earlier = new Date(today); earlier.setDate(earlier.getDate() - 2);
		controls.api.mockResolvedValueOnce({ items: [today.toISOString(), earlier.toISOString(), 'invalid'].map((createdAt, index) => ({ key: `user:peer${index}`, kind: 'user', user: { ...peer, id: `peer${index}` }, preferences: { isPinned: false, isMuted: false }, lastMessage: { createdAt, text: 'Fixture' }, unread: false })), nextCursor: null });
		const view = render(Sidebar, options); await settle();
		const times = Array.from(view.container.querySelectorAll('time'));
		expect(times.map(time => time.textContent)).toEqual([
			new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(today),
			new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(earlier),
			i18n.ts._ago.invalid,
		]);
		expect(times[0].dateTime).toBe(today.toISOString());
		expect(times[0].title).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(today));
		expect(times[2].title).toBe(i18n.ts._ago.invalid);
	});

	it('maps the primary groups/messages switch to existing filters without selecting or reading a chat', async () => {
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(primary(view).getByRole('button', { name: i18n.ts.zalip._chatUi.rooms })); await debounce();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'groups', query: '', limit: 30 });
		await fireEvent.click(primary(view).getByRole('button', { name: i18n.ts.zalip.messages })); await debounce();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'all', query: '', limit: 30 });
		expect(view.emitted().select).toBeUndefined(); expect(view.emitted().utility).toBeUndefined();
		expect(controls.api.mock.calls.some(call => call[0] === 'chat/messages/read')).toBe(false);
	});

	it('retains all four secondary filters and server-side search without duplicate group chips', async () => {
		const view = render(Sidebar, options); await settle();
		const filters = within(view.getByRole('group', { name: i18n.ts.filter }));
		expect(filters.queryByRole('button', { name: i18n.ts.zalip._chatUi.rooms })).toBeNull();
		for (const [label, filter] of [[i18n.ts.zalip._chatUi.unread, 'unread'], [i18n.ts.zalip._chatUi.people, 'people'], [i18n.ts.zalip._chatUi.archived, 'archived'], [i18n.ts.zalip._chatUi.all, 'all']]) {
			await fireEvent.click(filters.getByRole('button', { name: label })); await debounce();
			expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter, query: '', limit: 30 });
		}
		await fireEvent.update(view.getByRole('searchbox'), 'Peer'); await debounce();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'all', query: 'Peer', limit: 30 });
	});

	it('opens separate native DM/group creation actions and respects readonly policy', async () => {
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.chatIndividual })); await settle();
		expect(controls.user).toHaveBeenCalledWith({ localOnly: true, includeSelf: false });
		expect(view.emitted().select?.[0]).toEqual([{ userId: 'peer', title: 'Peer' }]);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.chatCreateRoom })); await settle();
		expect(controls.api).toHaveBeenCalledWith('chat/rooms/create', { name: 'Movie club' });
		expect(view.emitted().select?.[1]).toEqual([{ roomId: 'club', title: 'Movie club' }]);
		controls.account.policies.chatAvailability = 'readonly'; await settle();
		expect(view.getByRole('button', { name: i18n.ts.zalip.chatIndividual }).hasAttribute('disabled')).toBe(true);
		expect(view.getByRole('button', { name: i18n.ts.zalip.chatCreateRoom }).hasAttribute('disabled')).toBe(true);
	});

	it('ignores a new-chat picker result from the previous account', async () => {
		const pending = deferred<typeof peer>(); controls.user.mockReturnValueOnce(pending.promise);
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.chatIndividual }));
		controls.account.id = 'another'; await settle(); pending.resolve(peer); await settle();
		expect(view.emitted().select).toBeUndefined();
	});

	it('keeps utility navigation semantic and hides it in the compact cinema list', async () => {
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(within(view.getByRole('navigation')).getByRole('button', { name: i18n.ts.zalip.chatInvitations }));
		expect(view.emitted().utility?.[0]).toEqual(['invitations']);
		await view.rerender({ compact: true }); expect(view.queryByRole('navigation')).toBeNull();
	});
});

describe('shared full-page messenger geometry and utility routes', () => {
	it('uses the same layout/sidebar classes for the empty page and opened conversation', async () => {
		const home = render(Home, options); await settle();
		expect(home.container.querySelector('aside')?.classList.contains(layout.sidebar)).toBe(true);
		expect(home.container.querySelector('aside')?.parentElement?.classList.contains(layout.workspace)).toBe(true);
		home.unmount(); const room = render(Room, { ...options, props: { userId: 'peer' } }); await settle();
		expect(room.container.querySelector('aside')?.classList.contains(layout.sidebar)).toBe(true);
		expect(room.container.querySelector('aside')?.parentElement?.classList.contains(layout.workspace)).toBe(true);
	});

	it('opens search, invitations and joined/owned groups in the bottom utility area', async () => {
		const view = render(Home, options); await settle();
		const nav = within(view.getByRole('navigation'));
		await fireEvent.click(nav.getByRole('button', { name: i18n.ts.search })); await settle(); expect(view.getByTestId('message-search')).toBeTruthy(); expect(view.queryByRole('searchbox')).toBeNull();
		await fireEvent.click(nav.getByRole('button', { name: i18n.ts.zalip.chatInvitations })); await settle(); expect(view.getByTestId('invitations')).toBeTruthy();
		await fireEvent.click(nav.getByRole('button', { name: i18n.ts.zalip._chatUi.rooms })); await settle(); expect(view.getByTestId('joined-rooms')).toBeTruthy(); expect(view.getByTestId('owned-rooms')).toBeTruthy();
		await fireEvent.click(primary(view).getByRole('button', { name: i18n.ts.zalip.messages })); await settle(); expect(view.queryByTestId('owned-rooms')).toBeNull(); expect(view.getByRole('searchbox')).toBeTruthy();
	});

	it('supports utility links from an open conversation and validates the home query', async () => {
		const room = render(Room, { ...options, props: { roomId: 'club' } }); await settle();
		await fireEvent.click(within(room.getByRole('navigation')).getByRole('button', { name: i18n.ts.zalip.chatInvitations }));
		expect(controls.router.pushByPath).toHaveBeenCalledWith('/chat?view=invitations'); room.unmount();
		controls.path = '/chat?view=invitations'; const home = render(Home, options); await settle(); expect(home.getByTestId('invitations')).toBeTruthy();
		controls.path = '/chat?view=unknown'; controls.router.currentRef.value = { path: '/chat' }; await settle(); expect(home.queryByTestId('invitations')).toBeNull(); expect(home.getByRole('searchbox')).toBeTruthy();
	});
});
