/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityNotFoundError, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ZalipReviewService, zalipReviewVisibleAuthorSql } from '@/core/ZalipReviewService.js';
import type { PackedZalipReview } from '@/core/ZalipReviewService.js';
import type { MiMeta, MiUser } from '@/models/_.js';
import { MiNote } from '@/models/Note.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import type { Packed } from '@/misc/json-schema.js';
import { zalipDiscussionRootMarker } from '@/misc/zalip-discussion-root.js';

type Viewer = Pick<MiUser, 'id'> | null;
export type ZalipFeedSection = 'discussions' | 'essays';
type FeedKind = 'comment' | 'review' | 'essay';
type Anchor = { id: string; kind: FeedKind };
export type ZalipFeedOptions = { section: ZalipFeedSection; limit?: number; hideSpoilers?: boolean; cursor?: string };
type Work = Pick<MiZalipWork, 'id' | 'slug' | 'kind' | 'title' | 'posterPath' | 'releaseYear'>;
type Discussion = { rootNoteId: string; episodeId: string | null; episodeNumber: number | null; seasonNumber: number | null };
type Candidate = Anchor & { workId: string; rootNoteId: string | null; episodeId: string | null; episodeNumber: number | null; seasonNumber: number | null };
export type PackedZalipFeedItem =
	| { key: string; id: string; createdAt: string; type: 'comment'; work: Work; discussion: Discussion; note: Packed<'Note'> }
	| { key: string; id: string; createdAt: string; type: 'review' | 'essay'; work: Work; review: PackedZalipReview };
export type PackedZalipFeed = { items: PackedZalipFeedItem[]; nextCursor: string | null };

export class ZalipFeedError extends Error {
	constructor(public readonly code: 'INVALID_ZALIP_FEED' | 'INVALID_ZALIP_FEED_CURSOR') { super(code); }
}

function scope(section: ZalipFeedSection, me: Viewer, hideSpoilers: boolean): string {
	return createHash('sha256').update(JSON.stringify([1, section, me?.id ?? null, hideSpoilers])).digest('hex');
}

/** Navigation only, not an authorization token: privacy is reapplied on every request. */
export function encodeZalipFeedCursor(anchor: Anchor, section: ZalipFeedSection, me: Viewer, hideSpoilers: boolean): string {
	return Buffer.from(JSON.stringify({ v: 1, scope: scope(section, me, hideSpoilers), ...anchor })).toString('base64url');
}

export function decodeZalipFeedCursor(cursor: string, section: ZalipFeedSection, me: Viewer, hideSpoilers: boolean): Anchor {
	try {
		if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
		const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		if (value == null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,kind,scope,v' ||
			value.v !== 1 || value.scope !== scope(section, me, hideSpoilers) || typeof value.id !== 'string' || !/^[A-Za-z0-9]{1,32}$/u.test(value.id) ||
			!(section === 'essays' ? ['essay'] : ['comment', 'review']).includes(value.kind) ||
			encodeZalipFeedCursor({ id: value.id, kind: value.kind }, section, me, hideSpoilers) !== cursor) throw new Error();
		return { id: value.id, kind: value.kind };
	} catch { throw new ZalipFeedError('INVALID_ZALIP_FEED_CURSOR'); }
}

// Parameter $1 is the viewer. Include both directions of blocking and only active mutes.
function visibleAuthor(alias: string): string {
	return `${alias}."isSuspended" = false AND ${alias}."isDeleted" = false
		AND (${alias}."requireSigninToViewContents" = false OR $1::varchar IS NOT NULL)
		AND ($1::varchar IS NULL OR (
			NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $1 AND b."blockeeId" = ${alias}."id") OR (b."blockeeId" = $1 AND b."blockerId" = ${alias}."id"))
			AND NOT EXISTS (SELECT 1 FROM "muting" m WHERE m."muterId" = $1 AND m."muteeId" = ${alias}."id" AND (m."expiresAt" IS NULL OR m."expiresAt" > now()))
		))`;
}

