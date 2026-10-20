/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { budgetedTransport, remainingQuota } from './budget.js';
import { ImportProviderError, type ImportTransport } from './providers.js';

// This suite tests distributed reservations, not pacing; all transports are offline fixtures.
vi.mock('./providers.js', async importOriginal => ({
	...await importOriginal<typeof import('./providers.js')>(),
	pacedImportTransport: (transport: ImportTransport) => transport,
}));

function redisFixture() {
	const values = new Map<string, string>();
	const redis = {
		get: vi.fn(async (key: string) => values.get(key) ?? null),
		set: vi.fn(async (key: string, value: string | number, ...options: (string | number)[]) => {
			if (options.includes('NX') && values.has(key)) return null;
			values.set(key, String(value));
			return 'OK';
		}),
		del: vi.fn(async (key: string) => values.delete(key) ? 1 : 0),
		// The fixture models Redis' indivisible Lua reservation, including concurrent callers.
		eval: vi.fn(async (script: string, keyCount: number, dayKey: string, quotaKey: string, budget: number) => {
			expect(keyCount).toBe(2);
			expect(script).toContain('redis.call(\'INCR\', KEYS[1])');
			expect(script).toContain('redis.call(\'DECR\', KEYS[2])');
			const used = Number(values.get(dayKey) ?? 0);
			const remaining = values.get(quotaKey);
			if (used >= budget || (remaining !== undefined && Number(remaining) <= 0)) return 0;
			values.set(dayKey, String(used + 1));
			if (remaining !== undefined) values.set(quotaKey, String(Number(remaining) - 1));
			return 1;
		}),
	};
	return { redis, values };
}

const fixtureKey = 'offline-fixture-key';
const filmUrl = 'https://kinopoiskapiunofficial.tech/api/v2.2/films/100';

describe('import quota parsing', () => {
	it('uses the tighter known limit and treats negative values as unknown', () => {
		expect(remainingQuota({ dailyQuota: { value: 500, used: 422 }, totalQuota: { value: -1, used: 5000 } })).toBe(78);
		expect(remainingQuota({ dailyQuota: { value: 500, used: 2 }, totalQuota: { value: 1000, used: 998 } })).toBe(2);
		expect(remainingQuota({ dailyQuota: { value: 5, used: 8 } })).toBe(0);
		expect(remainingQuota(null)).toBeNull();
	});
});

