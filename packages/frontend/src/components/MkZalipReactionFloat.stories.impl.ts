/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { ref } from 'vue';
import type { StoryObj } from '@storybook/vue3';
import MkZalipReactionFloat from './MkZalipReactionFloat.vue';

export const Default = {
	render(args) {
		return { components: { MkZalipReactionFloat }, setup: () => ({ args, target: ref<HTMLElement | null>(null) }), template: '<div ref="target" style="position:relative;width:300px;height:260px;border:1px solid var(--MI_THEME-divider)"><MkZalipReactionFloat v-bind="args" :target="target"/></div>' };
	},
	args: { noteId: 'example', myReaction: '👍', reactions: { '👍': 5, '❤️': 2, '🔥': 1 }, reactionEmojis: {}, target: null },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkZalipReactionFloat>;

export const NoReactions = { ...Default, args: { ...Default.args, reactions: {} } } satisfies StoryObj<typeof MkZalipReactionFloat>;
export const NoSelectedReaction = { ...Default, args: { ...Default.args, myReaction: null } } satisfies StoryObj<typeof MkZalipReactionFloat>;
