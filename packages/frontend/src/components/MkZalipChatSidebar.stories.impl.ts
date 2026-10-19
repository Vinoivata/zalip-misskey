/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { HttpResponse, http } from 'msw';
import { action } from 'storybook/actions';
import { chatMessage, chatRoom, userLite } from '../../.storybook/fakes.js';
import MkZalipChatSidebar from './MkZalipChatSidebar.vue';
import type { StoryObj } from '@storybook/vue3';
import type { ChatConversationsResponse } from '@/utility/zalip-chat-types.js';

const preferences = { isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null };
const fixture: ChatConversationsResponse = { items: [
	{ key: 'user:demouser', kind: 'user', user: userLite('demouser', 'cinemafan', null, 'Cinema fan'), room: null, lastMessage: chatMessage(false, 'demomessage', 'Have you seen the new episode?'), unread: true, preferences: { ...preferences, isPinned: true } },
	{ key: 'room:demoroom', kind: 'room', user: null, room: chatRoom('demoroom', 'Movie club'), lastMessage: null, unread: false, preferences },
], nextCursor: null };

export const Default = {
	render(args) { return { components: { MkZalipChatSidebar }, setup: () => ({ args, select: action('select') }), template: '<div style="height: 640px; width: 360px;"><MkZalipChatSidebar v-bind="args" @select="select"/></div>' }; },
	args: { selectedKey: 'user:demouser' },
	parameters: { layout: 'centered', msw: { handlers: [http.post('*/api/zalip/chat/conversations', () => HttpResponse.json(fixture)), http.post('*/api/zalip/chat/preferences/update', () => HttpResponse.json(preferences))] } },
} satisfies StoryObj<typeof MkZalipChatSidebar>;

export const Compact = { ...Default, args: { ...Default.args, compact: true }, render(args) { return { components: { MkZalipChatSidebar }, setup: () => ({ args }), template: '<div style="height: 540px; width: 330px;"><MkZalipChatSidebar v-bind="args"/></div>' }; } } satisfies StoryObj<typeof MkZalipChatSidebar>;

export const Empty = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/chat/conversations', () => HttpResponse.json({ items: [], nextCursor: null }))] } } } satisfies StoryObj<typeof MkZalipChatSidebar>;
export const Error = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/chat/conversations', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }))] } } } satisfies StoryObj<typeof MkZalipChatSidebar>;
