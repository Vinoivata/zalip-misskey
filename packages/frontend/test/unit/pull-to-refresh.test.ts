/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';

vi.mock('@/os.js', () => ({ alert: vi.fn() }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn() }));

function touch(target: EventTarget, type: string, x: number, y: number, fingers = 1) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperty(event, 'touches', { value: Array.from({ length: fingers }, () => ({ screenX: x, screenY: y })) });
	target.dispatchEvent(event);
	return nextTick();
}

function setup(refresher = vi.fn().mockResolvedValue(undefined)) {
	const view = render(defineComponent({
		setup: () => () => h('div', { style: 'overflow-y: auto', 'data-testid': 'scroll' }, [
			h(MkPullToRefresh, { refresher }, { default: () => h('div', { 'data-testid': 'content' }, [h('input', { 'aria-label': 'Draft' })]) }),
		]),
	}), { global: { stubs: { MkLoading: true } } });
	return { ...view, refresher, content: view.getByTestId('content'), scroll: view.getByTestId('scroll') };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('pull to refresh', () => {
	it('refreshes once after a downward touch is released', async () => {
		const view = setup();
		await touch(view.content, 'touchstart', 100, 100);
		await touch(window, 'touchmove', 100, 320);
		expect(view.refresher).not.toHaveBeenCalled();
		await touch(window, 'touchend', 100, 320);
		await vi.runAllTimersAsync();
		expect(view.refresher).toHaveBeenCalledTimes(1);
		await touch(window, 'touchend', 100, 320);
		expect(view.refresher).toHaveBeenCalledTimes(1);
	});

	it.each(['horizontal', 'short', 'upward', 'cancel', 'multitouch', 'scrolled', 'input'])('does not refresh for %s gestures', async (kind) => {
		const view = setup();
		if (kind === 'scrolled') view.scroll.scrollTop = 100;
		await touch(kind === 'input' ? view.getByLabelText('Draft') : view.content, 'touchstart', 100, 100);
		await touch(window, 'touchmove', kind === 'horizontal' ? 400 : 100, kind === 'upward' ? 50 : kind === 'short' ? 150 : 320, kind === 'multitouch' ? 2 : 1);
		await touch(window, kind === 'cancel' ? 'touchcancel' : 'touchend', 100, 320);
		await vi.runAllTimersAsync();
		expect(view.refresher).not.toHaveBeenCalled();
	});

	it('allows another refresh after a rejected request', async () => {
		const refresher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
		const view = setup(refresher);
		for (let i = 0; i < 2; i++) {
			await touch(view.content, 'touchstart', 100, 100);
			await touch(window, 'touchmove', 100, 320);
			await touch(window, 'touchend', 100, 320);
			await vi.runAllTimersAsync();
		}
		expect(refresher).toHaveBeenCalledTimes(2);
	});

	it('does not start a duplicate refresh while a request is pending', async () => {
		let finish!: () => void;
		const view = setup(vi.fn(() => new Promise<void>(resolve => { finish = resolve; })));
		await touch(view.content, 'touchstart', 100, 100);
		await touch(window, 'touchmove', 100, 320);
		await touch(window, 'touchend', 100, 320);
		await vi.advanceTimersByTimeAsync(250);
		await touch(view.content, 'touchstart', 100, 100);
		await touch(window, 'touchmove', 100, 320);
		await touch(window, 'touchend', 100, 320);
		expect(view.refresher).toHaveBeenCalledTimes(1);
		finish();
		await vi.runAllTimersAsync();
	});

	it('removes active gesture listeners when leaving the page', async () => {
		const view = setup();
		await touch(view.content, 'touchstart', 100, 100);
		await touch(window, 'touchmove', 100, 320);
		view.unmount();
		await touch(window, 'touchend', 100, 320);
		await vi.runAllTimersAsync();
		expect(view.refresher).not.toHaveBeenCalled();
		expect(view.scroll.style.overscrollBehaviorY).toBe('');
	});

	it('keeps the existing middle-mouse refresh shortcut', async () => {
		const view = setup();
		await fireEvent.mouseDown(view.content, { button: 1, screenY: 100, screenX: 100 });
		await fireEvent.mouseMove(window, { screenY: 320, screenX: 100 });
		await fireEvent.mouseUp(window, { button: 1 });
		await vi.runAllTimersAsync();
		expect(view.refresher).toHaveBeenCalledTimes(1);
	});
});
