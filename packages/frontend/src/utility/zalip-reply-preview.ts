/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type * as Misskey from 'misskey-js';

type Reply = Misskey.entities.Note | null;
type Entry = { expires: number; result: Promise<Reply> };

/** A short-lived, account-isolated cache. Never persists private reply content. */
export function createReplyPreviewCache(maxEntries = 100, ttlMs = 30_000, now: () => number = Date.now): {
	load: (accountId: string | null, noteId: string, fetchReply: () => Promise<Misskey.entities.Note[]>) => Promise<Reply>;
	clear: () => void;
} {
	const entries = new Map<string, Entry>();
	let currentAccount: string | null | undefined;
	let generation = 0;
	let running = 0;
	const waiting: Array<() => void> = [];
	const drain = (): void => {
		while (running < 3 && waiting.length > 0) waiting.shift()?.();
	};
	const schedule = (task: () => Promise<Reply>): Promise<Reply> => {
		if (waiting.length >= Math.max(1, maxEntries)) return Promise.resolve(null);
		return new Promise(resolve => {
			waiting.push(() => {
				running++;
				Promise.resolve().then(task).then(resolve, () => resolve(null)).finally(() => { running--; drain(); });
			});
			queueMicrotask(drain);
		});
	};
	const clear = (): void => { entries.clear(); generation++; };
	return {
		clear,
		load(accountId, noteId, fetchReply) {
			if (accountId !== currentAccount) { clear(); currentAccount = accountId; }
			const key = JSON.stringify([accountId, noteId]);
			const cached = entries.get(key);
			if (cached && cached.expires > now()) {
				entries.delete(key);
				entries.set(key, cached);
				return cached.result;
			}
			entries.delete(key);
			const epoch = generation;
			const result = schedule(async () => {
				if (epoch !== generation || entries.get(key)?.result !== result) return null;
				const replies = await fetchReply();
				if (epoch !== generation) return null;
				const reply = replies.at(0);
				return reply && reply.replyId === noteId && !reply.isHidden && !reply.deletedAt ? reply : null;
			});
			entries.set(key, { result, expires: now() + ttlMs });
			while (entries.size > Math.max(1, maxEntries)) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
			return result;
		},
	};
}

export const replyPreviewCache = createReplyPreviewCache();
