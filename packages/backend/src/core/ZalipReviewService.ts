/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import type { MiUser } from '@/models/User.js';
import type { Packed } from '@/misc/json-schema.js';
import { zalipReviewFormats, zalipReviewSentiments, type ZalipReviewFormat, type ZalipReviewSentiment } from '@/models/ZalipReview.js';
import type { ZalipReviewVoteValue } from '@/models/ZalipReviewVote.js';
import type { EntityManager } from 'typeorm';

type Viewer = Pick<MiUser, 'id'>;
type ReviewErrorCode = 'NO_SUCH_ZALIP_WORK' | 'NO_SUCH_ZALIP_REVIEW' | 'INVALID_ZALIP_REVIEW' | 'CANNOT_EDIT_ZALIP_REVIEW' | 'CANNOT_VOTE_OWN_ZALIP_REVIEW';

export class ZalipReviewError extends Error {
	constructor(public readonly code: ReviewErrorCode) { super(code); }
}

export type PackedZalipReview = {
	id: string;
	workId: string;
	user: Packed<'UserLite'>;
	format: ZalipReviewFormat;
	title: string | null;
	body: string;
	isSpoiler: boolean;
	sentiment: ZalipReviewSentiment;
	/** The author's current native library score, never a second review-specific rating. */
	rating: number | null;
	helpfulCount: number;
	unhelpfulCount: number;
	myVote: ZalipReviewVoteValue | null;
	createdAt: string;
	updatedAt: string;
	canEdit: boolean;
	canDelete: boolean;
};

export type ZalipReviewInput = {
	format: ZalipReviewFormat;
	title?: string | null;
	body: string;
	isSpoiler: boolean;
	sentiment: ZalipReviewSentiment;
	/** Omission preserves the library rating; explicit null clears it. */
	rating?: number | null;
};

export type ZalipReviewListOptions = {
	format?: ZalipReviewFormat;
	sentiment?: ZalipReviewSentiment;
	hideSpoilers?: boolean;
	sort?: 'newest' | 'helpful';
	limit?: number;
	offset?: number;
};

export type PackedZalipReviewList = {
	items: PackedZalipReview[];
	total: number;
	summary: {
		reviewCount: number;
		positiveCount: number;
		neutralCount: number;
		negativeCount: number;
		averageRating: number | null;
		ratingCount: number;
		histogram: number[];
	};
	myReview: PackedZalipReview | null;
	/** Both independent author formats, even when the public list is filtered or paginated. */
	myReviews: PackedZalipReview[];
};

type ReviewRow = {
	id: string;
	workId: string;
	userId: string;
	format: ZalipReviewFormat;
	title: string | null;
	body: string;
	isSpoiler: boolean;
	sentiment: ZalipReviewSentiment;
	rating: number | null;
	helpfulCount: number;
	unhelpfulCount: number;
	myVote: ZalipReviewVoteValue | null;
	createdAt: Date;
	updatedAt: Date;
};

/** All authors are local signed-in users. The same safety predicate covers items and aggregates. */
export const zalipReviewVisibleAuthorSql = `author."host" IS NULL AND author."isSuspended" = false AND author."isDeleted" = false
	AND (author."requireSigninToViewContents" = false OR $2::varchar IS NOT NULL)
	AND ($2::varchar IS NULL OR (
		NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $2 AND b."blockeeId" = author."id") OR (b."blockeeId" = $2 AND b."blockerId" = author."id"))
		AND NOT EXISTS (SELECT 1 FROM "muting" m WHERE m."muterId" = $2 AND m."muteeId" = author."id" AND (m."expiresAt" IS NULL OR m."expiresAt" > now()))
	))`;

const reviewFromSql = `FROM "zalip_review" r
	INNER JOIN "user" author ON author."id" = r."userId"
	INNER JOIN "zalip_work" work ON work."id" = r."workId" AND work."publicationState" = 'published'`;
