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
import { Nirax } from '@/lib/nirax.js';
import { chatConversationEvents } from '@/utility/zalip-chat-types.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), user: vi.fn(), input: vi.fn(), menu: vi.fn(), router: null as any, account: null as any }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api, misskeyApiZalip: controls.api }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, selectUser: controls.user, inputText: controls.input }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: () => ({ on: vi.fn(), dispose: vi.fn() }) }) }));
vi.mock('@/router.js', () => ({ useRouter: () => controls.router }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/pages/chat/home.invitations.vue', () => ({ default: { template: '<div data-testid="invitations">Invitations fixture</div>' } }));
vi.mock('@/pages/chat/home.joiningRooms.vue', () => ({ default: { template: '<div data-testid="joined-rooms">Joined fixture</div>' } }));
vi.mock('@/pages/chat/home.ownedRooms.vue', () => ({ default: { template: '<div data-testid="owned-rooms">Owned fixture</div>' } }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: { template: '<div data-testid="message-search">Search fixture</div>' } }));
vi.mock('@/components/MkZalipChatConversation.vue', () => ({ default: { props: ['userId', 'roomId'], emits: ['close'], template: '<div data-testid="active-conversation"><button @click="$emit(\'close\')">Close fixture</button></div>' } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const peer = { id: 'peer', username: 'peer', name: 'Peer', host: null };
const stubs = { PageWithHeader: defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) }), MkLoading: true, MkAvatar: true, MkTime: true };
const options = { global: { stubs } };
let accountSequence = 0;
const preferences = { isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null };
function conversation(id = 'peer', patch: Record<string, unknown> = {}) { return { key: `user:${id}`, kind: 'user', user: { ...peer, id, name: id }, room: null, lastMessage: { id: `message-${id}`, createdAt: new Date().toISOString(), text: `Text ${id}` }, preferences: { ...preferences }, unread: false, ...patch }; }

async function settle(): Promise<void> { for (let count = 0; count < 12; count++) { await Promise.resolve(); await nextTick(); } }
async function debounce(): Promise<void> { await vi.advanceTimersByTimeAsync(260); await settle(); }
function primary(view: ReturnType<typeof render>) { return within(view.getByRole('group', { name: i18n.ts.zalip._chatUi.conversations })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function more(view: ReturnType<typeof render>, label: string): Promise<void> { await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); const entry = controls.menu.mock.calls.at(-1)![0].find((item: any) => item.text === label); expect(entry).toBeTruthy(); entry.action(); await settle(); }

beforeEach(() => {
	vi.useFakeTimers(); vi.clearAllMocks(); window.history.replaceState({}, '', '/chat');
	controls.router = new Nirax([{ path: '/chat', component: Home }, { path: '/chat/user/:userId', component: Room }, { path: '/chat/room/:roomId', component: Room }], '/chat', true, {});
	controls.router.on('push', ({ fullPath }: any) => window.history.pushState({}, '', fullPath)); controls.router.on('replace', ({ fullPath }: any) => window.history.replaceState({}, '', fullPath));
	controls.account = reactive({ id: `me-${++accountSequence}`, token: 'fixture-token', policies: { chatAvailability: 'available' } });
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
		await more(view, i18n.ts.zalip.chatCreateRoom);
		expect(controls.api).toHaveBeenCalledWith('chat/rooms/create', { name: 'Movie club' });
		expect(view.emitted().select?.[1]).toEqual([{ roomId: 'club', title: 'Movie club' }]);
		controls.account.policies.chatAvailability = 'readonly'; await settle();
		expect(view.getByRole('button', { name: i18n.ts.zalip.chatIndividual }).hasAttribute('disabled')).toBe(true);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); expect(controls.menu.mock.calls.at(-1)![0].some((item: any) => item.text === i18n.ts.zalip.chatCreateRoom)).toBe(false);
	});

	it('ignores a new-chat picker result from the previous account', async () => {
		const pending = deferred<typeof peer>(); controls.user.mockReturnValueOnce(pending.promise);
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.chatIndividual }));
		controls.account.id = 'another'; await settle(); pending.resolve(peer); await settle();
		expect(view.emitted().select).toBeUndefined();
	});

	it('keeps utility actions in one menu without a duplicate bottom navigation', async () => {
		const view = render(Sidebar, options); await settle();
		expect(view.queryByRole('navigation')).toBeNull(); await more(view, i18n.ts.zalip.chatInvitations);
		expect(view.emitted().utility?.[0]).toEqual(['invitations']);
		await view.rerender({ compact: true }); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); expect(controls.menu.mock.calls.at(-1)![0].map((item: any) => item.text)).toEqual([i18n.ts.zalip.chatCreateRoom]);
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

	it('opens utilities through real router URLs and clears a stale view query on return', async () => {
		const view = render(Home, options); await settle();
		await more(view, i18n.ts.search); expect(view.getByTestId('message-search')).toBeTruthy(); expect(view.queryByRole('searchbox')).toBeNull(); expect(window.location.search).toBe('?view=search');
		expect(view.queryByRole('button', { name: i18n.ts.more })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.back })); await settle(); expect(controls.router.getCurrentFullPath()).toBe('/chat');
		await more(view, i18n.ts.zalip.chatInvitations); expect(view.getByTestId('invitations')).toBeTruthy(); expect(controls.router.getCurrentFullPath()).toBe('/chat?view=invitations');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.back })); await settle(); expect(controls.router.getCurrentFullPath()).toBe('/chat');
		await more(view, i18n.ts.zalip._chatUi.manageGroups); expect(view.getByTestId('joined-rooms')).toBeTruthy(); expect(view.getByTestId('owned-rooms')).toBeTruthy();
		expect(view.queryByRole('group', { name: i18n.ts.zalip._chatUi.conversations })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.back })); await settle(); expect(view.queryByTestId('owned-rooms')).toBeNull(); expect(view.getByRole('searchbox')).toBeTruthy();
		expect(window.location.search).toBe(''); expect(controls.router.getCurrentFullPath()).toBe('/chat');
	});

	it('supports utility links from an open conversation and validates the home query', async () => {
		const room = render(Room, { ...options, props: { roomId: 'club' } }); await settle();
		await more(room, i18n.ts.zalip.chatInvitations); expect(controls.router.getCurrentFullPath()).toBe('/chat?view=invitations'); room.unmount();
		const home = render(Home, options); await settle(); expect(home.getByTestId('invitations')).toBeTruthy();
		controls.router.replaceByPath('/chat?view=unknown'); await settle(); expect(home.queryByTestId('invitations')).toBeNull(); expect(home.getByRole('searchbox')).toBeTruthy();
	});

	it('replaces the room entry on explicit back so browser history does not reopen it', async () => {
		controls.router.pushByPath('/chat/user/peer'); const length = window.history.length; const replace = vi.spyOn(controls.router, 'replace');
		const view = render(Room, { ...options, props: { userId: 'peer' } }); await settle(); await fireEvent.click(view.getByRole('button', { name: 'Close fixture' }));
		expect(replace).toHaveBeenCalledWith('/chat'); expect(window.history.length).toBe(length); expect(controls.router.getCurrentFullPath()).toBe('/chat'); expect(window.location.pathname).toBe('/chat');
	});
});

