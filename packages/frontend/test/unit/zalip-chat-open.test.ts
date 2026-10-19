/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openZalipChat } from '@/utility/zalip-chat.js';
import { zalipChatDock as dock } from '@/utility/zalip-chat-dock.js';

const controls = vi.hoisted(() => ({ account: null as { id: string; policies: { chatAvailability: string } } | null, device: 'desktop', path: '/zalip/title', push: vi.fn() }));
vi.mock('@/i.js', () => ({ get $i() { return controls.account; } }));
vi.mock('@/router.js', () => ({ mainRouter: { currentRoute: { value: { get path() { return controls.path; } } }, push: controls.push, pushByPath: controls.push } }));
vi.mock('@/utility/device-kind.js', () => ({ get deviceKind() { return controls.device; } }));

beforeEach(() => { controls.account = { id: 'viewer', policies: { chatAvailability: 'available' } }; controls.device = 'desktop'; controls.path = '/zalip/title'; controls.push.mockClear(); dock.setAccount(null); Object.defineProperty(window, 'innerWidth', { value: 1700, configurable: true }); });

describe('contextual native chat opening', () => {
	it('opens desktop mini-chats without navigating away from the current content', () => {
		openZalipChat({ userId: 'alice' }); expect(controls.push).not.toHaveBeenCalled(); expect(dock.windows.value[0].key).toBe('user:alice');
	});
	it('uses the full conversation on phones, narrow screens and existing chat routes', () => {
		controls.device = 'smartphone'; openZalipChat({ roomId: 'r1' }); expect(controls.push).toHaveBeenLastCalledWith('/chat/room/r1');
		controls.device = 'desktop'; Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true }); openZalipChat({ userId: 'u1' }); expect(controls.push).toHaveBeenLastCalledWith('/chat/user/u1');
		Object.defineProperty(window, 'innerWidth', { value: 1700, configurable: true }); controls.path = '/chat'; openZalipChat({ userId: 'u2' }); expect(controls.push).toHaveBeenLastCalledWith('/chat/user/u2'); expect(dock.windows.value).toEqual([]);
	});
	it('respects anonymous/role restrictions and refuses unsafe IDs', () => {
		controls.account = null; openZalipChat({ userId: 'alice' }); expect(dock.windows.value).toEqual([]);
		controls.account = { id: 'viewer', policies: { chatAvailability: 'unavailable' } }; openZalipChat({ userId: 'alice' }); expect(controls.push).not.toHaveBeenCalled();
		controls.account.policies.chatAvailability = 'available'; expect(() => openZalipChat({ roomId: '../settings' })).toThrow();
	});
});