const reviewWhereSql = `r."workId" = $1 AND r."deletedAt" IS NULL AND ${zalipReviewVisibleAuthorSql}`;
const reviewProjectionSql = `SELECT r."id", r."workId", r."userId", r."format", r."title", r."body", r."isSpoiler", r."sentiment", r."createdAt", r."updatedAt",
	library."personalRating" AS "rating", votes."helpfulCount", votes."unhelpfulCount",
	(SELECT mine."value" FROM "zalip_review_vote" mine WHERE mine."reviewId" = r."id" AND mine."userId" = $2) AS "myVote"
	${reviewFromSql}
	LEFT JOIN "zalip_library_entry" library ON library."userId" = r."userId" AND library."workId" = r."workId"
	LEFT JOIN LATERAL (
		SELECT COUNT(*) FILTER (WHERE v."value" = 'helpful')::int AS "helpfulCount", COUNT(*) FILTER (WHERE v."value" = 'unhelpful')::int AS "unhelpfulCount"
		FROM "zalip_review_vote" v INNER JOIN "user" voter ON voter."id" = v."userId"
		WHERE v."reviewId" = r."id" AND voter."isSuspended" = false AND voter."isDeleted" = false
	) votes ON true`;

/** A single partial-column UPSERT cannot reset status, favourites, subscriptions or watched episodes. */
export const zalipReviewRatingUpsertSql = `INSERT INTO "zalip_library_entry" ("userId", "workId", "status", "episodesWatched", "personalRating", "isFavorite", "isReleaseSubscribed", "createdAt", "updatedAt")
	VALUES ($1, $2, NULL, 0, $3, false, false, $4, $4)
	ON CONFLICT ("userId", "workId") DO UPDATE SET "personalRating" = EXCLUDED."personalRating", "updatedAt" = EXCLUDED."updatedAt"`;

export function normalizeZalipReviewInput(input: ZalipReviewInput): ZalipReviewInput & { title: string | null } {
	const trimmedTitle = input.title?.trim();
	const title = trimmedTitle?.length ? trimmedTitle : null;
	const body = input.body.trim();
	// AJV and PostgreSQL varchar length count Unicode code points, not UTF-16 units.
	const bodyLength = Array.from(body).length;
	if (!zalipReviewFormats.includes(input.format) || !zalipReviewSentiments.includes(input.sentiment) ||
		typeof input.isSpoiler !== 'boolean' || bodyLength < 20 || bodyLength > 12000 || Array.from(title ?? '').length > 200 ||
		(input.format === 'essay' && title == null) ||
		(input.rating !== undefined && input.rating !== null && (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 10))) {
		throw new ZalipReviewError('INVALID_ZALIP_REVIEW');
	}
	return { ...input, title, body };
}