/** Finite indexed thread/root bindings, never text matching, root attribution or generated Notes. */
export const zalipFeedCandidatesSql = `WITH roots AS (
	SELECT DISTINCT ON (binding."noteId") binding.* FROM (
		SELECT c."noteId", c."workId", NULL::varchar AS "episodeId", NULL::integer AS "episodeNumber", NULL::integer AS "seasonNumber" FROM "zalip_note_context" c
		UNION ALL
		SELECT c."noteId", s."workId", e."id", e."episodeNumber", s."seasonNumber" FROM "zalip_episode_note_context" c
		JOIN "zalip_episode" e ON e."id" = c."episodeId" JOIN "zalip_season" s ON s."id" = e."seasonId"
	) binding ORDER BY binding."noteId", binding."workId", binding."episodeId" NULLS FIRST
), candidates AS (
	SELECT n."id", 'comment'::varchar AS kind, context."workId", root."id" AS "rootNoteId", context."episodeId", context."episodeNumber", context."seasonNumber"
	FROM roots context JOIN "note" root ON root."id" = context."noteId"
	JOIN "user" root_author ON root_author."id" = root."userId"
	JOIN "zalip_work" work ON work."id" = context."workId" AND work."publicationState" = 'published'
	JOIN "note" n ON n."threadId" = root."id" AND n."id" <> root."id" AND n."replyId" IS NOT NULL
	JOIN "user" author ON author."id" = n."userId"
	WHERE $3::varchar = 'discussions' AND n."visibility" IN ('public', 'home') AND root."visibility" IN ('public', 'home')
		AND n."name" IS DISTINCT FROM '${zalipDiscussionRootMarker}'
		AND (NOT $2::boolean OR (n."cw" IS NULL AND root."cw" IS NULL))
		AND ${visibleAuthor('author')} AND ${visibleAuthor('root_author')}
		AND NOT EXISTS (SELECT 1 FROM "user" related WHERE related."id" = ANY(ARRAY[n."replyUserId", n."renoteUserId"]) AND (related."isDeleted" OR related."isSuspended"))
		AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[n."userHost", n."replyUserHost", n."renoteUserHost", root."userHost"]) host WHERE host IS NOT NULL AND host ILIKE ANY($7::text[]))
		AND ($1::varchar IS NULL OR (
			NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $1 AND b."blockeeId" = ANY(ARRAY[n."replyUserId", n."renoteUserId"])) OR (b."blockeeId" = $1 AND b."blockerId" = ANY(ARRAY[n."replyUserId", n."renoteUserId"])))
			AND NOT EXISTS (SELECT 1 FROM "muting" m WHERE m."muterId" = $1 AND m."muteeId" = ANY(ARRAY[n."replyUserId", n."renoteUserId"]) AND (m."expiresAt" IS NULL OR m."expiresAt" > now()))
			AND NOT EXISTS (SELECT 1 FROM "note_thread_muting" m WHERE m."userId" = $1 AND m."threadId" IN (n."id", n."threadId"))
			AND NOT EXISTS (SELECT 1 FROM "channel_muting" m WHERE m."userId" = $1 AND m."channelId" = ANY(ARRAY[n."channelId", n."renoteChannelId", root."channelId"]) AND (m."expiresAt" IS NULL OR m."expiresAt" > now()))
			AND NOT EXISTS (SELECT 1 FROM "user_profile" profile, unnest(ARRAY[n."userHost", n."replyUserHost", n."renoteUserHost", root."userHost"]) host WHERE profile."userId" = $1 AND host IS NOT NULL AND profile."mutedInstances"::jsonb ? host)
		))
	UNION ALL
	SELECT r."id", r."format"::varchar AS kind, r."workId", NULL::varchar, NULL::varchar, NULL::integer, NULL::integer
	FROM "zalip_review" r JOIN "user" author ON author."id" = r."userId"
	JOIN "zalip_work" work ON work."id" = r."workId" AND work."publicationState" = 'published'
	WHERE r."deletedAt" IS NULL AND r."format" = CASE WHEN $3::varchar = 'essays' THEN 'essay' ELSE 'review' END
		AND (NOT $2::boolean OR r."isSpoiler" = false) AND ${zalipReviewVisibleAuthorSql.replaceAll('$2', '$1')}
)
SELECT * FROM candidates WHERE ($8::varchar[] IS NULL OR "id" = ANY($8::varchar[]))
	AND ($4::varchar IS NULL OR ("id" COLLATE "C", kind COLLATE "C") < ($4::varchar COLLATE "C", $5::varchar COLLATE "C"))
ORDER BY "id" COLLATE "C" DESC, kind COLLATE "C" DESC LIMIT $6`;

