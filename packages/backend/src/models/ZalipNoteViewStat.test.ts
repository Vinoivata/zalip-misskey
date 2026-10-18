/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { MiZalipNoteViewStat } from './ZalipNoteViewStat.js';

type Runner = { query: (sql: string) => Promise<unknown> };
type Migration = { name: string; up: (runner: Runner) => Promise<void>; down: (runner: Runner) => Promise<void> };
const migrationUrl = new URL('../../migration/1792344215050-ZalipNoteViews.js', import.meta.url);
const { ZalipNoteViews1792344215050 } = await import(migrationUrl.href) as { ZalipNoteViews1792344215050: new () => Migration };

describe('durable aggregate note-view schema', () => {
	it('stores only a unique note ID and bounded aggregate, never viewer identities/history', () => {
		const metadata = getMetadataArgsStorage();
		const columns = metadata.columns.filter(column => column.target === MiZalipNoteViewStat);
		expect(columns.map(column => column.propertyName).sort()).toEqual(['count', 'noteId']);
		expect(columns.find(column => column.propertyName === 'noteId')?.options).toMatchObject({ primary: true, length: 32, primaryKeyConstraintName: 'PK_zalip_note_view_stat' });
		expect(columns.find(column => column.propertyName === 'count')?.options).toMatchObject({ type: 'bigint', default: 0 });
		expect(metadata.checks.find(check => check.target === MiZalipNoteViewStat)?.expression).toBe('"count" >= 0 AND "count" <= 9007199254740991');
		expect(metadata.relations.find(relation => relation.target === MiZalipNoteViewStat)?.options).toMatchObject({ onDelete: 'CASCADE' });
	});
	it('up adds only the aggregate table and note FK without modifying any native rows', async () => {
		const migration = new ZalipNoteViews1792344215050(); const query = vi.fn(async (_sql: string) => undefined);
		await migration.up({ query });
		expect(migration.name).toBe('ZalipNoteViews1792344215050'); expect(query).toHaveBeenCalledTimes(2);
		expect(query.mock.calls[0][0]).toContain('CREATE TABLE "zalip_note_view_stat"');
		expect(query.mock.calls[0][0]).toContain('PRIMARY KEY ("noteId")');
		expect(query.mock.calls[1][0]).toContain('REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION');
		for (const [sql] of query.mock.calls) expect(sql).not.toMatch(/^(?:UPDATE|INSERT|DELETE FROM|TRUNCATE|DROP TABLE|DROP COLUMN)\b/u);
	});
	it('down removes only the new aggregate and leaves native notes intact', async () => {
		const query = vi.fn(async (_sql: string) => undefined);
		await new ZalipNoteViews1792344215050().down({ query });
		expect(query).toHaveBeenCalledExactlyOnceWith('DROP TABLE "zalip_note_view_stat"');
	});
});