describe('persistent account-scoped list state and confirmed preferences', () => {
	it('waits for an account refresh batch to restore credentials before reloading the list', async () => {
		const initial = deferred<any>(); const requests: { accountId: string | undefined; credentialPresent: boolean }[] = [];
		controls.api.mockImplementation(async () => {
			requests.push({ accountId: controls.account.id, credentialPresent: typeof controls.account.token === 'string' && !!controls.account.token });
			if (!requests.at(-1)!.credentialPresent) throw new Error('CREDENTIAL_REQUIRED');
			return requests.length === 1 ? initial.promise : { items: [conversation('current')], nextCursor: null };
		});
		const view = render(Sidebar, options); const id = controls.account.id; const token = controls.account.token;
		expect(requests).toEqual([{ accountId: id, credentialPresent: true }]);
		// Mirror updateCurrentAccount: every old key is removed, id returns before token.
		for (const key of Object.keys(controls.account)) delete controls.account[key];
		Object.assign(controls.account, { id, policies: { chatAvailability: 'available' } });
		expect(requests).toHaveLength(1);
		controls.account.token = token; await settle();
		expect(requests).toEqual([{ accountId: id, credentialPresent: true }, { accountId: id, credentialPresent: true }]);
		expect(view.getByText('Text current')).toBeTruthy(); expect(view.queryByRole('alert')).toBeNull();
		initial.resolve({ items: [conversation('stale-initial')], nextCursor: null }); await settle();
		expect(view.queryByText('Text stale-initial')).toBeNull(); expect(view.getByText('Text current')).toBeTruthy();
	});

	it('invalidates private state immediately and reloads only the final principal in a rapid switch', async () => {
		controls.api.mockResolvedValue({ items: [conversation('private-old')], nextCursor: null });
		const view = render(Sidebar, options); await settle(); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: private-old` }));
		const oldMenu = controls.menu.mock.calls.at(-1)![0]; controls.api.mockClear();
		const requested: string[] = []; controls.api.mockImplementation(async () => { requested.push(controls.account.id); return { items: [conversation('final-account')], nextCursor: null }; });
		controls.account.id = 'intermediate-account'; controls.account.id = 'final-account';
		oldMenu.find((entry: any) => entry.text === i18n.ts.zalip._chatUi.archive).action();
		expect(controls.api).not.toHaveBeenCalled(); await nextTick(); expect(view.queryByText('Text private-old')).toBeNull(); await settle();
		expect(requested).toEqual(['final-account']); expect(view.getByText('Text final-account')).toBeTruthy();
		expect(controls.api.mock.calls.every(call => call[0] === 'zalip/chat/conversations')).toBe(true);
	});

	it('reloads when credentials arrive after the account id has settled in an earlier tick', async () => {
		const view = render(Sidebar, options); await settle(); controls.api.mockClear();
		delete controls.account.token; controls.account.id = 'late-account'; await settle();
		expect(controls.api).not.toHaveBeenCalled();
		controls.api.mockResolvedValueOnce({ items: [conversation('late-account')], nextCursor: null });
		controls.account.token = 'late-fixture-token'; expect(controls.api).not.toHaveBeenCalled(); await settle();
		expect(controls.api).toHaveBeenCalledOnce(); expect(view.getByText('Text late-account')).toBeTruthy(); expect(view.queryByRole('alert')).toBeNull();
	});

	it('invalidates private requests on token-only logout without reloading on nonempty token rotation', async () => {
		const response = deferred<any>(); controls.api.mockReturnValueOnce(response.promise);
		const view = render(Sidebar, options); controls.account.token = 'rotated-fixture-token'; await settle(); expect(controls.api).toHaveBeenCalledOnce();
		delete controls.account.token; await settle(); response.resolve({ items: [conversation('private-token-only')], nextCursor: null }); await settle();
		expect(view.queryByText('Text private-token-only')).toBeNull(); expect(controls.api).toHaveBeenCalledOnce();
	});

	it('cancels a deferred account reload on logout without credentials or stale private responses', async () => {
		const response = deferred<any>(); controls.api.mockReturnValueOnce(response.promise);
		const view = render(Sidebar, options); expect(controls.api).toHaveBeenCalledOnce();
		controls.account.id = 'next-account'; delete controls.account.id; delete controls.account.token;
		await settle(); expect(controls.api).toHaveBeenCalledOnce(); expect(view.queryByRole('alert')).toBeNull();
		controls.account.id = 'signed-out-cache'; await settle(); expect(controls.api).toHaveBeenCalledOnce();
		response.resolve({ items: [conversation('private-after-logout')], nextCursor: null }); await settle();
		expect(view.queryByText('Text private-after-logout')).toBeNull(); expect(controls.api).toHaveBeenCalledOnce();
	});

	it('cancels an account reload queued just before unmount', async () => {
		const view = render(Sidebar, options); await settle(); controls.api.mockClear();
		controls.account.id = 'next-account'; view.unmount(); await settle(); expect(controls.api).not.toHaveBeenCalled();
	});

	it('keeps explicit Retry working after a real initial request failure', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [conversation('retried')], nextCursor: null });
		const view = render(Sidebar, options); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._chatUi.loadError);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle();
		expect(view.queryByRole('alert')).toBeNull(); expect(view.getByText('Text retried')).toBeTruthy(); expect(controls.api).toHaveBeenCalledTimes(2);
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'all', query: '', limit: 30 });
	});

	it('keeps Groups isolated and restores the previous Messages subfilter', async () => {
		const view = render(Sidebar, options); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.archived })); await debounce();
		await fireEvent.click(primary(view).getByRole('button', { name: i18n.ts.zalip._chatUi.rooms })); await debounce();
		expect(view.queryByRole('group', { name: i18n.ts.filter })).toBeNull(); expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'groups', query: '', limit: 30 });
		await fireEvent.click(primary(view).getByRole('button', { name: i18n.ts.zalip.messages })); await debounce();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'archived', query: '', limit: 30 }); expect(view.getByRole('button', { name: i18n.ts.zalip._chatUi.archived }).getAttribute('aria-pressed')).toBe('true');
	});

	it('refreshes all loaded pages without removing page two and coalesces realtime events', async () => {
		controls.api.mockImplementation(async (_endpoint: string, params: any) => params.cursor ? { items: [conversation('later')], nextCursor: null } : { items: [conversation('first')], nextCursor: 'page2' });
		const view = render(Sidebar, options); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); expect(view.getByText('Text later')).toBeTruthy();
		const count = controls.api.mock.calls.length; chatConversationEvents.emit('changed'); chatConversationEvents.emit('changed'); await vi.advanceTimersByTimeAsync(130); await settle();
		expect(controls.api.mock.calls.length - count).toBe(2); expect(view.getByText('Text first')).toBeTruthy(); expect(view.getByText('Text later')).toBeTruthy(); expect(view.queryByRole('button', { name: i18n.ts.loadMore })).toBeNull();
	});

	it('restores the full list filter, query and scroll on a same-account room transition only', async () => {
		controls.api.mockResolvedValue({ items: [conversation('saved')], nextCursor: null });
		const first = render(Sidebar, options); await settle(); await fireEvent.click(first.getByRole('button', { name: i18n.ts.zalip._chatUi.unread })); await debounce(); await fireEvent.update(first.getByRole('searchbox'), 'saved'); await debounce();
		const scroll = first.getByText('Text saved').closest('button')!.parentElement!.parentElement!.parentElement!; scroll.scrollTop = 180; await fireEvent.scroll(scroll); first.unmount();
		const pending = deferred<any>(); controls.api.mockReturnValueOnce(pending.promise); const second = render(Sidebar, options); await settle();
		expect((second.getByRole('searchbox') as HTMLInputElement).value).toBe('saved'); expect(second.getByRole('button', { name: i18n.ts.zalip._chatUi.unread }).getAttribute('aria-pressed')).toBe('true'); expect(second.getByText('Text saved').closest('button')!.parentElement!.parentElement!.parentElement!.scrollTop).toBe(180);
		controls.api.mockResolvedValueOnce({ items: [], nextCursor: null }); controls.account.id = 'next-account'; await settle(); expect((second.getByRole('searchbox') as HTMLInputElement).value).toBe(''); expect(second.queryByText('Text saved')).toBeNull();
		pending.resolve({ items: [conversation('private-old')], nextCursor: null }); await settle(); expect(second.queryByText('Text private-old')).toBeNull();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'all', query: '', limit: 30 });
	});

	it('uses returned preferences immediately and does not overwrite them with a slower list response', async () => {
		const delayedList = deferred<any>(); const delayedUpdate = deferred<any>(); let listCalls = 0;
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/chat/preferences/update' ? delayedUpdate.promise : ++listCalls === 1 ? { items: [conversation()], nextCursor: null } : delayedList.promise);
		const view = render(Sidebar, options); await settle(); chatConversationEvents.emit('changed'); await vi.advanceTimersByTimeAsync(130); await settle();
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); controls.menu.mock.calls.at(-1)![0].find((item: any) => item.text === i18n.ts.zalip._chatUi.pin).action(); await settle();
		expect(view.getByRole('button', { name: `${i18n.ts.more}: peer` }).hasAttribute('disabled')).toBe(true);
		delayedUpdate.resolve({ ...preferences, isPinned: true, pinnedMessageId: 'pin' }); await settle();
		delayedList.resolve({ items: [conversation()], nextCursor: null }); await settle();
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); const menu = controls.menu.mock.calls.at(-1)![0];
		expect(menu.some((item: any) => item.text === i18n.ts.zalip._chatUi.unpinConversation)).toBe(true); expect(menu.some((item: any) => item.text === i18n.ts.zalip._chatUi.unpinMessage)).toBe(true);
		menu.find((item: any) => item.text === i18n.ts.zalip._chatUi.unpinConversation).action(); await settle(); expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/preferences/update', { userId: 'peer', isPinned: false });
	});

	it('keeps a confirmed explicit read when an older list request arrives later', async () => {
		const delayedList = deferred<any>(); const delayedRead = deferred<any>(); let listCalls = 0;
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'chat/messages/read' ? delayedRead.promise : ++listCalls === 1 ? { items: [conversation('peer', { unread: true })], nextCursor: null } : delayedList.promise);
		const view = render(Sidebar, options); await settle(); chatConversationEvents.emit('changed'); await vi.advanceTimersByTimeAsync(130); await settle();
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); const action = controls.menu.mock.calls.at(-1)![0].find((item: any) => item.text === i18n.ts.zalip._chatUi.markRead).action;
		action(); action(); await settle(); expect(controls.api.mock.calls.filter(call => call[0] === 'chat/messages/read')).toHaveLength(1);
		delayedRead.resolve({ readThroughId: 'message-peer' }); await settle(); delayedList.resolve({ items: [conversation('peer', { unread: true })], nextCursor: null }); await settle();
		expect(view.queryByLabelText(i18n.ts.unread)).toBeNull();
	});
});
