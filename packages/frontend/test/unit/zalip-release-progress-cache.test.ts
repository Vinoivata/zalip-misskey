/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createZalipReleaseProgressCache } from '@/composables/use-zalip-release-progress.js';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';

vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));

const item = (workId = 'work'): WatchProgress => ({ workId, episodeId: 'episode5', seasonNumber: 2, episodeNumber: 5, provider: 'kodik', translationId: 'voice', mode: 'time', positionSeconds: 754, durationSeconds: 1440, completed: false, lastPlayedAt: '2026-10-26T00:00:00Z' });

describe('release notification private progress batches', () => {
	it('coalesces requested rows and duplicate works into one microtask batch', async () => {
		const fetch = vi.fn(async (ids: string[]) => ({ items: ids.map(id => item(id)) }));
		const cache = createZalipReleaseProgressCache(() => ({ id: 'viewer', token: 'a' }), fetch);
		const requests = Array.from({ length: 20 }, (_, index) => cache.request(`w${index % 4}`));
		expect(fetch).not.toHaveBeenCalled();
		await Promise.all(requests);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(['w0', 'w1', 'w2', 'w3']);
		expect(cache.lookup('w0')?.episodeNumber).toBe(5);
	});
	it('retrieves requested older targets beyond the first fifty without a full history scan', async () => {
		const fetch = vi.fn(async (ids: string[]) => ({ items: ids.map(id => ({ ...item(id), completed: id === 'w119' })) }));
		const cache = createZalipReleaseProgressCache(() => ({ id: 'viewer' }), fetch);
		await Promise.all(Array.from({ length: 120 }, (_, index) => cache.request(`w${index}`)));
		expect(fetch.mock.calls.map(([ids]) => ids.length)).toEqual([50, 50, 20]);
		expect(new Set(fetch.mock.calls.flatMap(([ids]) => ids)).size).toBe(120);
		expect(cache.lookup('w119')).toMatchObject({ completed: true, episodeNumber: 5 });
		expect(cache.lookup('not-requested')).toBeNull();
	});
	it('ignores unsolicited response targets and caches an absent target without claiming it was never watched', async () => {
		const fetch = vi.fn().mockResolvedValue({ items: [item('foreign'), item('wanted'), { ...item('wanted'), episodeNumber: 99 }] });
		const cache = createZalipReleaseProgressCache(() => ({ id: 'viewer' }), fetch);
		await Promise.all([cache.request('wanted'), cache.request('absent')]);
		expect(cache.lookup('wanted')?.episodeNumber).toBe(5);
		expect(cache.lookup('foreign')).toBeNull();
		expect(cache.lookup('absent')).toBeNull();
		await cache.request('absent'); expect(fetch).toHaveBeenCalledTimes(1);
	});
	it('keeps at most two hundred requested entries in memory', async () => {
		const fetch = vi.fn(async (ids: string[]) => ({ items: ids.map(id => item(id)) }));
		const cache = createZalipReleaseProgressCache(() => ({ id: 'viewer' }), fetch);
		await Promise.all(Array.from({ length: 240 }, (_, index) => cache.request(`w${index}`)));
		expect(cache.size.value).toBe(200);
		expect(cache.lookup('w0')).toBeNull();
		expect(cache.lookup('w239')).not.toBeNull();
		expect(fetch.mock.calls.every(([ids]) => ids.length <= 50)).toBe(true);
	});
	it('does not leak cached or late responses after logout, account change or token rotation', async () => {
		const owner = ref<{ id: string; token: string } | null>({ id: 'a', token: 'first' });
		const finishes: Array<(page: { items: WatchProgress[] }) => void> = [];
		const fetch = vi.fn(() => new Promise<{ items: WatchProgress[] }>(resolve => { finishes.push(resolve); }));
		const cache = createZalipReleaseProgressCache(() => owner.value, fetch);
		const old = cache.request('aOnly'); await Promise.resolve();
		owner.value = { id: 'b', token: 'second' };
		const next = cache.request('bOnly'); await Promise.resolve();
		finishes[0]({ items: [item('aOnly')] }); await old;
		expect(cache.lookup('aOnly')).toBeNull();
		finishes[1]({ items: [item('bOnly')] }); await next;
		expect(cache.lookup('bOnly')).not.toBeNull();
		owner.value.token = 'rotated'; expect(cache.lookup('bOnly')).toBeNull();
		owner.value = null; await cache.request('bOnly');
		expect(cache.lookup('bOnly')).toBeNull(); expect(cache.size.value).toBe(0);
		expect(fetch).toHaveBeenCalledTimes(2);
	});
	it('drops queued work before dispatch when the account changes in the same turn', async () => {
		const owner = ref({ id: 'a', token: 'first' });
		const fetch = vi.fn(async (ids: string[]) => ({ items: ids.map(id => item(id)) }));
		const cache = createZalipReleaseProgressCache(() => owner.value, fetch);
		const old = cache.request('aOnly');
		owner.value = { id: 'b', token: 'second' };
		await Promise.all([old, cache.request('bOnly')]);
		expect(fetch).toHaveBeenCalledExactlyOnceWith(['bOnly']);
		expect(cache.lookup('aOnly')).toBeNull();
	});
	it('refreshes expired targets and clears stale progress on failure without a retry storm', async () => {
		let now = 100;
		const fetch = vi.fn().mockResolvedValue({ items: [item()] });
		const cache = createZalipReleaseProgressCache(() => ({ id: 'viewer' }), fetch, () => now);
		await cache.request('work'); await cache.request('work'); expect(fetch).toHaveBeenCalledTimes(1);
		now += 30_001; fetch.mockRejectedValue(new Error('offline'));
		await cache.request('work');
		expect(cache.lookup('work')).toBeNull(); expect(cache.failed('work')).toBe(true);
		await cache.request('work'); expect(fetch).toHaveBeenCalledTimes(2);
		fetch.mockResolvedValue({ items: [item()] });
		await cache.request('work', true); expect(cache.lookup('work')).not.toBeNull();
	});
});
