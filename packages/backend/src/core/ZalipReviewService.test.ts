/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { normalizeZalipReviewInput, ZalipReviewService, zalipReviewRatingUpsertSql, zalipReviewVisibleAuthorSql } from '@/core/ZalipReviewService.js';
import type { ZalipReviewInput } from '@/core/ZalipReviewService.js';
import { MiZalipReview } from '@/models/ZalipReview.js';
import { MiZalipReviewVote } from '@/models/ZalipReviewVote.js';
import { entities } from '@/postgres.js';
import ListEndpoint, { meta as listMeta } from '@/server/api/endpoints/zalip/reviews/list.js';
import UpsertEndpoint, { meta as upsertMeta } from '@/server/api/endpoints/zalip/reviews/upsert.js';
import DeleteEndpoint, { meta as deleteMeta } from '@/server/api/endpoints/zalip/reviews/delete.js';
import VoteEndpoint, { meta as voteMeta } from '@/server/api/endpoints/zalip/reviews/vote.js';
import { ZalipReviews1792442405046 } from '../../migration/1792442405046-ZalipReviews.js';
import { ZalipReviewFormats1792682390825 } from '../../migration/1792682390825-ZalipReviewFormats.js';

const owner = { id: 'owner' };
const other = { id: 'other' };
const moderator = { id: 'moderator' };
const input: ZalipReviewInput = { format: 'review', title: null, body: 'An independently written opinion about this title.', isSpoiler: false, sentiment: 'positive' };
type StoredReview = ZalipReviewInput & { id: string; workId: string; userId: string; title: string | null; createdAt: Date; updatedAt: Date; deletedAt: Date | null; deletedById: string | null };

