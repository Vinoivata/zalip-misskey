/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import List, { meta as listMeta } from './list.js';
import Show, { meta as showMeta } from './show.js';

vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));

function fixture() {
	const service = { listEntries: vi.fn().mockResolvedValue([]), showEntry: vi.fn().mockResolvedValue({ entry: {}, works: [], nextCursor: null }), listWorkEntries: vi.fn().mockResolvedValue([]) };
	return { service, list: new List(service as unknown as ZalipTaxonomyService), show: new Show(service as unknown as ZalipTaxonomyService) };
}

describe('public person directory and filmography contract', () => {
	test('anonymous endpoints always force published-only access and retain the existing response shape', async () => {
		const { service, list, show } = fixture();
		expect(listMeta.requireCredential).toBe(false); expect(showMeta.requireCredential).toBe(false);
		await expect(list.exec({ type: 'person', query: 'Alias', role: 'actor', limit: 10 }, null, null)).resolves.toEqual({ entries: [] });
		expect(service.listEntries).toHaveBeenCalledWith({ type: 'person', query: 'Alias', role: 'actor', limit: 10, offset: 0, publishedOnly: true });
		await expect(show.exec({ type: 'person', slug: 'person-tmdb-10', role: 'director', kind: 'movie', yearFrom: 2000, yearTo: 2026, sort: 'newest' }, null, null)).resolves.toEqual({ entry: {}, works: [], nextCursor: null });
		expect(service.showEntry).toHaveBeenCalledWith({ entryId: undefined, type: 'person', slug: 'person-tmdb-10', limit: 100, cursor: undefined, role: 'director', kind: 'movie', yearFrom: 2000, yearTo: 2026, sort: 'newest', publishedOnly: true });
	});

	test('rejects unknown roles/types/sorts, out-of-range years and private selectors before service access', async () => {
		const { service, list, show } = fixture();
		for (const params of [{ role: 'unknown' }, { sort: 'DROP TABLE' }, { kind: 'book' }, { yearFrom: 1799 }, { yearTo: 3001 }, { yearFrom: 2020.5 }, { publishedOnly: false }, { role: 'actor', admin: true }]) await expect(show.exec({ entryId: 'entry01', ...params }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const params of [{ role: 'unknown' }, { query: 'x'.repeat(257) }, { publishedOnly: false }, { offset: 10001 }]) await expect(list.exec(params, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.showEntry).not.toHaveBeenCalled(); expect(service.listEntries).not.toHaveBeenCalled();
	});

	test('work membership lookup cannot accidentally consume filmography filters or cursors', async () => {
		const { service, show } = fixture();
		for (const filters of [{ role: 'actor' }, { kind: 'movie' }, { yearFrom: 2000 }, { yearTo: 2026 }, { sort: 'title' }, { cursor: 'opaque' }]) await expect(show.exec({ workId: 'work01', ...filters }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.listWorkEntries).not.toHaveBeenCalled();
		await expect(show.exec({ workId: 'work01' }, null, null)).resolves.toEqual({ entries: [] });
		expect(service.listWorkEntries).toHaveBeenCalledWith('work01', { publishedOnly: true });
	});

	test('bounded larger cursor values accommodate Unicode title keys without permitting arbitrary encodings', async () => {
		const { service, show } = fixture(); const cursor = 'a'.repeat(1500);
		await show.exec({ entryId: 'entry01', cursor, limit: 1 }, null, null);
		expect(service.showEntry).toHaveBeenCalledWith(expect.objectContaining({ cursor, limit: 1, publishedOnly: true }));
		for (const value of ['', 'a'.repeat(2049), 'not/valid', 'padding=']) await expect(show.exec({ entryId: 'entry01', cursor: value }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.showEntry).toHaveBeenCalledTimes(1);
	});
});
