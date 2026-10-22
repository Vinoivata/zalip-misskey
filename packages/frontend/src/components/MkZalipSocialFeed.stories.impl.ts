/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { HttpResponse, http } from 'msw';
import MkZalipSocialFeed from './MkZalipSocialFeed.vue';
import type { StoryObj } from '@storybook/vue3';
import type { ZalipSocialFeedItem } from './zalip-social-feed.js';
import type { ZalipReview } from '@/utility/zalip-reviews.js';

function fixture(essay = false): ZalipSocialFeedItem {
	const format = essay ? 'essay' : 'review';
	const review: ZalipReview = {
		id: 'example', workId: 'example-work', user: { id: 'example-author', name: 'Cinema fan', username: 'cinemafan', host: null, avatarUrl: '/static-assets/avatar.png', avatarBlurhash: null, avatarDecorations: [], isBot: false, isCat: false, emojis: {}, onlineStatus: 'unknown' },
		format, title: essay ? 'How the soundtrack tells the story' : null, body: 'A thoughtful story with memorable characters and a beautiful soundtrack. The final act brings its ideas together without rushing.', isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 12, unhelpfulCount: 1, myVote: null,
		createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z', canEdit: false, canDelete: false,
	};
	return { type: format, key: `${format}:example`, id: review.id, createdAt: review.createdAt, review, work: { id: review.workId, slug: 'example-film', title: 'A memorable film', kind: 'movie', posterPath: null, releaseYear: 2026 } };
}

export const Default = {
	render(args) { return { components: { MkZalipSocialFeed }, setup: () => ({ args }), template: '<div style="max-width: 700px; margin: auto"><MkZalipSocialFeed v-bind="args"/></div>' }; },
	args: { section: 'discussions' },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/zalip/feed/list', async ({ request }) => {
		const body = await request.json() as { section: string };
		return HttpResponse.json({ items: [fixture(body.section === 'essays')], nextCursor: null });
	})] } },
} satisfies StoryObj<typeof MkZalipSocialFeed>;

export const Essays = { ...Default, args: { ...Default.args, section: 'essays' } } satisfies StoryObj<typeof MkZalipSocialFeed>;
export const Empty = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/feed/list', () => HttpResponse.json({ items: [], nextCursor: null }))] } } } satisfies StoryObj<typeof MkZalipSocialFeed>;
export const Error = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/zalip/feed/list', () => HttpResponse.json({ error: { code: 'INTERNAL_ERROR' } }, { status: 500 }))] } } } satisfies StoryObj<typeof MkZalipSocialFeed>;
