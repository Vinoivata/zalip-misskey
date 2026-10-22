/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type { ZalipReview, ZalipReviewsResponse } from '@/utility/zalip-reviews.js';
import { createZalipReviewsPager } from '@/utility/zalip-reviews.js';

function review(id: string, workId = 'work'): ZalipReview {
	return { id, workId, user: { id: 'author', username: 'author' }, body: `Review body ${id}`, format: 'review', sentiment: 'neutral', title: null, isSpoiler: false, rating: null, helpfulCount: 0, unhelpfulCount: 0, myVote: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', canEdit: false, canDelete: false } as ZalipReview;
}

function response(items: ZalipReview[], total = items.length): ZalipReviewsResponse {
	return { items, total, summary: { reviewCount: total, positiveCount: 0, neutralCount: total, negativeCount: 0, averageRating: null, ratingCount: 0, histogram: Array(10).fill(0) }, myReview: null };
}

describe('Zalip review pager', () => {
	it('advances offset through raw pages without duplicate IDs or foreign-work rows', async () => {
		const api = vi.fn().mockResolvedValueOnce(response(Array.from({ length: 20 }, (_, index) => review(String(index))), 25)).mockResolvedValueOnce(response([review('19'), review('20'), review('foreign', 'other')], 25));
		const pager = createZalipReviewsPager({ accountId: () => 'viewer', fetchPage: api });
		pager.reset('work', { hideSpoilers: false, sort: 'newest' });
		await pager.load(); await pager.load();
		expect(api.mock.calls[1][0]).toMatchObject({ workId: 'work', offset: 20, limit: 20 });
		expect(pager.state.items).toHaveLength(21);
		expect(pager.state.items.some(item => item.workId !== 'work')).toBe(false);
		expect(pager.state.hasMore).toBe(false);
	});

	it('ignores responses from an old work or account and clears all personalized data on reset', async () => {
		let finish!: (data: ZalipReviewsResponse) => void;
		let account = 'one';
		const api = vi.fn().mockImplementationOnce(() => new Promise<ZalipReviewsResponse>(resolve => { finish = resolve; })).mockResolvedValue(response([review('new', 'new-work')]));
		const pager = createZalipReviewsPager({ accountId: () => account, fetchPage: api });
		pager.reset('work', { hideSpoilers: false, sort: 'newest' });
		const old = pager.load();
		account = 'two';
		pager.reset('new-work', { format: 'essay', hideSpoilers: true, sort: 'helpful' });
		await pager.load();
		finish({ ...response([review('old')]), myReview: review('private') }); await old;
		expect(pager.state.items.map(item => item.id)).toEqual(['new']);
		expect(pager.state.myReview).toBeNull();
		expect(api.mock.calls[1][0]).toMatchObject({ workId: 'new-work', offset: 0, format: 'essay', hideSpoilers: true, sort: 'helpful' });
	});

	it('blocks duplicate loads and retries a failed page at the same offset', async () => {
		let fail!: (error: Error) => void;
		const api = vi.fn().mockImplementationOnce(() => new Promise<ZalipReviewsResponse>((_, reject) => { fail = reject; })).mockResolvedValue(response([review('recovered')]));
		const pager = createZalipReviewsPager({ accountId: () => null, fetchPage: api });
		pager.reset('work', { hideSpoilers: false, sort: 'newest' });
		const pending = pager.load(); await pager.load();
		expect(api).toHaveBeenCalledTimes(1);
		fail(new Error('offline')); await pending;
		expect(pager.state.error).toBe(true);
		await pager.load();
		expect(api.mock.calls[1][0].offset).toBe(0);
		expect(pager.state.error).toBe(false);
		expect(pager.state.items[0].id).toBe('recovered');
	});

	it('replaces matching votes but never inserts unknown or foreign-work reviews', async () => {
		const own = review('own');
		const pager = createZalipReviewsPager({ accountId: () => 'viewer', fetchPage: async () => ({ ...response([own]), myReview: own }) });
		pager.reset('work', { hideSpoilers: false, sort: 'newest' }); await pager.load();
		pager.replace({ ...own, helpfulCount: 2, myVote: 'helpful' });
		pager.replace(review('unknown')); pager.replace(review('own', 'foreign'));
		expect(pager.state.items).toHaveLength(1);
		expect(pager.state.items[0].helpfulCount).toBe(2);
		expect(pager.state.myReview?.myVote).toBe('helpful');
	});

	it('keeps both own formats outside the current page and updates them independently', async () => {
		const own = review('own');
		const essay = { ...review('essay'), format: 'essay' as const, title: 'An essay' };
		const pager = createZalipReviewsPager({ accountId: () => 'viewer', fetchPage: async () => ({ ...response([]), myReview: essay, myReviews: [own, essay, review('foreign', 'other')] }) });
		pager.reset('work', { format: 'essay', hideSpoilers: true, sort: 'newest' }); await pager.load();
		expect(pager.state.items).toEqual([]);
		expect(pager.state.myReviews.map(item => item.id)).toEqual(['own', 'essay']);
		expect(pager.state.independentFormats).toBe(true);
		pager.replace({ ...essay, body: 'Only the essay has changed.' });
		expect(pager.state.myReviews[0].body).toBe(own.body);
		expect(pager.state.myReviews[1].body).toBe('Only the essay has changed.');
		expect(pager.state.myReview?.body).toBe('Only the essay has changed.');
		pager.reset('next-work', { hideSpoilers: false, sort: 'newest' });
		expect(pager.state.myReviews).toEqual([]); expect(pager.state.myReview).toBeNull();
	});

	it('preserves a legacy server singular essay without treating it as a review', async () => {
		const essay = { ...review('legacy-essay'), format: 'essay' as const, title: 'Existing essay' };
		const pager = createZalipReviewsPager({ accountId: () => 'viewer', fetchPage: async () => ({ ...response([]), myReview: essay }) });
		pager.reset('work', { hideSpoilers: false, sort: 'newest' }); await pager.load();
		expect(pager.state.myReviews).toMatchObject([{ id: 'legacy-essay', format: 'essay' }]);
		expect(pager.state.myReviews.some(item => item.format === 'review')).toBe(false);
		expect(pager.state.independentFormats).toBe(false);
	});
});
