/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { url } from '@@/js/config.js';
import type * as Misskey from 'misskey-js';
import type { MenuItem } from '@/types/menu.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { getCopyNoteLinkMenu } from '@/utility/get-note-menu.js';
import { isSupportShare } from '@/utility/navigator.js';

/** Share only the canonical URL, never private/CW content or its title. */
export function openZalipNoteShare(note: Misskey.entities.Note, anchor?: HTMLElement | null): void {
	const items: MenuItem[] = [getCopyNoteLinkMenu(note, i18n.ts.copyLink)];
	if (isSupportShare()) items.push({
		text: i18n.ts.share,
		icon: 'ti ti-share',
		action: () => { void navigator.share({ url: `${url}/notes/${note.id}` }).catch(() => {}); },
	});
	void os.popupMenu(items, anchor);
}
