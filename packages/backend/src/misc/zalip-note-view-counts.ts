/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { In } from 'typeorm';
import type { DataSource } from 'typeorm';
import { MiZalipNoteViewStat } from '@/models/ZalipNoteViewStat.js';

export function zalipNoteViewCount(value: unknown): number {
	if (typeof value !== 'string' && typeof value !== 'number') return 0;
	const count = Number(value);
	return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/** Indexed, finite batches; no query for each timeline entry or nested preview. */
export async function packZalipNoteViewCounts(db: DataSource, noteIds: readonly string[]): Promise<Map<string, number>> {
	const ids = [...new Set(noteIds)];
	const counts = new Map<string, number>(ids.map(id => [id, 0]));
	for (let offset = 0; offset < ids.length; offset += 100) {
		const rows = await db.getRepository(MiZalipNoteViewStat).find({
			where: { noteId: In(ids.slice(offset, offset + 100)) },
			select: { noteId: true, count: true },
		});
		for (const row of rows) counts.set(row.noteId, zalipNoteViewCount(row.count));
	}
	return counts;
}
