/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type * as Redis from 'ioredis';
import { ImportProviderError, pacedImportTransport, type ImportTransport } from './providers.js';

export function remainingQuota(response: unknown): number | null {
	if (response == null || typeof response !== 'object') return null;
	const quotas = response as Record<string, unknown>;
	const remaining: number[] = [];
	for (const key of ['dailyQuota', 'totalQuota']) {
		const value = quotas[key];
		if (value == null || typeof value !== 'object') continue;
		const quota = value as Record<string, unknown>;
		if (typeof quota.value === 'number' && quota.value >= 0 && typeof quota.used === 'number' && quota.used >= 0) remaining.push(Math.max(0, quota.value - quota.used));
	}
	return remaining.length > 0 ? Math.min(...remaining) : null;
}

/** Redis reservations cover all application workers and UI previews sharing this API key. */
export function budgetedTransport(redis: Redis.Redis, transport: ImportTransport, key: string | undefined, dailyBudget = 350, apiOrigin = 'https://kinopoiskapiunofficial.tech'): ImportTransport {
	const fingerprint = createHash('sha256').update(key ?? '').digest('hex').slice(0, 20);
	const paced = pacedImportTransport(transport);
	return async (url, headers, options) => {
		if (new URL(url).origin !== apiOrigin || !key) return options ? transport(url, headers, options) : transport(url, headers);
		const prefix = `zalip:import:kp:${fingerprint}`;
		const quotaKey = `${prefix}:remaining`;
		if (await redis.get(quotaKey) == null) {
			const lock = await redis.set(`${prefix}:quota-lock`, '1', 'EX', 20, 'NX');
			if (lock) {
				try {
					const quota = remainingQuota(await paced(`${apiOrigin}/api/v1/api_keys/${encodeURIComponent(key)}`, { 'X-API-KEY': key }));
					await redis.set(quotaKey, quota == null ? dailyBudget : Math.max(0, quota - 20), 'EX', 3600);
				} finally {
					await redis.del(`${prefix}:quota-lock`);
				}
			} else {
				// Do not race a fresh quota check or silently exceed an unknown shared balance.
				throw new ImportProviderError('rate-limited', 30000);
			}
		}
		const dayKey = `${prefix}:day:${new Date().toISOString().slice(0, 10)}`;
		const reserved = await redis.eval(`
			local used = tonumber(redis.call('GET', KEYS[1]) or '0')
			local remaining = redis.call('GET', KEYS[2])
			if used >= tonumber(ARGV[1]) or (remaining and tonumber(remaining) <= 0) then return 0 end
			redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 172800)
			if remaining then redis.call('DECR', KEYS[2]) end
			return 1`, 2, dayKey, quotaKey, dailyBudget);
		if (Number(reserved) !== 1) throw new ImportProviderError('quota-exceeded', 3600000);
		try {
			return await (options ? paced(url, headers, options) : paced(url, headers));
		} catch (error) {
			if (error instanceof ImportProviderError && error.code === 'quota-exceeded') await redis.set(quotaKey, 0, 'EX', 3600);
			throw error;
		}
	};
}
