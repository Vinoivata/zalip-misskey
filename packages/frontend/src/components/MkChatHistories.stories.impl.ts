/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { http, HttpResponse } from 'msw';
import { action } from 'storybook/actions';
import { chatMessage, userLite } from '../../.storybook/fakes';
import MkChatHistories from './MkChatHistories.vue';
import type { StoryObj } from '@storybook/vue3';
export const Default = {
	render(args) {
		return {
			components: {
				MkChatHistories,
			},
			setup() {
				return {
					args,
				};
			},
			computed: {
				props() {
					return {
						...this.args,
					};
				},
			},
			template: '<MkChatHistories v-bind="props" />',
		};
	},
	parameters: {
		layout: 'centered',
		msw: {
			handlers: [
				http.post('*/api/zalip/chat/conversations', async ({ request }) => {
					const body = await request.json();
					action('POST /api/zalip/chat/conversations')(body);
					return HttpResponse.json({ items: [{ key: 'user:demouser', kind: 'user', user: userLite('demouser', 'cinemafan', null, 'Cinema fan'), room: null, lastMessage: chatMessage(), unread: true, preferences: { isPinned: false, isArchived: false, isMuted: false, pinnedMessageId: null } }], nextCursor: null });
				}),
			],
		},
	},
} satisfies StoryObj<typeof MkChatHistories>;
