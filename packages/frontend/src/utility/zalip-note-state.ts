/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowReactive } from 'vue';

export type NoteStateActor = { id: string; token: string };
export type BookmarkNoteState = { isFavorited: boolean; isMutedThread: boolean };
type Entry = { state: BookmarkNoteState | null; loading: boolean; changing: boolean; expires: number; version: number; promise?: Promise<BookmarkNoteState | null>; controller?: AbortController };

export function sameNoteStateActor(left: NoteStateActor | null, right: NoteStateActor | null): boolean {
	return left?.id === right?.id && left?.token === right?.token;
}

/** Bounded private state. Native notes/state is per-note: only duplicate reads can coalesce. */
export function createNoteStateCache(options: {
	actor: () => NoteStateActor | null;
	request: (id: string, actor: NoteStateActor, signal: AbortSignal) => Promise<unknown>;
	now?: () => number;
	maxEntries?: number;
	ttlMs?: number;
}) {
	const entries = shallowReactive(new Map<string, Entry>());
	const now = options.now ?? Date.now;
	const ttl = options.ttlMs ?? 30_000;
	const capacity = Math.max(1, Math.min(256, options.maxEntries ?? 256));
	let actor: NoteStateActor | null = null;
	let epoch = 0;

	function clear(): void {
		epoch++;
		for (const entry of entries.values()) entry.controller?.abort();
		entries.clear();
	}

	function syncActor(): NoteStateActor | null {
		const next = options.actor();
		if (!sameNoteStateActor(actor, next)) { clear(); actor = next ? { ...next } : null; }
		return actor;
	}

	function ensure(id: string): Entry | null {
		const existing = entries.get(id);
		if (existing) { entries.delete(id); entries.set(id, existing); return existing; }
		while (entries.size >= capacity) {
			const idle = [...entries].find(([, entry]) => !entry.loading && !entry.changing);
			if (!idle) return null;
			entries.delete(idle[0]);
		}
		const entry = shallowReactive<Entry>({ state: null, loading: false, changing: false, expires: 0, version: 0 });
		entries.set(id, entry);
		return entry;
	}

	function invalidate(id: string): void {
		syncActor();
		const entry = entries.get(id);
		if (!entry) return;
		entry.version++;
		entry.controller?.abort();
		entry.controller = undefined;
		entry.promise = undefined;
		entry.loading = false;
		entry.expires = 0;
	}

	function load(id: string, force = false): Promise<BookmarkNoteState | null> {
		const captured = syncActor();
		if (!captured || !id) return Promise.resolve(null);
		const entry = ensure(id);
		if (!entry) return Promise.resolve(null);
		if (entry.promise) return entry.promise;
		if (!force && entry.state && entry.expires > now()) return Promise.resolve(entry.state);
		const generation = epoch; const version = entry.version;
		const current = (): boolean => epoch === generation && entry.version === version && entries.get(id) === entry && sameNoteStateActor(captured, options.actor());
		const controller = new AbortController();
		entry.controller = controller;
		entry.loading = true;
		const timeout = window.setTimeout(() => controller.abort(), 15_000);
		entry.promise = Promise.resolve().then(() => options.request(id, captured, controller.signal)).then(value => {
			if (!current() || !value || typeof value !== 'object') return null;
			const row = value as Partial<BookmarkNoteState>;
			if (typeof row.isFavorited !== 'boolean' || typeof row.isMutedThread !== 'boolean') return null;
			entry.state = { isFavorited: row.isFavorited, isMutedThread: row.isMutedThread };
			entry.expires = now() + ttl;
			return entry.state;
		}).catch(() => null).finally(() => {
			window.clearTimeout(timeout);
			if (current()) { entry.loading = false; entry.promise = undefined; entry.controller = undefined; }
		});
		return entry.promise;
	}

	return {
		load, clear, invalidate,
		peek(id: string): Readonly<Entry> | undefined { syncActor(); return entries.get(id); },
		confirmFavorite(id: string, saved: boolean, captured: NoteStateActor): void {
			if (!sameNoteStateActor(syncActor(), captured)) return;
			const entry = ensure(id);
			if (!entry) return;
			invalidate(id); // A pre-write read must never undo a confirmed successful mutation.
			if (entry.state) entry.state = { ...entry.state, isFavorited: saved };
			entry.expires = now() + ttl;
		},
		lock(id: string): (() => void) | null {
			if (!syncActor()) return null;
			const entry = ensure(id);
			if (!entry || entry.changing) return null;
			entry.changing = true;
			return () => { entry.changing = false; };
		},
	};
}
