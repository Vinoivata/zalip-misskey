/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';

export const zalipCatalogueSorts = ['newest', 'oldest', 'year-desc', 'year-asc', 'title'] as const;
export type ZalipCatalogueSort = typeof zalipCatalogueSorts[number];
export type ZalipCatalogueAnchor = { id: string; value: string | number | null };

/** Scope cursors to a normalized public query; never include importer/provider state. */
export function cataloguePageScope(filters: { genres: string[]; kinds: string[]; query: string; yearFrom?: number; yearTo?: number }): string {
	return createHash('sha256').update(JSON.stringify([
		[...filters.genres].sort(), [...filters.kinds].sort(), filters.query,
		filters.yearFrom ?? null, filters.yearTo ?? null,
	])).digest('hex');
}

export function encodeCataloguePageCursor(scope: string, sort: ZalipCatalogueSort, anchor: ZalipCatalogueAnchor): string {
	return Buffer.from(JSON.stringify([1, scope, sort, anchor.id, anchor.value])).toString('base64url');
}

export function decodeCataloguePageCursor(cursor: string, scope: string, sort: ZalipCatalogueSort): ZalipCatalogueAnchor {
	const invalid = () => new Error('INVALID_CATALOG_CURSOR');
	if (!cursor || cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw invalid();
	let value: unknown;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) throw invalid();
		value = JSON.parse(bytes.toString('utf8'));
	} catch { throw invalid(); }
	if (!Array.isArray(value) || value.length !== 5 || value[0] !== 1 || value[1] !== scope || value[2] !== sort || typeof value[3] !== 'string' || !/^[A-Za-z0-9]{1,32}$/u.test(value[3])) throw invalid();
	const anchor = value[4];
	if (sort === 'title') {
		if (typeof anchor !== 'string' || [...anchor].length > 256 || anchor.includes('\0')) throw invalid();
	} else if (sort === 'year-desc' || sort === 'year-asc') {
		if (anchor !== null && (!Number.isInteger(anchor) || anchor < 1888 || anchor > 100000)) throw invalid();
	} else if (typeof anchor !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(anchor) || !Number.isFinite(Date.parse(anchor)) || new Date(anchor).toISOString() !== anchor) {
		throw invalid();
	}
	return { id: value[3], value: anchor };
}
