/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import MkZalipReviewCard from './MkZalipReviewCard.vue';
import type { StoryObj } from '@storybook/vue3';
import type { ZalipReview } from '@/utility/zalip-reviews.js';

const review: ZalipReview = {
	id: 'review-example', workId: 'example-work', user: { id: 'example-author', name: 'Cinema fan', username: 'cinemafan', host: null, avatarUrl: '/static-assets/avatar.png', avatarBlurhash: null, avatarDecorations: [], isBot: false, isCat: false, emojis: {}, onlineStatus: 'unknown' },
	format: 'review', title: null, body: 'A thoughtful story with memorable characters and a beautiful soundtrack. The final act brings its ideas together without rushing.', isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 12, unhelpfulCount: 1, myVote: null,
	createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', canEdit: false, canDelete: false,
};

export const Default = {
	render(args) { return { components: { MkZalipReviewCard }, setup: () => ({ args }), template: '<div style="max-width: 700px; margin: auto"><MkZalipReviewCard v-bind="args"/></div>' }; },
	args: { review, viewerId: 'viewer', work: { slug: 'example-film', title: 'A memorable film', releaseYear: 2026 } },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkZalipReviewCard>;

export const Spoiler = { ...Default, args: { ...Default.args, review: { ...review, format: 'essay', title: 'The hidden ending', isSpoiler: true } } } satisfies StoryObj<typeof MkZalipReviewCard>;
export const NoRating = { ...Default, args: { ...Default.args, review: { ...review, rating: null, sentiment: 'neutral' } } } satisfies StoryObj<typeof MkZalipReviewCard>;
export const Mobile = { ...Default, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipReviewCard>;