@Injectable()
export class ZalipReviewService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
		private userEntityService: UserEntityService,
		private roleService: RoleService,
	) {}

	private async publishedWork(manager: EntityManager, workId: string, lock = false): Promise<void> {
		const rows = await manager.query<{ id: string }[]>(`SELECT "id" FROM "zalip_work" WHERE "id" = $1 AND "publicationState" = 'published'${lock ? ' FOR SHARE' : ''}`, [workId]);
		if (rows.length !== 1) throw new ZalipReviewError('NO_SUCH_ZALIP_WORK');
	}

	private async activeActor(manager: EntityManager, me: Viewer): Promise<void> {
		const rows = await manager.query<{ id: string }[]>('SELECT "id" FROM "user" WHERE "id" = $1 AND "host" IS NULL AND "isSuspended" = false AND "isDeleted" = false', [me.id]);
		if (rows.length !== 1) throw new ZalipReviewError('CANNOT_EDIT_ZALIP_REVIEW');
	}

	/** At most 21 users are packed per list, with the native public avatar handling. */
	private async pack(rows: ReviewRow[], me: Viewer | null): Promise<PackedZalipReview[]> {
		if (rows.length === 0) return [];
		const [users, moderator] = await Promise.all([
			this.userEntityService.packMany([...new Set(rows.map(row => row.userId))], me, { schema: 'UserLite', includeSecrets: false }),
			me ? this.roleService.isModerator(me) : false,
		]);
		const byId = new Map(users.map(user => [user.id, user]));
		return rows.flatMap(row => {
			const user = byId.get(row.userId);
			if (user == null) return [];
			return [{
				id: row.id,
				workId: row.workId,
				user,
				format: row.format,
				title: row.title,
				body: row.body,
				isSpoiler: row.isSpoiler,
				sentiment: row.sentiment,
				rating: row.rating,
				helpfulCount: row.helpfulCount,
				unhelpfulCount: row.unhelpfulCount,
				myVote: row.myVote,
				createdAt: row.createdAt.toISOString(),
				updatedAt: row.updatedAt.toISOString(),
				canEdit: me?.id === row.userId,
				canDelete: me?.id === row.userId || moderator,
			}];
		});
	}

	public async list(workId: string, me: Viewer | null, options: ZalipReviewListOptions = {}): Promise<PackedZalipReviewList> {
		const { limit = 10, offset = 0, sort = 'newest', hideSpoilers = false } = options;
		if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0 || offset > 1000 ||
			!['newest', 'helpful'].includes(sort) || (options.format != null && !zalipReviewFormats.includes(options.format)) ||
			(options.sentiment != null && !zalipReviewSentiments.includes(options.sentiment))) throw new ZalipReviewError('INVALID_ZALIP_REVIEW');
		return this.db.transaction('REPEATABLE READ', async manager => {
			await this.publishedWork(manager, workId);
			const baseParams = [workId, me?.id ?? null];
			const params = [...baseParams, options.format ?? null, options.sentiment ?? null, hideSpoilers];
			const filter = `${reviewWhereSql} AND ($3::varchar IS NULL OR r."format" = $3) AND ($4::varchar IS NULL OR r."sentiment" = $4) AND (NOT $5::boolean OR r."isSpoiler" = false)`;
			const [rows, totals, sentiments, ratings, mine] = await Promise.all([
				manager.query<ReviewRow[]>(`${reviewProjectionSql} WHERE ${filter} ORDER BY ${sort === 'helpful' ? 'votes."helpfulCount" DESC, votes."unhelpfulCount" ASC, ' : ''}r."createdAt" DESC, r."id" DESC LIMIT $6 OFFSET $7`, [...params, limit, offset]),
				manager.query<{ total: number }[]>(`SELECT COUNT(*)::int AS total ${reviewFromSql} WHERE ${filter}`, params),
				manager.query<{ sentiment: ZalipReviewSentiment; count: number }[]>(`SELECT r."sentiment", COUNT(*)::int AS count ${reviewFromSql} WHERE ${reviewWhereSql} GROUP BY r."sentiment"`, baseParams),
				manager.query<{ rating: number; count: number }[]>(`SELECT library."personalRating" AS rating, COUNT(*)::int AS count FROM "zalip_library_entry" library INNER JOIN "user" author ON author."id" = library."userId" INNER JOIN "zalip_work" work ON work."id" = library."workId" AND work."publicationState" = 'published' WHERE library."workId" = $1 AND library."personalRating" BETWEEN 1 AND 10 AND ${zalipReviewVisibleAuthorSql} GROUP BY library."personalRating"`, baseParams),
				me ? manager.query<ReviewRow[]>(`${reviewProjectionSql} WHERE ${reviewWhereSql} AND r."userId" = $2 ORDER BY r."format" DESC LIMIT 2`, baseParams) : Promise.resolve([]),
			]);
			const packed = await this.pack([...rows, ...mine.filter(row => !rows.some(item => item.id === row.id))], me);
			const histogram = Array.from({ length: 10 }, () => 0);
			for (const row of ratings) histogram[row.rating - 1] = row.count;
			const ratingCount = histogram.reduce((sum, count) => sum + count, 0);
			const sentimentCounts = new Map(sentiments.map(row => [row.sentiment, row.count]));
			const myReviews = mine.flatMap(row => packed.filter(item => item.id === row.id));
			return {
				items: rows.flatMap(row => packed.filter(item => item.id === row.id)),
				total: totals[0]?.total ?? 0,
				summary: {
					reviewCount: sentiments.reduce((sum, row) => sum + row.count, 0),
					positiveCount: sentimentCounts.get('positive') ?? 0,
					neutralCount: sentimentCounts.get('neutral') ?? 0,
					negativeCount: sentimentCounts.get('negative') ?? 0,
					averageRating: ratingCount === 0 ? null : Math.round(histogram.reduce((sum, count, index) => sum + count * (index + 1), 0) / ratingCount * 10) / 10,
					ratingCount,
					histogram,
				},
				// Keep the legacy singular field deterministic. A legacy essay-only author
				// still receives their existing material when no format is requested.
				myReview: myReviews.find(item => item.format === (options.format ?? 'review')) ?? (options.format == null ? myReviews[0] : null) ?? null,
				myReviews,
			};
		});
	}

	public async upsert(me: Viewer, workId: string, input: ZalipReviewInput): Promise<PackedZalipReview> {
		const value = normalizeZalipReviewInput(input);
		return this.db.transaction(async manager => {
			await this.publishedWork(manager, workId, true);
			await this.activeActor(manager, me);
			await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-review:${me.id}:${workId}`]);
			const removed = (await manager.query<{ deletedAt: Date | null; deletedById: string | null }[]>('SELECT "deletedAt", "deletedById" FROM "zalip_review" WHERE "userId" = $1 AND "workId" = $2 AND "format" = $3', [me.id, workId, value.format])).at(0);
			// A writer may recover their own removal, not undo a moderation decision.
			if (removed?.deletedAt != null && removed.deletedById !== me.id) throw new ZalipReviewError('CANNOT_EDIT_ZALIP_REVIEW');
			if (value.rating !== undefined) await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-library:${me.id}:${workId}`]);
			const now = new Date();
			await manager.query(`INSERT INTO "zalip_review" ("id", "userId", "workId", "format", "title", "body", "isSpoiler", "sentiment", "createdAt", "updatedAt", "deletedAt", "deletedById") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, NULL, NULL)
				ON CONFLICT ("userId", "workId", "format") DO UPDATE SET "title" = EXCLUDED."title", "body" = EXCLUDED."body", "isSpoiler" = EXCLUDED."isSpoiler", "sentiment" = EXCLUDED."sentiment", "updatedAt" = EXCLUDED."updatedAt", "deletedAt" = NULL, "deletedById" = NULL`,
			[this.idService.gen(), me.id, workId, value.format, value.title, value.body, value.isSpoiler, value.sentiment, now]);
			if (value.rating !== undefined) await manager.query(zalipReviewRatingUpsertSql, [me.id, workId, value.rating, now]);
			const rows = await manager.query<ReviewRow[]>(`${reviewProjectionSql} WHERE ${reviewWhereSql} AND r."userId" = $2 AND r."format" = $3 LIMIT 1`, [workId, me.id, value.format]);
			const packed = (await this.pack(rows, me)).at(0);
			if (packed == null) throw new ZalipReviewError('NO_SUCH_ZALIP_REVIEW');
			return packed;
		});
	}

	/** Read-only finite projection for the cross-title feed. No fake native Notes. */
	public async feedByIds(ids: string[], me: Viewer | null, format: ZalipReviewFormat, hideSpoilers: boolean): Promise<PackedZalipReview[]> {
		if (ids.length === 0) return [];
		if (ids.length > 40 || !zalipReviewFormats.includes(format)) throw new ZalipReviewError('INVALID_ZALIP_REVIEW');
		const rows = await this.db.query<ReviewRow[]>(`${reviewProjectionSql} WHERE r."id" = ANY($1::varchar[]) AND r."deletedAt" IS NULL AND ${zalipReviewVisibleAuthorSql}
			AND r."format" = $3 AND (NOT $4::boolean OR r."isSpoiler" = false)`, [ids, me?.id ?? null, format, hideSpoilers]);
		return this.pack(rows, me);
	}

	public async delete(me: Viewer, reviewId: string): Promise<void> {
		const moderator = await this.roleService.isModerator(me);
		await this.db.transaction(async manager => {
			await this.activeActor(manager, me);
			const rows = await manager.query<{ userId: string; workId: string }[]>('SELECT "userId", "workId" FROM "zalip_review" WHERE "id" = $1', [reviewId]);
			const row = rows.at(0);
			if (row == null) throw new ZalipReviewError('NO_SUCH_ZALIP_REVIEW');
			await this.publishedWork(manager, row.workId, true);
			if (row.userId !== me.id && !moderator) throw new ZalipReviewError('CANNOT_EDIT_ZALIP_REVIEW');
			// Same author/work lock as upsert makes remove/revive ordering deterministic.
			await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-review:${row.userId}:${row.workId}`]);
			await manager.query('UPDATE "zalip_review" SET "deletedAt" = $2, "deletedById" = $3, "updatedAt" = $2 WHERE "id" = $1 AND "deletedAt" IS NULL', [reviewId, new Date(), me.id]);
		});
	}

	public async vote(me: Viewer, reviewId: string, value: ZalipReviewVoteValue | null): Promise<PackedZalipReview> {
		if (!([null, 'helpful', 'unhelpful'] as const).includes(value)) throw new ZalipReviewError('INVALID_ZALIP_REVIEW');
		return this.db.transaction(async manager => {
			await this.activeActor(manager, me);
			const target = (await manager.query<{ userId: string; workId: string }[]>('SELECT "userId", "workId" FROM "zalip_review" WHERE "id" = $1', [reviewId])).at(0);
			if (target == null) throw new ZalipReviewError('NO_SUCH_ZALIP_REVIEW');
			await this.publishedWork(manager, target.workId, true);
			const visible = (await manager.query<{ id: string }[]>(`SELECT r."id" ${reviewFromSql} WHERE ${reviewWhereSql} AND r."id" = $3 FOR UPDATE OF r`, [target.workId, me.id, reviewId])).at(0);
			if (visible == null) throw new ZalipReviewError('NO_SUCH_ZALIP_REVIEW');
			if (target.userId === me.id) throw new ZalipReviewError('CANNOT_VOTE_OWN_ZALIP_REVIEW');
			const existing = await manager.query<{ value: ZalipReviewVoteValue }[]>('SELECT "value" FROM "zalip_review_vote" WHERE "userId" = $1 AND "reviewId" = $2', [me.id, reviewId]);
			if (value == null || existing[0]?.value === value) {
				await manager.query('DELETE FROM "zalip_review_vote" WHERE "userId" = $1 AND "reviewId" = $2', [me.id, reviewId]);
			} else {
				await manager.query(`INSERT INTO "zalip_review_vote" ("userId", "reviewId", "value", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)
					ON CONFLICT ("userId", "reviewId") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`, [me.id, reviewId, value, new Date()]);
			}
			const rows = await manager.query<ReviewRow[]>(`${reviewProjectionSql} WHERE ${reviewWhereSql} AND r."id" = $3`, [target.workId, me.id, reviewId]);
			const packed = (await this.pack(rows, me)).at(0);
			if (packed == null) throw new ZalipReviewError('NO_SUCH_ZALIP_REVIEW');
			return packed;
		});
	}
}
