/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import PageEndpoint, { paramDef, meta } from './page.js';
import ListEndpoint from './list.js';

describe('backwards-compatible public catalogue pagination endpoint', () => {
	it('delegates global filters/order/cursor and retains the legacy array endpoint', async () => {
		const page = { items: [], total: 123, nextCursor: 'cursor' };
		const service = { pagePublished: vi.fn().mockResolvedValue(page), listPublished: vi.fn().mockResolvedValue([]) };
		const endpoint = new PageEndpoint(service as never);
		const params = { limit: 24, sort: 'year-desc', genres: ['Драма'], kinds: ['movie'], cursor: 'cursor', query: 'Title', yearFrom: 2000, yearTo: 2026 };
		await expect(endpoint.exec(params as never, null as never, null)).resolves.toEqual(page);
		expect(service.pagePublished).toHaveBeenCalledWith(24, { genres: ['Драма'], kinds: ['movie'], query: 'Title', yearFrom: 2000, yearTo: 2026 }, 'year-desc', 'cursor');
		await expect(new ListEndpoint(service as never).exec({ limit: 20 } as never, null as never, null)).resolves.toEqual([]);
		expect(meta.requireCredential).toBe(false);
		expect(paramDef.properties.limit.maximum).toBe(50);
	});
	it('maps malformed/cross-query keyset cursors to a safe 400 API error', async () => {
		const endpoint = new PageEndpoint({ pagePublished: vi.fn().mockRejectedValue(new Error('INVALID_CATALOG_CURSOR')) } as never);
		await expect(endpoint.exec({ limit: 24, sort: 'newest', cursor: 'bad' } as never, null as never, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_INVALID', httpStatusCode: 400 });
	});
});
