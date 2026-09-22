/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { popupAsyncWithDialog } from '@/os.js';

export async function openZalipSignup(): Promise<void> {
	const { dispose } = await popupAsyncWithDialog(import('@/components/MkSignupDialog.vue').then(x => x.default), {
		autoSet: true,
	}, {
		closed: () => dispose(),
	});
}