/** An explicit SQL boundary fake: unexpected queries fail rather than silently passing. */
function fixture() {
	const reviews = new Map<string, StoredReview>();
	const libraries = new Map<string, { personalRating: number | null; status: string | null; episodesWatched: number; isFavorite: boolean; isReleaseSubscribed: boolean; createdAt: Date; updatedAt: Date }>();
	const votes = new Map<string, 'helpful' | 'unhelpful'>();
	const work = { id: 'work', publicationState: 'published' };
	const users = new Map(['owner', 'other', 'moderator', 'third', 'hidden'].map(id => [id, { id, isSuspended: false, isDeleted: false, requireSigninToViewContents: false, host: null as string | null }]));
	const blocked = new Set<string>();
	const muted = new Set<string>();
	const key = (userId: string, workId: string) => `${userId}:${workId}`;
	const visible = (row: StoredReview, me: string | null) => {
		const user = users.get(row.userId);
		return row.deletedAt == null && row.workId === work.id && work.publicationState === 'published' && user && !user.isDeleted && !user.isSuspended && !user.host && (!user.requireSigninToViewContents || me != null) && (!me || !blocked.has(`${me}:${row.userId}`) && !blocked.has(`${row.userId}:${me}`) && !muted.has(`${me}:${row.userId}`));
	};
	const projection = (row: StoredReview, viewer: string | null) => ({ ...structuredClone(row), rating: libraries.get(key(row.userId, row.workId))?.personalRating ?? null, helpfulCount: [...votes].filter(([voteKey, value]) => voteKey.endsWith(`:${row.id}`) && value === 'helpful').length, unhelpfulCount: [...votes].filter(([voteKey, value]) => voteKey.endsWith(`:${row.id}`) && value === 'unhelpful').length, myVote: viewer ? votes.get(key(viewer, row.id)) ?? null : null });
	const query = vi.fn(async (sql: string, params: unknown[] = []): Promise<unknown[]> => {
		const [first, second] = params as [string, string | null];
		if (sql.startsWith('SELECT pg_advisory_xact_lock')) return [];
		if (sql.startsWith('SELECT "id" FROM "zalip_work"')) return first === work.id && work.publicationState === 'published' ? [{ id: work.id }] : [];
		if (sql.startsWith('SELECT "id" FROM "user"')) {
			const user = users.get(first); return user && !user.isSuspended && !user.isDeleted && !user.host ? [{ id: first }] : [];
		}
		if (sql.startsWith('SELECT "deletedAt", "deletedById"')) {
			const row = [...reviews.values()].find(value => value.userId === first && value.workId === second && value.format === params[2]);
			return row ? [{ deletedAt: row.deletedAt, deletedById: row.deletedById }] : [];
		}
		if (sql.startsWith('INSERT INTO "zalip_review"')) {
			const [id, userId, workId, format, title, body, isSpoiler, sentiment, now] = params as [string, string, string, ZalipReviewInput['format'], string | null, string, boolean, ZalipReviewInput['sentiment'], Date];
			const old = [...reviews.values()].find(row => row.userId === userId && row.workId === workId && row.format === format);
			const row = { id: old?.id ?? id, userId, workId, format, title, body, isSpoiler, sentiment, createdAt: old?.createdAt ?? now, updatedAt: now, deletedAt: null, deletedById: null };
			reviews.set(row.id, row); return [];
		}
		if (sql === zalipReviewRatingUpsertSql) {
			const [userId, workId, personalRating, now] = params as [string, string, number | null, Date];
			const entryKey = key(userId, workId);
			const old = libraries.get(entryKey);
			libraries.set(entryKey, { ...(old ?? { status: null, episodesWatched: 0, isFavorite: false, isReleaseSubscribed: false, createdAt: now }), personalRating, updatedAt: now }); return [];
		}
		if (sql.startsWith('SELECT "userId", "workId" FROM "zalip_review"')) {
			const row = reviews.get(first); return row ? [{ userId: row.userId, workId: row.workId }] : [];
		}
		if (sql.startsWith('UPDATE "zalip_review"')) {
			const row = reviews.get(first); if (row && !row.deletedAt) Object.assign(row, { deletedAt: params[1], deletedById: params[2], updatedAt: params[1] }); return [];
		}
		if (sql.startsWith('SELECT "value" FROM "zalip_review_vote"')) return votes.has(key(first, second!)) ? [{ value: votes.get(key(first, second!)) }] : [];
		if (sql.startsWith('DELETE FROM "zalip_review_vote"')) { votes.delete(key(first, second!)); return []; }
		if (sql.startsWith('INSERT INTO "zalip_review_vote"')) { votes.set(key(first, second!), params[2] as 'helpful' | 'unhelpful'); return []; }
		const active = [...reviews.values()].filter(row => row.workId === first && visible(row, second));
		if (sql.startsWith('SELECT r."id" FROM')) return active.filter(row => row.id === params[2]).map(row => ({ id: row.id }));
		if (sql.startsWith('SELECT r."sentiment"')) return ['positive', 'neutral', 'negative'].flatMap(sentiment => { const count = active.filter(row => row.sentiment === sentiment).length; return count ? [{ sentiment, count }] : []; });
		if (sql.startsWith('SELECT library."personalRating"')) {
			const counts = new Map<number, number>();
			for (const [entryKey, entry] of libraries) {
				const [userId, workId] = entryKey.split(':');
				if (workId === first && entry.personalRating != null && visible({ userId, workId, deletedAt: null } as StoredReview, second)) counts.set(entry.personalRating, (counts.get(entry.personalRating) ?? 0) + 1);
			}
			return [...counts].map(([rating, count]) => ({ rating, count }));
		}
		let selected = active;
		if (sql.includes('r."format" = $3')) selected = selected.filter(row => (!params[2] || row.format === params[2]) && (!params[3] || row.sentiment === params[3]) && (!params[4] || !row.isSpoiler));
		if (sql.startsWith('SELECT COUNT(*)::int AS total')) return [{ total: selected.length }];
		if (sql.startsWith('SELECT r."id", r."workId"')) {
			if (sql.includes('AND r."userId" = $2')) selected = selected.filter(row => row.userId === second);
			if (sql.includes('AND r."id" = $3')) selected = selected.filter(row => row.id === params[2]);
			const rows = selected.map(row => projection(row, second));
			rows.sort((a, b) => sql.includes('ORDER BY r."format"') ? b.format.localeCompare(a.format) : sql.includes('ORDER BY votes.') ? b.helpfulCount - a.helpfulCount || a.unhelpfulCount - b.unhelpfulCount || b.id.localeCompare(a.id) : b.id.localeCompare(a.id));
			if (sql.includes('LIMIT $6 OFFSET $7')) return rows.slice(params[6] as number, (params[6] as number) + (params[5] as number));
			return sql.includes('LIMIT 1') ? rows.slice(0, 1) : sql.includes('LIMIT 2') ? rows.slice(0, 2) : rows;
		}
		throw new Error(`Unexpected SQL in reviews fixture: ${sql}`);
	});
	const manager = { query };
	let serial = Promise.resolve(); let sequence = 0;
	const db = { transaction: vi.fn(async (...args: unknown[]) => {
		const action = args.at(-1) as (value: typeof manager) => Promise<unknown>;
		const pending = serial.then(() => action(manager)); serial = pending.then(() => undefined, () => undefined); return pending;
	}) };
	const packMany = vi.fn(async (ids: string[]) => ids.map(id => ({ id, name: 'Author', username: id, host: null, avatarUrl: `https://public.invalid/identicon/${id}`, avatarBlurhash: null, avatarDecorations: [] })));
	const roles = { isModerator: vi.fn(async (me: { id: string }) => me.id === 'moderator') };
	const service = new ZalipReviewService(db as never, { gen: () => `review${++sequence}` } as never, { packMany } as never, roles as never);
	return { service, reviews, votes, libraries, work, users, blocked, muted, query, db, packMany };
}

