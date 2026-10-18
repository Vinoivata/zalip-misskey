/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { createReplyPreviewCache } from '@/utility/zalip-reply-preview.js';

function reply(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'reply', replyId: 'parent', isHidden: false, deletedAt: null, ...patch } as Misskey.entities.Note;
}

describe('account-isolated reply preview cache', () => {
	it('deduplicates concurrent cards and caches only a real visible direct reply', async () => {
		const cache = createReplyPreviewCache();
		const fetchReply = vi.fn().mockResolvedValue([reply()]);
		const first = cache.load('a', 'parent', fetchReply);
		const second = cache.load('a', 'parent', fetchReply);
		expect(first).toBe(second);
		expect(await first).toEqual(reply());
		expect(fetchReply).toHaveBeenCalledTimes(1);
	});
	it.each([{ rows: [] }, { rows: [reply({ replyId: 'another-parent' })] }, { rows: [reply({ isHidden: true })] }, { rows: [reply({ deletedAt: '2026-10-18T00:00:00Z' })] }])('omits unavailable, deleted or non-reply rows $rows', async ({ rows }) => {
		expect(await createReplyPreviewCache().load(null, 'parent', async () => rows)).toBeNull();
	});
	it('caches quiet failures until a short TTL without a retry loop', async () => {
		let now = 0;
		const cache = createReplyPreviewCache(100, 30, () => now);
		const fetchReply = vi.fn().mockRejectedValue(new Error('unavailable'));
		expect(await cache.load('a', 'parent', fetchReply)).toBeNull();
		expect(await cache.load('a', 'parent', fetchReply)).toBeNull();
		expect(fetchReply).toHaveBeenCalledTimes(1);
		now = 31;
		await cache.load('a', 'parent', fetchReply);
		expect(fetchReply).toHaveBeenCalledTimes(2);
	});
	it('bounds the in-memory LRU and refreshes the least recently used entry', async () => {
		const cache = createReplyPreviewCache(2);
		const fetchReply = vi.fn().mockResolvedValue([]);
		await cache.load('a', 'one', fetchReply);
		await cache.load('a', 'two', fetchReply);
		await cache.load('a', 'one', fetchReply);
		await cache.load('a', 'three', fetchReply);
		await cache.load('a', 'two', fetchReply);
		expect(fetchReply).toHaveBeenCalledTimes(4);
	});
	it('purges previous-account results and rejects an in-flight old-account result', async () => {
		const cache = createReplyPreviewCache();
		let resolve!: (notes: Misskey.entities.Note[]) => void;
		const old = cache.load('a', 'parent', () => new Promise<Misskey.entities.Note[]>(done => { resolve = done; }));
		for (let i = 0; i < 5; i++) await Promise.resolve();
		await cache.load('b', 'parent', async () => []);
		resolve([reply()]);
		expect(await old).toBeNull();
		const fresh = vi.fn().mockResolvedValue([reply()]);
		expect(await cache.load('a', 'parent', fresh)).toEqual(reply());
		expect(fresh).toHaveBeenCalledTimes(1);
	});
	it('limits all visible reply requests to three in flight', async () => {
		const cache = createReplyPreviewCache();
		const complete: Array<(notes: Misskey.entities.Note[]) => void> = [];
		const fetchReply = vi.fn(() => new Promise<Misskey.entities.Note[]>(resolve => complete.push(resolve)));
		const requests = Array.from({ length: 5 }, (_, index) => cache.load('a', `parent-${index}`, fetchReply));
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(fetchReply).toHaveBeenCalledTimes(3);
		complete[0]([]);
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(fetchReply).toHaveBeenCalledTimes(4);
		complete[1]([]);
		for (let i = 0; i < 8; i++) await Promise.resolve();
		expect(fetchReply).toHaveBeenCalledTimes(5);
		for (const done of complete) done([]);
		await Promise.all(requests);
	});
});
