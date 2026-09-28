/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import ZalipRatingDialog from './ZalipRatingDialog.vue';

export const Default = {
	render(args) {
		return { components: { ZalipRatingDialog }, setup: () => ({ args }), template: '<ZalipRatingDialog v-bind="args"/>' };
	},
	args: { title: 'Example movie', subtitle: 'Original title, 2026', initialRating: 8, communityRating: 7.2 },
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof ZalipRatingDialog>;

export const Saving = { ...Default, args: { ...Default.args, saving: true } } satisfies StoryObj<typeof ZalipRatingDialog>;
export const Error = { ...Default, args: { ...Default.args, error: 'Unable to save. Try again.' } } satisfies StoryObj<typeof ZalipRatingDialog>;