describe('ZalipReviewService', () => {
	it('upserts one independent opinion per author/title/format using the canonical public UserLite packer', async () => {
		const f = fixture();
		const first = await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		const essay = await f.service.upsert(owner, 'work', { ...input, format: 'essay', title: ' Why this works ', body: 'A much longer original opinion on this title.', sentiment: 'neutral' });
		expect(essay).toMatchObject({ format: 'essay', title: 'Why this works', rating: 8, canEdit: true, canDelete: true, user: { id: owner.id } });
		expect(essay.id).not.toBe(first.id);
		const before = structuredClone(f.reviews.get(first.id));
		const edited = await f.service.upsert(owner, 'work', { ...input, format: 'essay', title: 'Edited essay', body: 'An independently edited essay with enough meaningful text.' });
		expect(edited.id).toBe(essay.id); expect(edited.createdAt).toBe(essay.createdAt);
		expect(f.reviews.get(first.id)).toEqual(before); expect(f.reviews.size).toBe(2);
		expect(edited.user).toMatchObject({ avatarBlurhash: null, avatarDecorations: [] });
		expect(edited.user).not.toHaveProperty('token'); expect(edited.user).not.toHaveProperty('email');
		expect(f.packMany).toHaveBeenCalledWith(['owner'], owner, { schema: 'UserLite', includeSecrets: false });
		const sql = f.query.mock.calls.find(([value]) => value.startsWith('INSERT INTO "zalip_review"'))![0];
		expect(sql).toContain('ON CONFLICT ("userId", "workId", "format") DO UPDATE');
		expect(sql.split('DO UPDATE SET')[1]).not.toContain('"format" =');
	});

	it('returns both own formats outside public filters with a deterministic compatible singular field', async () => {
		const f = fixture();
		const own = await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		const essay = await f.service.upsert(owner, 'work', { ...input, format: 'essay', title: 'A spoiler essay', isSpoiler: true, sentiment: 'negative' });
		const all = await f.service.list('work', owner);
		expect(all.myReview?.id).toBe(own.id);
		expect(all.myReviews.map(item => item.id)).toEqual([own.id, essay.id]);
		const filtered = await f.service.list('work', owner, { format: 'essay', sentiment: 'positive', hideSpoilers: true, limit: 1, offset: 1 });
		expect(filtered.items).toEqual([]); expect(filtered.total).toBe(0);
		expect(filtered.myReview?.id).toBe(essay.id);
		expect(filtered.myReviews.map(item => item.id)).toEqual([own.id, essay.id]);
		expect(filtered.summary).toMatchObject({ reviewCount: 2, ratingCount: 1, averageRating: 8 });
		expect((await f.service.list('work', null)).myReviews).toEqual([]);
		expect((await f.service.list('work', other)).myReviews).toEqual([]);
		await f.service.delete(owner, own.id);
		expect((await f.service.list('work', owner)).myReview?.id).toBe(essay.id);
		expect((await f.service.list('work', owner, { format: 'review' })).myReview).toBeNull();
	});

	it('shares one native score between independent formats and never counts it twice', async () => {
		const f = fixture();
		const own = await f.service.upsert(owner, 'work', { ...input, rating: 7 });
		const essayInput = { ...input, format: 'essay' as const, title: 'A separate essay' };
		const essay = await f.service.upsert(owner, 'work', { ...essayInput, rating: 9 });
		let listed = await f.service.list('work', owner);
		expect(listed.myReviews.map(item => item.rating)).toEqual([9, 9]);
		expect(listed.summary).toMatchObject({ ratingCount: 1, averageRating: 9 });
		expect(f.libraries.size).toBe(1);
		await f.service.upsert(owner, 'work', { ...input, rating: null });
		listed = await f.service.list('work', owner);
		expect(listed.myReviews.map(item => item.rating)).toEqual([null, null]);
		expect(listed.summary).toMatchObject({ ratingCount: 0, averageRating: null });
		await f.service.delete(owner, own.id);
		expect(f.reviews.get(essay.id)?.deletedAt).toBeNull();
		expect((await f.service.list('work', owner)).myReviews.map(item => item.id)).toEqual([essay.id]);
	});

	it('moderation and vote identities are independent for each author format', async () => {
		const f = fixture();
		const own = await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		const essayInput = { ...input, format: 'essay' as const, title: 'An independent essay' };
		const essay = await f.service.upsert(owner, 'work', essayInput);
		await f.service.vote(other, own.id, 'helpful');
		expect((await f.service.vote(other, essay.id, 'unhelpful'))).toMatchObject({ helpfulCount: 0, unhelpfulCount: 1 });
		await f.service.delete(moderator, own.id);
		await expect(f.service.upsert(owner, 'work', { ...input, rating: 10 })).rejects.toMatchObject({ code: 'CANNOT_EDIT_ZALIP_REVIEW' });
		expect(f.libraries.get('owner:work')?.personalRating).toBe(8);
		const edited = await f.service.upsert(owner, 'work', { ...essayInput, body: 'This separate essay is still editable after review moderation.' });
		expect(edited).toMatchObject({ id: essay.id, helpfulCount: 0, unhelpfulCount: 1, rating: 8 });
		expect(f.reviews.get(own.id)?.deletedById).toBe('moderator');
		await f.service.delete(owner, essay.id);
		expect((await f.service.upsert(owner, 'work', essayInput)).id).toBe(essay.id);
		expect(f.reviews.get(own.id)?.deletedById).toBe('moderator');
	});

	it('preserves native library status, favourites, subscriptions, episodes and creation date when rating changes or clears', async () => {
		const f = fixture(); const createdAt = new Date('2026-01-01');
		const before = { status: 'watching', episodesWatched: 12, isFavorite: true, isReleaseSubscribed: true, personalRating: 6, createdAt, updatedAt: createdAt };
		f.libraries.set('owner:work', structuredClone(before));
		for (const rating of [9, null]) {
			expect((await f.service.upsert(owner, 'work', { ...input, rating })).rating).toBe(rating);
			expect(f.libraries.get('owner:work')).toEqual({ ...before, personalRating: rating, updatedAt: expect.any(Date) });
		}
		expect(zalipReviewRatingUpsertSql.split('DO UPDATE SET')[1]).toBe(' "personalRating" = EXCLUDED."personalRating", "updatedAt" = EXCLUDED."updatedAt"');
		expect(f.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['zalip-library:owner:work']);
	});

	it('does not create or touch a library entry when rating is omitted', async () => {
		const f = fixture(); const result = await f.service.upsert(owner, 'work', input);
		expect(result.rating).toBeNull(); expect(f.libraries.size).toBe(0);
		expect(f.query.mock.calls.some(([sql]) => sql === zalipReviewRatingUpsertSql)).toBe(false);
	});

	it('concurrent same-author upserts retain one row with the original id', async () => {
		const f = fixture(); const [first, second] = await Promise.all([f.service.upsert(owner, 'work', input), f.service.upsert(owner, 'work', { ...input, rating: 9 })]);
		expect(f.reviews.size).toBe(1); expect(second.id).toBe(first.id); expect(second.rating).toBe(9);
		expect(f.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['zalip-review:owner:work']);
	});

	it('soft-removes and revives the original author review without removing their library score', async () => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', { ...input, rating: 7 });
		await f.service.delete(owner, review.id); await f.service.delete(owner, review.id);
		expect(f.reviews.get(review.id)).toMatchObject({ deletedAt: expect.any(Date), deletedById: 'owner', body: input.body });
		expect(await f.service.list('work', owner)).toMatchObject({ items: [], total: 0, myReview: null, summary: { ratingCount: 1, averageRating: 7, reviewCount: 0 } });
		const restored = await f.service.upsert(owner, 'work', input);
		expect(restored.id).toBe(review.id); expect(restored.createdAt).toBe(review.createdAt); expect(restored.rating).toBe(7);
		expect(f.reviews.get(review.id)?.deletedAt).toBeNull();
	});

	it('only author or moderator can remove a review', async () => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', input);
		await expect(f.service.delete(other, review.id)).rejects.toMatchObject({ code: 'CANNOT_EDIT_ZALIP_REVIEW' });
		expect(f.reviews.get(review.id)?.deletedAt).toBeNull();
		const listed = await f.service.list('work', moderator);
		expect(listed.items[0]).toMatchObject({ canEdit: false, canDelete: true });
		await f.service.delete(moderator, review.id); expect(f.reviews.get(review.id)?.deletedById).toBe('moderator');
	});

	it('does not let authors undo moderator removal or change their rating through a rejected revive', async () => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		await f.service.delete(moderator, review.id);
		const removed = structuredClone(f.reviews.get(review.id));
		await expect(f.service.upsert(owner, 'work', { ...input, rating: 10 })).rejects.toMatchObject({ code: 'CANNOT_EDIT_ZALIP_REVIEW' });
		expect(f.reviews.get(review.id)).toEqual(removed); expect(f.libraries.get('owner:work')?.personalRating).toBe(8);
	});

	it('toggles helpful/unhelpful and explicit clear without creating a second title rating', async () => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', input);
		for (const [value, myVote, helpfulCount, unhelpfulCount] of [['helpful', 'helpful', 1, 0], ['helpful', null, 0, 0], ['unhelpful', 'unhelpful', 0, 1], ['helpful', 'helpful', 1, 0], [null, null, 0, 0]] as const) {
			expect(await f.service.vote(other, review.id, value)).toMatchObject({ myVote, helpfulCount, unhelpfulCount, canEdit: false, canDelete: false });
		}
		expect(f.votes.size).toBe(0); expect(f.libraries.size).toBe(0);
		expect(f.query.mock.calls.some(([sql]) => sql.includes('FOR UPDATE OF r'))).toBe(true);
	});

	it('rejects self-votes, removed reviews, and hidden authors', async () => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', input);
		await expect(f.service.vote(owner, review.id, 'helpful')).rejects.toMatchObject({ code: 'CANNOT_VOTE_OWN_ZALIP_REVIEW' });
		f.blocked.add('owner:other');
		await expect(f.service.vote(other, review.id, 'helpful')).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_REVIEW' });
		f.blocked.clear(); await f.service.delete(owner, review.id);
		await expect(f.service.vote(other, review.id, 'helpful')).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_REVIEW' });
		expect(f.votes.size).toBe(0);
	});

	it.each(['draft', 'archived'])('all operations reject a %s title', async publicationState => {
		const f = fixture(); const review = await f.service.upsert(owner, 'work', input); f.work.publicationState = publicationState;
		for (const action of [() => f.service.list('work', null), () => f.service.upsert(owner, 'work', input), () => f.service.delete(owner, review.id), () => f.service.vote(other, review.id, 'helpful')]) await expect(action()).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_WORK' });
		expect(f.reviews.get(review.id)?.deletedAt).toBeNull(); expect(f.votes.size).toBe(0);
	});

	it.each(['isSuspended', 'isDeleted', 'host'] as const)('rejects an inactive/remote writer (%s)', async field => {
		const f = fixture(); Object.assign(f.users.get('owner')!, { [field]: field === 'host' ? 'remote.invalid' : true });
		await expect(f.service.upsert(owner, 'work', input)).rejects.toMatchObject({ code: 'CANNOT_EDIT_ZALIP_REVIEW' }); expect(f.reviews.size).toBe(0);
	});

	it('returns filter totals but independent sentiment summary and one canonical rating histogram', async () => {
		const f = fixture(); const own = await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		await f.service.upsert(other, 'work', { ...input, format: 'essay', title: 'Other view', sentiment: 'negative', isSpoiler: true, rating: 4 });
		await f.service.upsert({ id: 'third' }, 'work', { ...input, sentiment: 'neutral', rating: 8 });
		const result = await f.service.list('work', owner, { format: 'review', hideSpoilers: true, limit: 1, offset: 1 });
		expect(result).toMatchObject({ total: 2, items: [{ id: own.id }], myReview: { id: own.id }, summary: { reviewCount: 3, positiveCount: 1, neutralCount: 1, negativeCount: 1, ratingCount: 3, averageRating: 6.7 } });
		expect(result.summary.histogram).toEqual([0, 0, 0, 1, 0, 0, 0, 2, 0, 0]);
		expect(f.db.transaction).toHaveBeenLastCalledWith('REPEATABLE READ', expect.any(Function));
	});

	it('uses public library scores even when their author has no active review', async () => {
		const f = fixture(); await f.service.upsert(other, 'work', { ...input, rating: 5 });
		const removed = [...f.reviews.keys()][0]; await f.service.delete(other, removed);
		expect((await f.service.list('work', null)).summary).toMatchObject({ reviewCount: 0, ratingCount: 1, averageRating: 5 });
	});

	it('respects requireSigninToViewContents for anonymous review and rating reads', async () => {
		const f = fixture(); await f.service.upsert(owner, 'work', { ...input, rating: 8 });
		f.users.get('owner')!.requireSigninToViewContents = true;
		expect(await f.service.list('work', null)).toMatchObject({ items: [], total: 0, summary: { reviewCount: 0, ratingCount: 0, averageRating: null } });
		expect(await f.service.list('work', other)).toMatchObject({ total: 1, summary: { reviewCount: 1, ratingCount: 1, averageRating: 8 } });
	});

	it.each(['suspended', 'deleted', 'blocked', 'blockedBy', 'muted'])('applies %s safety to reviews, totals and rating summaries', async kind => {
		const f = fixture(); await f.service.upsert(owner, 'work', { ...input, rating: 8 }); await f.service.upsert(other, 'work', { ...input, rating: 1 });
		if (kind === 'suspended') f.users.get('other')!.isSuspended = true;
		if (kind === 'deleted') f.users.get('other')!.isDeleted = true;
		if (kind === 'blocked') f.blocked.add('owner:other');
		if (kind === 'blockedBy') f.blocked.add('other:owner');
		if (kind === 'muted') f.muted.add('owner:other');
		const result = await f.service.list('work', owner);
		expect(result.items).toHaveLength(1); expect(result.total).toBe(1); expect(result.summary).toMatchObject({ reviewCount: 1, averageRating: 8, ratingCount: 1 });
		for (const [sql] of f.query.mock.calls.filter(([value]) => value.includes('author."id"') && !value.includes('INSERT INTO'))) expect(sql).toContain(zalipReviewVisibleAuthorSql);
	});

	it('sorts by helpfulness with stable tie breakers and no unbounded list request', async () => {
		const f = fixture(); const first = await f.service.upsert(owner, 'work', input); await f.service.upsert(other, 'work', input); await f.service.vote({ id: 'third' }, first.id, 'helpful');
		expect((await f.service.list('work', null, { sort: 'helpful' })).items[0].id).toBe(first.id);
		for (const options of [{ limit: 21 }, { limit: 0 }, { offset: 1001 }, { offset: -1 }]) await expect(f.service.list('work', null, options)).rejects.toMatchObject({ code: 'INVALID_ZALIP_REVIEW' });
		const query = f.query.mock.calls.find(([sql]) => sql.includes('ORDER BY votes.'))!;
		expect(query[0]).toContain('r."createdAt" DESC, r."id" DESC LIMIT $6 OFFSET $7'); expect(query[1]?.slice(-2)).toEqual([10, 0]);
	});
});

