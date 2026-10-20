/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import MkZalipChatDock from '@/components/MkZalipChatDock.vue';
import { zalipChatDock as dock } from '@/utility/zalip-chat-dock.js';
import { $i } from '@/i.js';
import { mainRouter } from '@/router.js';
import { popups } from '@/os.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ push: vi.fn(), mounts: vi.fn(), unmounts: vi.fn() }));
vi.mock('@/i.js', async () => { const { reactive } = await import('vue'); return { $i: reactive({ id: 'viewer', policies: { chatAvailability: 'available' }, hasUnreadChatMessages: true }) }; });
vi.mock('@/router.js', async () => { const { ref } = await import('vue'); return { mainRouter: { currentRoute: ref({ path: '/zalip/title' }), push: controls.push, pushByPath: controls.push } }; });
vi.mock('@/os.js', async () => { const { ref } = await import('vue'); return { popups: ref([]) }; });
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/components/MkZalipChatConversation.vue', async () => {
	const { defineComponent, h, onMounted, onBeforeUnmount } = await import('vue');
	return { __esModule: true, default: defineComponent({ props: { userId: String, roomId: String, active: Boolean, compact: Boolean }, emits: ['loaded'], setup(props, { emit }) {
		onMounted(() => { controls.mounts(props.userId ?? props.roomId); emit('loaded', { title: 'Fixture conversation', user: props.userId ? { id: props.userId, username: `handle_${props.userId}`, name: 'Same name', host: null } : null, room: null }); });
		onBeforeUnmount(() => controls.unmounts(props.userId ?? props.roomId));
		return () => h('div', { 'data-testid': 'conversation', 'data-active': String(props.active) }, props.userId ?? props.roomId);
	} }) };
});
vi.mock('@/components/MkZalipChatSidebar.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { __esModule: true, default: defineComponent({ emits: ['select'], setup(_props, { emit }) { return () => h('button', { 'data-testid': 'sidebar', onClick: () => emit('select', { userId: 'alice', title: 'Alice' }) }, 'Select fixture'); } }) };
});

async function settle(): Promise<void> { for (let index = 0; index < 24; index++) { await Promise.resolve(); await nextTick(); } }
function resize(width: number): void { Object.defineProperty(window, 'innerWidth', { value: width, configurable: true }); window.dispatchEvent(new Event('resize')); }
function visibility(state: DocumentVisibilityState): void { Object.defineProperty(document, 'visibilityState', { value: state, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }
function setup() { return render(MkZalipChatDock, { global: { stubs: { MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }), MkAvatar: defineComponent({ props: ['user'], setup: props => () => h('span', { 'data-avatar-user': props.user.id }) }) } } }); }

beforeEach(() => {
	vi.clearAllMocks(); dock.setAccount(null); $i!.id = 'viewer'; $i!.policies.chatAvailability = 'available';
	mainRouter.currentRoute.value.path = '/zalip/title'; popups.value = []; resize(1700); visibility('visible');
});
afterEach(() => { cleanup(); dock.setAccount(null); visibility('visible'); });

describe('explicit cinema mini-chat mounting', () => {
	it('does not preload conversations; selecting a dialog leaves the title route and player alone', async () => {
		const view = setup(); await settle();
		expect(view.queryByTestId('sidebar')).toBeNull(); expect(view.queryByTestId('conversation')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.openMessages })); await settle();
		await fireEvent.click(view.getByTestId('sidebar')); await settle();
		expect(view.getByTestId('conversation').textContent).toBe('alice'); expect(controls.push).not.toHaveBeenCalled();
		expect(controls.mounts).toHaveBeenCalledTimes(1); expect(view.queryByTestId('sidebar')).toBeNull();
	});
	it('unmounts minimized conversations and pauses reads while a modal or hidden tab covers them', async () => {
		const view = setup(); dock.open({ userId: 'alice' }); await settle();
		expect(view.getByTestId('conversation').getAttribute('data-active')).toBe('true');
		visibility('hidden'); await settle(); expect(view.getByTestId('conversation').getAttribute('data-active')).toBe('false');
		visibility('visible'); popups.value = [{}] as typeof popups.value; await settle(); expect(view.getByTestId('conversation').getAttribute('data-active')).toBe('false');
		popups.value = []; await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.minimize })); await settle();
		expect(view.queryByTestId('conversation')).toBeNull(); expect(controls.unmounts).toHaveBeenCalledWith('alice');
		expect(dock.windows.value).toHaveLength(1);
	});
	it('removes old account windows and never keeps invisible mobile or full-page conversations mounted', async () => {
		const view = setup(); dock.open({ roomId: 'room' }); await settle();
		resize(800); await settle(); expect(view.queryByTestId('conversation')).toBeNull();
		resize(1700); await settle(); expect(view.getByTestId('conversation')).toBeTruthy();
		mainRouter.currentRoute.value.path = '/chat/user/alice'; await settle(); expect(view.queryByTestId('conversation')).toBeNull();
		mainRouter.currentRoute.value.path = '/zalip/title'; $i!.id = 'another'; await settle();
		expect(dock.windows.value).toEqual([]); expect(view.queryByTestId('conversation')).toBeNull();
		$i!.policies.chatAvailability = 'unavailable'; await settle(); expect(view.queryByRole('button')).toBeNull();
		$i!.policies.chatAvailability = 'available'; await settle(); dock.open({ userId: 'alice' }); await settle();
		expect(view.getByTestId('conversation').textContent).toBe('alice');
	});
	it('identifies a compact peer by avatar and username with one header and a profile link', async () => {
		const view = setup(); dock.open({ userId: 'alice', title: 'Same name' }); await settle();
		expect(view.getByText('@handle_alice')).toBeTruthy(); expect(view.getByRole('link', { name: /Fixture conversation/u }).getAttribute('href')).toBe('/@handle_alice'); expect(view.container.querySelector('[data-avatar-user="alice"]')).toBeTruthy(); expect(view.container.querySelectorAll('header')).toHaveLength(1);
	});
	it('does not disable a compact conversation for passive native tooltips or toasts', async () => {
		const view = setup(); dock.open({ userId: 'alice' }); await settle(); popups.value = [{ component: { __name: 'MkToast' }, props: {} }] as typeof popups.value; await settle(); expect(view.getByTestId('conversation').getAttribute('data-active')).toBe('true');
		popups.value = [{ component: { __name: 'MkDialog' }, props: {} }] as typeof popups.value; await settle(); expect(view.getByTestId('conversation').getAttribute('data-active')).toBe('false');
	});
});
