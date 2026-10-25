/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { MiZalipWatchProgress } from '@/models/ZalipWatchProgress.js';
import type { MiLocalUser } from '@/models/User.js';
import BatchEndpoint, { meta, paramDef } from '@/server/api/endpoints/zalip/progress/batch.js';
import { progressSchema } from '@/server/api/endpoints/zalip/progress/common.js';

const owner = { id: 'owner' } as MiLocalUser;

function row(workId = 'work', completed = false): MiZalipWatchProgress {
	return {
		userId: owner.id, workId, episodeId: `episode${workId}`, provider: 'kodik', translationId: 'voice', mode: 'time',
		positionSeconds: completed ? 1000 : 75, durationSeconds: 1000, completed, hidden: false,
		lastPlayedAt: new Date('2026-10-26T10:00:00Z'), sessionId: 'private-session', resourceId: 'private-resource', sequence: 14,
		episode: { id: `episode${workId}`, episodeNumber: 0, season: { id: `season${workId}`, workId, seasonNumber: 0 } },
	} as MiZalipWatchProgress;
}

function fixture(rows: MiZalipWatchProgress[] = [row()]) {
	const query = {
		innerJoin: vi.fn(), leftJoinAndSelect: vi.fn(), select: vi.fn(), where: vi.fn(), andWhere: vi.fn(), limit: vi.fn(),
		getMany: vi.fn(async () => rows),
	};
	for (const method of ['innerJoin', 'leftJoinAndSelect', 'select', 'where', 'andWhere', 'limit'] as const) query[method].mockReturnValue(query);
	const getRepository = vi.fn((model: unknown) => {
		expect(model).toBe(MiZalipWatchProgress);
		return { createQueryBuilder: vi.fn(() => query) };
	});
	const service = new ZalipWatchProgressService({ getRepository } as never, {} as never, {} as never, {} as never);
	return { service, query, getRepository };
}

