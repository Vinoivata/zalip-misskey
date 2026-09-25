/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import MobileFooterMenu from '@/ui/_common_/mobile-footer-menu.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { openZalipSearch } from '@/utility/zalip-search.js';

vi.mock('@/i.js', async () => {
	const { reactive } = await import('vue');
	return { $i: reactive({ id: 'admin', username: 'Admin', hasUnreadChatMessages: false, hasUnreadNotification: false, unreadNotificationsCount: 0 }) };
});
vi.mock('@/navbar.js', () => ({ navbarItemDef: Object.fromEntries(['feed', 'zalip', 'profile', 'catalogue', 'library', 'updates'].map(key => [key, { title: key }])) }));
vi.mock('@/os.js', () => ({ claimZIndex: () => 2000, popupMenu: vi.fn(), confirm: vi.fn() }));
vi.mock('@/utility/zalip-theme.js', () => ({ getZalipAppearanceMenu: () => [] }));
vi.mock('@/utility/zalip-search.js', () => ({ openZalipSearch: vi.fn() }));
vi.mock('@/utility/zalip-create.js', () => ({ openZalipCreateMenu: vi.fn() }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/signout.js', () => ({ signout: vi.fn() }));

function setup() {
	return render(MobileFooterMenu, { global: { stubs: {
		transition: false,
		MkAvatar: true,
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign($i!, { hasUnreadChatMessages: false, hasUnreadNotification: false, unreadNotificationsCount: 0 });
});
afterEach(cleanup);

describe('mobile footer', () => {
	it('updates both unread indicators reactively and clears them on read', async () => {
		const view = setup();
		const messages = view.getByRole('link', { name: i18n.ts.zalip.messages });
		const notifications = view.getByRole('link', { name: i18n.ts.notifications });
		expect(messages.querySelector('span')).toBeNull();
		Object.assign($i!, { hasUnreadChatMessages: true, hasUnreadNotification: true, unreadNotificationsCount: 3 });
		await nextTick();
		expect(messages.querySelector('span')).not.toBeNull();
		expect(notifications.querySelector('span')?.textContent).toBe('3');
		expect(messages.getAttribute('aria-label')).toContain(i18n.ts.unread);
		Object.assign($i!, { hasUnreadChatMessages: false, hasUnreadNotification: false, unreadNotificationsCount: 0 });
		await nextTick();
		expect(messages.querySelector('span')).toBeNull();
		expect(notifications.querySelector('span')).toBeNull();
	});

	it('shows a notification count even when the boolean flag is stale', async () => {
		$i!.unreadNotificationsCount = 124;
		const view = setup();
		expect(view.container.querySelector('a[href="/my/notifications"] span')?.textContent).toBe('99+');
	});

	it.each(['appearance', 'search'])('removes the profile drawer before opening %s', async (action) => {
		const view = setup();
		const callback = action === 'appearance' ? vi.mocked(os.popupMenu) : vi.mocked(openZalipSearch);
		callback.mockImplementation(() => {
			expect(view.queryByRole('dialog')).toBeNull();
			expect(document.querySelector('#misskey_app')?.hasAttribute('inert')).not.toBe(true);
			return Promise.resolve();
		});
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.more }));
		expect(view.getByRole('dialog')).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: action === 'appearance' ? i18n.ts.zalip.appearanceTitle : i18n.ts.zalip.search }));
		await waitFor(() => expect(callback).toHaveBeenCalledTimes(1));
		expect(view.queryByRole('dialog')).toBeNull();
	});
});
