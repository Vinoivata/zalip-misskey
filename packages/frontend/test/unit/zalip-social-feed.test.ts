/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type { ZalipReview } from '@/utility/zalip-reviews.js';
import type { ZalipSocialFeedItem, ZalipSocialFeedResponse } from '@/components/zalip-social-feed.js';
import { createZalipSocialFeedPager } from '@/components/zalip-social-feed.js';

const work = { id: 'work', slug: 'a-film', title: 'A Film', kind: 'movie' as const, posterPath: null, releaseYear: 2026 };
function item(id: string, type: 'review' | 'essay' = 'review'): ZalipSocialFeedItem {
	return { type, key: `${type}:${id}`, id, createdAt: '2026-10-22T00:00:00Z', work,
		review: { id, workId: work.id, format: type, user: { id: 'author', username: 'author' }, body: 'A thoughtful review of the film and its characters.', title: null, isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 2, unhelpfulCount: 0, myVote: null, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', canEdit: false, canDelete: false } as ZalipReview };
}
function comment(id: string): ZalipSocialFeedItem {
	return { type: 'comment', key: `comment:${id}`, id, createdAt: '2026-10-22T00:00:00Z', work,
		note: { id, user: { id: 'commenter', username: 'commenter' }, zalipDiscussion: { workId: work.id }, isHidden: false } as unknown as Extract<ZalipSocialFeedItem, { type: 'comment' }>['note'],
		discussion: { rootNoteId: 'canonical-root', episodeId: null, episodeNumber: null, seasonNumber: null } };
}

describe('content social feed cursor pager', () => {
	it('keeps real Notes separate from reviews even when their IDs are equal, and uses only opaque cursors', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce({ items: [comment('same'), item('same')], nextCursor: 'opaque-page2' }).mockResolvedValueOnce({ items: [item('same'), item('next')], nextCursor: null });
		const pager = createZalipSocialFeedPager({ accountId: () => 'viewer', fetchPage });
		pager.reset('discussions', true); await pager.load(); await pager.load();
		expect(fetchPage.mock.calls.map(([params]) => params)).toEqual([{ section: 'discussions', hideSpoilers: true, limit: 20 }, { section: 'discussions', hideSpoilers: true, limit: 20, cursor: 'opaque-page2' }]);
		expect(pager.state.items.map(value => value.key)).toEqual(['comment:same', 'review:same', 'review:next']);
		expect(pager.state.hasMore).toBe(false);
	});

	it('rejects technical/hidden/mismatched notes, wrong sections and spoiler reviews without fabricating an author', async () => {
		const root = comment('root'); if (root.type === 'comment') root.note.isZalipDiscussionRoot = true;
		const hidden = comment('hidden'); if (hidden.type === 'comment') hidden.note.isHidden = true;
		const mismatch = comment('mismatch'); if (mismatch.type === 'comment') mismatch.note.zalipDiscussion!.workId = 'other';
		const spoiler = item('spoiler'); if (spoiler.type !== 'comment') spoiler.review.isSpoiler = true;
		const wrong = item('wrong'); if (wrong.type !== 'comment') wrong.review.workId = 'other';
		const fetchPage = vi.fn().mockResolvedValue({ items: [root, hidden, mismatch, spoiler, wrong, item('essay', 'essay'), comment('real'), item('real')], nextCursor: null });
		const pager = createZalipSocialFeedPager({ accountId: () => null, fetchPage });
		pager.reset('discussions', true); await pager.load();
		expect(pager.state.items.map(value => value.key)).toEqual(['comment:real', 'review:real']);
		pager.reset('essays', false); await pager.load();
		expect(pager.state.items.map(value => value.key)).toEqual(['essay:essay']);
	});

	it('drops late responses after account, filter, section changes and disposal', async () => {
		let account = 'first';
		let finish!: (page: ZalipSocialFeedResponse) => void;
		const fetchPage = vi.fn(() => new Promise<ZalipSocialFeedResponse>(resolve => { finish = resolve; }));
		const pager = createZalipSocialFeedPager({ accountId: () => account, fetchPage });
		pager.reset('discussions', true); const old = pager.load();
		account = 'second'; pager.reset('essays', false);
		finish({ items: [item('old')], nextCursor: 'old-cursor' }); await old;
		expect(pager.state.items).toEqual([]); expect(pager.state.loaded).toBe(false); expect(pager.state.pending).toBe(false);
		const pending = pager.load(); pager.dispose(); finish({ items: [item('old-essay', 'essay')], nextCursor: null }); await pending;
		expect(pager.state.items).toEqual([]); await pager.load(); expect(fetchPage).toHaveBeenCalledTimes(2);
	});

	it('blocks concurrent loads and allows a failed cursor page to be retried unchanged', async () => {
		let reject!: (error: Error) => void;
		const fetchPage = vi.fn().mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; })).mockResolvedValue({ items: [item('retry')], nextCursor: null });
		const pager = createZalipSocialFeedPager({ accountId: () => 'viewer', fetchPage });
		pager.reset('discussions', true); const pending = pager.load(); await pager.load();
		expect(fetchPage).toHaveBeenCalledTimes(1); reject(new Error('offline')); await pending;
		expect(pager.state.error).toBe(true); await pager.load();
		expect(fetchPage.mock.calls[0][0]).toEqual(fetchPage.mock.calls[1][0]); expect(pager.state.error).toBe(false);
		expect(pager.state.items.map(value => value.id)).toEqual(['retry']);
	});

	it('stops repeated/oversized cursors without appending another copy of a page', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce({ items: [item('one')], nextCursor: 'repeat' }).mockResolvedValueOnce({ items: [item('two')], nextCursor: 'repeat' }).mockResolvedValueOnce({ items: [item('three')], nextCursor: 'x'.repeat(1025) });
		const pager = createZalipSocialFeedPager({ accountId: () => null, fetchPage });
		pager.reset('discussions', true); await pager.load(); await pager.load();
		expect(pager.state.error).toBe(true); expect(pager.state.items.map(value => value.id)).toEqual(['one']);
		await pager.load(); expect(pager.state.error).toBe(true); expect(pager.state.items).toHaveLength(1);
	});

	it('updates/removes only reviews, not a native Note with the same ID', async () => {
		const review = item('same');
		if (review.type === 'comment') throw new Error('fixture');
		const fetchPage = vi.fn().mockResolvedValue({ items: [comment('same'), review], nextCursor: null });
		const pager = createZalipSocialFeedPager({ accountId: () => 'viewer', fetchPage });
		pager.reset('discussions', true); await pager.load();
		pager.replaceReview({ ...review.review, workId: 'other', helpfulCount: 100 });
		expect(pager.state.items[1]).toEqual(review);
		pager.replaceReview({ ...review.review, helpfulCount: 3, myVote: 'helpful' });
		expect(pager.state.items[1]).toMatchObject({ review: { helpfulCount: 3, myVote: 'helpful' } });
		pager.removeReview('same'); expect(pager.state.items.map(value => value.key)).toEqual(['comment:same']);
	});
	it('discards malformed rows independently without losing valid neighbours or poisoning their deduplication key', async () => {
		const valid = item('real');
		const fetchPage = vi.fn().mockResolvedValue({ items: [null, { ...valid, review: null }, { ...valid, work: null }, { ...valid, review: { ...('review' in valid ? valid.review : {}), user: null } }, valid], nextCursor: null });
		const pager = createZalipSocialFeedPager({ accountId: () => 'viewer', fetchPage });
		pager.reset('discussions', true); await pager.load();
		expect(pager.state.error).toBe(false);
		expect(pager.state.items).toEqual([valid]);
	});
});
