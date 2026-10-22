/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { MiNote } from '@/models/Note.js';

function note(id: string, changes: Partial<MiNote> = {}): MiNote {
	return Object.assign(new MiNote({}), {
		id, userId: 'author', userHost: null, text: 'Public child comment.', name: null, cw: null,
		visibility: 'home', localOnly: true, replyId: null, renoteId: null, reply: null, renote: null,
		fileIds: [], tags: [], emojis: [], mentions: [], visibleUserIds: [], channelId: null,
		reactions: { '👍': 1 }, reactionAndUserPairCache: ['viewer/👍'], reactionAcceptance: null,
		clippedCount: 0, repliesCount: 0, renoteCount: 0, hasPoll: true, uri: null, url: null,
		...changes,
	});
}

function fixture() {
	const user = (id: string) => ({ id, username: id, requireSigninToViewContents: false, makeNotesHiddenBefore: null, makeNotesFollowersOnlyBefore: null });
	const notesRepository = { findOneByOrFail: vi.fn(() => { throw new Error('Unexpected nested note lookup'); }) };
	const polls = { findOneByOrFail: vi.fn().mockResolvedValue({ choices: ['Yes', 'No'], votes: [1, 0], multiple: false, expiresAt: null }) };
	const pollVotes = { findOneBy: vi.fn().mockResolvedValue({ choice: 0 }) };
	const services: Record<string, unknown> = {
		UserEntityService: { pack: vi.fn(async (value: string | { id: string }) => user(typeof value === 'string' ? value : value.id)), packMany: vi.fn(async (ids: (string | { id: string })[]) => ids.map(value => user(typeof value === 'string' ? value : value.id))) },
		DriveFileEntityService: { packManyByIds: vi.fn().mockResolvedValue([]), packManyByIdsMap: vi.fn().mockResolvedValue(new Map()) },
		CustomEmojiService: { populateEmojis: vi.fn().mockReturnValue({}), prefetchEmojis: vi.fn(), parseEmojiStr: vi.fn() },
		ReactionService: { convertLegacyReaction: (value: string) => value, convertLegacyReactions: (value: object) => value, decodeReaction: (value: string) => ({ reaction: value, name: null, host: null }) },
		ReactionsBufferingService: { mergeReactions: (value: object) => value },
		IdService: { parse: () => ({ date: new Date('2026-10-22T00:00:00Z') }), gen: () => 'zzzzzz' },
		CacheService: { userFollowingsCache: { fetch: vi.fn().mockResolvedValue({}) } },
	};
	const db = { getRepository: () => ({ find: vi.fn().mockResolvedValue([]) }), query: vi.fn().mockResolvedValue([]) };
	const service = new NoteEntityService({ get: (name: string) => services[name] } as never, db as never, { enableReactionsBuffering: false } as never,
		{} as never, notesRepository as never, {} as never, polls as never, pollVotes as never, { findBy: vi.fn().mockResolvedValue([]) } as never, {} as never);
	service.onModuleInit();
	const parent = note('privateParent', { hasPoll: false, reactions: {}, reactionAndUserPairCache: [], visibility: 'specified', visibleUserIds: ['other'], text: 'PRIVATE PARENT BODY' });
	const quote = note('privateQuote', { hasPoll: false, reactions: {}, reactionAndUserPairCache: [], visibility: 'specified', visibleUserIds: ['other'], text: 'PRIVATE QUOTE BODY' });
	const child = note('feednote', { replyId: parent.id, reply: parent, renoteId: quote.id, renote: quote });
	return { service, notesRepository, polls, pollVotes, child, parent, quote };
}

describe('native detailed packing without nested Notes', () => {
	it('retains native own reaction and poll choices without returning private parent/quote payloads', async () => {
		const f = fixture();
		const packed = await f.service.pack(f.child, { id: 'viewer' }, { detail: true, withNestedNotes: false });
		expect(packed).toMatchObject({ id: 'feednote', replyId: 'privateParent', renoteId: 'privateQuote', myReaction: '👍', poll: { choices: [{ text: 'Yes', votes: 1, isVoted: true }, { text: 'No', votes: 0, isVoted: false }] } });
		expect(packed.reply).toBeUndefined(); expect(packed.renote).toBeUndefined();
		expect(JSON.stringify(packed)).not.toContain('PRIVATE');
		expect(f.notesRepository.findOneByOrFail).not.toHaveBeenCalled();
	});

	it('forwards the option through bulk packing and preserves native reaction/poll handling', async () => {
		const f = fixture();
		const [packed] = await f.service.packMany([f.child], { id: 'viewer' }, { detail: true, withNestedNotes: false });
		expect(packed.myReaction).toBe('👍'); expect(packed.poll?.choices[0].isVoted).toBe(true);
		expect(packed.reply).toBeUndefined(); expect(packed.renote).toBeUndefined();
		expect(JSON.stringify(packed)).not.toContain('PRIVATE');
		expect(f.polls.findOneByOrFail).toHaveBeenCalledOnce();
	});

	it('does not even inspect preloaded nested text when the option is disabled', async () => {
		const f = fixture();
		for (const nested of [f.parent, f.quote]) Object.defineProperty(nested, 'text', { get() { throw new Error('Nested body was read'); } });
		await expect(f.service.pack(f.child, { id: 'viewer' }, { detail: true, withNestedNotes: false })).resolves.toMatchObject({ id: 'feednote', myReaction: '👍' });
	});

	it('keeps default detailed packing unchanged for all existing callers', async () => {
		const f = fixture(); f.parent.visibility = 'home'; f.quote.visibility = 'home';
		const packed = await f.service.pack(f.child, { id: 'viewer' });
		expect(packed.reply?.text).toBe('PRIVATE PARENT BODY'); expect(packed.renote?.text).toBe('PRIVATE QUOTE BODY');
		expect(packed.myReaction).toBe('👍'); expect(packed.poll?.choices).toHaveLength(2);
		expect((await f.service.pack(f.child, { id: 'viewer' }, { withNestedNotes: undefined })).reply?.text).toBe('PRIVATE PARENT BODY');
	});

	it('does not change legacy detail:false or override native hiding', async () => {
		const f = fixture();
		const brief = await f.service.pack(f.child, { id: 'viewer' }, { detail: false });
		expect(brief.myReaction).toBeUndefined(); expect(brief.poll).toBeUndefined();
		const hidden = await f.service.pack(note('hidden', { visibility: 'specified', visibleUserIds: ['other'], text: 'PRIVATE CHILD BODY' }), { id: 'viewer' }, { detail: true, withNestedNotes: false });
		expect(hidden).toMatchObject({ isHidden: true, text: null, files: [] }); expect(hidden.poll).toBeUndefined();
	});
});
