/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { HttpResponse, http } from 'msw';
import MkZalipReviewsPanel from './MkZalipReviewsPanel.vue';
import type { StoryObj } from '@storybook/vue3';
import type { ZalipReview, ZalipReviewsResponse } from '@/utility/zalip-reviews.js';

const example: ZalipReview = {
	id: 'review-example', workId: 'example-work', user: { id: 'example-author', name: 'Cinema fan', username: 'cinemafan', host: null, avatarUrl: '/static-assets/avatar.png', avatarBlurhash: null, avatarDecorations: [], isBot: false, isCat: false, emojis: {}, onlineStatus: 'unknown' },
	format: 'review', title: null, body: 'A thoughtful story with memorable characters and a beautiful soundtrack. The final act brings its ideas together without rushing.', isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 12, unhelpfulCount: 1, myVote: null,
	createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', canEdit: false, canDelete: false,
};

function fixture(items: ZalipReview[]): ZalipReviewsResponse {
	return { items, total: items.length, myReview: null, summary: { reviewCount: items.length, positiveCount: items.length, neutralCount: 0, negativeCount: 0, averageRating: 7.8, ratingCount: 24, histogram: [0, 0, 0, 1, 1, 2, 6, 8, 4, 2] } };
}

export const Default = {
	render(args) {
		return { components: { MkZalipReviewsPanel }, setup: () => ({ args }), template: '<div style="max-width: 840px; margin: auto;"><MkZalipReviewsPanel v-bind="args"/></div>' };
	},
	args: { workId: 'example-work', workTitle: 'A memorable film' },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/zalip/reviews/list', () => HttpResponse.json(fixture([example, { ...example, id: 'spoiler-example', format: 'essay', title: 'The meaning of the ending', isSpoiler: true }])))] } },
} satisfies StoryObj<typeof MkZalipReviewsPanel>;

export const Empty = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/reviews/list', () => HttpResponse.json(fixture([])))] } } } satisfies StoryObj<typeof MkZalipReviewsPanel>;

export const Error = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/reviews/list', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }))] } } } satisfies StoryObj<typeof MkZalipReviewsPanel>;