describe('bounded private playback history for release notifications', () => {
	it('requires account-read permission and does not turn notification-read permission into history access', () => {
		expect(meta.requireCredential).toBe(true);
		expect(meta.kind).toBe('read:account');
		expect(meta).not.toHaveProperty('cacheSec');
		expect(paramDef.additionalProperties).toBe(false);
		expect(meta.res.properties.items.items).toBe(progressSchema);
		for (const key of ['sessionId', 'resourceId', 'sequence', 'hidden', 'userId', 'work', 'iframe', 'token']) expect(progressSchema.properties).not.toHaveProperty(key);
	});

	it.each([
		{}, { workIds: [] }, { workIds: Array.from({ length: 51 }, (_, index) => `work${index}`) },
		{ workIds: ['work', 'work'] }, { workIds: ['a/b'] }, { workIds: ['x'.repeat(33)] },
		{ workIds: [5] }, { workIds: ['work'], userId: 'someoneElse' },
	])('rejects invalid bounds, ids, duplicates and a caller-selected owner: %j', async params => {
		const batch = vi.fn();
		const endpoint = new BatchEndpoint({ batch } as never);
		await expect(endpoint.exec(params, owner, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(batch).not.toHaveBeenCalled();
	});

	it('accepts 50 valid unique ids and always forwards the authenticated owner', async () => {
		const ids = Array.from({ length: 50 }, (_, index) => `work${index}`);
		const batch = vi.fn(async () => ({ items: [] }));
		const endpoint = new BatchEndpoint({ batch } as never);
		await expect(endpoint.exec({ workIds: ids }, owner, null)).resolves.toEqual({ items: [] });
		expect(batch).toHaveBeenCalledExactlyOnceWith(owner, ids);
	});

	it('returns completed and unfinished canonical targets without changing state or returning session data', async () => {
		const rows = [row('complete', true), row('unfinished')];
		const before = structuredClone(rows);
		const f = fixture(rows);
		const result = await f.service.batch(owner, ['unfinished', 'complete', 'missing']);
		expect(result.items.map(item => item.workId)).toEqual(['unfinished', 'complete']);
		expect(result.items[1]).toMatchObject({ completed: true, seasonNumber: 0, episodeNumber: 0, positionSeconds: 1000, provider: 'kodik', translationId: 'voice' });
		expect(Object.keys(result.items[0]).sort()).toEqual([...progressSchema.required].sort());
		expect(JSON.stringify(result)).not.toContain('private-');
		expect(rows).toEqual(before);
	});

	it('filters by owner, published state, hidden flag and requested canonical ids in one bounded query', async () => {
		const ids = Array.from({ length: 50 }, (_, index) => `work${index}`);
		const f = fixture(ids.map(id => row(id, true)));
		expect((await f.service.batch(owner, ids)).items).toHaveLength(50);
		expect(f.getRepository).toHaveBeenCalledOnce();
		expect(f.query.getMany).toHaveBeenCalledOnce();
		expect(f.query.where).toHaveBeenCalledWith('progress.userId = :userId', { userId: owner.id });
		expect(f.query.andWhere).toHaveBeenCalledWith('progress.workId IN (:...workIds)', { workIds: ids });
		expect(f.query.andWhere).toHaveBeenCalledWith('work.publicationState = :publicationState', { publicationState: 'published' });
		expect(f.query.andWhere).toHaveBeenCalledWith('progress.hidden = false');
		expect(f.query.andWhere).not.toHaveBeenCalledWith('progress.completed = false');
		expect(f.query.limit).toHaveBeenCalledWith(50);
		expect(f.query.select.mock.calls[0][0]).not.toContain('progress.sessionId');
		expect(f.query.select.mock.calls[0][0]).not.toContain('progress.resourceId');
	});

	it('keeps hidden, foreign, missing and mismatched episode targets out of the result', async () => {
		const valid = row('valid');
		const hidden = { ...row('hidden'), hidden: true };
		const foreign = { ...row('foreign'), userId: 'someoneElse' };
		const missing = { ...row('missing'), episode: null };
		const mismatched = { ...row('mismatched'), episode: { ...valid.episode!, id: 'otherEpisode' } } as MiZalipWatchProgress;
		const otherWork = { ...row('otherWork'), episode: { ...row('otherWork').episode!, season: { workId: 'anotherWork', seasonNumber: 1 } } } as MiZalipWatchProgress;
		const f = fixture([valid, hidden, foreign, missing, mismatched, otherWork, row('notRequested')]);
		expect((await f.service.batch(owner, ['valid', 'hidden', 'foreign', 'missing', 'mismatched', 'otherWork'])).items.map(item => item.workId)).toEqual(['valid']);
	});

	it('requires a real canonical film for null episode ids and rejects serial evidence in SQL', async () => {
		const movie = { ...row('movie'), episodeId: null, episode: null };
		const f = fixture([movie]);
		expect((await f.service.batch(owner, ['movie'])).items[0]).toMatchObject({ episodeId: null, seasonNumber: null, episodeNumber: null });
		const predicate = f.query.andWhere.mock.calls.find(([condition]) => String(condition).includes('progress.episodeId IS NOT NULL'))?.[0];
		expect(predicate).toContain('season.workId = progress.workId');
		expect(predicate).toContain("work.kind <> 'series'");
		expect(predicate).toContain("work.tmdbMediaType <> 'tv'");
		expect(predicate).toContain('NOT EXISTS (SELECT 1 FROM "zalip_season"');
		expect(predicate).toContain('NOT EXISTS (SELECT 1 FROM "zalip_external_identity"');
		expect(predicate).toContain("i.\"entityType\" = 'tv'");
		expect(predicate).toContain("i.\"entityType\" = 'movie'");
	});

	it.each([[], ['work', 'work'], ['a/b'], ['x'.repeat(33)], Array.from({ length: 51 }, (_, index) => `work${index}`)].map(ids => ({ ids })))('also bounds direct service callers before SQL: $ids', async ({ ids }) => {
		const f = fixture();
		await expect(f.service.batch(owner, ids)).rejects.toThrow('INVALID_ZALIP_PROGRESS');
		expect(f.getRepository).not.toHaveBeenCalled();
	});
});
