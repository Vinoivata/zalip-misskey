/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowReactive } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ZalipReview } from '@/utility/zalip-reviews.js';

export type ZalipSocialFeedSection = 'discussions' | 'essays';
export type ZalipSocialFeedWork = {
	id: string;
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	posterPath: string | null;
	releaseYear: number | null;
};
type FeedBase = { key: string; id: string; createdAt: string; work: ZalipSocialFeedWork };
export type ZalipSocialFeedItem = FeedBase & ({
	type: 'comment';
	note: Misskey.entities.Note;
	discussion: { rootNoteId: string; episodeId: string | null; episodeNumber: number | null; seasonNumber: number | null };
} | { type: 'review' | 'essay'; review: ZalipReview });
export type ZalipSocialFeedRequest = { section: ZalipSocialFeedSection; limit: number; hideSpoilers: boolean; cursor?: string };
export type ZalipSocialFeedResponse = { items: ZalipSocialFeedItem[]; nextCursor: string | null };

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Do not render malformed or identity-mismatched rows from a stale/invalid response. */
function coherentItem(value: unknown): value is ZalipSocialFeedItem {
	const item = record(value);
	if (!item || typeof item.id !== 'string' || !item.id || typeof item.createdAt !== 'string' || !['comment', 'review', 'essay'].includes(String(item.type)) || item.key !== `${item.type}:${item.id}`) return false;
	const work = record(item.work);
	if (!work || typeof work.id !== 'string' || !work.id || typeof work.slug !== 'string' || !work.slug || typeof work.title !== 'string') return false;
	if (item.type === 'comment') {
		const note = record(item.note);
		const user = record(note?.user);
		return note?.id === item.id && !note.isHidden && !note.isZalipDiscussionRoot && typeof user?.id === 'string' && record(note.zalipDiscussion)?.workId === work.id;
	}
	const review = record(item.review);
	return review?.id === item.id && review.workId === work.id && review.format === item.type && typeof record(review.user)?.id === 'string' && typeof review.body === 'string' && typeof review.isSpoiler === 'boolean';
}

/** Account/filter-bound opaque cursors. Native Notes and reviews retain distinct identities. */
export function createZalipSocialFeedPager(options: {
	accountId: () => string | null;
	fetchPage: (request: ZalipSocialFeedRequest) => Promise<ZalipSocialFeedResponse>;
}) {
	const state = shallowReactive({ items: [] as ZalipSocialFeedItem[], pending: false, loaded: false, error: false, hasMore: false });
	let epoch = 0;
	let active = false;
	let section: ZalipSocialFeedSection = 'discussions';
	let hideSpoilers = true;
	let cursor: string | undefined;
	let pages = 0;
	const seen = new Set<string>();
	const cursors = new Set<string>();

	function reset(nextSection: ZalipSocialFeedSection, nextHideSpoilers: boolean): void {
		epoch++;
		active = true;
		section = nextSection;
		hideSpoilers = nextHideSpoilers;
		cursor = undefined;
		pages = 0;
		seen.clear(); cursors.clear();
		Object.assign(state, { items: [], pending: false, loaded: false, error: false, hasMore: false });
	}

	async function load(): Promise<void> {
		if (!active || state.pending || (state.loaded && !state.hasMore && !state.error) || pages >= 50) return;
		const requestEpoch = epoch;
		const account = options.accountId();
		const current = () => active && epoch === requestEpoch && account === options.accountId();
		state.pending = true;
		state.error = false;
		try {
			const result = await options.fetchPage({ section, hideSpoilers, limit: 20, ...(cursor ? { cursor } : {}) });
			if (!current()) return;
			if (!Array.isArray(result.items) || result.items.length > 20 || (result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !result.nextCursor || result.nextCursor.length > 1024 || cursors.has(result.nextCursor)))) throw new Error('Invalid social feed page');
			const fresh = result.items.filter(coherentItem).filter(item => {
				if (seen.has(item.key)) return false;
				if (section === 'essays' ? item.type !== 'essay' : item.type === 'essay') return false;
				if (item.type !== 'comment' && hideSpoilers && item.review.isSpoiler) return false;
				seen.add(item.key);
				return true;
			});
			state.items = [...state.items, ...fresh];
			pages++;
			if (result.nextCursor) cursors.add(result.nextCursor);
			cursor = result.nextCursor ?? undefined;
			state.hasMore = result.nextCursor !== null && pages < 50;
			state.loaded = true;
		} catch {
			if (current()) state.error = true;
		} finally {
			if (current()) state.pending = false;
		}
	}

	function replaceReview(review: ZalipReview): void {
		state.items = state.items.map(item => item.type !== 'comment' && item.id === review.id && item.work.id === review.workId && item.type === review.format ? { ...item, review } : item);
	}

	function removeReview(id: string): void {
		state.items = state.items.filter(item => item.type === 'comment' || item.id !== id);
	}

	function dispose(): void {
		epoch++;
		active = false;
		state.pending = false;
	}

	return { state, reset, load, replaceReview, removeReview, dispose };
}
