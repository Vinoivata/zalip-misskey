/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { nextTick, reactive } from 'vue';
import Common from '@/ui/_common_/common.vue';

const state = vi.hoisted(() => ({ route: null as { name?: string; path: string } | null }));
vi.mock('@/router.js', () => ({ mainRouter: { currentRoute: { get value() { return state.route; } } } }));
vi.mock('@/i.js', () => ({ $i: { id: 'viewer', isBot: false } }));
vi.mock('@/os.js', () => ({ popups: [] }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { animation: false } } }));
vi.mock('@/store.js', () => ({ store: { s: { realtimeMode: false } } }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ send: vi.fn(), useChannel: () => ({ on: vi.fn() }) }) }));
vi.mock('@/events.js', () => ({ globalEvents: { on: vi.fn() } }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { removeItem: vi.fn() } }));
vi.mock('@/utility/unison-reload.js', () => ({ unisonReload: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ pendingApiRequestsCount: 0 }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: vi.fn() }));
vi.mock('@/ui/_common_/sw-inject.js', () => ({ swInject: vi.fn() }));
vi.mock('@/ui/_common_/notification.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/navbar.vue', () => ({ default: { render: () => null } }));
vi.mock('@/components/MkZalipChatDock.vue', () => ({ __esModule: true, default: { template: '<button data-testid="quick-chat">Quick chat</button>' } }));

function setup() {
	return render(Common, { global: { stubs: { XStreamIndicator: true } } });
}
beforeEach(() => { state.route = reactive({ name: undefined, path: '/timeline' }); });
afterEach(cleanup);

describe('common quick chat entry', () => {
	it('removes the dock on watch and restores it on an ordinary route without a reload', async () => {
		const view = setup();
		await view.findByTestId('quick-chat');
		Object.assign(state.route!, { name: 'zalipWatch', path: '/zalip/:slug/watch' });
		await nextTick();
		expect(view.queryByTestId('quick-chat')).toBeNull();
		Object.assign(state.route!, { name: undefined, path: '/timeline' });
		await view.findByTestId('quick-chat');
	});

	it('does not mount a dock when opening a watch route directly', async () => {
		Object.assign(state.route!, { name: 'zalipWatch', path: '/zalip/:slug/watch' });
		const view = setup();
		await nextTick();
		expect(view.queryByTestId('quick-chat')).toBeNull();
	});

	it('does not confuse a title slug containing watch with the named playback route', async () => {
		Object.assign(state.route!, { name: 'zalipWork', path: '/zalip/:slug' });
		await setup().findByTestId('quick-chat');
	});
});
