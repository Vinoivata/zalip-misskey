/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { packZalipNoteViewCounts, zalipNoteViewCount } from './zalip-note-view-counts.js';
import { packedNoteSchema } from '@/models/json-schema/note.js';
import { MiZalipSharedNote } from '@/models/ZalipSharedNote.js';
import type { MiNote } from '@/models/Note.js';

describe('batched public Zalip note-view counts', () => {
	it.each([null, undefined, false, {}, [], NaN, Infinity, -1, 1.5, '9007199254740992', '-1', 'bad'])('rejects an unsafe count %s', value => expect(zalipNoteViewCount(value)).toBe(0));
	it.each([[0, 0], ['17', 17], ['9007199254740991', Number.MAX_SAFE_INTEGER]])('projects bounded count %s', (input, expected) => expect(zalipNoteViewCount(input)).toBe(expected));
	it('does not query for an empty batch', async () => {
		const db = { getRepository: vi.fn() };
		expect(await packZalipNoteViewCounts(db as never, [])).toEqual(new Map());
		expect(db.getRepository).not.toHaveBeenCalled();
	});
	it('deduplicates root/reply/renote IDs and uses at most 100 indexed keys in a finite batch', async () => {
		const find = vi.fn(async (options: { where: { noteId: { value: string[] } } }) => options.where.noteId.value.map(noteId => ({ noteId, count: '42' })));
		const db = { getRepository: () => ({ find }) };
		const ids = Array.from({ length: 205 }, (_, index) => `note${index}`);
		const result = await packZalipNoteViewCounts(db as never, [...ids, ...ids.slice(0, 10)]);
		expect(find).toHaveBeenCalledTimes(3);
		expect(find.mock.calls.map(([options]) => options.where.noteId.value.length)).toEqual([100, 100, 5]);
		expect(result.size).toBe(205); expect(result.get('note0')).toBe(42);
	});
	it('removes the optional count when native packing hides a private note', () => {
		const packed = { visibleUserIds: ['viewer'], fileIds: ['file'], files: [], text: 'Private', poll: undefined, cw: 'Warning', zalipViewCount: 29 };
		NoteEntityService.prototype.hideNote(packed as never);
		expect(packed.zalipViewCount).toBeUndefined(); expect(packed.text).toBeNull();
		expect(packedNoteSchema.properties.zalipViewCount).toMatchObject({ optional: true, nullable: false, minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
	});
	it('passes one batched hint through native timeline packing including unloaded reply/renote identities', async () => {
		const findCounts = vi.fn(async () => [{ noteId: 'note01', count: '8' }, { noteId: 'parent01', count: '4' }, { noteId: 'quoted01', count: '2' }]);
		const db = { query: vi.fn().mockResolvedValue([]), getRepository: (entity: unknown) => ({ find: entity === MiZalipSharedNote ? vi.fn(async () => []) : findCounts }) };
		const service = new NoteEntityService({} as never, db as never, { enableReactionsBuffering: false } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
		Object.assign(service, { customEmojiService: { prefetchEmojis: vi.fn(async () => undefined) }, userEntityService: { packMany: vi.fn(async () => []) } });
		vi.spyOn(service, 'aggregateNoteEmojis').mockReturnValue([]);
		const pack = vi.spyOn(service, 'pack').mockResolvedValue({} as never);
		const note = { id: 'note01', replyId: 'parent01', renoteId: 'quoted01', fileIds: [], userId: 'author', replyUserId: null, renoteUserId: null } as unknown as MiNote;
		await service.packMany([note, { ...note, id: 'note02' }]);
		expect(findCounts).toHaveBeenCalledTimes(1); expect(pack).toHaveBeenCalledTimes(2);
		const firstHint = pack.mock.calls[0][2]?._hint_?.zalipViewCounts;
		expect(firstHint).toEqual(new Map([['note01', 8], ['parent01', 4], ['quoted01', 2], ['note02', 0]]));
		expect(pack.mock.calls[1][2]?._hint_?.zalipViewCounts).toBe(firstHint);
	});
});
