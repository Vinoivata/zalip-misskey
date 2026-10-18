/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipNoteViewService, ZalipNoteViewUnavailableError, zalipNoteViewClaimSeconds, zalipNoteViewConfirmScript, zalipNoteViewDedupKey, zalipNoteViewDedupSeconds, zalipNoteViewIncrementSql, zalipNoteViewReleaseScript } from './ZalipNoteViewService.js';
import type { MiNote } from '@/models/Note.js';
import { zalipDiscussionRootMarker } from '@/misc/zalip-discussion-root.js';

function harness() {
	let count = 0;
	let exists = true;
	const note = { id: 'note01', userId: 'author01', name: null, text: 'Visible post', cw: null, replyId: null, renoteId: null, fileIds: [], hasPoll: false } as unknown as MiNote;
	const keys = new Map<string, string>();
	const query = { where: vi.fn().mockReturnThis(), andWhere: vi.fn().mockReturnThis(), innerJoinAndSelect: vi.fn().mockReturnThis(), leftJoinAndSelect: vi.fn().mockReturnThis(), getOne: vi.fn(async () => exists ? note : null) };
	const db = { query: vi.fn(async (_sql: string, _parameters: unknown[]) => [{ count: String(++count) }]) };
	const redis = {
		set: vi.fn(async (key: string, token: string, _expiry: string, _seconds: number, _nx: string) => {
			if (keys.has(key)) return null;
			keys.set(key, token);
			return 'OK';
		}),
		eval: vi.fn(async (script: string, _count: number, key: string, token: string, _seconds?: string) => {
			if (keys.get(key) !== token) return 0;
			if (script === zalipNoteViewReleaseScript) keys.delete(key);
			return 1;
		}),
	};
	const queryService = { generateVisibilityQuery: vi.fn(), generateBaseNoteFilteringQuery: vi.fn() };
	const entity = { pack: vi.fn(async () => ({ id: note.id, zalipViewCount: count, isHidden: false, deletedAt: null as string | null })) };
	const createService = () => new ZalipNoteViewService(db as never, redis as never, { createQueryBuilder: () => query } as never, queryService as never, entity as never);
	const service = createService();
	return { service, createService, note, keys, db, redis, queryService, entity, query, absent: () => { exists = false; }, count: () => count };
}