describe('review validation and API boundaries', () => {
	it('trims opinion text and essay title, preserving omitted vs cleared rating', () => {
		expect(normalizeZalipReviewInput({ ...input, title: '   ', body: ` ${input.body} ` })).toEqual(input);
		expect(normalizeZalipReviewInput({ ...input, rating: null }).rating).toBeNull();
		expect(normalizeZalipReviewInput(input)).not.toHaveProperty('rating');
	});

	it('validates Unicode lengths after trimming before the database CHECK constraint', () => {
		expect(() => normalizeZalipReviewInput({ ...input, body: `     ${'😀'.repeat(15)}` })).toThrow('INVALID_ZALIP_REVIEW');
		expect(normalizeZalipReviewInput({ ...input, body: '😀'.repeat(20), format: 'essay', title: '😀'.repeat(200) })).toMatchObject({ body: '😀'.repeat(20), title: '😀'.repeat(200) });
	});

	it.each([{ body: ' '.repeat(20) }, { body: 'x'.repeat(19) }, { body: 'x'.repeat(12001) }, { format: 'essay', title: '   ' }, { title: 'x'.repeat(201) }, { rating: 0 }, { rating: 11 }, { rating: 1.5 }])('rejects invalid input %j', changes => {
		expect(() => normalizeZalipReviewInput({ ...input, ...changes } as ZalipReviewInput)).toThrow('INVALID_ZALIP_REVIEW');
	});

	it('keeps API writes authenticated, internal and rate-limited', () => {
		for (const meta of [upsertMeta, deleteMeta, voteMeta]) expect(meta).toMatchObject({ requireCredential: true, secure: true, limit: { duration: 60000 } });
		expect(listMeta.requireCredential).toBe(false); expect(upsertMeta.limit.max).toBeLessThanOrEqual(10); expect(voteMeta.limit.max).toBeLessThanOrEqual(60);
	});

	it('binds authors to the authenticated session and rejects supplied userId/reviewId/HTML-specific fields', async () => {
		const upsert = vi.fn().mockResolvedValue({ id: 'saved' }); const endpoint = new UpsertEndpoint({ upsert } as never);
		await endpoint.exec({ ...input, workId: 'work' }, owner as never, null);
		expect(upsert).toHaveBeenCalledWith(owner, 'work', expect.objectContaining(input));
		for (const extra of [{ userId: 'other' }, { reviewId: 'someoneelsesreview' }, { html: '<script>bad</script>' }]) await expect(endpoint.exec({ ...input, workId: 'work', ...extra }, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(upsert).toHaveBeenCalledOnce();
	});

	it('validates list bounds and forwards anonymous reads without an impersonated viewer', async () => {
		const list = vi.fn().mockResolvedValue({ items: [] }); const endpoint = new ListEndpoint({ list } as never);
		await endpoint.exec({ workId: 'work' }, null, null);
		expect(list).toHaveBeenCalledWith('work', null, { workId: 'work', limit: 10, offset: 0, hideSpoilers: false, sort: 'newest' });
		await expect(endpoint.exec({ workId: 'work', limit: 1000 }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({ workId: 'work', offset: 1001 }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	it('delete/vote forward only the actor and target; repeated toggles retain nullable value', async () => {
		const remove = vi.fn().mockResolvedValue(undefined); const vote = vi.fn().mockResolvedValue({});
		await new DeleteEndpoint({ delete: remove } as never).exec({ reviewId: 'review1' }, owner as never, null);
		await new VoteEndpoint({ vote } as never).exec({ reviewId: 'review1', value: null }, other as never, null);
		expect(remove).toHaveBeenCalledWith(owner, 'review1'); expect(vote).toHaveBeenCalledWith(other, 'review1', null);
	});
});

describe('reviews additive schema', () => {
	it('has canonical work/user uniqueness, recoverable removal and helpfulness uniqueness', async () => {
		class MetadataOnlyDataSource extends DataSource { async prepare() { await this.buildMetadatas(); } }
		const db = new MetadataOnlyDataSource({ type: 'postgres', entities });
		await db.prepare(); const review = db.getMetadata(MiZalipReview); const vote = db.getMetadata(MiZalipReviewVote);
		expect(review.uniques.find(value => value.name === 'UQ_zalip_review_user_work_format')?.columns.map(value => value.propertyName)).toEqual(['userId', 'workId', 'format']);
		expect(review.uniques.some(value => value.name === 'UQ_zalip_review_user_work')).toBe(false);
		expect(review.columns.find(value => value.propertyName === 'deletedAt')?.isNullable).toBe(true);
		expect(review.columns.some(value => value.propertyName === 'rating')).toBe(false);
		expect(vote.primaryColumns.map(value => value.propertyName)).toEqual(['userId', 'reviewId']);
		expect(review.foreignKeys.map(value => [value.name, value.onDelete])).toContainEqual(['FK_zalip_review_deleted_by', 'SET NULL']);
	});

	it('migration creates/drops only its new tables and never rewrites native library or discussion data', async () => {
		const query = vi.fn().mockResolvedValue([]); const migration = new ZalipReviews1792442405046(); await migration.up({ query });
		expect(query.mock.calls.map(call => call[0]).join('\n')).toContain('CONSTRAINT "UQ_zalip_review_user_work" UNIQUE ("userId", "workId")');
		expect(query.mock.calls.some(call => /UPDATE "(?:zalip_library_entry|note|zalip_work)"/u.test(call[0]))).toBe(false);
		query.mockClear(); await migration.down({ query }); expect(query.mock.calls.map(call => call[0])).toEqual(['DROP TABLE "zalip_review_vote"', 'DROP TABLE "zalip_review"']);
	});

	it('the format migration only exchanges unique constraints and preserves all existing rows', async () => {
		const query = vi.fn().mockResolvedValue([]);
		const migration = new ZalipReviewFormats1792682390825();
		await migration.up({ query });
		expect(query.mock.calls.map(call => call[0])).toEqual([
			'ALTER TABLE "zalip_review" ADD CONSTRAINT "UQ_zalip_review_user_work_format" UNIQUE ("userId", "workId", "format")',
			'ALTER TABLE "zalip_review" DROP CONSTRAINT "UQ_zalip_review_user_work"',
		]);
		query.mockClear(); await migration.down({ query });
		expect(query.mock.calls[0][0]).toBe('LOCK TABLE "zalip_review" IN ACCESS EXCLUSIVE MODE');
		expect(query.mock.calls[1][0]).toContain('GROUP BY "userId", "workId" HAVING COUNT(*) > 1');
		expect(query.mock.calls[1][0]).not.toContain('"deletedAt"');
		expect(query.mock.calls[1][0]).toContain("ERRCODE = '23514'");
		expect(query.mock.calls.slice(2).map(call => call[0])).toEqual([
			'ALTER TABLE "zalip_review" ADD CONSTRAINT "UQ_zalip_review_user_work" UNIQUE ("userId", "workId")',
			'ALTER TABLE "zalip_review" DROP CONSTRAINT "UQ_zalip_review_user_work_format"',
		]);
		expect(query.mock.calls.some(([sql]) => /\b(?:DELETE|UPDATE|INSERT|TRUNCATE|DROP TABLE)\b/u.test(sql))).toBe(false);
	});

	it('fails a conflicting format rollback before any DDL or row mutation', async () => {
		const query = vi.fn(async (sql: string) => {
			if (sql.startsWith('DO $$')) throw Object.assign(new Error('Both formats exist'), { code: '23514' });
			return [];
		});
		await expect(new ZalipReviewFormats1792682390825().down({ query })).rejects.toMatchObject({ code: '23514' });
		expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls.some(([sql]) => sql.startsWith('ALTER TABLE'))).toBe(false);
	});
});
