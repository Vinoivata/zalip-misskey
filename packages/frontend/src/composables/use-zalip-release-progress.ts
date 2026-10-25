/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onActivated, shallowRef, toValue, watch } from 'vue';
import type { MaybeRefOrGetter } from 'vue';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';
import { $i } from '@/i.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type Owner = { id: string; token?: string };
type Entry = { progress: WatchProgress | null; pending: boolean; failed: boolean; expiresAt: number };
type Waiter = { promise: Promise<void>; resolve: () => void };

/** Batch only requested native targets. The private snapshot is never persisted. */
export function createZalipReleaseProgressCache(account: () => Owner | null, fetchBatch: (workIds: string[]) => Promise<{ items: WatchProgress[] }>, now: () => number = Date.now) {
	const entries = shallowRef<ReadonlyMap<string, Entry>>(new Map());
	let owner: Owner | null = null;
	let generation = 0;
	let scheduled = false;
	let running: number | null = null;
	const queued = new Set<string>();
	const waiters = new Map<string, Waiter>();
	const sameOwner = (left: Owner | null, right: Owner | null) => left?.id === right?.id && left?.token === right?.token;
	const owned = () => owner != null && sameOwner(owner, account());

	function replace(next: Map<string, Entry>): void {
		while (next.size > 200) next.delete(next.keys().next().value!);
		entries.value = next;
	}

	function synchronize(): Owner | null {
		const current = account();
		if (!sameOwner(owner, current)) {
			generation++;
			owner = current ? { ...current } : null;
			scheduled = false;
			running = null;
			queued.clear();
			for (const waiter of waiters.values()) waiter.resolve();
			waiters.clear();
			entries.value = new Map();
		}
		return current;
	}

	async function drain(epoch: number): Promise<void> {
		if (epoch !== generation) return;
		scheduled = false;
		running = epoch;
		const captured = owner ? { ...owner } : null;
		try {
			while (epoch === generation && sameOwner(captured, account()) && queued.size) {
				const ids = Array.from(queued).slice(0, 50);
				for (const id of ids) queued.delete(id);
				try {
					const result = await fetchBatch(ids);
					if (epoch !== generation || !sameOwner(captured, account())) return;
					const rows = new Map<string, WatchProgress>();
					for (const item of result.items) if (ids.includes(item.workId) && !rows.has(item.workId)) rows.set(item.workId, item);
					const next = new Map(entries.value);
					for (const id of ids) if (next.has(id)) next.set(id, { progress: rows.get(id) ?? null, pending: false, failed: false, expiresAt: now() + 30_000 });
					replace(next);
				} catch {
					if (epoch !== generation || !sameOwner(captured, account())) return;
					const next = new Map(entries.value);
					for (const id of ids) if (next.has(id)) next.set(id, { progress: null, pending: false, failed: true, expiresAt: now() + 10_000 });
					replace(next);
				} finally {
					if (epoch === generation) for (const id of ids) { waiters.get(id)?.resolve(); waiters.delete(id); }
				}
			}
		} finally {
			if (running === epoch) running = null;
			if (epoch === generation && !sameOwner(owner, account())) synchronize();
		}
	}

	function request(workId: string, force = false): Promise<void> {
		if (synchronize() == null || !workId || workId.length > 32) return Promise.resolve();
		const pending = waiters.get(workId);
		if (pending) return pending.promise;
		const existing = entries.value.get(workId);
		if (!force && existing && existing.expiresAt > now()) {
			const next = new Map(entries.value); next.delete(workId); next.set(workId, existing); replace(next);
			return Promise.resolve();
		}
		let resolve!: () => void;
		const promise = new Promise<void>(done => { resolve = done; });
		waiters.set(workId, { promise, resolve });
		const next = new Map(entries.value); next.delete(workId); next.set(workId, { progress: null, pending: true, failed: false, expiresAt: 0 }); replace(next);
		queued.add(workId);
		if (!scheduled && running !== generation) {
			scheduled = true;
			const epoch = generation;
			void Promise.resolve().then(() => drain(epoch));
		}
		return promise;
	}

	return {
		request,
		lookup: (workId: string) => owned() ? entries.value.get(workId)?.progress ?? null : null,
		pending: (workId: string) => owned() && (entries.value.get(workId)?.pending ?? false),
		failed: (workId: string) => owned() && (entries.value.get(workId)?.failed ?? false),
		size: computed(() => owned() ? entries.value.size : 0),
	};
}

const cache = createZalipReleaseProgressCache(
	() => $i ? { id: $i.id, token: $i.token } : null,
	workIds => misskeyApiZalip<{ items: WatchProgress[] }>('zalip/progress/batch', { workIds }),
);

export function useZalipReleaseProgress(workId: MaybeRefOrGetter<string>, enabled: MaybeRefOrGetter<boolean> = true) {
	const load = () => toValue(enabled) ? cache.request(toValue(workId)) : Promise.resolve();
	watch(() => [$i?.id, $i?.token, toValue(workId), toValue(enabled)], load, { immediate: true, flush: 'sync' });
	// Revalidate an inbox revisited after playback, still coalescing its rows.
	onActivated(() => { if (toValue(enabled)) void cache.request(toValue(workId), true); });
	return {
		item: computed(() => toValue(enabled) ? cache.lookup(toValue(workId)) : null),
		pending: computed(() => toValue(enabled) && cache.pending(toValue(workId))),
		failed: computed(() => toValue(enabled) && cache.failed(toValue(workId))),
	};
}
