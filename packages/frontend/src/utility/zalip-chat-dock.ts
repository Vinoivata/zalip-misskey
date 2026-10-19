/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';

export type ZalipChatTarget = { userId?: string; roomId?: string; title?: string };
export type ZalipChatDockWindow = ZalipChatTarget & { key: string; collapsed: boolean };

export function zalipChatTargetKey(target: ZalipChatTarget): string {
	const id = target.userId ?? target.roomId;
	if (!!target.userId === !!target.roomId || !id || !/^[a-zA-Z0-9]{1,32}$/u.test(id)) throw new Error('Invalid chat target');
	return `${target.userId ? 'user' : 'room'}:${id}`;
}

export function zalipChatTargetPath(target: ZalipChatTarget): string {
	zalipChatTargetKey(target);
	return target.userId ? `/chat/user/${encodeURIComponent(target.userId)}` : `/chat/room/${encodeURIComponent(target.roomId!)}`;
}

/** No messages, drafts, or credentials are stored here or persisted across accounts. */
export function createZalipChatDockState() {
	const windows = ref<ZalipChatDockWindow[]>([]);
	const listOpen = ref(false);
	const ownerId = ref<string | null>(null);

	function setAccount(id: string | null): void {
		if (ownerId.value === id) return;
		ownerId.value = id;
		windows.value = [];
		listOpen.value = false;
	}

	function open(target: ZalipChatTarget, visibleLimit = 2): void {
		if (ownerId.value == null) return;
		const key = zalipChatTargetKey(target);
		const limit = Math.max(1, Math.min(2, Math.trunc(visibleLimit) || 1));
		const existing = windows.value.find(item => item.key === key);
		if (existing) {
			existing.collapsed = false;
			if (target.title) existing.title = target.title;
		} else {
			// Keep at most six headers; an old closed session never remains mounted.
			if (windows.value.length >= 6) windows.value.shift();
			windows.value.push({ ...target, key, collapsed: false });
		}
		const others = windows.value.filter(item => item.key !== key && !item.collapsed);
		for (const item of others.slice(0, Math.max(0, others.length - limit + 1))) item.collapsed = true;
		listOpen.value = false;
	}

	function minimize(key: string): void {
		const item = windows.value.find(window => window.key === key);
		if (item) item.collapsed = true;
	}

	function close(key: string): void { windows.value = windows.value.filter(item => item.key !== key); }

	function setTitle(key: string, title: string): void {
		const item = windows.value.find(window => window.key === key);
		if (item) item.title = title;
	}

	return { windows, listOpen, ownerId, setAccount, open, minimize, close, setTitle };
}

export const zalipChatDock = createZalipChatDockState();
