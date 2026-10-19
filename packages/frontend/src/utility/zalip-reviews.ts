/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import type * as Misskey from 'misskey-js';

export type ZalipReviewFormat = 'review' | 'essay';
export type ZalipReviewSentiment = 'positive' | 'neutral' | 'negative';
export type ZalipReviewVote = 'helpful' | 'unhelpful' | null;
export type ZalipReview = {
	id: string;
	workId: string;
	user: Misskey.entities.UserLite;
	format: ZalipReviewFormat;
	title: string | null;
	body: string;
	isSpoiler: boolean;
	sentiment: ZalipReviewSentiment;
	rating: number | null;
	helpfulCount: number;
	unhelpfulCount: number;
	myVote: ZalipReviewVote;
	createdAt: string;
	updatedAt: string;
	canEdit: boolean;
	canDelete: boolean;
};
export type ZalipReviewSummary = {
	reviewCount: number;
	positiveCount: number;
	neutralCount: number;
	negativeCount: number;
	averageRating: number | null;
	ratingCount: number;
	histogram: number[];
};
export type ZalipReviewFilters = {
	format?: ZalipReviewFormat;
	sentiment?: ZalipReviewSentiment;
	hideSpoilers: boolean;
	sort: 'newest' | 'helpful';
};
export type ZalipReviewsRequest = ZalipReviewFilters & { workId: string; limit: number; offset: number };
export type ZalipReviewsResponse = { items: ZalipReview[]; total: number; summary: ZalipReviewSummary; myReview: ZalipReview | null };

/** Offset advances by server rows, not deduplicated rows. Old accounts/work requests never apply. */
export function createZalipReviewsPager(options: {
	accountId: () => string | null;
	fetchPage: (params: ZalipReviewsRequest) => Promise<ZalipReviewsResponse>;
}) {
	const state = reactive({ items: [] as ZalipReview[], total: 0, summary: null as ZalipReviewSummary | null, myReview: null as ZalipReview | null, pending: false, loaded: false, error: false, hasMore: false });
	let workId = '';
	let filters: ZalipReviewFilters = { hideSpoilers: false, sort: 'newest' };
	let offset = 0;
	let epoch = 0;

	function reset(id: string, nextFilters: ZalipReviewFilters): void {
		epoch++;
		workId = id;
		filters = { ...nextFilters };
		offset = 0;
		Object.assign(state, { items: [], total: 0, summary: null, myReview: null, pending: false, loaded: false, error: false, hasMore: false });
	}

	async function load(): Promise<void> {
		if (!workId || state.pending || (state.loaded && !state.hasMore && !state.error) || offset > 1000) return;
		const requestEpoch = epoch;
		const account = options.accountId();
		const current = () => requestEpoch === epoch && account === options.accountId();
		state.pending = true;
		state.error = false;
		try {
			const result = await options.fetchPage({ workId, ...filters, limit: 20, offset });
			if (!current()) return;
			const known = new Set(state.items.map(item => item.id));
			for (const item of result.items) {
				if (item.workId !== workId || known.has(item.id)) continue;
				known.add(item.id);
				state.items.push(item);
			}
			offset += result.items.length;
			state.total = result.total;
			state.summary = result.summary;
			state.myReview = result.myReview;
			state.hasMore = result.items.length === 20 && offset < result.total && offset <= 1000;
			state.loaded = true;
		} catch {
			if (current()) state.error = true;
		} finally {
			if (current()) state.pending = false;
		}
	}

	function replace(review: ZalipReview): void {
		if (review.workId !== workId) return;
		const index = state.items.findIndex(item => item.id === review.id);
		if (index !== -1) state.items[index] = review;
		if (state.myReview?.id === review.id) state.myReview = review;
	}

	return { state, reset, load, replace };
}
