/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { createCommunityDirectory } from '@/utility/zalip-communities.js';

function channel(id: string): Misskey.entities.Channel { return { id, name: id, isArchived: false } as Misskey.entities.Channel; }

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; }

function setup() {
	const session = { id: 'viewer' as string | null, token: 'fixture-token' as string | null };
	const api = vi.fn().mockResolvedValue([]);
	const directory = createCommunityDirectory({ accountId: () => session.id, token: () => session.token, fetchPage: api });
	return { session, api, directory };
}

describe('native community directory', () => {
	it('discovers even new empty communities via native search rather than active-only featured', async () => {
		const { api, directory } = setup(); api.mockResolvedValue([channel('new-empty')]);
		directory.reset('discover'); await directory.load();
		expect(api).toHaveBeenCalledExactlyOnceWith('channels/search', { limit: 21, query: '', type: 'nameAndDescription' }, 'fixture-token');
		expect(directory.state.items.map(item => item.id)).toEqual(['new-empty']); expect(directory.state.hasMore).toBe(false);
	});
	it('uses exact native follow/owned endpoints, excludes anonymous private queries and searches publicly', async () => {
		const { api, directory, session } = setup();
		directory.reset('following'); await directory.load(); expect(api.mock.calls[0][0]).toBe('channels/followed');
		directory.reset('owned'); await directory.load(); expect(api.mock.calls[1][0]).toBe('channels/owned');
		session.id = null; session.token = null; api.mockClear();
		directory.reset('following'); await directory.load(); expect(api).not.toHaveBeenCalled();
		directory.reset('discover', '  Films  '); await directory.load(); expect(api).toHaveBeenCalledExactlyOnceWith('channels/search', { limit: 21, query: 'Films', type: 'nameAndDescription' }, null);
	});
	it('probes one extra item then advances by the last displayed native channel ID without dropping the probe', async () => {
		const { api, directory } = setup(); api.mockResolvedValueOnce(Array.from({ length: 21 }, (_, index) => channel(String(30 - index)))).mockResolvedValueOnce([channel('10')]);
		directory.reset('following'); await directory.load(); expect(directory.state.items).toHaveLength(20); expect(directory.state.hasMore).toBe(true);
		await directory.load(); expect(api.mock.calls[1][1]).toEqual({ limit: 21, untilId: '11' }); expect(directory.state.items.at(-1)?.id).toBe('10'); expect(directory.state.hasMore).toBe(false);
	});
	it('does not truncate unpaged native favourites or invent another page', async () => {
		const { api, directory } = setup(); api.mockResolvedValue(Array.from({ length: 32 }, (_, index) => channel(String(index))));
		directory.reset('favorites'); await directory.load(); await directory.load(); expect(directory.state.items).toHaveLength(32); expect(api).toHaveBeenCalledTimes(1); expect(directory.state.hasMore).toBe(false);
	});
	it('coalesces duplicate load calls and retries an errored page with its original cursor', async () => {
		const { api, directory } = setup(); const pending = deferred<Misskey.entities.Channel[]>(); api.mockReturnValueOnce(pending.promise);
		directory.reset('discover'); const first = directory.load(); await directory.load(); expect(api).toHaveBeenCalledTimes(1);
		pending.reject(new Error('offline')); await first; expect(directory.state.error).toBe(true);
		api.mockResolvedValueOnce([channel('retry')]); await directory.load(); expect(directory.state.error).toBe(false); expect(directory.state.items[0].id).toBe('retry'); expect(api.mock.calls[0][1]).toEqual(api.mock.calls[1][1]);
	});
	it.each(['scope', 'account', 'token', 'dispose'] as const)('discards late results after %s changes', async kind => {
		const { api, directory, session } = setup(); const pending = deferred<Misskey.entities.Channel[]>(); api.mockReturnValueOnce(pending.promise);
		directory.reset('discover'); const loading = directory.load();
		if (kind === 'scope') directory.reset('following');
		if (kind === 'account') session.id = 'other';
		if (kind === 'token') session.token = 'new-fixture-token';
		if (kind === 'dispose') directory.dispose();
		pending.resolve([channel('old')]); await loading; expect(directory.state.items).toEqual([]); expect(directory.state.error).toBe(false);
	});
	it('cannot loop forever when a native endpoint returns the same cursor and duplicate rows', async () => {
		const { api, directory } = setup(); api.mockResolvedValue(Array.from({ length: 21 }, (_, index) => channel(String(30 - index))));
		directory.reset('discover'); await directory.load(); await directory.load(); await directory.load(); expect(api).toHaveBeenCalledTimes(2); expect(directory.state.items).toHaveLength(20); expect(directory.state.hasMore).toBe(false);
	});
});
