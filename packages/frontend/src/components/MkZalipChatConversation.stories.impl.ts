/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { HttpResponse, http } from 'msw';
import { action } from 'storybook/actions';
import { chatMessage, userDetailed } from '../../.storybook/fakes.js';
import MkZalipChatConversation from './MkZalipChatConversation.vue';
import type { StoryObj } from '@storybook/vue3';

const peer = { ...userDetailed('demouser', 'cinemafan', null, 'Cinema fan'), canChat: true };
const first = { ...chatMessage(false, 'demomessageone', 'Have you seen the new episode?'), fromUserId: peer.id, fromUser: peer, toUserId: 'someuserid' };
const second = { ...chatMessage(false, 'demomessagetwo', 'Not yet. Let’s discuss it after watching!'), toUserId: peer.id, replyId: first.id, reply: { id: first.id, text: first.text ?? null, fromUser: peer, fileName: null } };
const handlers = [
	http.post('*/api/users/show', () => HttpResponse.json(peer)),
	http.post('*/api/chat/messages/user-timeline', () => HttpResponse.json([second, first])),
	http.post('*/api/zalip/chat/preferences/show', () => HttpResponse.json({ isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null })),
	http.post('*/api/chat/messages/read', async ({ request }) => { const body = await request.json() as { messageId: string }; return HttpResponse.json({ readThroughId: body.messageId, hasUnread: false }); }),
];

export const Default = {
	render(args) { return { components: { MkZalipChatConversation }, setup: () => ({ args, loaded: action('loaded') }), template: '<div style="height: 680px; width: min(760px, calc(100vw - 32px));"><MkZalipChatConversation v-bind="args" @loaded="loaded"/></div>' }; },
	args: { userId: peer.id },
	parameters: { layout: 'centered', msw: { handlers } },
} satisfies StoryObj<typeof MkZalipChatConversation>;
export const Compact = { ...Default, args: { ...Default.args, compact: true }, render(args) { return { components: { MkZalipChatConversation }, setup: () => ({ args }), template: '<div style="height: 540px; width: 350px;"><MkZalipChatConversation v-bind="args"/></div>' }; } } satisfies StoryObj<typeof MkZalipChatConversation>;
export const Error = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/users/show', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 })), ...handlers.slice(1)] } } } satisfies StoryObj<typeof MkZalipChatConversation>;
export const Inactive = { ...Default, args: { ...Default.args, active: false } } satisfies StoryObj<typeof MkZalipChatConversation>;
