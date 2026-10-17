/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import { ZalipProgressError } from '@/core/ZalipWatchProgressService.js';
import Start, { meta as startMeta } from './start.js';
import Update, { meta as updateMeta } from './update.js';
import Show, { meta as showMeta } from './show.js';
import Continue, { meta as continueMeta } from './continue.js';
import Reset, { meta as resetMeta } from './reset.js';
import { progressCall, progressErrors } from './common.js';

const me = { id: 'owner' } as MiLocalUser;
const target = { workId: 'work', episodeId: 'episode', provider: 'kodik', translationId: 'serial-1' };
const update = { workId: 'work', sessionId: '07d7e784-8ba8-4409-aca9-a66292f3326d', sequence: 1 };

describe('Zalip private progress API', () => {
	it('requires owner authentication/scopes without cache and limits every route; writes reject moved users', () => {
		for (const meta of [startMeta, updateMeta, resetMeta]) {
			expect(meta.requireCredential).toBe(true); expect(meta.kind).toBe('write:account'); expect(meta.prohibitMoved).toBe(true); expect(meta.limit.max).toBeLessThanOrEqual(120); expect(meta).not.toHaveProperty('cacheSec');
		}
		for (const meta of [showMeta, continueMeta]) { expect(meta.requireCredential).toBe(true); expect(meta.kind).toBe('read:account'); expect(meta.limit.max).toBeLessThanOrEqual(120); expect(meta).not.toHaveProperty('cacheSec'); }
	});

	it('start passes the authenticated owner and exact canonical target, not JSON auth fields', async () => {
		const service = { start: vi.fn(async () => ({ sessionId: 'session', sequence: 0, progress: {} })) };
		const endpoint = new Start(service as never);
		await endpoint.exec({ ...target, i: 'fixture-auth' }, me, null);
		expect(service.start).toHaveBeenCalledExactlyOnceWith(me, target);
		for (const extra of [{ userId: 'other' }, { iframe: 'https://evil.example.org' }, { resourceId: '123' }, { mode: 'time' }, { lastPlayedAt: '2026-01-01' }, { sessionId: 'chosen' }, { positionSeconds: 10 }]) await expect(endpoint.exec({ ...target, ...extra }, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	it.each([{ workId: '' }, { workId: 'a'.repeat(33) }, { episodeId: '../episode' }, { episodeId: undefined }, { provider: 'tmdb' }, { translationId: 'a'.repeat(101) }, { expectedResourceFingerprint: 'A'.repeat(64) }, { expectedResourceFingerprint: 'a'.repeat(63) }])('start rejects malformed target %o', async partial => {
		const service = { start: vi.fn() }; await expect(new Start(service as never).exec({ ...target, ...partial }, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' }); expect(service.start).not.toHaveBeenCalled();
	});

	it('forwards only a bounded opaque mounted-frame fingerprint, never a URL', async () => {
		const service = { start: vi.fn(async () => ({ sessionId: 'session', sequence: 0, progress: {} })) };
		await new Start(service as never).exec({ ...target, expectedResourceFingerprint: 'a'.repeat(64) }, me, null);
		expect(service.start).toHaveBeenCalledWith(me, { ...target, expectedResourceFingerprint: 'a'.repeat(64) });
	});

	it('allows explicit movie and parent-source null values without guessing them', async () => {
		const service = { start: vi.fn(async () => ({ sessionId: 'session', sequence: 0, progress: {} })) };
		await new Start(service as never).exec({ ...target, episodeId: null, translationId: null }, me, null);
		expect(service.start).toHaveBeenCalledWith(me, { ...target, episodeId: null, translationId: null });
	});

	it('update cannot change canonical target/provider/voice/owner or client timestamp', async () => {
		const service = { update: vi.fn(async () => ({ accepted: false, progress: null })) }; const endpoint = new Update(service as never);
		await endpoint.exec(update, me, null); expect(service.update).toHaveBeenCalledWith(me, update);
		for (const extra of [{ userId: 'other' }, { episodeId: 'episode2' }, { provider: 'alloha' }, { translationId: 'serial-2' }, { resourceId: 'serial-2' }, { lastPlayedAt: new Date().toISOString() }]) await expect(endpoint.exec({ ...update, ...extra }, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	it.each([{ sequence: 0 }, { sequence: -1 }, { sequence: 1.1 }, { sequence: 2147483648 }, { sessionId: 'not-issued-uuid' }, { positionSeconds: -1 }, { positionSeconds: 172801 }, { durationSeconds: 0 }, { durationSeconds: Infinity }, { positionSeconds: NaN }, { completed: 'true' }])('update rejects malformed event %o', async partial => {
		const service = { update: vi.fn() }; await expect(new Update(service as never).exec({ ...update, ...partial }, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' }); expect(service.update).not.toHaveBeenCalled();
	});

	it('show/reset are own-only and continue has bounded defaults and no userId override', async () => {
		const service = { show: vi.fn(async () => ({ progress: null })), reset: vi.fn(async () => ({ cleared: true })), continue: vi.fn(async () => ({ items: [], nextCursor: null })) };
		await new Show(service as never).exec({ workId: 'work', i: 'auth' }, me, null); expect(service.show).toHaveBeenCalledWith(me, 'work');
		await new Reset(service as never).exec({ workId: 'work' }, me, null); expect(service.reset).toHaveBeenCalledWith(me, 'work');
		await new Continue(service as never).exec({}, me, null); expect(service.continue).toHaveBeenCalledWith(me, 12, undefined);
		for (const Endpoint of [Show, Reset]) await expect(new Endpoint(service as never).exec({ workId: 'work', userId: 'other' }, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const params of [{ limit: 51 }, { limit: 0 }, { cursor: 'a'.repeat(513) }, { userId: 'other' }]) await expect(new Continue(service as never).exec(params, me, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	it.each(Object.values(progressErrors))('maps declared business error $code without swallowing unknown failures', async definition => {
		await expect(progressCall(() => Promise.reject(new ZalipProgressError(definition.code)))).rejects.toMatchObject({ code: definition.code, id: definition.id });
	});

	it('unexpected failures remain server errors, not fake successful saves', async () => {
		const error = new Error('database unavailable'); await expect(progressCall(() => Promise.reject(error))).rejects.toBe(error);
	});
});
