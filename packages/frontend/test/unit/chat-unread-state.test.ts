/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { createChatUnreadReconciler } from '@/utility/chat-unread-state.js';

describe('authoritative chat unread event reconciliation', () => {
	it('a stale read-state event cannot clear a newly unread dialog', async () => {
		const apply = vi.fn();
		const notify = vi.fn();
		const reconcile = createChatUnreadReconciler(async () => true, apply, notify);
		await reconcile(false);
		expect(apply).toHaveBeenCalledExactlyOnceWith(true);
		expect(notify).not.toHaveBeenCalled();
	});
	it('a delayed old message event cannot revive an already read badge or play a false sound', async () => {
		const apply = vi.fn();
		const notify = vi.fn();
		await createChatUnreadReconciler(async () => false, apply, notify)(true);
		expect(apply).toHaveBeenCalledExactlyOnceWith(false);
		expect(notify).not.toHaveBeenCalled();
	});
	it('ignores an older refresh after a subsequent new-message event', async () => {
		let finish!: (value: boolean) => void;
		const read = vi.fn<() => Promise<boolean>>().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(true);
		const apply = vi.fn();
		const notify = vi.fn();
		const reconcile = createChatUnreadReconciler(read, apply, notify);
		const older = reconcile(false);
		await reconcile(true);
		finish(false);
		await older;
		expect(apply).toHaveBeenCalledExactlyOnceWith(true);
		expect(notify).toHaveBeenCalledOnce();
	});
	it('keeps confirmed state on a failed API refresh', async () => {
		const apply = vi.fn();
		await createChatUnreadReconciler(async () => { throw new Error('offline'); }, apply, vi.fn())();
		expect(apply).not.toHaveBeenCalled();
	});
});
