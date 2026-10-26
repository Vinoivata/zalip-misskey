/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';
import type { EffectScope } from 'vue';
import { useScrollPositionKeeper } from '@/composables/use-scroll-position-keeper.js';

const lifecycle = vi.hoisted(() => ({ activated: [] as (() => void)[], deactivated: [] as (() => void)[] }));

vi.mock('vue', async importOriginal => ({
	...await importOriginal<typeof import('vue')>(),
	onActivated: (callback: () => void) => lifecycle.activated.push(callback),
	onDeactivated: (callback: () => void) => lifecycle.deactivated.push(callback),
}));

const scopes: EffectScope[] = [];
const containers: HTMLElement[] = [];

function fixture() {
	const container = document.createElement('div');
	container.innerHTML = '<div data-scroll-anchor="visible"></div><details><summary>More events</summary><a data-scroll-anchor="hidden"></a></details>';
	document.body.append(container);
	containers.push(container);
	container.scrollTop = 800;
	const visible = container.querySelector<HTMLElement>('[data-scroll-anchor="visible"]')!;
	const hidden = container.querySelector<HTMLElement>('[data-scroll-anchor="hidden"]')!;
	const layout = { contentY: 1030, visible: true };
	const visibleRect = () => new DOMRect(20, 100 + layout.contentY - container.scrollTop, 200, 50);
	vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 500, 600));
	const visibleBounds = vi.spyOn(visible, 'getBoundingClientRect').mockImplementation(visibleRect);
	vi.spyOn(visible, 'getClientRects').mockImplementation(() => (layout.visible ? [visibleRect()] : []) as unknown as DOMRectList);
	const hiddenBounds = vi.spyOn(hidden, 'getBoundingClientRect').mockReturnValue(new DOMRect());
	vi.spyOn(hidden, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
	const scope = effectScope();
	scope.run(() => useScrollPositionKeeper(ref(container)));
	scopes.push(scope);
	return { container, layout, visibleBounds, hiddenBounds };
}

beforeEach(() => {
	vi.useFakeTimers();
	lifecycle.activated.length = 0;
	lifecycle.deactivated.length = 0;
});

afterEach(async () => {
	await nextTick();
	for (const scope of scopes.splice(0)) scope.stop();
	for (const container of containers.splice(0)) container.remove();
	vi.clearAllTimers();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('scroll position keeper with collapsed event anchors', () => {
	it('captures the visible anchor instead of a later hidden link and restores its exact viewport offset', async () => {
		const { container, layout, hiddenBounds } = fixture();
		container.dispatchEvent(new Event('pointerdown'));
		expect(hiddenBounds).not.toHaveBeenCalled();
		lifecycle.deactivated[0]();
		container.scrollTop = 0;
		layout.contentY += 120;
		lifecycle.activated[0]();
		// The visible event stays 230px below the container top after content grows.
		expect(container.scrollTop).toBe(920);
		await nextTick();
		await vi.runOnlyPendingTimersAsync();
		expect(container.scrollTop).toBe(920);
		expect(hiddenBounds).not.toHaveBeenCalled();
	});

	it('ignores an anchor collapsed since capture and retains the native saved-scroll fallback', async () => {
		const { container, layout, visibleBounds } = fixture();
		container.dispatchEvent(new Event('pointerdown'));
		expect(visibleBounds).toHaveBeenCalledTimes(1);
		lifecycle.deactivated[0]();
		layout.visible = false;
		container.scrollTop = 0;
		lifecycle.activated[0]();
		expect(container.scrollTop).toBe(0);
		await nextTick();
		expect(visibleBounds).toHaveBeenCalledTimes(1);
		await vi.runOnlyPendingTimersAsync();
		expect(container.scrollTop).toBe(800);
		expect(visibleBounds).toHaveBeenCalledTimes(1);
	});
});
