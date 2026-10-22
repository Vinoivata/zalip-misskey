/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ImportWorkState } from '@/utility/zalip-importer.js';

export type ImportPlayerRefreshRequest = { workId: string; source: 'vibix'; expected: string };
export type ImportPlayerRefreshResult = {
	workId: string;
	source: 'vibix';
	status: 'queued' | 'stale' | 'locked' | 'unsupported' | 'ambiguous' | 'busy';
	runId: string | null;
	playbackRevision: string;
};

/** Only saved protection is eligible; this action must never save locks or reuse import options. */
export function importerPlayerRefreshRequest(state: ImportWorkState | null, workId: string, pendingLocks: readonly string[], configured: boolean): ImportPlayerRefreshRequest | null {
	if (!configured || !state || state.workId !== workId || !/^[A-Za-z0-9]{1,32}$/u.test(workId) || !/^[a-f0-9]{64}$/u.test(state.playbackRevision ?? '') || state.locks.includes('players')) return null;
	const locks = new Set(pendingLocks);
	if (pendingLocks.length !== state.locks.length || locks.size !== state.locks.length || !state.locks.every(field => locks.has(field))) return null;
	return { workId, source: 'vibix', expected: state.playbackRevision! };
}
