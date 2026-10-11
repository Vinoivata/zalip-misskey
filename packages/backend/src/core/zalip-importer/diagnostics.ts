/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ImportProviderError } from './providers.js';
import type { ImportMediaType, ImportProvider, ImportRef, ImportSource } from './types.js';

export type ImportSourceCheck = { source: ImportSource; configured: boolean; checkedAt: string; latencyMs: number; ok: boolean; error: string | null; cached: boolean };
const checkErrors = ['not-configured', 'not-found', 'quota-exceeded', 'rate-limited', 'upstream-failure', 'invalid-ref', 'unsupported', 'malformed-response'];

/** Redis is not an API schema boundary: validate and explicitly project cached values. */
export function cachedImportSourceCheck(value: unknown, source: ImportSource): ImportSourceCheck | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if (item.source !== source || typeof item.configured !== 'boolean' || typeof item.ok !== 'boolean') return null;
	if (typeof item.checkedAt !== 'string' || !Number.isFinite(Date.parse(item.checkedAt))) return null;
	if (typeof item.latencyMs !== 'number' || !Number.isFinite(item.latencyMs) || item.latencyMs < 0) return null;
	if (item.error !== null && (typeof item.error !== 'string' || !checkErrors.includes(item.error))) return null;
	if (item.ok !== (item.error === null)) return null;
	return { source, configured: item.configured, checkedAt: item.checkedAt, latencyMs: item.latencyMs, ok: item.ok, error: item.error as string | null, cached: true };
}

/** Health diagnostics return a closed set of errors, never provider messages or credentials. */
export async function checkImportProvider(provider: ImportProvider): Promise<ImportSourceCheck> {
	const status = provider.status();
	const started = Date.now();
	let error: string | null = null;
	try {
		if (!status.configured) throw new ImportProviderError('not-configured');
		if (!provider.check) throw new ImportProviderError('unsupported');
		await provider.check();
	} catch (cause) {
		error = cause instanceof ImportProviderError && checkErrors.includes(cause.code) ? cause.code : 'upstream-failure';
	}
	return { source: status.source, configured: status.configured, checkedAt: new Date().toISOString(), latencyMs: Math.max(0, Date.now() - started), ok: error === null, error, cached: false };
}

/** IMDb lookup is exact and typed; no fuzzy name matching or extra provider enrichment. */
export async function resolveImdbImport(provider: ImportProvider, imdbId: string, mediaType: ImportMediaType): Promise<{ ref: ImportRef; title: string; releaseYear: number | null; posterUrl: string | null }> {
	if (!/^tt\d{5,12}$/u.test(imdbId) || !['movie', 'tv'].includes(mediaType)) throw new ImportProviderError('invalid-ref');
	if (!provider.status().configured) throw new ImportProviderError('not-configured');
	if (!provider.lookup) throw new ImportProviderError('unsupported');
	const record = await provider.lookup([{ provider: 'imdb', externalId: imdbId, entityType: mediaType }], mediaType, ['title', 'kind', 'releaseYear', 'posterUrl']);
	if (!record) throw new ImportProviderError('not-found');
	if (record.ref.mediaType !== mediaType || !record.identities.some(identity => identity.provider === 'imdb' && identity.externalId === imdbId && identity.entityType === mediaType)) throw new ImportProviderError('malformed-response');
	return { ref: record.ref, title: record.title, releaseYear: record.releaseYear, posterUrl: record.posterUrl };
}
