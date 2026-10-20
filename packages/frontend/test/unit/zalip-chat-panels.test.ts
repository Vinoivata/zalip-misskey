/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import Conversation from '@/components/MkZalipChatConversation.vue';
import Sidebar from '@/components/MkZalipChatSidebar.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), menu: vi.fn(), user: vi.fn(), account: null as any, channels: [] as any[], observers: [] as any[], resizeObservers: [] as any[], send: null as ((message: unknown) => void) | null }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api, misskeyApiZalip: controls.api }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, selectUser: controls.user, toast: vi.fn(), popups: { value: [] } }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: (name: string) => { const handlers = new Map(); const connection = { name, on: (event: string, handler: any) => { handlers.set(event, handler); }, fire: (event: string, payload: any) => handlers.get(event)?.(payload), send: vi.fn(), dispose: vi.fn() }; controls.channels.push(connection); return connection; } }) }));
vi.mock('@/pages/chat/room.form.vue', () => ({ default: { props: ['active'], emits: ['sent'], setup: (_props: unknown, { emit }: { emit: (event: 'sent', message: unknown) => void }) => { controls.send = message => emit('sent', message); }, template: '<textarea data-testid="composer" :disabled="!active" />' } }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.members.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.info.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkMediaList.vue', () => ({ default: { props: ['mediaList'], template: '<div data-testid="loaded-media">{{ mediaList.length }}</div>' } }));
vi.mock('@/components/MkMediaBanner.vue', () => ({ default: { props: ['media'], template: '<div data-testid="loaded-file" :data-sensitive="media.isSensitive">{{ media.name }}</div>' } }));
vi.mock('@/pages/chat/XMessage.vue', () => ({ default: { props: ['message', 'isReadByRecipient'], emits: ['pin'], template: '<div><span>{{ message.text }}</span><span data-testid="reactions">{{ message.reactions.length }}</span><span v-if="isReadByRecipient">READ</span><button @click="$emit(\'pin\', message)">Pin message</button></div>' } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const peer = { id: 'peer', username: 'peer', name: 'Peer', host: null, canChat: true };
const preference = { isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null };
function message(id = '02', patch: Record<string, unknown> = {}) { const reactions: { reaction: string; userId: string; user: typeof peer }[] = []; return { id, createdAt: '2026-10-20T00:00:00Z', fromUserId: 'peer', fromUser: peer, toUserId: 'me', text: `Message ${id}`, file: null, reactions, ...patch }; }
function conversation(key = 'peer', patch: Record<string, unknown> = {}) { return { key: `user:${key}`, kind: 'user', user: { ...peer, id: key, name: key }, room: null, lastMessage: message(), unread: true, preferences: { ...preference }, ...patch }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let index = 0; index < 10; index++) { await Promise.resolve(); await nextTick(); } }
const stubs = { MkLoading: true, MkAvatar: true, MkTime: true, MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) };
function setup(props: Record<string, unknown> = {}) { return render(Conversation, { props: { userId: 'peer', ...props }, global: { stubs } }); }
function sidebar() { return render(Sidebar, { global: { stubs } }); }
function readCalls() { return controls.api.mock.calls.filter(call => call[0] === 'chat/messages/read'); }
function geometry(view: ReturnType<typeof setup>, visible = true) {
	const element = view.container.querySelector('[tabindex="0"]') as HTMLElement;
	Object.defineProperty(element, 'clientHeight', { configurable: true, value: visible ? 400 : 0 });
	element.getBoundingClientRect = () => ({ top: 0, bottom: 400, left: 0, right: 500, width: 500, height: 400 }) as DOMRect;
	for (const row of element.querySelectorAll<HTMLElement>('[data-chat-message-id]')) row.getBoundingClientRect = () => ({ top: 30, bottom: 130, left: 0, right: 450, width: 450, height: 100 }) as DOMRect;
	return element;
}

beforeEach(() => {
	vi.clearAllMocks(); vi.useFakeTimers(); controls.channels.length = 0; controls.observers.length = 0; controls.resizeObservers.length = 0; controls.send = null;
	controls.account = reactive({ id: 'me', username: 'me', host: null, policies: { chatAvailability: 'available' } });
	controls.api.mockImplementation(async (endpoint: string, params: any) => {
		if (endpoint === 'users/show') return { ...peer, id: params.userId };
		if (endpoint.endsWith('-timeline')) return [message('02'), message('01', { fromUserId: 'me', fromUser: controls.account, toUserId: 'peer' })];
		if (endpoint === 'zalip/chat/preferences/show') return { ...preference };
		if (endpoint === 'zalip/chat/conversations') return { items: [conversation()], nextCursor: null };
		if (endpoint === 'chat/messages/read') return { readThroughId: params.messageId, hasUnread: false };
		return { ...preference, ...params };
	});
	vi.stubGlobal('IntersectionObserver', class { callback: any; constructor(callback: any) { this.callback = callback; controls.observers.push(this); } observe() {} disconnect() {} });
	vi.stubGlobal('ResizeObserver', class { callback: any; constructor(callback: any) { this.callback = callback; controls.resizeObservers.push(this); } observe() {} disconnect() {} });
	HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Zalip conversation visibility and lifecycle', () => {
	it('does not fetch or read a hidden conversation and always loads timelines read-only', async () => {
		const view = setup({ active: false }); await settle(); expect(controls.api).not.toHaveBeenCalled();
		await view.rerender({ active: true }); await settle(); expect(controls.api).toHaveBeenCalledWith('chat/messages/user-timeline', { userId: 'peer', limit: 30, markAsRead: false }); expect(readCalls()).toHaveLength(0);
	});
	it('acknowledges only incoming messages actually visible in the viewport', async () => {
		const view = setup(); await settle(); const element = geometry(view); await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(130); await settle();
		expect(readCalls()).toEqual([['chat/messages/read', { userId: 'peer', messageId: '02' }]]);
	});
	it('rejects stale observer callbacks after hiding or switching targets', async () => {
		const view = setup(); await settle(); const element = geometry(view); const observer = controls.observers.at(-1); const old = element.querySelector('[data-chat-message-id="02"]');
		await view.rerender({ active: false }); observer.callback([{ target: old, isIntersecting: true, intersectionRatio: 1 }]); await vi.advanceTimersByTimeAsync(150); expect(readCalls()).toHaveLength(0);
		await view.rerender({ userId: 'other', active: true }); await settle(); geometry(view); observer.callback([{ target: old, isIntersecting: true, intersectionRatio: 1 }]); await vi.advanceTimersByTimeAsync(150); expect(readCalls()).toHaveLength(0);
	});
	it('rechecks visibility at the delayed read flush and retries a failed acknowledgement on scroll', async () => {
		const view = setup(); await settle(); const element = geometry(view); await fireEvent.scroll(element); geometry(view, false); await vi.advanceTimersByTimeAsync(150); expect(readCalls()).toHaveLength(0);
		controls.api.mockRejectedValueOnce(new Error('offline')); geometry(view); await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(150); await settle();
		await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(150); await settle(); expect(readCalls()).toHaveLength(2);
	});
	it('retains the composer and older messages when reopening after a modal', async () => {
		const view = setup(); await settle(); const composer = view.getByTestId('composer'); await fireEvent.update(composer, 'Unsent draft');
		await view.rerender({ active: false }); await view.rerender({ active: true }); await settle();
		expect(view.getByTestId('composer')).toBe(composer); expect((composer as HTMLTextAreaElement).value).toBe('Unsent draft'); expect(view.getByText('Message 01')).toBeTruthy();
	});
	it('does not read messages covered by narrow details and preserves the mounted composer', async () => {
		const view = setup(); await settle(); const element = geometry(view); const observer = controls.observers.at(-1); const row = element.querySelector('[data-chat-message-id="02"]');
		const composer = view.getByTestId('composer'); await fireEvent.update(composer, 'Unsent draft'); await fireEvent.scroll(element);
		await fireEvent.click(view.getAllByRole('button', { name: i18n.ts.zalip._chatUi.conversationDetails })[1]); await settle();
		observer.callback([{ target: row, isIntersecting: true, intersectionRatio: 1 }]); await vi.advanceTimersByTimeAsync(150); await settle();
		expect(readCalls()).toHaveLength(0); expect((composer as HTMLTextAreaElement).disabled).toBe(true); expect((composer as HTMLTextAreaElement).value).toBe('Unsent draft');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.close })); await settle(); geometry(view); await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(150); await settle();
		expect(view.getByTestId('composer')).toBe(composer); expect(readCalls()).toHaveLength(1);
	});
	it('keeps visible desktop messages readable beside the split details pane', async () => {
		const view = setup(); await settle(); controls.resizeObservers[0].callback([{ contentRect: { width: 1100 } }]); await settle();
		await fireEvent.click(view.getAllByRole('button', { name: i18n.ts.zalip._chatUi.conversationDetails })[1]); await settle();
		expect((view.getByTestId('composer') as HTMLTextAreaElement).disabled).toBe(false); const element = geometry(view); await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(150); await settle(); expect(readCalls()).toHaveLength(1);
	});
	it('shows only deduplicated loaded attachments and labels that limitation explicitly', async () => {
		const original = controls.api.getMockImplementation()!; const image = { id: 'photo', name: 'Photo.jpg', type: 'image/jpeg', url: '/synthetic-photo' }; const file = { id: 'pdf', name: 'Guide.pdf', type: 'application/pdf', url: '/synthetic-file', isSensitive: true };
		controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint.endsWith('-timeline') ? [message('03', { file: image }), message('02', { file: image }), message('01', { file })] : original(endpoint, params));
		const view = setup(); await settle(); await fireEvent.click(view.getAllByRole('button', { name: i18n.ts.zalip._chatUi.conversationDetails })[1]); await settle();
		expect(view.getByText(i18n.ts.zalip._chatUi.loadedAttachmentsHint)).toBeTruthy(); expect(view.getByTestId('loaded-media').textContent).toBe('1'); expect(view.getByTestId('loaded-file').textContent).toBe('Guide.pdf'); expect(view.getByTestId('loaded-file').getAttribute('data-sensitive')).toBe('true'); expect(readCalls()).toHaveLength(0);
	});
	it('keeps date separators outside message visibility targets', async () => {
		vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); const view = setup(); await settle();
		expect(view.getByText(i18n.ts.zalip._chatUi.today).closest('[data-chat-message-id]')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(2);
	});
	it('acknowledges a tall scrolled message by visible viewport area, not half of its full height', async () => {
		const view = setup(); await settle(); const element = geometry(view); const row = element.querySelector('[data-chat-message-id="02"]') as HTMLElement;
		row.getBoundingClientRect = () => ({ top: 350, bottom: 1350, left: 0, right: 450, width: 450, height: 1000 }) as DOMRect;
		await fireEvent.scroll(element); await vi.advanceTimersByTimeAsync(130); expect(readCalls()).toHaveLength(0);
		row.getBoundingClientRect = () => ({ top: -300, bottom: 700, left: 0, right: 450, width: 450, height: 1000 }) as DOMRect;
		controls.observers.at(-1).callback([{ target: row, isIntersecting: true, intersectionRatio: .4 }]); await vi.advanceTimersByTimeAsync(130); await settle(); expect(readCalls()).toEqual([['chat/messages/read', { userId: 'peer', messageId: '02' }]]);
	});
	it('bridges more than 30 new rows and refreshes older loaded edits, reactions and deletions authoritatively', async () => {
		const id = (value: number) => String(value).padStart(3, '0'); let rows = Array.from({ length: 60 }, (_, index) => message(id(index + 1))); const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint.endsWith('-timeline') ? rows.filter(row => !params.untilId || row.id < params.untilId).toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, 30) : original(endpoint, params));
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); expect(view.getByText('Message 005')).toBeTruthy();
		await view.rerender({ active: false }); rows = Array.from({ length: 105 }, (_, index) => message(id(index + 1))).filter(row => row.id !== '010').map(row => row.id === '005' ? { ...row, text: 'Edited older row' } : row.id === '015' ? { ...row, reactions: [{ reaction: '❤️', userId: 'peer', user: peer }] } : row);
		await view.rerender({ active: true }); await settle(); expect(view.getByText('Message 061')).toBeTruthy(); expect(view.getByText('Message 075')).toBeTruthy(); expect(view.getByText('Message 105')).toBeTruthy(); expect(view.getByText('Edited older row')).toBeTruthy(); expect(view.queryByText('Message 010')).toBeNull(); expect(view.container.querySelector('[data-chat-message-id="015"] [data-testid="reactions"]')?.textContent).toBe('1');
		expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(104); expect(readCalls()).toHaveLength(0);
	});
	it('bounds a very large resume gap and replaces it with an honest latest page plus older-page navigation', async () => {
		const id = (value: number) => String(value).padStart(3, '0'); let rows = Array.from({ length: 30 }, (_, index) => message(id(index + 1))); const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint.endsWith('-timeline') ? rows.filter(row => !params.untilId || row.id < params.untilId).toSorted((a, b) => b.id.localeCompare(a.id)).slice(0, 30) : original(endpoint, params));
		const view = setup(); await settle(); await view.rerender({ active: false }); rows = Array.from({ length: 300 }, (_, index) => message(id(index + 1))); const before = controls.api.mock.calls.filter(call => call[0].endsWith('-timeline')).length;
		await view.rerender({ active: true }); await settle(); expect(controls.api.mock.calls.filter(call => call[0].endsWith('-timeline')).length - before).toBe(6); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(30); expect(view.getByText('Message 300')).toBeTruthy(); expect(view.queryByText('Message 001')).toBeNull(); expect(view.queryByText('Message 121')).toBeNull(); expect(view.getByRole('button', { name: i18n.ts.loadMore })).toBeTruthy();
	});
	it('replays ordered live mutations received while a resumed older page is pending', async () => {
		const id = (value: number) => String(value).padStart(3, '0'); const page = (newest: number) => Array.from({ length: 30 }, (_, index) => message(id(newest - index))); const pending = deferred<ReturnType<typeof message>[]>(); let resumed = false; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => {
			if (!endpoint.endsWith('-timeline')) return original(endpoint, params);
			if (!resumed) return page(30);
			if (params.untilId === '061') return pending.promise;
			return params.untilId ? page(30) : page(90).map(row => row.id === '077' ? { ...row, reactions: [{ reaction: '❤️', userId: 'peer', user: peer }] } : row);
		});
		const view = setup(); await settle(); await view.rerender({ active: false }); resumed = true; await view.rerender({ active: true }); await settle();
		const channel = controls.channels.at(-1); expect(channel.dispose).not.toHaveBeenCalled();
		channel.fire('message', message('091', { text: 'Live incoming' })); channel.fire('updated', message('091', { text: 'Edited live incoming' })); channel.fire('react', { messageId: '091', reaction: '❤️', userId: 'peer', user: peer }); channel.fire('unreact', { messageId: '091', reaction: '❤️', userId: 'peer' }); channel.fire('react', { messageId: '091', reaction: '⭐', userId: 'peer', user: peer });
		channel.fire('updated', message('080', { text: 'Edited during resume' })); channel.fire('deleted', '079'); channel.fire('react', { messageId: '078', reaction: '❤️', userId: 'peer', user: peer }); channel.fire('unreact', { messageId: '077', reaction: '❤️', userId: 'peer' }); channel.fire('deleted', '076'); channel.fire('updated', message('076', { text: 'Must not resurrect deleted row' }));
		await settle(); expect(view.queryByText('Edited live incoming')).toBeNull(); pending.resolve(page(60)); await settle();
		expect(view.getByText('Edited live incoming')).toBeTruthy(); expect(view.queryByText('Live incoming')).toBeNull(); expect(view.getByText('Edited during resume')).toBeTruthy(); expect(view.queryByText('Message 079')).toBeNull(); expect(view.queryByText('Must not resurrect deleted row')).toBeNull();
		for (const [messageId, count] of [['091', '1'], ['078', '1'], ['077', '0']]) expect(view.container.querySelector(`[data-chat-message-id="${messageId}"] [data-testid="reactions"]`)?.textContent).toBe(count);
		expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(89); expect(readCalls()).toHaveLength(0);
	});
	it('drops the buffered resume and disposed channel events when the account changes', async () => {
		const page = (newest: number) => Array.from({ length: 30 }, (_, index) => message(String(newest - index).padStart(3, '0'))); const pending = deferred<ReturnType<typeof message>[]>(); let resumed = false; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => {
			if (!endpoint.endsWith('-timeline')) return original(endpoint, params);
			if (controls.account.id !== 'me') return [message('new-account', { text: 'New account conversation' })];
			if (!resumed) return page(30);
			return params.untilId ? pending.promise : page(90);
		});
		const view = setup(); await settle(); await view.rerender({ active: false }); resumed = true; await view.rerender({ active: true }); await settle(); const channel = controls.channels.at(-1);
		channel.fire('message', message('091', { text: 'Private buffered old account message' })); controls.account.id = 'other-account'; await settle(); expect(channel.dispose).toHaveBeenCalled(); pending.resolve(page(60)); channel.fire('message', message('092', { text: 'Private disposed channel message' })); channel.fire('unavailable'); await settle();
		expect(view.getByText('New account conversation')).toBeTruthy(); expect(view.queryByText('Private buffered old account message')).toBeNull(); expect(view.queryByText('Private disposed channel message')).toBeNull(); expect(view.queryByRole('alert')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(1);
	});
	it('preserves a local send during reconciliation and replays its following edit and deletion in order', async () => {
		const page = (newest: number) => Array.from({ length: 30 }, (_, index) => message(String(newest - index).padStart(3, '0'))); const pending = deferred<ReturnType<typeof message>[]>(); let resumed = false; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => { if (!endpoint.endsWith('-timeline')) return original(endpoint, params); if (!resumed) return page(30); if (params.untilId === '061') return pending.promise; return params.untilId ? page(30) : page(90); });
		const view = setup(); await settle(); await view.rerender({ active: false }); resumed = true; await view.rerender({ active: true }); await settle(); const channel = controls.channels.at(-1);
		const local = message('091', { fromUserId: 'me', fromUser: controls.account, toUserId: 'peer', text: 'Local send during resume' }); controls.send!(local); channel.fire('message', local); channel.fire('updated', { ...local, text: 'Edited local send' });
		const deleted = message('092', { ...local, id: '092', text: 'Deleted local send' }); controls.send!(deleted); channel.fire('message', deleted); channel.fire('deleted', '092'); await settle(); expect(view.getByText('Local send during resume')).toBeTruthy();
		pending.resolve(page(60)); await settle(); expect(view.queryByText('Local send during resume')).toBeNull(); expect(view.getAllByText('Edited local send')).toHaveLength(1); expect(view.queryByText('Deleted local send')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(91);
	});
	it('replays live mutations over the latest-page fallback when an older resume page fails', async () => {
		const page = (newest: number) => Array.from({ length: 30 }, (_, index) => message(String(newest - index).padStart(3, '0'))); const pending = deferred<void>(); let resumed = false; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => { if (!endpoint.endsWith('-timeline')) return original(endpoint, params); if (!resumed) return page(30); if (params.untilId) { await pending.promise; throw new Error('offline older page'); } return page(90); });
		const view = setup(); await settle(); await view.rerender({ active: false }); resumed = true; await view.rerender({ active: true }); await settle(); const channel = controls.channels.at(-1); channel.fire('message', message('091')); channel.fire('deleted', '080'); channel.fire('updated', message('081', { text: 'Live fallback edit' })); pending.resolve(); await settle();
		expect(view.getByText('Message 091')).toBeTruthy(); expect(view.getByText('Live fallback edit')).toBeTruthy(); expect(view.queryByText('Message 080')).toBeNull(); expect(view.queryByText('Message 001')).toBeNull(); expect(view.getByRole('alert')).toBeTruthy(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(30);
	});
	it('clears a cancelled resume buffer without discarding the next resume live events', async () => {
		const page = (newest: number) => Array.from({ length: 30 }, (_, index) => message(String(newest - index).padStart(3, '0'))); const pending = deferred<ReturnType<typeof message>[]>(); let phase = 0; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => { if (!endpoint.endsWith('-timeline')) return original(endpoint, params); if (phase === 0) return page(30); if (phase === 1) return params.untilId ? pending.promise : page(90); return [message('100')]; });
		const view = setup(); await settle(); await view.rerender({ active: false }); phase = 1; await view.rerender({ active: true }); await settle(); const oldChannel = controls.channels.at(-1); oldChannel.fire('message', message('091', { text: 'Cancelled buffered message' }));
		await view.rerender({ active: false }); phase = 2; await view.rerender({ active: true }); await settle(); const channel = controls.channels.at(-1); oldChannel.fire('message', message('092', { text: 'Disposed same-account channel message' })); channel.fire('message', message('101', { text: 'New live message' })); pending.resolve(page(60)); await settle();
		expect(view.getByText('Message 100')).toBeTruthy(); expect(view.getByText('New live message')).toBeTruthy(); expect(view.queryByText('Cancelled buffered message')).toBeNull(); expect(view.queryByText('Disposed same-account channel message')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(2);
	});
	it('does not mix stale history into a partial resume when an older-page request fails', async () => {
		const id = (value: number) => String(value).padStart(3, '0'); let resumed = false; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => { if (!endpoint.endsWith('-timeline')) return original(endpoint, params); if (!resumed) return Array.from({ length: 30 }, (_, index) => message(id(30 - index))); if (params.untilId) throw new Error('offline older page'); return Array.from({ length: 30 }, (_, index) => message(id(100 - index))); });
		const view = setup(); await settle(); await view.rerender({ active: false }); resumed = true; await view.rerender({ active: true }); await settle(); expect(view.getByText('Message 100')).toBeTruthy(); expect(view.queryByText('Message 001')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(30); expect(view.getByRole('alert')).toBeTruthy();
	});
	it('does not insert an edited unloaded old message ahead of the pagination frontier', async () => {
		const original = controls.api.getMockImplementation()!; controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint.endsWith('-timeline') ? Array.from({ length: 30 }, (_, index) => message(String(129 - index))) : original(endpoint, params));
		const view = setup(); await settle(); controls.channels.find(item => item.name === 'chatUser').fire('updated', message('020', { text: 'Unloaded old edit' })); await settle(); expect(view.queryByText('Unloaded old edit')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); expect(controls.api).toHaveBeenCalledWith('chat/messages/user-timeline', { userId: 'peer', limit: 30, markAsRead: false, untilId: '100' });
	});
	it('ignores an older-page response superseded by resume without clearing a new pending load', async () => {
		const oldPage = deferred<ReturnType<typeof message>[]>(); const newPage = deferred<ReturnType<typeof message>[]>(); let olderCalls = 0; const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (endpoint: string, params: any) => { if (!endpoint.endsWith('-timeline')) return original(endpoint, params); if (params.untilId) return ++olderCalls === 1 ? oldPage.promise : newPage.promise; return Array.from({ length: 30 }, (_, index) => message(String(90 - index).padStart(3, '0'))); });
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); expect((view.getByRole('button', { name: i18n.ts.loadMore }) as HTMLButtonElement).disabled).toBe(true);
		await view.rerender({ active: false }); await view.rerender({ active: true }); await settle(); expect((view.getByRole('button', { name: i18n.ts.loadMore }) as HTMLButtonElement).disabled).toBe(false);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); oldPage.resolve([message('050', { text: 'Stale deleted older message' })]); await settle();
		expect(view.queryByText('Stale deleted older message')).toBeNull(); expect(view.container.querySelectorAll('[data-chat-message-id]')).toHaveLength(30); expect((view.getByRole('button', { name: i18n.ts.loadMore }) as HTMLButtonElement).disabled).toBe(true);
		newPage.resolve([message('060', { text: 'Current older message' })]); await settle(); expect(view.getByText('Current older message')).toBeTruthy(); expect(view.queryByText('Stale deleted older message')).toBeNull(); expect(view.queryByRole('button', { name: i18n.ts.loadMore })).toBeNull();
	});
	it('handles reaction removal by explicit actor and read receipt frontiers', async () => {
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'users/show' ? peer : endpoint.endsWith('-timeline') ? [message('01', { fromUserId: 'me', fromUser: controls.account, reactions: [{ reaction: '❤️', userId: 'me', user: controls.account }, { reaction: '❤️', userId: 'peer', user: peer }] })] : preference);
		const view = setup(); await settle(); const channel = controls.channels.find(item => item.name === 'chatUser'); channel.fire('unreact', { messageId: '01', reaction: '❤️', userId: 'me' }); channel.fire('read', { userId: 'peer', messageId: '01' }); await settle();
		expect(view.getByTestId('reactions').textContent).toBe('1'); expect(view.getByText('READ')).toBeTruthy();
	});
	it('expires typing and ignores the current account typing echo', async () => {
		const view = setup(); await settle(); const channel = controls.channels.find(item => item.name === 'chatUser'); channel.fire('typing', { userId: 'me', typing: true }); await settle(); expect(view.queryByRole('status')).toBeNull();
		channel.fire('typing', { userId: 'peer', typing: true }); await settle(); expect(view.getByText(i18n.ts.zalip._chatUi.typing)).toBeTruthy(); await vi.advanceTimersByTimeAsync(6000); expect(view.queryByText(i18n.ts.zalip._chatUi.typing)).toBeNull();
	});
	it('loads a personal pinned message without reading and clears it on deletion', async () => {
		const original = controls.api.getMockImplementation()!; controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint === 'zalip/chat/preferences/show' ? { ...preference, pinnedMessageId: '02' } : endpoint === 'chat/messages/show' ? message() : original(endpoint, params));
		const view = setup(); await settle(); expect(view.getByRole('link', { name: /Message 02/u }).getAttribute('href')).toBe('/chat/messages/02'); expect(readCalls()).toHaveLength(0);
		controls.channels.find(item => item.name === 'chatUser').fire('deleted', '02'); await settle(); expect(view.queryByRole('link', { name: /Message 02/u })).toBeNull();
	});
	it('does not display a pinned message from a stale account or wrong conversation', async () => {
		const pending = deferred<any>(); const original = controls.api.getMockImplementation()!; controls.api.mockImplementation(async (endpoint: string, params: any) => endpoint === 'zalip/chat/preferences/show' ? { ...preference, pinnedMessageId: 'pin' } : endpoint === 'chat/messages/show' ? pending.promise : original(endpoint, params));
		const view = setup(); await settle(); controls.account.id = 'new-account'; await settle(); pending.resolve(message('pin', { text: 'Private old pin', toUserId: 'me' })); await settle(); expect(view.queryByText('Private old pin')).toBeNull();
	});
	it('exposes load failure and permits retry without duplicate timelines', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')); const view = setup(); await settle(); expect(view.getByRole('alert')).toBeTruthy(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle(); expect(view.getByText('Message 02')).toBeTruthy();
		controls.channels.find(item => item.name === 'chatUser').fire('message', message('02')); await settle(); expect(view.getAllByText('Message 02')).toHaveLength(1);
	});
});

