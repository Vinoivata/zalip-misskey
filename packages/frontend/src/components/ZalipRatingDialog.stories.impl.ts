/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import ZalipRatingDialog from './ZalipRatingDialog.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) {
		return { components: { ZalipRatingDialog }, setup: () => ({ args }), template: '<ZalipRatingDialog v-bind="args"/>' };
	},
	args: { title: 'Example movie', subtitle: '2026', initialRating: 8, ratedWorks: [{ personalRating: 8, work: { id: 'example', title: 'Another movie', posterPath: null } }] },
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof ZalipRatingDialog>;

export const Saving = { ...Default, args: { ...Default.args, saving: true } } satisfies StoryObj<typeof ZalipRatingDialog>;
export const Error = { ...Default, args: { ...Default.args, error: 'Unable to save. Try again.' } } satisfies StoryObj<typeof ZalipRatingDialog>;
export const LowRating = { ...Default, args: { ...Default.args, initialRating: 3 } } satisfies StoryObj<typeof ZalipRatingDialog>;
export const Loading = { ...Default, args: { ...Default.args, relatedPending: true } } satisfies StoryObj<typeof ZalipRatingDialog>;
export const LibraryError = { ...Default, args: { ...Default.args, relatedError: true } } satisfies StoryObj<typeof ZalipRatingDialog>;
