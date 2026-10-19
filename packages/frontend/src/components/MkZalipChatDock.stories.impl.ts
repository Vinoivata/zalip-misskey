/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import MkZalipChatDock from './MkZalipChatDock.vue';

/** Uses the native signed-in Storybook account; never seeds or fetches another user's chats. */
export const Default = {
	render(args) { return { components: { MkZalipChatDock }, setup() { return { args }; }, template: '<MkZalipChatDock v-bind="args"/>' }; },
	args: {},
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof MkZalipChatDock>;
