/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { ImportWorkState } from '@/utility/zalip-importer.js';
import { importerPlayerRefreshRequest } from '@/utility/zalip-importer-player-refresh.js';

const state: ImportWorkState = { workId: 'work1', title: 'Existing title', locks: ['title', 'posterUrl'], playbackRevision: 'a'.repeat(64), fields: [] };

describe('existing-title Vibix player refresh request', () => {
	it('emits only the fixed source, saved target and revision without mutating protection', () => {
		const before = structuredClone(state);
		expect(importerPlayerRefreshRequest(state, 'work1', ['posterUrl', 'title'], true)).toEqual({ workId: 'work1', source: 'vibix', expected: 'a'.repeat(64) });
		expect(state).toEqual(before);
	});
	it.each<[ImportWorkState | null, string, readonly string[], boolean]>([
		[null, 'work1', [], true],
		[state, 'work2', state.locks, true],
		[{ ...state, workId: 'bad/id' }, 'bad/id', state.locks, true],
		[{ ...state, playbackRevision: undefined }, 'work1', state.locks, true],
		[{ ...state, playbackRevision: 'A'.repeat(64) }, 'work1', state.locks, true],
		[{ ...state, locks: ['players'] }, 'work1', ['players'], true],
		[state, 'work1', ['title'], true],
		[state, 'work1', ['title', 'posterUrl', 'players'], true],
		[state, 'work1', ['title', 'posterUrl', 'title'], true],
		[state, 'work1', state.locks, false],
	])('rejects unloaded, changed, protected or unconfigured input (%#)', (value, workId, locks, configured) => {
		expect(importerPlayerRefreshRequest(value, workId, locks, configured)).toBeNull();
	});
});
