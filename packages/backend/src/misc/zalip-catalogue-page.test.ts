/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { cataloguePageScope, decodeCataloguePageCursor, encodeCataloguePageCursor } from './zalip-catalogue-page.js';

describe('public catalogue keyset cursors', () => {
	const scope = cataloguePageScope({ genres: ['Драма', 'Комедия'], kinds: ['movie'], query: 'Test' });
	it('uses an order-independent normalized filter scope', () => {
		expect(cataloguePageScope({ genres: ['Комедия', 'Драма'], kinds: ['movie'], query: 'Test' })).toBe(scope);
	});
	it.each([
		['newest', '2026-10-16T10:00:00.123Z'], ['oldest', '2026-10-16T10:00:00.123Z'],
		['title', 'Японское название'], ['year-desc', 2026], ['year-asc', null],
	] as const)('roundtrips %s without exposing any private state', (sort, value) => {
		const anchor = { id: 'work01', value };
		expect(decodeCataloguePageCursor(encodeCataloguePageCursor(scope, sort, anchor), scope, sort)).toEqual(anchor);
	});
	it('rejects cross-filter/sort reuse and malformed/noncanonical payloads', () => {
		const cursor = encodeCataloguePageCursor(scope, 'title', { id: 'work01', value: 'Title' });
		for (const action of [
			() => decodeCataloguePageCursor(cursor, 'different', 'title'),
			() => decodeCataloguePageCursor(cursor, scope, 'newest'),
			...['!', `${cursor}=`, 'a'.repeat(2049), Buffer.from('[]').toString('base64url')].map(value => () => decodeCataloguePageCursor(value, scope, 'title')),
			() => decodeCataloguePageCursor(encodeCataloguePageCursor(scope, 'title', { id: 'work01', value: '\0' }), scope, 'title'),
		]) expect(action).toThrow('INVALID_CATALOG_CURSOR');
	});
});