@Injectable()
export class ZalipFeedService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.meta) private meta: MiMeta,
		private notes: NoteEntityService,
		private reviews: ZalipReviewService,
	) {}

	private async pack(candidates: Candidate[], me: Viewer, hideSpoilers: boolean): Promise<Map<string, PackedZalipFeedItem>> {
		const commentIds = candidates.filter(row => row.kind === 'comment').flatMap(row => [row.id, row.rootNoteId!]);
		const native = commentIds.length ? await this.db.getRepository(MiNote).find({ where: { id: In([...new Set(commentIds)]) } }) : [];
		let packedNotes: Packed<'Note'>[];
		try { packedNotes = await this.notes.packMany(native, me, { detail: true, withNestedNotes: false }); } catch (error) {
			if (!(error instanceof EntityNotFoundError)) throw error;
			// A concurrent deletion must not turn an otherwise valid page into a 500.
			const remaining = await Promise.all(native.map(async note => {
				try { return await this.notes.pack(note, me, { detail: true, withNestedNotes: false }); } catch (cause) { if (cause instanceof EntityNotFoundError) return null; throw cause; }
			}));
			packedNotes = remaining.filter(note => note !== null);
		}
		const byNote = new Map(packedNotes.filter(note => !note.isHidden && ['public', 'home'].includes(note.visibility) && (!hideSpoilers || note.cw == null)).map(note => [note.id, note]));
		const reviewRows = candidates.filter(row => row.kind !== 'comment');
		const packedReviews = reviewRows.length ? await this.reviews.feedByIds(reviewRows.map(row => row.id), me, reviewRows[0].kind === 'essay' ? 'essay' : 'review', hideSpoilers) : [];
		const byReview = new Map(packedReviews.map(row => [row.id, row]));
		// Recheck publication after packing. Only whitelist fields, never importer state or provider URLs.
		const works = await this.db.getRepository(MiZalipWork).find({
			where: { id: In([...new Set(candidates.map(row => row.workId))]), publicationState: 'published' },
			select: { id: true, slug: true, kind: true, title: true, posterPath: true, releaseYear: true },
		});
		const byWork = new Map(works.map(work => [work.id, work]));
		const result = new Map<string, PackedZalipFeedItem>();
		for (const row of candidates) {
			const source = byWork.get(row.workId);
			if (!source) continue;
			const work: Work = { id: source.id, slug: source.slug, kind: source.kind, title: source.title, posterPath: source.posterPath, releaseYear: source.releaseYear };
			const key = `${row.kind}:${row.id}`;
			if (row.kind === 'comment') {
				const note = byNote.get(row.id);
				if (!note || !row.rootNoteId || !byNote.has(row.rootNoteId)) continue;
				result.set(key, { key, id: row.id, createdAt: note.createdAt, type: 'comment', work, note, discussion: { rootNoteId: row.rootNoteId, episodeId: row.episodeId, episodeNumber: row.episodeNumber, seasonNumber: row.seasonNumber } });
			} else {
				const review = byReview.get(row.id);
				if (review?.workId === work.id && review.format === row.kind) result.set(key, { key, id: row.id, createdAt: review.createdAt, type: row.kind, work, review });
			}
		}
		return result;
	}

	public async list(me: Viewer, options: ZalipFeedOptions): Promise<PackedZalipFeed> {
		const { section, limit = 10, hideSpoilers = true } = options;
		if (!['discussions', 'essays'].includes(section) || !Number.isInteger(limit) || limit < 1 || limit > 20 || typeof hideSpoilers !== 'boolean') throw new ZalipFeedError('INVALID_ZALIP_FEED');
		let anchor = options.cursor ? decodeZalipFeedCursor(options.cursor, section, me, hideSpoilers) : null;
		const items: PackedZalipFeedItem[] = [];
		const batch = Math.max(20, limit * 2);
		const blockedHosts = this.meta.blockedHosts.flatMap(host => [host, `%.${host}`]);
		// Never scan indefinitely to fill a page of hidden/removed items. Continue from
		// the last consumed raw key even when an entire finite batch was filtered out.
		for (let scanned = 0; scanned < 200;) {
			const requestLimit = Math.min(batch, 200 - scanned);
			const rows = await this.db.query<Candidate[]>(zalipFeedCandidatesSql, [me?.id ?? null, hideSpoilers, section, anchor?.id ?? null, anchor?.kind ?? null, requestLimit, blockedHosts, null]);
			if (rows.length === 0) return { items, nextCursor: null };
			const packed = await this.pack(rows, me, hideSpoilers);
			// A deletion, unpublication, block, mute or changed catalogue binding during
			// native packing must not return the stale item. This is still a bounded read.
			const current = await this.db.query<Candidate[]>(zalipFeedCandidatesSql, [me?.id ?? null, hideSpoilers, section, null, null, rows.length, blockedHosts, rows.map(row => row.id)]);
			const currentBindings = new Map(current.map(row => [`${row.kind}:${row.id}`, row]));
			for (const [index, row] of rows.entries()) {
				anchor = { id: row.id, kind: row.kind }; scanned++;
				const key = `${row.kind}:${row.id}`;
				const binding = currentBindings.get(key);
				const item = binding?.workId === row.workId && binding.rootNoteId === row.rootNoteId && binding.episodeId === row.episodeId ? packed.get(key) : undefined;
				if (item) items.push(item);
				if (items.length === limit) return { items, nextCursor: index === rows.length - 1 && rows.length < requestLimit ? null : encodeZalipFeedCursor(anchor, section, me, hideSpoilers) };
			}
			if (rows.length < requestLimit) return { items, nextCursor: null };
		}
		return { items, nextCursor: anchor ? encodeZalipFeedCursor(anchor, section, me, hideSpoilers) : null };
	}
}
