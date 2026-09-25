/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkZalipAccentPicker from './MkZalipAccentPicker.vue';

export const Default = {
	render(args) {
		return { components: { MkZalipAccentPicker }, setup: () => ({ args }), template: '<MkZalipAccentPicker v-bind="args"/>' };
	},
	args: {
		initialValue: 'blue',
		options: [
			{ value: 'blue', label: 'Sapphire', color: '#527bff', icon: 'ti ti-diamond' },
			{ value: 'purple', label: 'Violet', color: '#aa80ff', icon: 'ti ti-flower' },
			{ value: 'green', label: 'Emerald', color: '#39b68a', icon: 'ti ti-leaf' },
			{ value: 'gold', label: 'Amber', color: '#e9ac43', icon: 'ti ti-sun' },
		],
		onSelect: () => {},
	},
} satisfies StoryObj<typeof MkZalipAccentPicker>;
