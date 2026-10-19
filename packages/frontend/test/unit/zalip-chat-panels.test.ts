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

const controls = vi.hoisted(() => ({ api: vi.fn(), menu: vi.fn(), user: vi.fn(), account: null as any, channels: [] as any[], observers: [] as any[], resizeObservers: [] as any[] }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api, misskeyApiZalip: controls.api }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, selectUser: controls.user, toast: vi.fn(), popups: { value: [] } }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: (name: string) => { const handlers = new Map(); const connection = { name, on: (event: string, handler: any) => { handlers.set(event, handler); }, fire: (event: string, payload: any) => handlers.get(event)?.(payload), send: vi.fn(), dispose: vi.fn() }; controls.channels.push(connection); return connection; } }) }));
vi.mock('@/pages/chat/room.form.vue', () => ({ default: { props: ['active'], template: '<textarea data-testid="composer" :disabled="!active" />' } }));
vi.mock('@/pages/chat/room.search.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.members.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/chat/room.info.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkMediaList.vue', () => ({ default: { props: ['mediaList'], template: '<div data-testid="loaded-media">{{ mediaList.length }}</div>' } }));
vi.mock('@/components/MkMediaBanner.vue', () => ({ default: { props: ['media'], template: '<div data-testid="loaded-file" :data-sensitive="media.isSensitive">{{ media.name }}</div>' } }));
vi.mock('@/pages/chat/XMessage.vue', () => ({ default: { props: ['message', 'isReadByRecipient'], emits: ['pin'], template: '<div><span>{{ message.text }}</span><span data-testid="reactions">{{ message.reactions.length }}</span><span v-if="isReadByRecipient">READ</span><button @click="$emit(\'pin\', message)">Pin message</button></div>' } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot /></div>' } }));

const peer = { id: 'peer', username: 'peer', name: 'Peer', host: null, canChat: true };
const preference = { isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null };
function message(id = '02', patch: Record<string, unknown> = {}) { return { id, createdAt: '2026-10-20T00:00:00Z', fromUserId: 'peer', fromUser: peer, toUserId: 'me', text: `Message ${id}`, file: null, reactions: [], ...patch }; }
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
	vi.clearAllMocks(); vi.useFakeTimers(); controls.channels.length = 0; controls.observers.length = 0; controls.resizeObservers.length = 0;
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
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/chat/conversations').length).toBe(4);
	});
	it('does not execute an old account menu or apply its pending list response', async () => {
		const view = sidebar(); await settle(); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); const entries = controls.menu.mock.calls.at(-1)![0];
		controls.account.id = 'new-account'; await settle(); entries.find((entry: any) => entry.text === i18n.ts.zalip._chatUi.archive).action(); await settle(); expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/chat/preferences/update')).toHaveLength(0);
	});
	it('reports a mutation error without hiding the conversation', async () => {
		const view = sidebar(); await settle(); controls.api.mockRejectedValueOnce(new Error('offline')); await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.more}: peer` })); controls.menu.mock.calls.at(-1)![0][0].action(); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._chatUi.actionError); expect(view.getByText('peer')).toBeTruthy();
	});
});
