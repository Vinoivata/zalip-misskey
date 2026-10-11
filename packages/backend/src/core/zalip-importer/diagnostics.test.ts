/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { cachedImportSourceCheck, checkImportProvider, resolveImdbImport } from './diagnostics.js';
import { ImportProviderError, normalizeTmdbRecord } from './providers.js';
import type { ImportProvider } from './types.js';

function fixture(): ImportProvider {
	return {
		status: () => ({ source: 'tmdb', configured: true, capabilities: { search: true, collections: true, updates: false }, dailyLimit: null }),
		check: vi.fn(async () => {}), search: vi.fn(), fetch: vi.fn(), lookup: vi.fn(),
	};
}

describe('safe importer diagnostics', () => {
	test('cached diagnostics discard arbitrary fields and reject invalid status data', () => {
		const value = { source: 'tmdb', configured: true, checkedAt: new Date().toISOString(), latencyMs: 12, ok: true, error: null, secret: 'fixture-secret' };
		expect(cachedImportSourceCheck(value, 'tmdb')).toEqual({ source: 'tmdb', configured: true, checkedAt: value.checkedAt, latencyMs: 12, ok: true, error: null, cached: true });
		for (const invalid of [{ ...value, source: 'collaps' }, { ...value, error: 'fixture-secret' }, { ...value, latencyMs: -1 }, { ...value, checkedAt: 'invalid' }, { ...value, ok: false }]) {
			expect(cachedImportSourceCheck(invalid, 'tmdb')).toBeNull();
		}
	});
	test('reports a timestamp and latency without provider payloads', async () => {
		const provider = fixture();
		expect(await checkImportProvider(provider)).toMatchObject({ source: 'tmdb', configured: true, ok: true, error: null, cached: false });
		expect(provider.check).toHaveBeenCalledOnce();
	});

	test('a missing key does not send a request', async () => {
		const provider = fixture();
		provider.status = () => ({ source: 'tmdb', configured: false, capabilities: { search: true, collections: true, updates: false }, dailyLimit: null });
		expect(await checkImportProvider(provider)).toMatchObject({ ok: false, error: 'not-configured' });
		expect(provider.check).not.toHaveBeenCalled();
	});

	test.each(['quota-exceeded', 'rate-limited', 'malformed-response'] as const)('retains safe %s code', async code => {
		const provider = fixture();
		provider.check = vi.fn(async () => { throw new ImportProviderError(code); });
		expect(await checkImportProvider(provider)).toMatchObject({ ok: false, error: code });
	});

	test('does not expose raw exception, URL or malicious provider error code', async () => {
		const provider = fixture();
		for (const error of [new Error('https://api.example.org/?token=fixture-secret'), new ImportProviderError('fixture-secret' as never)]) {
			provider.check = vi.fn(async () => { throw error; });
			const result = await checkImportProvider(provider);
			expect(result.error).toBe('upstream-failure');
			expect(JSON.stringify(result)).not.toContain('fixture-secret');
		}
	});
});

describe('exact IMDb reference resolution', () => {
	test('uses a typed identity and asks only for lightweight fields', async () => {
		const provider = fixture();
		provider.lookup = vi.fn(async () => normalizeTmdbRecord({ id: 278, title: 'Film', imdb_id: 'tt0111161', release_date: '1994-09-23' }, 'movie'));
		expect(await resolveImdbImport(provider, 'tt0111161', 'movie')).toEqual({ ref: { source: 'tmdb', externalId: '278', mediaType: 'movie' }, title: 'Film', releaseYear: 1994, posterUrl: null });
		expect(provider.lookup).toHaveBeenCalledWith([{ provider: 'imdb', externalId: 'tt0111161', entityType: 'movie' }], 'movie', ['title', 'kind', 'releaseYear', 'posterUrl']);
	});

	test('rejects invalid and contradictory IDs, never matching by title', async () => {
		const provider = fixture();
		await expect(resolveImdbImport(provider, 'https://evil.example.org', 'movie')).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(provider.lookup).not.toHaveBeenCalled();
		provider.lookup = vi.fn(async () => normalizeTmdbRecord({ id: 278, title: 'Film', imdb_id: 'tt0000001' }, 'movie'));
		await expect(resolveImdbImport(provider, 'tt0111161', 'movie')).rejects.toMatchObject({ code: 'malformed-response' });
		provider.lookup = vi.fn(async () => null);
		await expect(resolveImdbImport(provider, 'tt0111161', 'movie')).rejects.toMatchObject({ code: 'not-found' });
	});
});
