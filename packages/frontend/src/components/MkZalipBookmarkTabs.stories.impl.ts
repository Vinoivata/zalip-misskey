/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import MkZalipBookmarkTabs from './MkZalipBookmarkTabs.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) {
		return { components: { MkZalipBookmarkTabs }, setup: () => ({ args }), template: '<MkZalipBookmarkTabs v-bind="args"/>' };
	},
	args: { active: 'posts' },
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof MkZalipBookmarkTabs>;

export const Content = { ...Default, args: { active: 'content' } } satisfies StoryObj<typeof MkZalipBookmarkTabs>;
