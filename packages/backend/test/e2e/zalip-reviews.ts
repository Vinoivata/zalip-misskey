/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type { DataSource } from 'typeorm';
import { MiUser } from '@/models/User.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipReview } from '@/models/ZalipReview.js';
import { MiZalipReviewVote } from '@/models/ZalipReviewVote.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { api, castAsError, createAppToken, initTestDb, signup } from '../utils.js';
import type * as Misskey from 'misskey-js';

type ReviewRequest = Misskey.Endpoints['zalip/reviews/upsert']['req'];
const opinion: Omit<ReviewRequest, 'workId'> = {
	format: 'review', title: null, body: 'An independently written public opinion about this synthetic title.',
	isSpoiler: false, sentiment: 'positive',
};

function assertApiError(response: { status: number; body: unknown }, status: number, code: string) {
	assert.strictEqual(response.status, status, JSON.stringify(response.body));
	assert.strictEqual(castAsError(response.body as Record<string, unknown>).error.code, code);
}

describe('Zalip canonical title reviews HTTP API', () => {
	let admin: Misskey.entities.SignupResponse;
	let author: Misskey.entities.SignupResponse;
	let reader: Misskey.entities.SignupResponse;
	let db: DataSource;

	beforeAll(async () => {
		db = await initTestDb(true);
		admin = await signup({ username: 'zalipreviewadmin' });
		author = await signup({ username: 'zalipreviewauthor' });
		reader = await signup({ username: 'zalipreviewreader' });
		for (const user of [admin, author, reader]) assert.ok(user.id && user.token, 'review fixtures must authenticate');
	}, 120000);
	afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

	async function createWork(publicationState: 'published' | 'draft' = 'published') {
		const id = randomUUID().replaceAll('-', '');
		const now = new Date();
		await db.getRepository(MiZalipWork).insert({
			id, slug: `review-test-${id}`, title: 'Synthetic reviews HTTP fixture', kind: 'movie', publicationState,
			createdAt: now, updatedAt: now, publishedAt: publicationState === 'published' ? now : null,
		});
		return id;
	}

	async function createReview(workId: string, user = author, changes: Partial<Omit<ReviewRequest, 'workId'>> = {}) {
		const response = await api('zalip/reviews/upsert', { ...opinion, ...changes, workId }, user);
		assert.strictEqual(response.status, 200, JSON.stringify(response.body));
		return response.body;
	}

	test('registers public list and rejects guests and application tokens before all native-only writes', async () => {
		const workId = await createWork();
		const listed = await api('zalip/reviews/list', { workId });
		assert.strictEqual(listed.status, 200);
		assert.deepStrictEqual(listed.body.items, []);
		assert.strictEqual(listed.body.total, 0);
		assert.strictEqual(listed.body.myReview, null);
		assert.deepStrictEqual(listed.body.myReviews, []);
		assert.deepStrictEqual(listed.body.summary.histogram, Array.from({ length: 10 }, () => 0));

		const token = await createAppToken(author, ['write:notes', 'write:account', 'read:account']);
		const missingReview = randomUUID().replaceAll('-', '');
		const writes = [
			['zalip/reviews/upsert', { ...opinion, workId }],
			['zalip/reviews/delete', { reviewId: missingReview }],
			['zalip/reviews/vote', { reviewId: missingReview, value: 'helpful' }],
		] as const;
		for (const [endpoint, input] of writes) {
			// secure is checked before requireCredential: this is native ACCESS_DENIED, not 401.
			assertApiError(await api(endpoint, input), 400, 'ACCESS_DENIED');
			assertApiError(await api(endpoint, input, { token, bearer: true }), 400, 'ACCESS_DENIED');
		}
		assert.strictEqual(await db.getRepository(MiZalipReview).countBy({ workId }), 0);
	});

	test('maps missing and unpublished targets to declared errors for every route', async () => {
		const missing = randomUUID().replaceAll('-', '');
		assertApiError(await api('zalip/reviews/list', { workId: missing }), 404, 'NO_SUCH_ZALIP_WORK');
		assertApiError(await api('zalip/reviews/upsert', { ...opinion, workId: missing }, author), 404, 'NO_SUCH_ZALIP_WORK');
		assertApiError(await api('zalip/reviews/delete', { reviewId: missing }, author), 404, 'NO_SUCH_ZALIP_REVIEW');
		assertApiError(await api('zalip/reviews/vote', { reviewId: missing, value: 'helpful' }, reader), 404, 'NO_SUCH_ZALIP_REVIEW');
		const draftId = await createWork('draft');
		assertApiError(await api('zalip/reviews/list', { workId: draftId }), 404, 'NO_SUCH_ZALIP_WORK');
		assertApiError(await api('zalip/reviews/upsert', { ...opinion, workId: draftId }, author), 404, 'NO_SUCH_ZALIP_WORK');
		const workId = await createWork();
		const review = await createReview(workId);
		await db.getRepository(MiZalipWork).update(workId, { publicationState: 'draft' });
		assertApiError(await api('zalip/reviews/delete', { reviewId: review.id }, author), 404, 'NO_SUCH_ZALIP_WORK');
		assertApiError(await api('zalip/reviews/vote', { reviewId: review.id, value: 'helpful' }, reader), 404, 'NO_SUCH_ZALIP_WORK');
		assert.strictEqual((await db.getRepository(MiZalipReview).findOneByOrFail({ id: review.id })).deletedAt, null);
	});

	test('uses the signed-in author and native public avatar without exposing secrets or accepting an impersonated owner', async () => {
		const workId = await createWork();
		const review = await createReview(workId, author, { rating: 8 });
		assert.strictEqual(review.workId, workId);
		assert.strictEqual(review.user.id, author.id);
		assert.strictEqual(review.user.username, author.username);
		assert.strictEqual(typeof review.user.avatarUrl, 'string');
		assert.strictEqual(review.canEdit, true);
		assert.strictEqual(review.canDelete, true);
		for (const secret of ['token', 'email', 'password']) assert.strictEqual(secret in review.user, false);
		const invalidOwner = { ...opinion, workId, userId: admin.id };
		assertApiError(await api('zalip/reviews/upsert', invalidOwner, author), 400, 'INVALID_PARAM');
		const invalidTarget = { ...opinion, workId, reviewId: review.id };
		assertApiError(await api('zalip/reviews/upsert', invalidTarget, reader), 400, 'INVALID_PARAM');
		assert.strictEqual(await db.getRepository(MiZalipReview).countBy({ workId }), 1);
		const listed = await api('zalip/reviews/list', { workId }, reader);
		assert.strictEqual(listed.status, 200);
		assert.strictEqual(listed.body.items[0].canEdit, false);
		assert.strictEqual(listed.body.items[0].canDelete, false);
		assert.strictEqual(listed.body.myReview, null);
	});

	test('keeps review and essay independently editable with one shared native score and unchanged library fields', async () => {
		const workId = await createWork();
		const initial = await api('zalip/library/update', { workId, status: 'watching', episodesWatched: 4, personalRating: 6, isFavorite: true, isReleaseSubscribed: true }, author);
		assert.strictEqual(initial.status, 200);
		const before = await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: author.id, workId });
		const first = await createReview(workId, author, { rating: 8 });
		const essay = await createReview(workId, author, { format: 'essay', title: '  An extended opinion  ', sentiment: 'neutral' });
		assert.notStrictEqual(essay.id, first.id);
		assert.strictEqual(essay.title, 'An extended opinion');
		assert.strictEqual(essay.rating, 8);
		const edited = await createReview(workId, author, { body: 'A revised but still independent short opinion about this title.' });
		assert.strictEqual(edited.id, first.id);
		assert.strictEqual(edited.createdAt, first.createdAt);
		assert.strictEqual(edited.rating, 8);
		assert.strictEqual(await db.getRepository(MiZalipReview).countBy({ userId: author.id, workId }), 2);
		assert.strictEqual((await db.getRepository(MiZalipReview).findOneByOrFail({ id: essay.id })).body, opinion.body);
		const listed = await api('zalip/reviews/list', { workId }, author);
		assert.strictEqual(listed.status, 200);
		assert.strictEqual(listed.body.myReview?.id, first.id);
		assert.deepStrictEqual(new Set(listed.body.myReviews.map(row => row.id)), new Set([first.id, essay.id]));
		assert.strictEqual(listed.body.summary.reviewCount, 2);
		assert.strictEqual(listed.body.summary.ratingCount, 1);
		assert.strictEqual(listed.body.summary.averageRating, 8);
		const essayOnly = await api('zalip/reviews/list', { workId, format: 'essay', limit: 1 }, author);
		assert.strictEqual(essayOnly.body.myReview?.id, essay.id);
		assert.deepStrictEqual(new Set(essayOnly.body.myReviews.map(row => row.id)), new Set([first.id, essay.id]));
		for (const rating of [8, null]) {
			if (rating === null) assert.strictEqual((await createReview(workId, author, { body: edited.body, rating: null })).rating, null);
			const current = await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: author.id, workId });
			assert.deepStrictEqual({ ...current }, { ...before, personalRating: rating, updatedAt: current.updatedAt });
		}
		const cleared = await api('zalip/reviews/list', { workId }, author);
		assert.ok(cleared.body.myReviews.every(row => row.rating === null));
		assert.strictEqual(cleared.body.summary.ratingCount, 0);
		assert.strictEqual((await api('zalip/reviews/delete', { reviewId: essay.id }, author)).status, 204);
		const remaining = await api('zalip/reviews/list', { workId }, author);
		assert.deepStrictEqual(remaining.body.items.map(row => row.id), [first.id]);
		assert.strictEqual((await db.getRepository(MiZalipReview).findOneByOrFail({ id: first.id })).body, edited.body);
	});

	test('serializes a concurrent list change and review rating without losing unrelated library fields', async () => {
		const workId = await createWork();
		assert.strictEqual((await api('zalip/library/update', { workId, status: 'watching', episodesWatched: 4, personalRating: 6, isFavorite: true, isReleaseSubscribed: true }, author)).status, 200);
		const [review, library] = await Promise.all([
			api('zalip/reviews/upsert', { ...opinion, workId, rating: 9 }, author),
			api('zalip/library/update', { workId, status: 'completed', isFavorite: false }, author),
		]);
		assert.strictEqual(review.status, 200);
		assert.strictEqual(library.status, 200);
		const current = await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: author.id, workId });
		assert.strictEqual(current.personalRating, 9);
		assert.strictEqual(current.status, 'completed');
		assert.strictEqual(current.isFavorite, false);
		assert.strictEqual(current.episodesWatched, 4);
		assert.strictEqual(current.isReleaseSubscribed, true);
	});

	test('toggles helpfulness and rejects self-votes without creating an extra title rating', async () => {
		const workId = await createWork();
		const review = await createReview(workId);
		assertApiError(await api('zalip/reviews/vote', { reviewId: review.id, value: 'helpful' }, author), 400, 'CANNOT_VOTE_OWN_ZALIP_REVIEW');
		for (const [value, myVote, helpfulCount, unhelpfulCount] of [
			['helpful', 'helpful', 1, 0], ['helpful', null, 0, 0], ['unhelpful', 'unhelpful', 0, 1], [null, null, 0, 0],
		] as const) {
			const result = await api('zalip/reviews/vote', { reviewId: review.id, value }, reader);
			assert.strictEqual(result.status, 200);
			assert.deepStrictEqual([result.body.myVote, result.body.helpfulCount, result.body.unhelpfulCount], [myVote, helpfulCount, unhelpfulCount]);
		}
		assert.strictEqual(await db.getRepository(MiZalipReviewVote).countBy({ reviewId: review.id }), 0);
		assert.strictEqual(await db.getRepository(MiZalipLibraryEntry).countBy({ userId: reader.id, workId }), 0);
	});

	test('only permits owner removal or moderation and prevents the author from undoing moderator removal', async () => {
		const workId = await createWork();
		const review = await createReview(workId, author, { rating: 7 });
		assertApiError(await api('zalip/reviews/delete', { reviewId: review.id }, reader), 403, 'CANNOT_EDIT_ZALIP_REVIEW');
		assert.strictEqual((await api('zalip/reviews/delete', { reviewId: review.id }, author)).status, 204);
		assert.strictEqual((await api('zalip/reviews/delete', { reviewId: review.id }, author)).status, 204);
		const removed = await db.getRepository(MiZalipReview).findOneByOrFail({ id: review.id });
		assert.ok(removed.deletedAt);
		assert.strictEqual(removed.deletedById, author.id);
		assert.strictEqual(removed.body, opinion.body);
		const empty = await api('zalip/reviews/list', { workId }, author);
		assert.deepStrictEqual(empty.body.items, []);
		assert.strictEqual(empty.body.myReview, null);
		assert.strictEqual(empty.body.summary.ratingCount, 1);
		assertApiError(await api('zalip/reviews/vote', { reviewId: review.id, value: 'helpful' }, reader), 404, 'NO_SUCH_ZALIP_REVIEW');
		const restored = await createReview(workId);
		assert.strictEqual(restored.id, review.id);
		assert.strictEqual(restored.createdAt, review.createdAt);
		assert.strictEqual(restored.rating, 7);
		const moderation = await api('zalip/reviews/list', { workId }, admin);
		assert.strictEqual(moderation.body.items[0].canEdit, false);
		assert.strictEqual(moderation.body.items[0].canDelete, true);
		assert.strictEqual((await api('zalip/reviews/delete', { reviewId: review.id }, admin)).status, 204);
		assertApiError(await api('zalip/reviews/upsert', { ...opinion, workId, rating: 10 }, author), 403, 'CANNOT_EDIT_ZALIP_REVIEW');
		assert.strictEqual((await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: author.id, workId })).personalRating, 7);
		assert.strictEqual((await db.getRepository(MiZalipReview).findOneByOrFail({ id: review.id })).deletedById, admin.id);
	});

	test('filters spoiler reviews and formats while retaining independent sentiment and native-rating summaries', async () => {
		const workId = await createWork();
		const first = await createReview(workId, author, { rating: 8 });
		await createReview(workId, reader, { format: 'essay', title: 'Another view', sentiment: 'negative', isSpoiler: true, rating: 4 });
		assert.strictEqual((await api('zalip/reviews/vote', { reviewId: first.id, value: 'helpful' }, admin)).status, 200);
		const filtered = await api('zalip/reviews/list', { workId, format: 'essay', hideSpoilers: true }, author);
		assert.strictEqual(filtered.status, 200);
		assert.strictEqual(filtered.body.total, 0);
		assert.strictEqual(filtered.body.myReview, null);
		assert.deepStrictEqual(filtered.body.myReviews.map(row => row.id), [first.id]);
		assert.strictEqual(filtered.body.summary.reviewCount, 2);
		assert.strictEqual(filtered.body.summary.positiveCount, 1);
		assert.strictEqual(filtered.body.summary.negativeCount, 1);
		assert.strictEqual(filtered.body.summary.averageRating, 6);
		assert.deepStrictEqual(filtered.body.summary.histogram, [0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
		const sorted = await api('zalip/reviews/list', { workId, sort: 'helpful', limit: 1 });
		assert.strictEqual(sorted.body.items[0].id, first.id);
		assertApiError(await api('zalip/reviews/list', { workId, limit: 21 }), 400, 'INVALID_PARAM');
		assertApiError(await api('zalip/reviews/list', { workId, offset: 1001 }), 400, 'INVALID_PARAM');
		assertApiError(await api('zalip/reviews/upsert', { ...opinion, workId, format: 'essay', title: '   ' }, admin), 400, 'INVALID_ZALIP_REVIEW');
	});

	test('applies blocks, mutes and anonymous-author privacy equally to items and aggregate scores', async () => {
		const workId = await createWork();
		const review = await createReview(workId, author, { rating: 9 });
		await createReview(workId, reader, { rating: 3 });
		try {
			const blocking = await api('blocking/create', { userId: author.id }, reader);
			assert.strictEqual(blocking.status, 200);
			assert.strictEqual(blocking.body.id, author.id);
			const blocked = await api('zalip/reviews/list', { workId }, reader);
			assert.strictEqual(blocked.body.total, 1);
			assert.strictEqual(blocked.body.summary.ratingCount, 1);
			assert.strictEqual(blocked.body.summary.averageRating, 3);
			assertApiError(await api('zalip/reviews/vote', { reviewId: review.id, value: 'helpful' }, reader), 404, 'NO_SUCH_ZALIP_REVIEW');
			const unblocking = await api('blocking/delete', { userId: author.id }, reader);
			assert.strictEqual(unblocking.status, 200);
			assert.strictEqual(unblocking.body.id, author.id);
			assert.strictEqual((await api('mute/create', { userId: author.id }, reader)).status, 204);
			const muted = await api('zalip/reviews/list', { workId }, reader);
			assert.strictEqual(muted.body.total, 1);
			assert.strictEqual(muted.body.summary.ratingCount, 1);
			assert.strictEqual((await api('mute/delete', { userId: author.id }, reader)).status, 204);
			await db.getRepository(MiUser).update(author.id, { requireSigninToViewContents: true });
			const anonymous = await api('zalip/reviews/list', { workId });
			assert.strictEqual(anonymous.body.total, 1);
			assert.strictEqual(anonymous.body.summary.ratingCount, 1);
			assert.strictEqual(anonymous.body.summary.averageRating, 3);
			assert.strictEqual((await api('zalip/reviews/list', { workId }, reader)).body.total, 2);
		} finally {
			await api('blocking/delete', { userId: author.id }, reader);
			await api('mute/delete', { userId: author.id }, reader);
			await db.getRepository(MiUser).update(author.id, { requireSigninToViewContents: false });
		}
	});
});
