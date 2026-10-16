/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Redis marker writes and realtime transport may use different connections/servers. */
export function createChatUnreadReconciler(read: () => Promise<boolean>, apply: (unread: boolean) => void, notify: () => void): (newMessage?: boolean) => Promise<void> {
	let generation = 0;
	return async (newMessage = false) => {
		const request = ++generation;
		try {
			const unread = await read();
			if (request !== generation) return;
			apply(unread);
			if (newMessage && unread) notify();
		} catch { /* Preserve the last confirmed state when the authoritative refresh fails. */ }
	};
}
