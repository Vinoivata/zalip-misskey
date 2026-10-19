/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ZalipChatTarget } from '@/utility/zalip-chat-dock.js';
import { $i } from '@/i.js';
import { mainRouter } from '@/router.js';
import { deviceKind } from '@/utility/device-kind.js';
import { zalipChatDock, zalipChatTargetPath } from '@/utility/zalip-chat-dock.js';

/** A mini-chat is only opened by an explicit action, never by an incoming message. */
export function openZalipChat(target: ZalipChatTarget): void {
	if (!$i || $i.policies.chatAvailability === 'unavailable') return;
	const path = zalipChatTargetPath(target);
	if (deviceKind !== 'desktop' || window.innerWidth <= 1099 || /^\/chat(?:\/|$)/u.test(mainRouter.currentRoute.value.path)) {
		mainRouter.pushByPath(path);
		return;
	}
	zalipChatDock.setAccount($i.id);
	zalipChatDock.open(target, window.innerWidth >= 1600 ? 2 : 1);
}
