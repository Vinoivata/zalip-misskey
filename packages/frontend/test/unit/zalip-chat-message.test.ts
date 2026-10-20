/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import Message from '@/pages/chat/XMessage.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), menu: vi.fn(), account: null as any, preferences: null as any }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, contextMenu: vi.fn(), confirm: vi.fn(), popupAsyncWithDialog: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { get s() { return controls.preferences; } } }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: vi.fn() }));
vi.mock('@/utility/reaction-picker.js', () => ({ reactionPicker: { show: vi.fn() } }));
vi.mock('@/utility/copy-to-clipboard.js', () => ({ copyToClipboard: vi.fn() }));
vi.mock('@/components/MkMediaList.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkUrlPreview.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { props: ['reaction'], template: '<span>{{ reaction }}</span>' } }));

const peer = { id: 'peer', username: 'peer', name: 'Peer', host: null };
const third = { id: 'third', username: 'third', name: 'Third', host: null };
const stubs = {
	MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	MkAvatar: defineComponent({ props: { user: { type: Object, required: true }, link: Boolean }, setup: props => () => h(props.link ? 'a' : 'span', { 'data-avatar-user': props.user.id, ...(props.link ? { href: `/@${props.user.username}`, 'aria-label': `Avatar ${props.user.username}` } : {}) }) }),
	MkUserName: defineComponent({ props: ['user'], setup: props => () => h('span', props.user.name || props.user.username) }),
	Mfm: defineComponent({ props: ['text'], setup: props => () => h('span', props.text) }),
};
function message(patch: Record<string, unknown> = {}): any { return { id: 'message', fromUserId: peer.id, fromUser: peer, toUserId: 'me', toRoomId: null, file: null, text: 'Message text', reactions: [], createdAt: '2026-10-20T00:00:00Z', ...patch }; }
function setup(patch: Record<string, unknown> = {}, props: Record<string, unknown> = {}) { return render(Message, { props: { message: message(patch), ...props }, global: { stubs } }); }
async function settle() { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.account = reactive({ id: 'me', username: 'me', name: 'Me', host: null, policies: { chatAvailability: 'available' } }); controls.preferences = reactive({ animation: false, 'chat.showSenderName': true }); controls.api.mockResolvedValue(undefined); });
afterEach(cleanup);

describe('real chat message rendering and actions', () => {
	it('groups identical reactions and preserves actor identities in a native profile list', async () => {
		const records = [peer, controls.account, third].map(user => ({ reaction: '❤️', userId: user.id, user })); const view = setup({ reactions: records });
		expect(view.getAllByRole('button', { name: '❤️' })).toHaveLength(1); expect(view.getByText('3')).toBeTruthy();
		const people = view.getByRole('button', { name: `${i18n.ts.reaction}: Peer (@peer), Me (@me), Third (@third)` }); await fireEvent.click(people);
		expect(controls.menu.mock.calls.at(-1)?.[0]).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'link', to: '/@peer', caption: '@peer' }), expect.objectContaining({ type: 'link', to: '/@third', caption: '@third' })]));
		await fireEvent.click(view.getByRole('button', { name: '❤️' })); await settle(); expect(controls.api).toHaveBeenCalledWith('chat/messages/unreact', { messageId: 'message', reaction: '❤️' });
		await view.rerender({ message: message({ reactions: records.filter(record => record.userId !== 'me') }) }); await fireEvent.click(view.getByRole('button', { name: '❤️' })); await settle(); expect(controls.api).toHaveBeenLastCalledWith('chat/messages/react', { messageId: 'message', reaction: '❤️' });
	});
	it('keeps group avatars linked and respects the sender-name setting', async () => {
		const view = setup({ toRoomId: 'room', toUserId: null }); expect(view.getByRole('link', { name: 'Avatar peer' }).getAttribute('href')).toBe('/@peer'); expect(view.getByRole('link', { name: 'Peer' }).getAttribute('href')).toBe('/@peer');
		controls.preferences['chat.showSenderName'] = false; await settle(); expect(view.queryByRole('link', { name: 'Peer' })).toBeNull(); expect(view.getByRole('link', { name: 'Avatar peer' })).toBeTruthy();
	});
	it('provides the correct profile and conversation links for incoming DM search results', () => {
		const view = setup({}, { isSearchResult: true }); expect(view.getByRole('link', { name: 'Peer' }).getAttribute('href')).toBe('/@peer'); expect(view.getByRole('link', { name: '@peer' }).getAttribute('href')).toBe('/chat/user/peer');
	});
	it('routes outgoing DM search results to the peer rather than the current account', () => {
		const view = setup({ fromUserId: 'me', fromUser: controls.account, toUserId: peer.id, toUser: peer }, { isSearchResult: true }); expect(view.getByRole('link', { name: '@peer' }).getAttribute('href')).toBe('/chat/user/peer');
	});
	it('preserves native reply, forward and pin actions in the accessible message menu', async () => {
		const view = setup(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); const entries = controls.menu.mock.calls.at(-1)?.[0];
		for (const [label, event] of [[i18n.ts.reply, 'reply'], [i18n.ts.zalip._chatUi.forward, 'forward'], [i18n.ts.zalip._chatUi.pinMessageForMe, 'pin']]) { entries.find((entry: any) => entry.text === label).action(); expect(view.emitted()[event]).toHaveLength(1); }
	});
});
