/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as os from '@/os.js';

export type ZalipSearchTab = 'catalogue' | 'movie' | 'series' | 'anime' | 'animation' | 'note' | 'user';

/** Opens the cross-product Zalip search without leaving the current context. */
export function openZalipSearch(initialTab: ZalipSearchTab = 'catalogue', initialQuery = ''): void {
	let dispose: () => void = () => {};

	void os.popupAsyncWithDialog(
		import('@/pages/zalip/search-dialog.vue').then(({ default: component }) => component),
		{ initialTab, initialQuery },
		{
			closed: () => dispose(),
		},
	).then((popup) => {
		dispose = popup.dispose;
	}).catch(() => {});
}
