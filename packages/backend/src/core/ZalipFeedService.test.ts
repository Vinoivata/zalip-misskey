/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { EntityNotFoundError } from 'typeorm';
import { ZalipFeedError, ZalipFeedService, decodeZalipFeedCursor, encodeZalipFeedCursor, zalipFeedCandidatesSql } from '@/core/ZalipFeedService.js';
import { ZalipReviewService } from '@/core/ZalipReviewService.js';
import { MiNote } from '@/models/Note.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import ListEndpoint, { meta, paramDef } from '@/server/api/endpoints/zalip/feed/list.js';

type Row = { id: string; kind: 'comment' | 'review' | 'essay'; workId: string; rootNoteId: string | null; episodeId: string | null; episodeNumber: number | null; seasonNumber: number | null };
const me = { id: 'viewer' };
const options = { section: 'discussions' as const };
const row = (id: string, kind: Row['kind'] = 'comment', workId = 'work'): Row => ({ id, kind, workId, rootNoteId: kind === 'comment' ? 'root' : null, episodeId: null, episodeNumber: null, seasonNumber: null });
const compare = (a: Row, b: Pick<Row, 'id' | 'kind'>) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)) || Buffer.compare(Buffer.from(a.kind), Buffer.from(b.kind));

function fixture(initial: Row[]) {
	const state = { rows: initial, removed: new Set<string>(), hidden: new Set<string>(), missing: new Set<string>(), privateWorks: new Set<string>(), cw: new Set<string>(), changedBinding: false };
	const query = vi.fn(async (sql: string, args: unknown[]) => {
		expect(sql).toBe(zalipFeedCandidatesSql);
		const [, hide, section, id, kind, limit, , ids] = args as [string | null, boolean, string, string | null, Row['kind'], number, string[], string[] | null];
		return state.rows.filter(value => !state.removed.has(value.id) && !state.privateWorks.has(value.workId) && (section === 'essays' ? value.kind === 'essay' : value.kind !== 'essay') && (!hide || !state.cw.has(value.id)) && (!ids || ids.includes(value.id)) && (!id || compare(value, { id, kind }) < 0))
			.sort((a, b) => -compare(a, b)).slice(0, limit).map(value => ({ ...value, ...(ids && state.changedBinding ? { rootNoteId: 'differentroot' } : {}) }));
	});
	const native = (id: string) => ({ id, userId: 'realAuthor', text: id === 'root' ? 'TECHNICAL ROOT MUST NOT APPEAR' : `Native comment ${id}`, cw: state.cw.has(id) ? 'Spoiler warning' : null, createdAt: '2026-10-22T00:00:00.000Z', visibility: 'home', isHidden: state.hidden.has(id), zalipDiscussion: { workId: 'work', rootNoteId: 'root', isRoot: id === 'root' } });
	const noteRepository = { find: vi.fn(async () => [...new Set(state.rows.filter(value => value.kind === 'comment').flatMap(value => [value.id, value.rootNoteId!]))].filter(id => !state.missing.has(id)).map(id => ({ id }))) };
	const workRepository = { find: vi.fn(async () => [...new Set(state.rows.map(value => value.workId))].filter(id => !state.privateWorks.has(id)).map(id => ({ id, slug: `title-${id}`, kind: 'movie', title: 'Public title', posterPath: '/local-poster.webp', releaseYear: 2026, importData: { secret: 'PRIVATE IMPORT TOKEN' }, description: 'Not part of the feed projection' }))) };
	const db = { query, getRepository: vi.fn((model: unknown) => model === MiNote ? noteRepository : model === MiZalipWork ? workRepository : undefined) };
	const notes = { packMany: vi.fn(async (values: { id: string }[]) => values.map(value => native(value.id))), pack: vi.fn(async (value: { id: string }) => native(value.id)) };
	const reviews = { feedByIds: vi.fn(async (ids: string[], _viewer: unknown, format: Row['kind']) => state.rows.filter(value => ids.includes(value.id) && value.kind === format && !state.removed.has(value.id)).map(value => ({ id: value.id, workId: value.workId, format: value.kind, body: 'Actual author opinion, not a generated Note.', createdAt: '2026-10-22T00:00:00.000Z', user: { id: 'realAuthor' } }))) };
	const service = new ZalipFeedService(db as never, { blockedHosts: ['blocked.invalid'] } as never, notes as never, reviews as never);
	return { service, state, query, notes, reviews, noteRepository, workRepository };
}