describe('Zalip conversation sidebar', () => {
	it('does not select or read a conversation automatically and sends server-side filters/search', async () => {
		const view = sidebar(); await settle(); expect(view.emitted().select).toBeUndefined(); expect(readCalls()).toHaveLength(0);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.unread })); await fireEvent.update(view.getByRole('searchbox'), 'Peer'); await vi.advanceTimersByTimeAsync(260); await settle();
		expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', { filter: 'unread', query: 'Peer', limit: 30 });
	});
	it('paginates opaque cursors and deduplicates rows without changing selection', async () => {
		controls.api.mockResolvedValueOnce({ items: [conversation('one')], nextCursor: 'opaque-cursor' }).mockResolvedValueOnce({ items: [conversation('one'), conversation('two')], nextCursor: null });
		const view = sidebar(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore })); await settle(); expect(controls.api).toHaveBeenLastCalledWith('zalip/chat/conversations', expect.objectContaining({ cursor: 'opaque-cursor' }));
		expect(view.getAllByText('one')).toHaveLength(1); expect(view.getByText('two')).toBeTruthy(); expect(view.emitted().select).toBeUndefined();
	});
	it('uses explicit preference updates and refreshes after pin/archive/mute', async () => {
		const view = sidebar(); await settle(); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` }));
		const entries = controls.menu.mock.calls.at(-1)![0];
		for (const [label, key] of [[i18n.ts.zalip._chatUi.pin, 'isPinned'], [i18n.ts.zalip._chatUi.archive, 'isArchived'], [i18n.ts.zalip._chatUi.muteConversation, 'isMuted']]) { entries.find((entry: any) => entry.text === label).action(); await settle(); expect(controls.api).toHaveBeenCalledWith('zalip/chat/preferences/update', { userId: 'peer', [key]: true }); }
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/chat/preferences/update')).toHaveLength(3);
		await vi.advanceTimersByTimeAsync(130); await settle(); expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/chat/conversations')).toHaveLength(2);
	});
	it('does not execute an old account menu or apply its pending list response', async () => {
		const view = sidebar(); await settle(); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); const entries = controls.menu.mock.calls.at(-1)![0];
		controls.account.id = 'new-account'; await settle(); entries.find((entry: any) => entry.text === i18n.ts.zalip._chatUi.archive).action(); await settle(); expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/chat/preferences/update')).toHaveLength(0);
	});
	it('reports a mutation error without hiding the conversation', async () => {
		const view = sidebar(); await settle(); controls.api.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); controls.menu.mock.calls.at(-1)![0][0].action(); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._chatUi.actionError); expect(view.getByText('peer')).toBeTruthy();
	});
});
