/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { packedNoteSchema } from '@/models/json-schema/note.js';
import { MiZalipSharedNote } from '@/models/ZalipSharedNote.js';
import type { MiNote } from '@/models/Note.js';
import { isBoundZalipDiscussionRoot, packZalipNoteDiscussions, type PackedZalipNoteDiscussion } from './zalip-note-discussion.js';

const discussion: PackedZalipNoteDiscussion = {
	workId: 'work01', slug: 'example', title: 'Example', posterPath: '/files/poster.webp',
	rootNoteId: 'root01', isRoot: false, episodeId: null, episodeNumber: null, seasonNumber: null,
};

describe('canonical content discussion context', () => {
	it('does not query for ordinary replies or identify a root by its author or text', async () => {
		const db = { query: vi.fn() };
		await expect(isBoundZalipDiscussionRoot(db as never, { id: 'admin-note', name: null })).resolves.toBe(false);
		await expect(isBoundZalipDiscussionRoot(db as never, null)).resolves.toBe(false);
		expect(db.query).not.toHaveBeenCalled();
	});
	it.each([true, false])('requires a real work or episode binding even for a technical marker: %s', async bound => {
		const db = { query: vi.fn().mockResolvedValue([{ bound }]) };
		await expect(isBoundZalipDiscussionRoot(db as never, { id: 'root01', name: 'zalip:discussion-root' })).resolves.toBe(bound);
		expect(db.query).toHaveBeenCalledWith(expect.stringContaining('"zalip_episode_note_context"'), ['root01']);
	});
	it('does not query an empty context batch', async () => {
		const db = { query: vi.fn() };
		expect(await packZalipNoteDiscussions(db as never, [])).toEqual(new Map());
		expect(db.query).not.toHaveBeenCalled();
	});
	it('batches 100 unique indexed note IDs and only projects public title facts', async () => {
		const query = vi.fn(async (_sql: string, [ids]: [string[]]) => ids.map(noteId => ({ noteId, ...discussion })));
		const ids = Array.from({ length: 205 }, (_, index) => `note${index}`);
		const result = await packZalipNoteDiscussions({ query } as never, [...ids, ...ids.slice(0, 10)]);
		expect(query).toHaveBeenCalledTimes(3);
		expect(query.mock.calls.map(([, [batch]]) => batch.length)).toEqual([100, 100, 5]);
		expect(result.size).toBe(205);
		expect(result.get('note0')).toEqual(discussion);
		const sql = query.mock.calls[0][0];
		expect(sql).toContain('COALESCE(c."threadId", c."id")');
		expect(sql).toContain('c.depth < 32 AND NOT n."id" = ANY(c.path)');
		expect(sql).toContain('w."publicationState" = \'published\'');
		expect(sql).not.toContain('createdById');
	});
	it('passes the same context hint through roots, nested reply and repost packing', async () => {
		const query = vi.fn().mockResolvedValue([
			{ noteId: 'root01', ...discussion, isRoot: true },
			{ noteId: 'nested01', ...discussion },
			{ noteId: 'repost01', ...discussion },
		]);
		const db = { query, getRepository: (model: unknown) => ({ find: vi.fn().mockResolvedValue(model === MiZalipSharedNote ? [] : []) }) };
		const service = new NoteEntityService({} as never, db as never, { enableReactionsBuffering: false } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
		Object.assign(service, { customEmojiService: { prefetchEmojis: vi.fn(async () => undefined) }, userEntityService: { packMany: vi.fn(async () => []) } });
		vi.spyOn(service, 'aggregateNoteEmojis').mockReturnValue([]);
		const pack = vi.spyOn(service, 'pack').mockResolvedValue({} as never);
		const base = { fileIds: [], userId: 'real-comment-author', replyUserId: null, renoteUserId: null };
		await service.packMany([
			{ ...base, id: 'nested01', replyId: 'parent01', threadId: 'root01', renoteId: null },
			{ ...base, id: 'repost01', replyId: null, renoteId: 'nested01' },
		] as unknown as MiNote[]);
		expect(query).toHaveBeenCalledOnce();
		const contexts = pack.mock.calls[0][2]?._hint_?.zalipDiscussions;
		expect(contexts?.get('nested01')).toEqual(discussion);
		expect(contexts?.get('root01')?.isRoot).toBe(true);
		expect(contexts?.get('repost01')).toEqual(discussion);
		expect(pack.mock.calls[1][2]?._hint_?.zalipDiscussions).toBe(contexts);
	});
	it('does not expose the context of a note hidden by native visibility checks', () => {
		const packed = { visibleUserIds: [], fileIds: [], files: [], text: 'Private comment', cw: null, zalipDiscussion: discussion };
		NoteEntityService.prototype.hideNote(packed as never);
		expect(packed.zalipDiscussion).toBeUndefined();
		expect(packedNoteSchema.properties.zalipDiscussion).toMatchObject({ optional: true, nullable: false, properties: {
			workId: { optional: false, nullable: false }, isRoot: { type: 'boolean' },
			episodeId: { optional: false, nullable: true },
		} });
	});
	it.each([
		['root01', 'legacy-admin', true, false],
		['nested01', 'real-comment-author', false, false],
		['repost01', 'real-reposter', false, false],
		['private01', 'private-author', false, true],
	] as const)('native packing preserves the true author and visibility for %s', async (id, userId, isRoot, requiresSignin) => {
		const db = { query: vi.fn() };
		const service = new NoteEntityService({} as never, db as never, { enableReactionsBuffering: false } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
		Object.assign(service, {
			idService: { parse: () => ({ date: new Date('2026-10-19T00:00:00Z') }) },
			reactionService: { convertLegacyReactions: (reactions: unknown) => reactions },
			reactionsBufferingService: { mergeReactions: () => ({}) },
			customEmojiService: { populateEmojis: () => ({}) },
		});
		const note = { id, userId, name: isRoot ? 'zalip:discussion-root' : null, text: 'Actual note', cw: null, visibility: 'home', localOnly: true,
			userHost: null, reactions: {}, reactionAndUserPairCache: [], fileIds: [], tags: [], mentions: [], emojis: [], channelId: null,
		} as unknown as MiNote;
		const packed = await service.pack(note, null, { detail: false, _hint_: {
			bufferedReactions: null, myReactions: new Map(), packedFiles: new Map(),
			packedUsers: new Map([[userId, { id: userId, requireSigninToViewContents: requiresSignin } as never]]),
			zalipShares: new Map(), zalipViewCounts: new Map(), zalipDiscussions: new Map([[id, { ...discussion, isRoot }]]),
		} });
		expect(packed.userId).toBe(userId);
		expect(packed.user.id).toBe(userId);
		expect(packed.zalipDiscussion).toEqual(requiresSignin ? undefined : { ...discussion, isRoot });
		expect(db.query).not.toHaveBeenCalled();
	});
});
