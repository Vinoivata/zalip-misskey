/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';

const cleanups: Array<() => void> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.useRealTimers();
});

function fixture() {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const clicked = vi.fn();
	const app = createApp(defineComponent({
		setup() {
			const drag = useZalipHorizontalDrag();
			return () => h('div', { onPointerdown: drag.onPointerDown, onClickCapture: drag.onClickCapture }, [
				h('a', { href: '#title', onClick: clicked }, 'Title'),
			]);
		},
	}));
	app.mount(host);
	// Vue timestamps bubbling events to ignore listeners attached during dispatch.
	// Advance beyond attachment, as real user input would, even on a fast runner.
	vi.advanceTimersByTime(10);
	const rail = host.firstElementChild as HTMLElement;
	const link = rail.firstElementChild as HTMLAnchorElement;
	rail.setPointerCapture = vi.fn();
	rail.hasPointerCapture = vi.fn(() => false);
	rail.releasePointerCapture = vi.fn();
	cleanups.push(() => { app.unmount(); host.remove(); });
	return { rail, link, clicked, unmount: () => app.unmount() };
}

function pointer(target: EventTarget, type: string, x: number, y = 20, pointerType = 'mouse') {
	target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType, button: 0, clientX: x, clientY: y }));
}

function click(link: HTMLElement, detail = 1) {
	const event = new MouseEvent('click', { bubbles: true, cancelable: true, detail });
	link.dispatchEvent(event);
	return event;
}

describe('Zalip mouse rail dragging', () => {
	it('preserves ordinary card clicks and ignores small hand movement', () => {
		const { rail, link, clicked } = fixture();
		pointer(link, 'pointerdown', 100);
		pointer(window, 'pointermove', 102);
		pointer(window, 'pointerup', 102);
		expect(rail.setPointerCapture).not.toHaveBeenCalled();
		expect(rail.scrollLeft).toBe(0);
		expect(click(link).defaultPrevented).toBe(false);
		expect(clicked).toHaveBeenCalledOnce();
	});

	it('prevents image/link native dragging and scrolls only after the threshold', () => {
		const { rail, link, clicked } = fixture();
		pointer(link, 'pointerdown', 200);
		const nativeDrag = new Event('dragstart', { bubbles: true, cancelable: true });
		link.dispatchEvent(nativeDrag);
		expect(nativeDrag.defaultPrevented).toBe(true);
		pointer(window, 'pointermove', 80);
		expect(rail.scrollLeft).toBe(120);
		expect(rail.dataset.dragging).toBe('true');
		expect(rail.setPointerCapture).toHaveBeenCalledWith(1);
		pointer(window, 'pointerup', 80);
		expect(rail.dataset.dragging).toBeUndefined();
		expect(click(link).defaultPrevented).toBe(true);
		expect(clicked).not.toHaveBeenCalled();
		pointer(link, 'pointerdown', 80);
		pointer(window, 'pointerup', 80);
		expect(click(link).defaultPrevented).toBe(false);
		expect(clicked).toHaveBeenCalledOnce();
	});

	it('leaves touch scrolling native and never captures touch clicks', () => {
		const { rail, link } = fixture();
		pointer(link, 'pointerdown', 200, 20, 'touch');
		pointer(window, 'pointermove', 50, 20, 'touch');
		pointer(window, 'pointerup', 50, 20, 'touch');
		expect(rail.setPointerCapture).not.toHaveBeenCalled();
		expect(rail.scrollLeft).toBe(0);
		expect(click(link).defaultPrevented).toBe(false);
	});

	it('preserves keyboard activation after cancelled dragging', () => {
		const { link, clicked } = fixture();
		pointer(link, 'pointerdown', 200);
		pointer(window, 'pointermove', 100);
		pointer(window, 'pointercancel', 100);
		expect(click(link, 0).defaultPrevented).toBe(false);
		expect(clicked).toHaveBeenCalledOnce();
	});

	it('does not treat a vertical gesture as a horizontal drag', () => {
		const { rail, link } = fixture();
		pointer(link, 'pointerdown', 100);
		pointer(window, 'pointermove', 110, 120);
		pointer(window, 'pointermove', 20, 120);
		expect(rail.setPointerCapture).not.toHaveBeenCalled();
		expect(rail.scrollLeft).toBe(0);
	});
});
