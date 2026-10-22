/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { createNoteStateCache } from '@/utility/zalip-note-state.js';
import type { NoteStateActor } from '@/utility/zalip-note-state.js';

const row = (isFavorited = false) => ({ isFavorited, isMutedThread: false });
const viewer = { id: 'viewer', token: 'fixture-token' };

describe('bounded private note state cache', () => {
	it('coalesces copies of the same note but preserves native distinct per-note requests', async () => {
		const request = vi.fn(async (_id: string) => row());
		const cache = createNoteStateCache({ actor: () => viewer, request });
		const first = cache.load('a'); const duplicate = cache.load('a'); const second = cache.load('b');
		expect(first).toBe(duplicate); await Promise.all([first, second]);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls.map(call => call[0])).toEqual(['a', 'b']);
	});
	it('reuses confirmed state within TTL and bounds idle LRU entries', async () => {
		let now = 0;
		const request = vi.fn(async () => row());
		const cache = createNoteStateCache({ actor: () => viewer, request, now: () => now, ttlMs: 30, maxEntries: 2 });
		await cache.load('a'); await cache.load('b'); await cache.load('a'); expect(request).toHaveBeenCalledTimes(2);
		await cache.load('c'); expect(cache.peek('b')).toBeUndefined(); expect(cache.peek('a')?.state).toEqual(row());
		now = 31; await cache.load('a'); expect(request).toHaveBeenCalledTimes(4);
	});
	it('makes no guest requests and discards old-account or rotated-token responses', async () => {
		let actor: NoteStateActor | null = null;
		let finish!: (value: ReturnType<typeof row>) => void;
		const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(row());
		const cache = createNoteStateCache({ actor: () => actor, request });
		await cache.load('a'); expect(request).not.toHaveBeenCalled();
		actor = viewer; const old = cache.load('a'); await Promise.resolve();
		actor = { ...viewer, token: 'rotated-fixture-token' }; const fresh = cache.load('a');
		finish(row(true)); await expect(old).resolves.toBeNull(); await expect(fresh).resolves.toEqual(row());
		expect(cache.peek('a')?.state).toEqual(row());
		actor = null; expect(cache.peek('a')).toBeUndefined();
	});
	it('does not let an old read undo a confirmed mutation', async () => {
		let finish!: (value: ReturnType<typeof row>) => void;
		const request = vi.fn().mockResolvedValueOnce(row()).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const cache = createNoteStateCache({ actor: () => viewer, request });
		await cache.load('a'); const old = cache.load('a', true); await Promise.resolve();
		cache.confirmFavorite('a', true, viewer); finish(row());
		await expect(old).resolves.toBeNull(); expect(cache.peek('a')?.state?.isFavorited).toBe(true);
	});
	it('never retains unknown payloads or treats a failed read as confirmed false', async () => {
		const request = vi.fn().mockResolvedValueOnce({ isFavorited: 'false', isMutedThread: false, unsafe: 'ignored' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(row(true));
		const cache = createNoteStateCache({ actor: () => viewer, request });
		await expect(cache.load('a')).resolves.toBeNull(); expect(cache.peek('a')?.state).toBeNull();
		await expect(cache.load('a')).resolves.toBeNull(); await expect(cache.load('a')).resolves.toEqual(row(true));
		expect(cache.peek('a')?.loading).toBe(false);
	});
	it('serializes mutations and never evicts active entries to exceed the cache bound', async () => {
		const cache = createNoteStateCache({ actor: () => viewer, request: async () => row(), maxEntries: 1 });
		const unlock = cache.lock('a'); expect(unlock).toBeTypeOf('function'); expect(cache.lock('a')).toBeNull();
		await expect(cache.load('b')).resolves.toBeNull(); expect(cache.peek('b')).toBeUndefined();
		unlock?.(); await cache.load('b'); expect(cache.peek('a')).toBeUndefined();
	});
});
