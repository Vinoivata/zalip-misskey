/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import MkChannelFollowButton from '@/components/MkChannelFollowButton.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), alert: vi.fn(), login: vi.fn(), session: null as Ref<{ id: string; token: string } | null> | null }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref(null); return { get $i() { return controls.session!.value; } }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/os.js', () => ({ alert: controls.alert }));

function channel(patch: Partial<Misskey.entities.Channel> = {}): Misskey.entities.Channel { return { id: 'club', name: 'Cinema club', isFollowing: false, ...patch } as Misskey.entities.Channel; }

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.session!.value = { id: 'viewer', token: 'fixture-token' }; controls.api.mockResolvedValue(undefined); controls.alert.mockResolvedValue(undefined); controls.login.mockResolvedValue(false); });
afterEach(cleanup);

describe('native community subscriptions', () => {
	it('follows and unfollows the exact native channel only after explicit clicks', async () => {
		const view = render(MkChannelFollowButton, { props: { channel: channel(), full: true } }); expect(controls.api).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.follow + ' Cinema club' })); await settle(); expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/follow', { channelId: 'club' }, 'fixture-token');
		expect(view.getByRole('button', { pressed: true })).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.unfollow + ' Cinema club' })); await settle(); expect(controls.api.mock.lastCall).toEqual(['channels/unfollow', { channelId: 'club' }, 'fixture-token']); expect(view.emitted().changed).toEqual([[true], [false]]);
	});
	it('asks guests to sign in and never calls a mutation API anonymously', async () => {
		controls.session!.value = null; const view = render(MkChannelFollowButton, { props: { channel: channel() } });
		await fireEvent.click(view.getByRole('button')); await settle(); expect(controls.login).toHaveBeenCalledTimes(1); expect(controls.api).not.toHaveBeenCalled();
	});
	it('prevents duplicate requests while pending and presents errors without pretending success', async () => {
		let reject!: (error: Error) => void; controls.api.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
		const view = render(MkChannelFollowButton, { props: { channel: channel() } }); await fireEvent.click(view.getByRole('button')); await fireEvent.click(view.getByRole('button')); expect(controls.api).toHaveBeenCalledTimes(1);
		reject(new Error('offline')); await settle(); expect(controls.alert).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: i18n.ts.somethingHappened }); expect(view.getByRole('button', { pressed: false })).toBeTruthy(); expect(view.emitted().changed).toBeUndefined();
	});
	it.each(['channel', 'account', 'token', 'unmount'] as const)('does not apply an old mutation after %s changes', async kind => {
		let finish!: () => void; controls.api.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
		const view = render(MkChannelFollowButton, { props: { channel: channel() } }); await fireEvent.click(view.getByRole('button'));
		if (kind === 'channel') await view.rerender({ channel: channel({ id: 'other', name: 'Other' }) });
		if (kind === 'account') controls.session!.value = { id: 'other', token: 'other-fixture-token' };
		if (kind === 'token') controls.session!.value!.token = 'new-fixture-token';
		if (kind === 'unmount') view.unmount();
		await settle(); finish(); await settle(); expect(view.emitted().changed).toBeUndefined(); expect(controls.alert).not.toHaveBeenCalled();
	});
});
