/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { $i } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { createNoteStateCache, sameNoteStateActor } from '@/utility/zalip-note-state.js';
import type { NoteStateActor } from '@/utility/zalip-note-state.js';

export function noteBookmarkActor(): NoteStateActor | null { return $i ? { id: $i.id, token: $i.token } : null; }

export const noteBookmarkState = createNoteStateCache({ actor: noteBookmarkActor, request: (noteId, actor, signal) => misskeyApi('notes/state', { noteId }, actor.token, signal) });

/** Re-read before a write, serialize all copies, and reconcile ambiguous failures without retrying writes. */
export async function changeNoteBookmark(noteId: string, desired: boolean | undefined, valid: () => boolean): Promise<'changed' | 'unchanged' | 'unavailable' | 'cancelled'> {
	const actor = noteBookmarkActor();
	if (!actor || !valid()) return 'cancelled';
	const unlock = noteBookmarkState.lock(noteId);
	if (!unlock) return 'cancelled';
	const current = (): boolean => sameNoteStateActor(actor, noteBookmarkActor());
	try {
		const state = await noteBookmarkState.load(noteId, true);
		if (!current() || !valid()) return 'cancelled';
		if (!state) return 'unavailable';
		const saved = desired ?? !state.isFavorited;
		if (saved === state.isFavorited) return 'unchanged';
		try {
			await misskeyApi(saved ? 'notes/favorites/create' : 'notes/favorites/delete', { noteId }, actor.token);
			// A confirmed server success still belongs to other mounted copies if the initiating view closed.
			noteBookmarkState.confirmFavorite(noteId, saved, actor);
			return 'changed';
		} catch (error) {
			if (!current()) return 'cancelled';
			noteBookmarkState.invalidate(noteId);
			const confirmed = await noteBookmarkState.load(noteId, true);
			if (confirmed?.isFavorited === saved) return 'changed';
			if (current() && valid()) throw error;
			return 'cancelled';
		}
	} finally { unlock(); }
}
