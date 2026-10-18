/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { shallowReactive } from 'vue';

export type FollowActor = { id: string; token: string };
export type FollowRelation = {
	id: string;
	isFollowing: boolean;
	hasPendingFollowRequestFromYou: boolean;
	isBlocking: boolean;
	isBlocked: boolean;
};
export type FollowRelationState = {
	relation: FollowRelation | null;
	loading: boolean;
	changing: boolean;
	failed: boolean;
};
type Entry = FollowRelationState & { expires: number; version: number; promise?: Promise<FollowRelation | null> };
type Job = { id: string; entry: Entry; version: number; actor: FollowActor; epoch: number; resolve: (relation: FollowRelation | null) => void; promise: Promise<FollowRelation | null> };

export function sameFollowActor(left: FollowActor | null, right: FollowActor | null): boolean {
	return left?.id === right?.id && left?.token === right?.token;
}

function parseRelation(value: unknown, id: string): FollowRelation | null {
	if (!value || typeof value !== 'object') return null;
	const row = value as Record<string, unknown>;
	if (row.id !== id || !['isFollowing', 'hasPendingFollowRequestFromYou', 'isBlocking', 'isBlocked'].every(key => typeof row[key] === 'boolean')) return null;
	return { id, isFollowing: row.isFollowing as boolean, hasPendingFollowRequestFromYou: row.hasPendingFollowRequestFromYou as boolean, isBlocking: row.isBlocking as boolean, isBlocked: row.isBlocked as boolean };
}

/** Private, demand-only relationship reads: one batch at a time, no user profile requests. */
export function createFollowRelationsCache(options: {
	actor: () => FollowActor | null;
	request: (ids: string[], actor: FollowActor, signal: AbortSignal) => Promise<unknown>;
	now?: () => number;
	maxEntries?: number;
	ttlMs?: number;
}) {
	const now = options.now ?? Date.now;
	const maxEntries = Math.max(1, Math.min(256, options.maxEntries ?? 256));
	const ttlMs = options.ttlMs ?? 30_000;
	const entries = shallowReactive(new Map<string, Entry>());
	const waiting = new Map<string, Job>();
	let actor: FollowActor | null = null;
	let epoch = 0;
	let running = false;
	let scheduled = false;
	let controller: AbortController | undefined;

	function clear(): void {
		epoch++;
		controller?.abort();
		for (const job of waiting.values()) job.resolve(null);
		waiting.clear();
		entries.clear();
	}

	function syncActor(): FollowActor | null {
		const nextActor = options.actor();
		if (!sameFollowActor(actor, nextActor)) { clear(); actor = nextActor ? { ...nextActor } : null; }
		return actor;
	}

	function current(job: Job): boolean {
		return sameFollowActor(options.actor(), job.actor) && epoch === job.epoch && entries.get(job.id) === job.entry && job.entry.version === job.version;
	}

	function schedule(): void {
		if (scheduled || running || waiting.size === 0) return;
		scheduled = true;
		queueMicrotask(() => { scheduled = false; void drain(); });
	}

	async function drain(): Promise<void> {
		if (running || waiting.size === 0) return;
		syncActor();
		const jobs = [...waiting.values()].slice(0, 50);
		if (jobs.length === 0) return;
		for (const job of jobs) waiting.delete(job.id);
		running = true;
		const abort = new AbortController();
		controller = abort;
		const timeout = window.setTimeout(() => abort.abort(), 15_000);
		let response: unknown;
		try { response = await options.request(jobs.map(job => job.id), jobs[0].actor, abort.signal); } catch { /* No automatic retries or error payload retention. */ } finally { window.clearTimeout(timeout); if (controller === abort) controller = undefined; }
		for (const job of jobs) {
			let relation: FollowRelation | null = null;
			if (current(job)) {
				const matches = Array.isArray(response) ? response.filter(value => value && typeof value === 'object' && (value as Record<string, unknown>).id === job.id) : [];
				relation = matches.length === 1 ? parseRelation(matches[0], job.id) : null;
				job.entry.relation = relation;
				job.entry.failed = relation === null;
				job.entry.expires = relation ? now() + ttlMs : 0;
				job.entry.loading = false;
				job.entry.promise = undefined;
			}
			job.resolve(relation);
		}
		running = false;
		schedule();
	}

	function ensure(id: string): Entry | null {
		const existing = entries.get(id);
		if (existing) { entries.delete(id); entries.set(id, existing); return existing; }
		while (entries.size >= maxEntries) {
			const idle = [...entries].find(([, entry]) => !entry.loading && !entry.changing);
			if (!idle) return null;
			entries.delete(idle[0]);
		}
		const entry = shallowReactive<Entry>({ relation: null, loading: false, changing: false, failed: false, expires: 0, version: 0 });
		entries.set(id, entry);
		return entry;
	}

	function invalidate(id: string): void {
		syncActor();
		const entry = entries.get(id);
		if (!entry) return;
		entry.version++;
		entry.expires = 0;
		entry.relation = null;
		entry.promise = undefined;
		entry.loading = false;
		waiting.get(id)?.resolve(null);
		waiting.delete(id);
	}

	function load(id: string, force = false): Promise<FollowRelation | null> {
		const captured = syncActor();
		if (!captured || id === captured.id) return Promise.resolve(null);
		if (force) invalidate(id);
		const entry = ensure(id);
		if (!entry) return Promise.resolve(null);
		if (entry.promise) return entry.promise;
		if (entry.relation && entry.expires > now()) return Promise.resolve(entry.relation);
		entry.loading = true;
		entry.failed = false;
		let resolve!: Job['resolve'];
		const promise = new Promise<FollowRelation | null>(done => { resolve = done; });
		entry.promise = promise;
		waiting.set(id, { id, entry, version: entry.version, actor: { ...captured }, epoch, resolve, promise });
		schedule();
		return promise;
	}

	return {
		load,
		invalidate,
		invalidateAll(): void { syncActor(); for (const id of entries.keys()) invalidate(id); },
		clear,
		peek(id: string): Readonly<FollowRelationState> | undefined { syncActor(); return entries.get(id); },
		lock(id: string): (() => void) | null {
			syncActor();
			const entry = entries.get(id);
			if (!entry || entry.changing) return null;
			entry.changing = true;
			return () => { entry.changing = false; };
		},
	};
}