describe('Zalip canonical mixed feed', () => {
	it('mixes genuine comments and reviews but keeps essays in their own section', async () => {
		const f = fixture([row('n03'), row('n02', 'review'), row('n01', 'essay')]);
		const mixed = await f.service.list(me, options);
		expect(mixed.items.map(item => [item.type, item.id, item.key])).toEqual([['comment', 'n03', 'comment:n03'], ['review', 'n02', 'review:n02']]);
		expect((await f.service.list(me, { section: 'essays' })).items.map(item => item.type)).toEqual(['essay']);
		expect(JSON.stringify(mixed)).not.toMatch(/TECHNICAL ROOT|PRIVATE IMPORT TOKEN|Not part of the feed projection/u);
		expect(mixed.items[0]).toMatchObject({ work: { title: 'Public title' }, note: { userId: 'realAuthor' }, discussion: { rootNoteId: 'root', episodeId: null } });
		expect(mixed.items[1]).not.toHaveProperty('note');
		expect(f.notes.packMany).toHaveBeenCalledWith(expect.any(Array), me, { detail: true, withNestedNotes: false });
		expect(f.reviews.feedByIds).toHaveBeenCalledWith(['n02'], me, 'review', true);
	});

	it('uses id+kind C ordering and never skips a colliding native/review ID', async () => {
		const f = fixture([row('n02'), row('n02', 'review'), row('n01')]);
		const first = await f.service.list(me, { ...options, limit: 1 });
		const second = await f.service.list(me, { ...options, limit: 1, cursor: first.nextCursor! });
		const third = await f.service.list(me, { ...options, limit: 1, cursor: second.nextCursor! });
		expect([...first.items, ...second.items, ...third.items].map(item => item.key)).toEqual(['review:n02', 'comment:n02', 'comment:n01']);
		expect(third.nextCursor).toBeNull();
	});

	it('does not reorder or duplicate an edited opinion and ignores newer insertions on older pages', async () => {
		const f = fixture([row('n03'), row('n02', 'review'), row('n01')]);
		const first = await f.service.list(me, { ...options, limit: 1 });
		f.state.rows.push(row('n04', 'review'));
		const next = await f.service.list(me, { ...options, cursor: first.nextCursor!, limit: 20 });
		expect(next.items.map(item => item.id)).toEqual(['n02', 'n01']);
	});

	it('refills after native privacy hides items without exposing hidden/root payloads', async () => {
		const f = fixture(Array.from({ length: 25 }, (_, index) => row(`n${String(index).padStart(3, '0')}`)));
		for (let index = 5; index < 25; index++) f.state.hidden.add(`n${String(index).padStart(3, '0')}`);
		const page = await f.service.list(me, { ...options, limit: 2 });
		expect(page.items.map(item => item.id)).toEqual(['n004', 'n003']);
		expect(f.query.mock.calls.filter(([, args]) => args[7] === null)).toHaveLength(2);
	});

	it.each([10, 11])('caps raw scanning at 200 for limit %i, including an all-hidden page, and supplies forward progress', async limit => {
		const f = fixture(Array.from({ length: 240 }, (_, index) => row(`n${String(index).padStart(3, '0')}`)));
		for (const value of f.state.rows) f.state.hidden.add(value.id);
		const first = await f.service.list(me, { ...options, limit });
		expect(first.items).toEqual([]);
		expect(decodeZalipFeedCursor(first.nextCursor!, 'discussions', me, true)).toEqual({ id: 'n040', kind: 'comment' });
		expect(f.query.mock.calls.filter(([, args]) => args[7] === null)).toHaveLength(10);
		f.state.hidden.clear();
		expect((await f.service.list(me, { ...options, cursor: first.nextCursor! })).items[0].id).toBe('n039');
	});

	it('continues past a mixed partial request at the 200-candidate cap', async () => {
		const f = fixture(Array.from({ length: 240 }, (_, index) => row(`n${String(index).padStart(3, '0')}`)));
		for (let index = 42; index < 240; index++) f.state.hidden.add(`n${String(index).padStart(3, '0')}`);
		const first = await f.service.list(me, { ...options, limit: 11 });
		expect(first.items.map(item => item.id)).toEqual(['n041', 'n040']);
		expect(first.nextCursor).not.toBeNull();
		const scans = f.query.mock.calls.filter(([, args]) => args[7] === null);
		expect(scans.at(-1)?.[1][5]).toBe(2);
		expect(scans.reduce((sum, [, args]) => sum + Number(args[5]), 0)).toBe(200);
		expect((await f.service.list(me, { ...options, limit: 11, cursor: first.nextCursor! })).items[0].id).toBe('n039');
	});

	it('excludes native-hidden technical roots, missing roots and newly unpublished works', async () => {
		for (const mode of ['hidden', 'missing', 'work'] as const) {
			const f = fixture([row('n03')]);
			if (mode === 'work') f.state.privateWorks.add('work');
			else f.state[mode].add('root');
			expect((await f.service.list(me, options)).items).toEqual([]);
		}
	});

	it('rechecks removals, title publication and canonical binding after native packing', async () => {
		for (const mode of ['removed', 'privateWork', 'binding'] as const) {
			const f = fixture([row('n03')]);
			f.notes.packMany.mockImplementationOnce(async values => {
				if (mode === 'removed') f.state.removed.add('n03');
				if (mode === 'privateWork') f.state.privateWorks.add('work');
				if (mode === 'binding') f.state.changedBinding = true;
				return values.map(value => ({ id: value.id, visibility: 'home', cw: null, isHidden: false } as never));
			});
			expect((await f.service.list(me, options)).items).toEqual([]);
		}
	});

	it('keeps surviving replies when an intermediate parent is removed', async () => {
		const f = fixture([{ ...row('n03'), episodeId: 'episode', episodeNumber: 4, seasonNumber: 2 }]);
		const page = await f.service.list(me, options);
		expect(page.items[0]).toMatchObject({ discussion: { rootNoteId: 'root', episodeId: 'episode', episodeNumber: 4, seasonNumber: 2 } });
		expect(zalipFeedCandidatesSql).toContain('n."threadId" = root."id"');
		expect(zalipFeedCandidatesSql).not.toMatch(/JOIN "note" (?:parent|reply) /u);
	});

	it('tolerates a deletion during bulk packing but does not swallow unexpected failures', async () => {
		const f = fixture([row('n03')]);
		f.notes.packMany.mockRejectedValueOnce(new EntityNotFoundError(MiNote, 'deleted'));
		expect((await f.service.list(me, options)).items).toHaveLength(1);
		f.notes.packMany.mockRejectedValueOnce(new Error('database unavailable'));
		await expect(f.service.list(me, options)).rejects.toThrow('database unavailable');
	});

	it('filters CW by default and only returns its native warning when explicitly enabled', async () => {
		const f = fixture([row('n03')]); f.state.cw.add('n03');
		expect((await f.service.list(me, options)).items).toEqual([]);
		expect((await f.service.list(me, { ...options, hideSpoilers: false })).items[0]).toMatchObject({ note: { cw: 'Spoiler warning' } });
	});

	it('pins all query boundaries and privacy checks without user-interpolated SQL', async () => {
		const f = fixture([row('n01')]); await f.service.list(me, options);
		expect(f.query.mock.calls[0][1]).toEqual(['viewer', true, 'discussions', null, null, 20, ['blocked.invalid', '%.blocked.invalid'], null]);
		for (const marker of ['"publicationState" = \'published\'', 'n."visibility" IN (\'public\', \'home\')', 'root."visibility" IN (\'public\', \'home\')', '"isDeleted"', '"isSuspended"', '"requireSigninToViewContents"', '"blocking"', 'b."blockerId" = $1', 'b."blockeeId" = $1', '"muting"', '"expiresAt" > now()', '"note_thread_muting"', '"channel_muting"', '"mutedInstances"', 'ILIKE ANY($7::text[])', 'r."deletedAt" IS NULL', '"zalip_episode_note_context"', 'COLLATE "C"']) expect(zalipFeedCandidatesSql).toContain(marker);
		expect(zalipFeedCandidatesSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE TABLE)\b/u);
		expect(zalipFeedCandidatesSql).not.toContain('"zalip_library_entry"');
	});
});

