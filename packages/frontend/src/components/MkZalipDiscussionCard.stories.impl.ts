/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StoryObj } from '@storybook/vue3';
import MkZalipDiscussionCard from './MkZalipDiscussionCard.vue';

export const Default = {
	render(args) { return { components: { MkZalipDiscussionCard }, setup: () => ({ args }), template: '<div style="max-width: 600px"><MkZalipDiscussionCard v-bind="args"/></div>' }; },
	args: { context: { workId: 'work', slug: 'sample-title', title: 'A title discussion, not a post by its importer', posterPath: null, rootNoteId: 'root', isRoot: true, episodeId: null, episodeNumber: null, seasonNumber: null } },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkZalipDiscussionCard>;

export const Episode = { ...Default, args: { context: { ...Default.args.context, episodeId: 'episode', episodeNumber: 3, seasonNumber: 1 } } } satisfies StoryObj<typeof MkZalipDiscussionCard>;
