/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onMounted } from 'vue';

/** Refresh personal pages after returning from a cached title, without two initial requests. */
export function useZalipPageReload(load: () => Promise<void>): void {
	let activated = false;
	onMounted(() => { void load(); });
	onActivated(() => {
		if (activated) void load();
		activated = true;
	});
}
