/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import type * as Misskey from 'misskey-js';

export type CommunityDirectoryMode = 'discover' | 'following' | 'owned' | 'favorites';
export type CommunityDirectoryEndpoint = 'channels/search' | 'channels/followed' | 'channels/owned' | 'channels/my-favorites';
export type CommunityDirectoryParams = { limit: number; untilId?: string; query?: string; type?: 'nameAndDescription' };

/** Uses native channel IDs/cursors and never creates a separate group/subscription model. */
export function createCommunityDirectory(options: {
	accountId: () => string | null;
	token: () => string | null;
	fetchPage: (endpoint: CommunityDirectoryEndpoint, params: CommunityDirectoryParams, token: string | null) => Promise<Misskey.entities.Channel[]>;
}) {
	const state = reactive({ items: [] as Misskey.entities.Channel[], pending: false, error: false, loaded: false, hasMore: false });
	let epoch = 0;
	let cursor: string | undefined;
	let mode: CommunityDirectoryMode = 'discover';
	let query = '';
	let stopped = false;
	const pageSize = 20;

	function reset(nextMode: CommunityDirectoryMode, nextQuery = ''): void {
		epoch++;
		mode = nextMode;
		query = nextQuery.trim();
		cursor = undefined;
		Object.assign(state, { items: [], pending: false, error: false, loaded: false, hasMore: false });
	}

	async function load(): Promise<void> {
		if (stopped || state.pending || (state.loaded && !state.hasMore)) return;
		const account = options.accountId();
		const token = options.token();
		if (mode !== 'discover' && !account) { state.loaded = true; return; }
		const request = epoch;
		const current = () => !stopped && request === epoch && options.accountId() === account && options.token() === token;
		const endpoint = ({ discover: 'channels/search', following: 'channels/followed', owned: 'channels/owned', favorites: 'channels/my-favorites' } as const)[mode];
		const params: CommunityDirectoryParams = { limit: pageSize + 1, ...(cursor ? { untilId: cursor } : {}), ...(mode === 'discover' ? { query, type: 'nameAndDescription' as const } : {}) };
		state.pending = true;
		state.error = false;
		try {
			const found = await options.fetchPage(endpoint, params, token);
			if (!current()) return;
			// Native favourites are returned as one unpaged list; never send a fake cursor.
			const page = mode === 'favorites' ? found : found.slice(0, pageSize);
			const existing = new Set(state.items.map(item => item.id));
			state.items.push(...page.filter(item => !existing.has(item.id)));
			const nextCursor = page.at(-1)?.id;
			state.hasMore = mode !== 'favorites' && found.length > pageSize && nextCursor !== cursor;
			cursor = nextCursor;
			state.loaded = true;
		} catch {
			if (current()) state.error = true;
		} finally {
			if (current()) state.pending = false;
		}
	}

	function dispose(): void { stopped = true; epoch++; }

	return { state, reset, load, dispose };
}
