/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { createFollowRelationsCache } from '@/utility/zalip-follow-relations.js';
import type { FollowActor } from '@/utility/zalip-follow-relations.js';

const row = (id: string, isFollowing = false) => ({ id, isFollowing, hasPendingFollowRequestFromYou: false, isBlocking: false, isBlocked: false });
async function settle(): Promise<void> { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('private bounded follow relation cache', () => {
	it('deduplicates simultaneous authors into one native array request and returns authoritative state', async () => {
		const request = vi.fn(async (ids: string[]) => ids.map(id => row(id, id === 'a')));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request });
		const a = cache.load('a'); const duplicate = cache.load('a'); const b = cache.load('b');
		expect(a).toBe(duplicate);
		await expect(a).resolves.toEqual(row('a', true)); await expect(b).resolves.toEqual(row('b'));
		expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0]).toEqual(['a', 'b']);
		expect(cache.peek('a')).toMatchObject({ loading: false, failed: false, relation: row('a', true) });
	});
	it('caps native batches at 50 and never runs them concurrently', async () => {
		let finish!: (rows: ReturnType<typeof row>[]) => void;
		const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async (ids: string[]) => ids.map(id => row(id)));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request });
		const promises = Array.from({ length: 113 }, (_, i) => cache.load(String(i)));
		await settle(); expect(request).toHaveBeenCalledTimes(1); expect(request.mock.calls[0][0]).toHaveLength(50);
		finish(request.mock.calls[0][0].map((id: string) => row(id))); await Promise.all(promises);
		expect(request.mock.calls.map(call => call[0].length)).toEqual([50, 50, 13]);
	});
	it('expires the TTL and evicts only idle LRU entries within its finite bound', async () => {
		let now = 0;
		const request = vi.fn(async (ids: string[]) => ids.map(id => row(id)));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request, maxEntries: 2, ttlMs: 30, now: () => now });
		await cache.load('a'); await cache.load('b'); await cache.load('a'); expect(request).toHaveBeenCalledTimes(2);
		await cache.load('c'); expect(cache.peek('b')).toBeUndefined(); expect(cache.peek('a')?.relation?.id).toBe('a');
		now = 31; await cache.load('a'); expect(request).toHaveBeenCalledTimes(4);
	});
	it('has bounded waiting capacity and does not evict active requests', async () => {
		let finish!: (rows: ReturnType<typeof row>[]) => void;
		const request = vi.fn(() => new Promise<ReturnType<typeof row>[]>(resolve => { finish = resolve; }));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request, maxEntries: 2 });
		const a = cache.load('a'); const b = cache.load('b'); await expect(cache.load('c')).resolves.toBeNull();
		await settle(); finish([row('a'), row('b')]); await Promise.all([a, b]); expect(cache.peek('c')).toBeUndefined();
	});
	it('rejects missing, duplicate, malformed and unrelated response rows without inventing follow state', async () => {
		const request = vi.fn(async () => [row('a'), row('a'), { ...row('b'), isFollowing: 'false' }, row('foreign')]);
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request });
		expect(await Promise.all(['a', 'b', 'missing'].map(id => cache.load(id)))).toEqual([null, null, null]);
		expect(cache.peek('a')).toMatchObject({ relation: null, loading: false, failed: true }); expect(cache.peek('foreign')).toBeUndefined();
	});
	it('discards old-account and same-account old-token responses, including queued reads', async () => {
		let actor: FollowActor = { id: 'viewer', token: 'first' };
		let finish!: (rows: ReturnType<typeof row>[]) => void;
		const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async (ids: string[]) => ids.map(id => row(id)));
		const cache = createFollowRelationsCache({ actor: () => actor, request });
		const old = cache.load('a'); await settle();
		actor = { id: 'viewer', token: 'second' }; const current = cache.load('a');
		finish([row('a', true)]); await expect(old).resolves.toBeNull(); await expect(current).resolves.toEqual(row('a'));
		expect(request.mock.calls[1][1]).toEqual(actor); expect(cache.peek('a')?.relation?.isFollowing).toBe(false);
		actor = { id: 'other', token: 'third' }; expect(cache.peek('a')).toBeUndefined();
	});
	it('does not let a stale in-flight read overwrite a forced post-write refresh', async () => {
		let finish!: (rows: ReturnType<typeof row>[]) => void;
		const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockImplementation(async (ids: string[]) => ids.map(id => row(id, true)));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request });
		const old = cache.load('a'); await settle(); const fresh = cache.load('a', true);
		finish([row('a')]); await expect(old).resolves.toBeNull(); await expect(fresh).resolves.toEqual(row('a', true));
		expect(cache.peek('a')?.relation?.isFollowing).toBe(true);
	});
	it('locks a shared author action, and performs no reads for guests or self', async () => {
		let actor: FollowActor | null = null;
		const request = vi.fn(async (ids: string[]) => ids.map(id => row(id)));
		const cache = createFollowRelationsCache({ actor: () => actor, request });
		await cache.load('a'); actor = { id: 'viewer', token: 'fixture-token' }; await cache.load('viewer'); expect(request).not.toHaveBeenCalled();
		await cache.load('a'); const release = cache.lock('a'); expect(release).toBeTypeOf('function'); expect(cache.lock('a')).toBeNull();
		release?.(); expect(cache.peek('a')?.changing).toBe(false);
	});
	it('fails closed after a network error and retries only on another explicit demand', async () => {
		const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async (ids: string[]) => ids.map(id => row(id)));
		const cache = createFollowRelationsCache({ actor: () => ({ id: 'viewer', token: 'fixture-token' }), request });
		await expect(cache.load('a')).resolves.toBeNull(); await settle(); expect(request).toHaveBeenCalledTimes(1);
		await expect(cache.load('a')).resolves.toEqual(row('a')); expect(request).toHaveBeenCalledTimes(2);
	});
});
