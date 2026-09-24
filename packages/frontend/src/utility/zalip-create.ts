/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { pleaseLogin } from '@/utility/please-login.js';

export async function writeZalipPost(): Promise<void> {
	if (!await pleaseLogin()) return;
	void os.post();
}

export function openZalipCreateMenu(event: PointerEvent): void {
	if (!$i?.isAdmin) {
		void writeZalipPost();
		return;
	}
	void os.popupMenu([
		{ text: i18n.ts.zalip.feedQuickPost, icon: 'ti ti-pencil', action: writeZalipPost },
		{ type: 'link', text: i18n.ts.zalip.addContent, icon: 'ti ti-movie', to: '/zalip/editor' },
	], event.currentTarget ?? event.target);
}
