/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import type * as Misskey from 'misskey-js';

export type DiscussionPageRequest = { noteId: string; limit: number; sinceId?: string; untilId?: string };

/** Shared by post, title and episode discussions. Cursor always follows raw server rows. */
export function createZalipDiscussionPager(options: {
	accountId: () => string | null;
	fetchPage: (params: DiscussionPageRequest) => Promise<Misskey.entities.Note[]>;
}) {
	const state = reactive({ items: [] as Misskey.entities.Note[], pending: false, loaded: false, error: false, hasMore: false });
	let parentId = '';
	let ascending = false;
	let cursor: string | undefined;
	let epoch = 0;
	const removed = new Set<string>();

	function reset(noteId: string, oldestFirst = false): void {
		epoch++;
		parentId = noteId;
		ascending = oldestFirst;
		cursor = undefined;
		removed.clear();
		Object.assign(state, { items: [], pending: false, loaded: false, error: false, hasMore: false });
	}

	async function load(): Promise<void> {
		if (!parentId || state.pending || (state.loaded && !state.hasMore && !state.error)) return;
		const requestEpoch = epoch;
		const account = options.accountId();
		const previousCursor = cursor;
		state.pending = true;
		state.error = false;
		try {
			const raw = await options.fetchPage({ noteId: parentId, limit: 30, ...(ascending ? { sinceId: cursor ?? '0' } : cursor ? { untilId: cursor } : {}) });
			if (requestEpoch !== epoch || account !== options.accountId()) return;
			for (const note of raw) insert(note);
			const next = raw.at(-1)?.id;
			const advanced = next != null && (previousCursor == null || (ascending ? next > previousCursor : next < previousCursor));
			state.hasMore = raw.length === 30 && advanced;
			if (advanced) cursor = next;
			state.loaded = true;
		} catch {
			if (requestEpoch === epoch && account === options.accountId()) state.error = true;
		} finally {
			if (requestEpoch === epoch) state.pending = false;
		}
	}

	function insert(note: Misskey.entities.Note): void {
		if (note.replyId !== parentId || note.id === parentId || removed.has(note.id) || note.isHidden || note.deletedAt || state.items.some(item => item.id === note.id)) return;
		state.items.push(note);
		state.items.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * (ascending ? 1 : -1));
	}

	function remove(noteId: string): void {
		removed.add(noteId);
		state.items = state.items.filter(note => note.id !== noteId);
	}

	return { state, reset, load, insert, remove };
}
