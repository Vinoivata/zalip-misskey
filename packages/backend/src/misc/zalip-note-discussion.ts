/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { DataSource } from 'typeorm';
import type { MiNote } from '@/models/Note.js';
import { zalipDiscussionRootMarker } from './zalip-discussion-root.js';

export type PackedZalipNoteDiscussion = {
	workId: string;
	slug: string;
	title: string;
	posterPath: string | null;
	rootNoteId: string;
	isRoot: boolean;
	episodeId: string | null;
	episodeNumber: number | null;
	seasonNumber: number | null;
};

/** A marker alone is not authority: only an actual catalogue binding owns a technical root. */
export async function isBoundZalipDiscussionRoot(db: DataSource, note: Pick<MiNote, 'id' | 'name'> | null | undefined): Promise<boolean> {
	if (note?.name !== zalipDiscussionRootMarker) return false;
	const [row] = await db.query<Array<{ bound: boolean }>>(`
		SELECT EXISTS (
			SELECT 1 FROM "zalip_note_context" WHERE "noteId" = $1
			UNION ALL
			SELECT 1 FROM "zalip_episode_note_context" WHERE "noteId" = $1
		) AS bound
	`, [note.id]);
	return row?.bound === true;
}

/**
 * Native threadId already preserves the root of arbitrarily nested replies, including legacy ones.
 * Only quote/renote chains need traversal: one PK lookup per level, capped at 32 with cycle protection.
 * No author rewriting, text matching, full-thread scan or per-timeline-entry context query is needed.
 */
export async function packZalipNoteDiscussions(db: DataSource, noteIds: readonly string[]): Promise<Map<string, PackedZalipNoteDiscussion>> {
	const ids = [...new Set(noteIds)];
	const contexts = new Map<string, PackedZalipNoteDiscussion>();
	for (let offset = 0; offset < ids.length; offset += 100) {
		const rows = await db.query<Array<PackedZalipNoteDiscussion & { noteId: string }>>(`
			WITH RECURSIVE chain AS (
				SELECT n."id" AS "originNoteId", n."id", n."threadId", n."renoteId",
					0 AS depth, ARRAY[n."id"]::varchar[] AS path
				FROM "note" n WHERE n."id" = ANY($1::varchar[])
				UNION ALL
				SELECT c."originNoteId", n."id", n."threadId", n."renoteId",
					c.depth + 1, c.path || n."id"
				FROM chain c JOIN "note" n ON n."id" = c."renoteId"
				WHERE c.depth < 32 AND NOT n."id" = ANY(c.path)
			), roots AS (
				SELECT c."noteId", c."workId", NULL::varchar AS "episodeId",
					NULL::integer AS "episodeNumber", NULL::integer AS "seasonNumber"
				FROM "zalip_note_context" c
				UNION ALL
				SELECT c."noteId", s."workId", e."id", e."episodeNumber", s."seasonNumber"
				FROM "zalip_episode_note_context" c
				JOIN "zalip_episode" e ON e."id" = c."episodeId"
				JOIN "zalip_season" s ON s."id" = e."seasonId"
			)
			SELECT DISTINCT ON (c."originNoteId") c."originNoteId" AS "noteId",
				w."id" AS "workId", w."slug", w."title", w."posterPath",
				r."noteId" AS "rootNoteId", c."originNoteId" = r."noteId" AS "isRoot",
				r."episodeId", r."episodeNumber", r."seasonNumber"
			FROM chain c JOIN roots r ON r."noteId" = COALESCE(c."threadId", c."id")
			JOIN "zalip_work" w ON w."id" = r."workId" AND w."publicationState" = 'published'
			ORDER BY c."originNoteId", c.depth ASC
		`, [ids.slice(offset, offset + 100)]);
		for (const { noteId, ...context } of rows) contexts.set(noteId, context);
	}
	return contexts;
}
