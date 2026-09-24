/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkZalipIcon from './MkZalipIcon.vue';

export const Default = {
	render(args) {
		return { components: { MkZalipIcon }, setup: () => ({ args }), template: '<MkZalipIcon v-bind="args"/>' };
	},
	args: { name: 'home', filled: false },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkZalipIcon>;

export const Active = { ...Default, args: { name: 'home', filled: true } } satisfies StoryObj<typeof MkZalipIcon>;