describe('cursor and REST boundary', () => {
	it('binds canonical cursors to viewer, section and spoiler filter', () => {
		const cursor = encodeZalipFeedCursor({ id: 'note1', kind: 'comment' }, 'discussions', me, true);
		expect(decodeZalipFeedCursor(cursor, 'discussions', me, true)).toEqual({ id: 'note1', kind: 'comment' });
		for (const [section, viewer, hide] of [['essays', me, true], ['discussions', null, true], ['discussions', { id: 'other' }, true], ['discussions', me, false]] as const) expect(() => decodeZalipFeedCursor(cursor, section, viewer, hide)).toThrow('INVALID_ZALIP_FEED_CURSOR');
		for (const value of ['!', `${cursor}=`, 'x'.repeat(1025), Buffer.from('[]').toString('base64url'), encodeZalipFeedCursor({ id: '../secret', kind: 'comment' }, 'discussions', me, true)]) expect(() => decodeZalipFeedCursor(value, 'discussions', me, true)).toThrow('INVALID_ZALIP_FEED_CURSOR');
	});

	it('accepts public reads with strict input bounds and scoped defaults', async () => {
		const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null }); const endpoint = new ListEndpoint({ list } as never);
		await endpoint.exec({}, null, null);
		expect(list).toHaveBeenCalledWith(null, { section: 'discussions', limit: 10, hideSpoilers: true });
		for (const input of [{ limit: 21 }, { limit: 0 }, { section: 'everything' }, { cursor: '' }, { userId: 'other' }, { hideSpoilers: 'false' }]) await expect(endpoint.exec(input, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(meta.requireCredential).toBe(false); expect(meta.limit.max).toBeLessThanOrEqual(60); expect(paramDef.additionalProperties).toBe(false);
	});

	it('maps only declared domain failures and preserves unexpected server errors', async () => {
		const list = vi.fn().mockRejectedValue(new ZalipFeedError('INVALID_ZALIP_FEED_CURSOR')); const endpoint = new ListEndpoint({ list } as never);
		await expect(endpoint.exec({}, null, null)).rejects.toMatchObject({ code: 'INVALID_ZALIP_FEED_CURSOR' });
		list.mockRejectedValueOnce(new Error('unexpected'));
		await expect(endpoint.exec({}, null, null)).rejects.toThrow('unexpected');
	});

	it('registers the endpoint, CoreModule provider/export and typed non-Note review schema', async () => {
		const [endpoints, module] = await Promise.all([readFile(new URL('../server/api/endpoint-list.ts', import.meta.url), 'utf8'), readFile(new URL('./CoreModule.ts', import.meta.url), 'utf8')]);
		expect(endpoints).toContain("export * as 'zalip/feed/list' from './endpoints/zalip/feed/list.js'");
		expect(module.match(/\t\tZalipFeedService,/gu)).toHaveLength(2);
		expect(meta.res.properties.items.items.anyOf.map(item => item.properties.type.enum)).toEqual([['comment'], ['review', 'essay']]);
	});

	it('reuses the existing private-safe review projection and canonical public user packer', async () => {
		const query = vi.fn().mockResolvedValue([{ id: 'review1', workId: 'work', userId: 'realAuthor', format: 'essay', title: 'Title', body: 'Actual opinion', isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 0, unhelpfulCount: 0, myVote: null, createdAt: new Date(), updatedAt: new Date() }]);
		const packMany = vi.fn().mockResolvedValue([{ id: 'realAuthor', avatarUrl: '/avatar.webp' }]);
		const service = new ZalipReviewService({ query } as never, {} as never, { packMany } as never, { isModerator: async () => false } as never);
		expect(await service.feedByIds(['review1'], me, 'essay', true)).toMatchObject([{ id: 'review1', user: { id: 'realAuthor' }, format: 'essay' }]);
		expect(query.mock.calls[0][1]).toEqual([['review1'], 'viewer', 'essay', true]);
		for (const marker of ['r."deletedAt" IS NULL', '"publicationState" = \'published\'', 'r."isSpoiler" = false', '"requireSigninToViewContents"', '"blocking"', '"muting"']) expect(query.mock.calls[0][0]).toContain(marker);
		expect(packMany).toHaveBeenCalledWith(['realAuthor'], me, { schema: 'UserLite', includeSecrets: false });
	});
});
