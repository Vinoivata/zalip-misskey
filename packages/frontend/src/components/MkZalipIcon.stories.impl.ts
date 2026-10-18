/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkZalipIcon, { zalipIconNames } from './MkZalipIcon.vue';

export const Default = {
	render(args) {
		return { components: { MkZalipIcon }, setup: () => ({ args }), template: '<MkZalipIcon v-bind="args"/>' };
	},
	args: { name: 'home', filled: false },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkZalipIcon>;

export const Active = {
	...Default,
	args: { name: 'bookmark', filled: true },
} satisfies StoryObj<typeof MkZalipIcon>;

export const AllOutlines = {
	args: { name: 'home', filled: true },
	render() {
		return {
			components: { MkZalipIcon },
			setup: () => ({ names: zalipIconNames }),
			template: '<div style="display: grid; grid-template-columns: repeat(4, minmax(90px, 1fr)); gap: 20px; text-align: center;"><div v-for="name in names" :key="name"><MkZalipIcon :name="name" :filled="true"/><div style="margin-top: 8px; font-size: 12px;">{{ name }}</div></div></div>',
		};
	},
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkZalipIcon>;
