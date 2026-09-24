/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import MkZalipFeed from './MkZalipFeed.vue';

export const Default = {
	render() {
		return { components: { MkZalipFeed }, template: '<MkZalipFeed/>' };
	},
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof MkZalipFeed>;
