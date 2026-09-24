/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkZalipSectionHeader from './MkZalipSectionHeader.vue';
import { i18n } from '@/i18n.js';

export const Default = {
	render(args) {
		return { components: { MkZalipSectionHeader }, setup: () => ({ args }), template: '<MkZalipSectionHeader v-bind="args"/>' };
	},
	args: { title: i18n.ts.notifications, tab: 'all', tabs: [{ key: 'all', title: i18n.ts.all }, { key: 'mentions', title: i18n.ts.mentions }] },
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof MkZalipSectionHeader>;
