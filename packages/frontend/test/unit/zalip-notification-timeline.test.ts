/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { nextTick, ref } from 'vue';
import type { Ref } from 'vue';
import type { entities } from 'misskey-js';
import Timeline from '@/components/MkStreamingNotificationsTimeline.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

const state = vi.hoisted(() => ({
	handlers: new Map<string, (notification?: entities.Notification) => void>(),
	send: vi.fn(), dispose: vi.fn(),
	visibility: null as Ref<DocumentVisibilityState> | null,
	preferences: { animation: false, enablePullToRefresh: false, useGroupedNotifications: false, enableInfiniteScroll: false, pollingInterval: 3 },
}));

vi.mock('@/preferences.js', () => ({ prefer: { s: state.preferences } }));
vi.mock('@/store.js', () => ({ store: { s: { realtimeMode: true } } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn() }));
vi.mock('@@/js/use-interval.js', () => ({ useInterval: vi.fn() }));
vi.mock('@@/js/use-document-visibility.js', () => ({ useDocumentVisibility: () => state.visibility }));
vi.mock('@@/js/scroll.js', () => ({ getScrollContainer: () => null, scrollToTop: vi.fn() }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ send: state.send, useChannel: () => ({ on: (name: string, listener: (notification?: entities.Notification) => void) => state.handlers.set(name, listener), dispose: state.dispose }) }) }));
vi.mock('@/components/MkNote.vue', () => ({ default: { props: ['note'], template: '<div data-testid="native-note">{{ note.id }}</div>' } }));
vi.mock('@/components/MkPullToRefresh.vue', () => ({ default: { template: '<div><slot/></div>' } }));
vi.mock('@/components/MkNotification.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({
		props: ['notification', 'releaseNotifications'],
		setup: props => () => h('section', { 'data-testid': 'notification-card' }, [
			h('p', { 'data-testid': 'notification-title' }, props.notification.workTitle ?? props.notification.type),
			...(props.releaseNotifications ?? [props.notification]).map((notification: entities.Notification) => h('button', { key: notification.id, 'data-notification-id': notification.id }, notification.id)),
		]),
	}) };
});

const timestamp = new Date(2026, 9, 12, 12).toISOString();
const release = (id: string, extra: { isRead?: boolean } = {}): entities.Notification => ({ type: 'zalipAllohaAvailable', id, createdAt: timestamp, workId: 'work', workSlug: 'series', workTitle: 'Series', seasonNumber: 1, episodeNumber: 1, translationCount: 2, ...extra });
const start = () => render(Timeline, { global: { stubs: { MkLoading: true, MkError: true, MkResult: true }, directives: { appear: {} } } });
const renderedIds = (container: Element) => Array.from(container.querySelectorAll('[data-notification-id]')).map(element => element.getAttribute('data-notification-id'));

