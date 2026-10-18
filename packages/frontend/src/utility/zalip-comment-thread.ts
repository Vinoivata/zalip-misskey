/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { reactive } from 'vue';
import type * as Misskey from 'misskey-js';
import type { InjectionKey } from 'vue';

export const COMMENT_REPLY_PAGE_SIZE = 10;
export const COMMENT_THREAD_MAX_DEPTH = 4;
export const COMMENT_THREAD_MAX_NOTES = 100;
export type CommentPageRequest = { noteId: string; limit: number; sinceId: string };
export type CommentThreadBudget = { take: (note: Misskey.entities.Note) => boolean };
export const commentThreadBudgetKey: InjectionKey<CommentThreadBudget> = Symbol('zalip-comment-thread-budget');

export function createCommentThreadBudget(limit = COMMENT_THREAD_MAX_NOTES): CommentThreadBudget {
	const ids = new Set<string>();
	return { take(note) {
		if (ids.has(note.id)) return true;
		if (ids.size >= limit) return false;
		ids.add(note.id);
		return true;
	} };
}

/** Each parent owns its raw server cursor; filtering never invents pagination. */
export function createCommentReplyPager(options: {
	parentId: string;
	ancestors?: readonly string[];
	accountId: () => string | null;
	fetchPage: (params: CommentPageRequest) => Promise<Misskey.entities.Note[]>;
	allowNote?: (note: Misskey.entities.Note) => boolean;
	budget?: CommentThreadBudget;
}) {
	const state = reactive({ items: [] as Misskey.entities.Note[], expanded: false, loaded: false, pending: false, error: false, hasMore: false, limited: false });
	const blocked = new Set([options.parentId, ...options.ancestors ?? []]);
	const budget = options.budget ?? createCommentThreadBudget();
	// Native IDs are alphanumeric; this minimal accepted sentinel requests ASC
	// without excluding federated replies timestamped before their parent.
	let cursor = '0';
	let generation = 0;

	function accept(note: Misskey.entities.Note): boolean {
		if (note.replyId !== options.parentId || blocked.has(note.id) || note.isHidden || note.deletedAt) return false;
		if (options.allowNote && !options.allowNote(note)) return false;
		if (state.items.some(item => item.id === note.id)) return false;
		if (!budget.take(note)) { state.limited = true; return false; }
		return true;
	}

	async function loadNext(): Promise<void> {
		if (state.pending || state.limited || (state.loaded && !state.hasMore && !state.error)) return;
		const epoch = generation;
		const account = options.accountId();
		const previousCursor = cursor;
		state.pending = true;
		state.error = false;
		try {
			const raw = await options.fetchPage({ noteId: options.parentId, limit: COMMENT_REPLY_PAGE_SIZE, sinceId: previousCursor });
			if (epoch !== generation || account !== options.accountId()) return;
			for (const note of raw) if (accept(note)) state.items.push(note);
			state.items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
			const next = raw.at(-1)?.id;
			state.hasMore = raw.length === COMMENT_REPLY_PAGE_SIZE && next != null && next > previousCursor && !state.limited;
			if (next && next > previousCursor) cursor = next;
			state.loaded = true;
		} catch {
			if (epoch === generation && account === options.accountId()) state.error = true;
		} finally {
			if (epoch === generation) state.pending = false;
		}
	}

	function toggle(): void {
		state.expanded = !state.expanded;
		if (state.expanded && !state.loaded) void loadNext();
	}

	function insert(note: Misskey.entities.Note): void {
		if (!state.expanded || !accept(note)) return;
		state.items.push(note);
		state.items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
	}

	function reset(): void {
		generation++;
		cursor = '0';
		Object.assign(state, { items: [], expanded: false, loaded: false, pending: false, error: false, hasMore: false, limited: false });
	}

	function remove(noteId: string): void { state.items = state.items.filter(note => note.id !== noteId); }

	return { state, toggle, loadNext, insert, reset, remove };
}
