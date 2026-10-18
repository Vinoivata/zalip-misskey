/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Redis } from 'ioredis';
import { DI } from '@/di-symbols.js';
import type { NotesRepository } from '@/models/_.js';
import type { MiUser } from '@/models/User.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { QueryService } from '@/core/QueryService.js';
import { isQuote, isRenote } from '@/misc/is-renote.js';
import { zalipDiscussionRootMarker } from '@/misc/zalip-discussion-root.js';
import { zalipNoteViewCount } from '@/misc/zalip-note-view-counts.js';

export const zalipNoteViewClaimSeconds = 60;
export const zalipNoteViewDedupSeconds = 24 * 60 * 60;
export const zalipNoteViewReleaseScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
export const zalipNoteViewConfirmScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('EXPIRE', KEYS[1], ARGV[2]) end return 0`;
export const zalipNoteViewIncrementSql = `INSERT INTO "zalip_note_view_stat" ("noteId", "count") SELECT "id", 1 FROM "note" WHERE "id" = $1 ON CONFLICT ("noteId") DO UPDATE SET "count" = LEAST("zalip_note_view_stat"."count" + 1, 9007199254740991) RETURNING "count"`;

export class ZalipNoteViewUnavailableError extends Error {
	constructor() { super('NO_SUCH_NOTE'); }
}

export function zalipNoteViewDedupKey(viewerId: string, noteId: string): string {
	return `zalip:note-view:v1:${createHash('sha256').update(JSON.stringify([viewerId, noteId])).digest('hex')}`;
}

@Injectable()
export class ZalipNoteViewService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redis: Redis,
		@Inject(DI.notesRepository) private notes: NotesRepository,
		private queryService: QueryService,
		private noteEntityService: NoteEntityService,
	) {}

	/** UI dwell is a client signal, not proof of a unique human. No anonymous tracking. */
	public async record(me: Pick<MiUser, 'id'>, noteId: string): Promise<{ counted: boolean; viewCount: number }> {
		const query = this.notes.createQueryBuilder('note')
			.where('note.id = :noteId', { noteId })
			.innerJoinAndSelect('note.user', 'user')
			.leftJoinAndSelect('note.reply', 'reply')
			.leftJoinAndSelect('note.renote', 'renote')
			.leftJoinAndSelect('reply.user', 'replyUser')
			.leftJoinAndSelect('renote.user', 'renoteUser');
		this.queryService.generateVisibilityQuery(query, me);
		this.queryService.generateBaseNoteFilteringQuery(query, me);
		// Native timeline filters blocked-by; recording also excludes users I blocked.
		query.andWhere('NOT EXISTS (SELECT 1 FROM "blocking" view_block WHERE view_block."blockerId" = :viewerId AND view_block."blockeeId" = note."userId")', { viewerId: me.id });
		const note = await query.getOne();
		if (note == null) throw new ZalipNoteViewUnavailableError();
		const packed = await this.noteEntityService.pack(note, me);
		if (packed.isHidden || packed.deletedAt != null) throw new ZalipNoteViewUnavailableError();
		const current = zalipNoteViewCount(packed.zalipViewCount);
		if (note.userId === me.id || note.name === zalipDiscussionRootMarker || (isRenote(note) && !isQuote(note))) {
			return { counted: false, viewCount: current };
		}

		const key = zalipNoteViewDedupKey(me.id, note.id);
		const token = randomUUID();
		// A failed DB write must not reserve the full 24-hour window.
		const claimed = await this.redis.set(key, token, 'EX', zalipNoteViewClaimSeconds, 'NX');
		if (claimed !== 'OK') return { counted: false, viewCount: current };
		let rows: { count: string }[];
		try {
			rows = await this.db.query<{ count: string }[]>(zalipNoteViewIncrementSql, [note.id]);
			if (rows.length !== 1) throw new ZalipNoteViewUnavailableError();
		} catch (error) {
			await this.redis.eval(zalipNoteViewReleaseScript, 1, key, token).catch(() => undefined);
			if (error != null && typeof error === 'object' && 'code' in error && error.code === '23503') throw new ZalipNoteViewUnavailableError();
			throw error;
		}
		// PG owns the durable total. Redis loss may weaken dedup, never undo a saved view.
		await this.redis.eval(zalipNoteViewConfirmScript, 1, key, token, String(zalipNoteViewDedupSeconds)).catch(() => undefined);
		return { counted: true, viewCount: zalipNoteViewCount(rows[0].count) };
	}
}