describe('distributed Kinopoisk request budget', () => {
	it('preserves a Vibix POST through the budget wrapper without charging Kinopoisk', async () => {
		const { redis } = redisFixture(); const transport = vi.fn().mockResolvedValue({ data: [] });
		const url = 'https://vibix.org/api/v1/publisher/videos/search?name=Fixture&page=1&limit=20';
		await budgetedTransport(redis as never, transport, fixtureKey)(url, { Authorization: 'Bearer fixture' }, { method: 'POST' });
		expect(transport).toHaveBeenCalledWith(url, { Authorization: 'Bearer fixture' }, { method: 'POST' });
		expect(redis.eval).not.toHaveBeenCalled(); expect(redis.get).not.toHaveBeenCalled();
	});
	it('does not apply Kinopoisk quotas to other providers or an unconfigured key', async () => {
		const { redis } = redisFixture();
		const transport = vi.fn().mockResolvedValue({ result: true });
		await budgetedTransport(redis as never, transport, fixtureKey)('https://api.themoviedb.org/3/movie/100', {});
		await budgetedTransport(redis as never, transport, undefined)(filmUrl, {});
		expect(transport).toHaveBeenCalledTimes(2);
		expect(redis.get).not.toHaveBeenCalled();
		expect(redis.eval).not.toHaveBeenCalled();
	});

	it('probes the provider quota once, reserves before fetching and never stores the raw key in Redis', async () => {
		const { redis, values } = redisFixture();
		const transport = vi.fn(async (url: string) => url.includes('/api_keys/') ? { dailyQuota: { value: 500, used: 400 }, totalQuota: { value: -1, used: 400 } } : { title: 'Fixture' });
		const request = budgetedTransport(redis as never, transport, fixtureKey, 350);
		await request(filmUrl, { 'X-API-KEY': fixtureKey });
		await request(filmUrl, { 'X-API-KEY': fixtureKey });
		expect(transport.mock.calls.filter(([url]) => url.includes('/api_keys/'))).toHaveLength(1);
		expect(redis.eval).toHaveBeenCalledTimes(2);
		expect([...values].find(([key]) => key.endsWith(':remaining'))?.[1]).toBe('78'); // Reserve a safety margin of 20 and two requests.
		expect([...values].find(([key]) => key.includes(':day:'))?.[1]).toBe('2');
		expect([...values.keys()].every(key => !key.includes(fixtureKey))).toBe(true);
		expect(redis.del).toHaveBeenCalledWith(expect.stringMatching(/:quota-lock$/u));
		expect(redis.eval.mock.invocationCallOrder[0]).toBeLessThan(transport.mock.invocationCallOrder[1]);
	});

	it('enforces the shared daily cap atomically across concurrent workers', async () => {
		const { redis, values } = redisFixture();
		const transport = vi.fn(async (url: string) => url.includes('/api_keys/') ? { dailyQuota: { value: 1000, used: 0 } } : { title: 'Fixture' });
		const firstWorker = budgetedTransport(redis as never, transport, fixtureKey, 2);
		const secondWorker = budgetedTransport(redis as never, transport, fixtureKey, 2);
		await firstWorker(filmUrl, {});
		const results = await Promise.allSettled([firstWorker(filmUrl, {}), secondWorker(filmUrl, {}), secondWorker(filmUrl, {})]);
		expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
		const failures = results.filter(result => result.status === 'rejected');
		expect(failures.every(result => result.reason instanceof ImportProviderError && result.reason.code === 'quota-exceeded')).toBe(true);
		expect(transport.mock.calls.filter(([url]) => !url.includes('/api_keys/'))).toHaveLength(2);
		expect([...values].find(([key]) => key.includes(':day:'))?.[1]).toBe('2');
	});

	it('stops without fetching a film when the remaining provider balance is exhausted', async () => {
		const { redis } = redisFixture();
		const transport = vi.fn().mockResolvedValue({ dailyQuota: { value: 500, used: 490 } });
		await expect(budgetedTransport(redis as never, transport, fixtureKey)(filmUrl, {})).rejects.toMatchObject({ code: 'quota-exceeded', retryAfterMs: 3600000 });
		expect(transport).toHaveBeenCalledOnce();
		expect(redis.eval).toHaveBeenCalledOnce();
	});

	it('pauses contenders while a quota probe is in flight instead of guessing the balance', async () => {
		const { redis, values } = redisFixture();
		const transport = vi.fn().mockResolvedValue({ dailyQuota: { value: 500, used: 0 } });
		const request = budgetedTransport(redis as never, transport, fixtureKey);
		await request(filmUrl, {});
		const remainingKey = [...values.keys()].find(key => key.endsWith(':remaining'));
		if (!remainingKey) throw new Error('MISSING_FIXTURE_QUOTA_KEY');
		values.delete(remainingKey);
		values.set(remainingKey.replace(/:remaining$/u, ':quota-lock'), 'another-worker');
		transport.mockClear();
		await expect(request(filmUrl, {})).rejects.toMatchObject({ code: 'rate-limited', retryAfterMs: 30000 });
		expect(transport).not.toHaveBeenCalled();
	});

	it('releases a failed probe lock and permits a safe later retry', async () => {
		const { redis, values } = redisFixture();
		const transport = vi.fn().mockRejectedValueOnce(new ImportProviderError('upstream-failure')).mockResolvedValue({ dailyQuota: { value: 500, used: 0 } });
		const request = budgetedTransport(redis as never, transport, fixtureKey);
		await expect(request(filmUrl, {})).rejects.toMatchObject({ code: 'upstream-failure' });
		expect([...values.keys()].some(key => key.endsWith(':quota-lock'))).toBe(false);
		await expect(request(filmUrl, {})).resolves.toEqual({ dailyQuota: { value: 500, used: 0 } });
	});

	it('upstream quota exhaustion zeroes the shared balance for subsequent workers', async () => {
		const { redis, values } = redisFixture();
		const transport = vi.fn().mockResolvedValueOnce({ dailyQuota: { value: 500, used: 0 } }).mockRejectedValueOnce(new ImportProviderError('quota-exceeded', 86400000));
		const request = budgetedTransport(redis as never, transport, fixtureKey);
		await expect(request(filmUrl, {})).rejects.toMatchObject({ code: 'quota-exceeded' });
		expect([...values].find(([key]) => key.endsWith(':remaining'))?.[1]).toBe('0');
		await expect(request(filmUrl, {})).rejects.toMatchObject({ code: 'quota-exceeded' });
		expect(transport).toHaveBeenCalledTimes(2);
	});
});
