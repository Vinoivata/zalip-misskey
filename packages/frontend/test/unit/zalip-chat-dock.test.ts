/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { createZalipChatDockState, zalipChatTargetKey, zalipChatTargetPath } from '@/utility/zalip-chat-dock.js';

describe('cinema mini-chat sessions', () => {
	it('accepts exactly one canonical target and rejects unsafe IDs', () => {
		expect(zalipChatTargetKey({ userId: 'abc123' })).toBe('user:abc123');
		expect(zalipChatTargetPath({ roomId: 'room1' })).toBe('/chat/room/room1');
		for (const target of [{}, { userId: 'u', roomId: 'r' }, { userId: '../other' }, { roomId: 'x'.repeat(33) }]) {
			expect(() => zalipChatTargetKey(target)).toThrow();
		}
	});

	it('does not open sessions anonymously or carry sessions across accounts', () => {
		const state = createZalipChatDockState();
		state.open({ userId: 'alice' });
		expect(state.windows.value).toEqual([]);
		state.setAccount('owner');
		state.open({ userId: 'alice' });
		state.listOpen.value = true;
		state.setAccount('different');
		expect(state.windows.value).toEqual([]);
		expect(state.listOpen.value).toBe(false);
		state.setAccount(null);
		expect(state.ownerId.value).toBeNull();
	});

	it('restores a minimized session without duplicates and bounds expanded windows', () => {
		const state = createZalipChatDockState();
		state.setAccount('owner');
		state.open({ userId: 'one' });
		state.open({ roomId: 'two' });
		state.open({ userId: 'three' });
		expect(state.windows.value.filter(item => !item.collapsed).map(item => item.key)).toEqual(['room:two', 'user:three']);
		state.open({ userId: 'one', title: 'One' }, 1);
		expect(state.windows.value).toHaveLength(3);
		expect(state.windows.value.filter(item => !item.collapsed).map(item => item.key)).toEqual(['user:one']);
		state.minimize('user:one');
		expect(state.windows.value.every(item => item.collapsed)).toBe(true);
		state.setTitle('user:one', 'Updated');
		expect(state.windows.value[0].title).toBe('Updated');
		state.close('user:one');
		expect(state.windows.value.map(item => item.key)).toEqual(['room:two', 'user:three']);
	});

	it('keeps only a bounded number of session headers', () => {
		const state = createZalipChatDockState();
		state.setAccount('owner');
		for (let index = 0; index < 20; index++) state.open({ userId: `u${index}` }, 1);
		expect(state.windows.value).toHaveLength(6);
		expect(state.windows.value.filter(item => !item.collapsed)).toHaveLength(1);
	});
});