describe('Zalip private-safe aggregate note views', () => {
	it('counts once across concurrent instances for the same authenticated viewer and note', async () => {
		const h = harness();
		const second = h.createService();
		const results = await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? second : h.service).record({ id: 'viewer01' }, 'note01')));
		expect(results.filter(result => result.counted)).toHaveLength(1);
		expect(h.count()).toBe(1);
		expect(h.db.query).toHaveBeenCalledExactlyOnceWith(zalipNoteViewIncrementSql, ['note01']);
		expect(h.redis.set).toHaveBeenCalledWith(zalipNoteViewDedupKey('viewer01', 'note01'), expect.any(String), 'EX', zalipNoteViewClaimSeconds, 'NX');
		expect(h.redis.eval).toHaveBeenCalledExactlyOnceWith(zalipNoteViewConfirmScript, 1, zalipNoteViewDedupKey('viewer01', 'note01'), expect.any(String), String(zalipNoteViewDedupSeconds));
	});

	it('counts independent viewers atomically while persisting no viewer, clock, IP or device data in PostgreSQL', async () => {
		const h = harness();
		const results = await Promise.all(['viewer01', 'viewer02', 'viewer03'].map(id => h.service.record({ id }, 'note01')));
		expect(results.every(result => result.counted)).toBe(true);
		expect(h.count()).toBe(3);
		for (const [sql, parameters] of h.db.query.mock.calls) {
			expect(parameters).toEqual(['note01']);
			expect(sql).not.toMatch(/viewer|ipAddress|userAgent|device|fingerprint|userId/u);
		}
	});

	it('uses native visibility and mute/block filters before taking a Redis claim', async () => {
		const h = harness(); const viewer = { id: 'viewer01' };
		await h.service.record(viewer, 'note01');
		expect(h.queryService.generateVisibilityQuery).toHaveBeenCalledExactlyOnceWith(h.query, viewer);
		expect(h.queryService.generateBaseNoteFilteringQuery).toHaveBeenCalledExactlyOnceWith(h.query, viewer);
		expect(h.query.andWhere).toHaveBeenCalledWith(expect.stringContaining('view_block."blockerId" = :viewerId'), { viewerId: viewer.id });
		expect(h.entity.pack).toHaveBeenCalledWith(h.note, viewer);
	});

	it('rejects nonexistent or SQL-filtered private/muted/blocked notes before any write or dedup lookup', async () => {
		const h = harness(); h.absent();
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBeInstanceOf(ZalipNoteViewUnavailableError);
		expect(h.entity.pack).not.toHaveBeenCalled(); expect(h.redis.set).not.toHaveBeenCalled(); expect(h.db.query).not.toHaveBeenCalled();
	});

	it.each([{ isHidden: true, deletedAt: null }, { isHidden: false, deletedAt: '2026-10-18T00:00:00Z' }])('rejects packed hidden/deleted content %o without writing', async state => {
		const h = harness(); h.entity.pack.mockResolvedValue({ id: h.note.id, zalipViewCount: 123, ...state });
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBeInstanceOf(ZalipNoteViewUnavailableError);
		expect(h.redis.set).not.toHaveBeenCalled(); expect(h.db.query).not.toHaveBeenCalled();
	});

	it.each(['self', 'discussion-root', 'pure-renote'] as const)('does not count %s while retaining the safe existing total', async kind => {
		const h = harness();
		if (kind === 'self') h.note.userId = 'viewer01';
		if (kind === 'discussion-root') h.note.name = zalipDiscussionRootMarker;
		if (kind === 'pure-renote') { h.note.renoteId = 'source01'; h.note.text = null; }
		expect(await h.service.record({ id: 'viewer01' }, 'note01')).toEqual({ counted: false, viewCount: 0 });
		expect(h.redis.set).not.toHaveBeenCalled(); expect(h.db.query).not.toHaveBeenCalled();
	});

	it('counts a quote as its own post instead of silently attributing it to the quoted author', async () => {
		const h = harness(); h.note.renoteId = 'quoted01';
		expect((await h.service.record({ id: 'viewer01' }, 'note01')).counted).toBe(true);
		expect(h.db.query).toHaveBeenCalledWith(zalipNoteViewIncrementSql, ['note01']);
	});

	it('fails closed when Redis cannot grant a claim', async () => {
		const h = harness(); const error = new Error('Redis unavailable'); h.redis.set.mockRejectedValue(error);
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBe(error);
		expect(h.db.query).not.toHaveBeenCalled();
	});

	it('releases only its own short claim after a DB failure and allows a successful retry', async () => {
		const h = harness(); const error = new Error('DB unavailable'); h.db.query.mockRejectedValueOnce(error);
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBe(error);
		expect(h.keys.size).toBe(0);
		expect(h.redis.eval).toHaveBeenCalledWith(zalipNoteViewReleaseScript, 1, zalipNoteViewDedupKey('viewer01', 'note01'), expect.any(String));
		expect(await h.service.record({ id: 'viewer01' }, 'note01')).toEqual({ counted: true, viewCount: 1 });
	});

	it('never deletes or extends another claim when its own request finishes late', async () => {
		const h = harness(); const key = zalipNoteViewDedupKey('viewer01', 'note01');
		h.db.query.mockImplementationOnce(async () => { h.keys.set(key, 'new-owner'); throw new Error('Old request failed'); });
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toThrow('Old request failed');
		expect(h.keys.get(key)).toBe('new-owner');
	});

	it('keeps a durable saved total even if receipt confirmation fails and never runs a compensating decrement', async () => {
		const h = harness(); h.redis.eval.mockRejectedValueOnce(new Error('Redis confirmation unavailable'));
		expect(await h.service.record({ id: 'viewer01' }, 'note01')).toEqual({ counted: true, viewCount: 1 });
		expect(h.db.query).toHaveBeenCalledTimes(1);
		expect(h.redis.set.mock.calls[0][3]).toBe(60);
	});

	it.each(['deleted-before-insert', 'foreign-key-race'] as const)('normalizes %s without leaving a full-day reservation', async kind => {
		const h = harness();
		if (kind === 'deleted-before-insert') h.db.query.mockResolvedValueOnce([]);
		else h.db.query.mockRejectedValueOnce(Object.assign(new Error('FK race'), { code: '23503' }));
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBeInstanceOf(ZalipNoteViewUnavailableError);
		expect(h.keys.size).toBe(0);
	});

	it('never masks the DB failure with a Redis cleanup failure and only reserves a short lease', async () => {
		const h = harness(); const error = new Error('DB failed'); h.db.query.mockRejectedValueOnce(error); h.redis.eval.mockRejectedValueOnce(new Error('Redis failed'));
		await expect(h.service.record({ id: 'viewer01' }, 'note01')).rejects.toBe(error);
		expect(h.redis.set.mock.calls[0][3]).toBe(zalipNoteViewClaimSeconds);
		expect(h.redis.eval).not.toHaveBeenCalledWith(zalipNoteViewConfirmScript, expect.anything(), expect.anything(), expect.anything(), expect.anything());
	});

	it('uses opaque rolling viewer+note keys, not a public viewer list or a client-controlled day bucket', () => {
		const key = zalipNoteViewDedupKey('viewer01', 'note01');
		expect(key).toMatch(/^zalip:note-view:v1:[a-f0-9]{64}$/u);
		expect(key).not.toContain('viewer01'); expect(key).not.toContain('note01');
		expect(key).not.toBe(zalipNoteViewDedupKey('viewer02', 'note01'));
		expect(key).not.toBe(zalipNoteViewDedupKey('viewer01', 'note02'));
	});
});