beforeEach(() => {
	vi.clearAllMocks();
	state.handlers.clear();
	state.visibility = ref('visible');
	state.preferences.useGroupedNotifications = false;
	vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
	vi.mocked(misskeyApi).mockResolvedValue([release('n3'), release('n2')]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('native notification list presentation adapter', () => {
	it.each([false, true])('retains native endpoint and received ids with grouped-notification preference %s', async grouped => {
		state.preferences.useGroupedNotifications = grouped;
		const view = start();
		await waitFor(() => expect(renderedIds(view.container)).toEqual(['n3', 'n2']));
		expect(view.getAllByTestId('notification-card')).toHaveLength(1);
		expect(misskeyApi).toHaveBeenCalledExactlyOnceWith(grouped ? 'i/notifications-grouped' : 'i/notifications', expect.objectContaining({ limit: 20 }));
		expect(vi.mocked(misskeyApi).mock.calls[0][1]).not.toHaveProperty('markAsRead');
		expect(state.send).not.toHaveBeenCalled();
	});

	it('keeps raw pagination cursors while extending an already rendered group', async () => {
		vi.mocked(misskeyApi).mockResolvedValueOnce([release('n3'), release('n2')]).mockResolvedValueOnce([release('n1')]);
		const view = start();
		await view.findByText('n2');
		const card = view.getByTestId('notification-card');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadMore }));
		await waitFor(() => expect(renderedIds(view.container)).toEqual(['n3', 'n2', 'n1']));
		expect(view.getByTestId('notification-card')).toBe(card);
		expect(misskeyApi).toHaveBeenLastCalledWith('i/notifications', expect.objectContaining({ untilId: 'n2', limit: 30 }));
		expect(state.send).not.toHaveBeenCalled();
	});

	it('prepends a visible native event into the group without losing the previous focused event or adding read commands', async () => {
		const view = start();
		const focused = await view.findByRole('button', { name: 'n2' });
		focused.focus();
		const card = view.getByTestId('notification-card');
		state.handlers.get('notification')!(release('n4'));
		await waitFor(() => expect(renderedIds(view.container)).toEqual(['n4', 'n3', 'n2']));
		expect(view.getByTestId('notification-card')).toBe(card);
		expect(document.activeElement).toBe(focused);
		expect(state.send).toHaveBeenCalledExactlyOnceWith('readNotification');
		expect(misskeyApi).toHaveBeenCalledTimes(1);
	});

	it('does not infer concurrent hidden arrival read state from an uncorrelated acknowledgement; a native refetch restores grouping', async () => {
		const view = start();
		await view.findByText('n2');
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
		state.visibility!.value = 'hidden'; await nextTick();
		state.handlers.get('notification')!(release('n4'));
		expect(state.send).not.toHaveBeenCalled();
		state.visibility!.value = 'visible';
		await waitFor(() => expect(renderedIds(view.container)).toEqual(['n4', 'n3', 'n2']));
		expect(view.getAllByTestId('notification-card')).toHaveLength(2);
		state.handlers.get('readAllNotifications')?.();
		await nextTick();
		expect(view.getAllByTestId('notification-card')).toHaveLength(2);
		expect(renderedIds(view.container)).toEqual(['n4', 'n3', 'n2']);
		expect(state.send).not.toHaveBeenCalled();
		vi.mocked(misskeyApi).mockResolvedValueOnce([release('n4'), release('n3'), release('n2')]);
		await view.rerender({ excludeTypes: [] });
		await waitFor(() => expect(view.getAllByTestId('notification-card')).toHaveLength(1));
		expect(renderedIds(view.container)).toEqual(['n4', 'n3', 'n2']);
		expect(state.send).not.toHaveBeenCalled();
	});

	it('keeps explicit unread boundaries and ordinary notifications separate', async () => {
		vi.mocked(misskeyApi).mockResolvedValue([release('read', { isRead: true }), release('unread', { isRead: false }), { type: 'test', id: 'ordinary', createdAt: timestamp }, release('last', { isRead: false })]);
		const view = start();
		await waitFor(() => expect(renderedIds(view.container)).toEqual(['read', 'unread', 'ordinary', 'last']));
		expect(view.getAllByTestId('notification-card')).toHaveLength(4);
	});

	it('retains native type filtering and reload without resurfacing grouped events from the previous filter', async () => {
		vi.mocked(misskeyApi).mockResolvedValueOnce([release('n3'), release('n2')]).mockResolvedValueOnce([]);
		const view = start();
		await view.findByText('n2');
		await view.rerender({ excludeTypes: ['zalipAllohaAvailable'] });
		await waitFor(() => expect(misskeyApi).toHaveBeenCalledTimes(2));
		expect(misskeyApi).toHaveBeenLastCalledWith('i/notifications', expect.objectContaining({ excludeTypes: ['zalipAllohaAvailable'] }));
		await waitFor(() => expect(view.queryAllByTestId('notification-card')).toHaveLength(0));
		state.handlers.get('notification')!(release('muted'));
		await nextTick();
		expect(view.queryByText('muted')).toBeNull();
		expect(state.send).toHaveBeenCalledExactlyOnceWith('readNotification');
	});
});
