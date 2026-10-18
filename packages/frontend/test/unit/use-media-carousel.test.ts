/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useMediaCarousel } from '@/composables/use-media-carousel.js';

function fixture(widths = [210, 420, 180, 260], rtl = false, animate = false) {
	const viewport = ref<HTMLElement | null>(null);
	const count = ref(widths.length);
	const enabled = ref(true);
	const identity = ref('album-one');
	let carousel!: ReturnType<typeof useMediaCarousel>;
	const view = render(defineComponent({
		setup() {
			carousel = useMediaCarousel(viewport, count, enabled, () => animate, () => identity.value);
			return () => h('div', { ref: viewport, style: { direction: rtl ? 'rtl' : 'ltr' } }, widths.map((_, index) => h('button', { 'data-carousel-item': '', 'data-index': index })));
		},
	}));
	const element = viewport.value!;
	const slides = Array.from(element.querySelectorAll<HTMLElement>('[data-carousel-item]'));
	const width = 600;
	const gap = 8;
	const total = widths.reduce((sum, value) => sum + value, 0) + Math.max(0, widths.length - 1) * gap;
	const max = Math.max(0, total - width);
	vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: width, width } as DOMRect));
	for (const [index, slide] of slides.entries()) {
		const offset = widths.slice(0, index).reduce((sum, value) => sum + value + gap, 0);
		vi.spyOn(slide, 'getBoundingClientRect').mockImplementation(() => {
			const left = rtl ? width - offset - widths[index] - element.scrollLeft : offset - element.scrollLeft;
			return { left, right: left + widths[index], width: widths[index] } as DOMRect;
		});
	}
	const scroll = vi.fn((options?: ScrollToOptions | number) => {
		const left = typeof options === 'number' ? options : options?.left ?? 0;
		element.scrollLeft = rtl ? Math.max(-max, Math.min(0, left)) : Math.max(0, Math.min(max, left));
	});
	element.scrollTo = scroll;
	carousel.onScroll();
	return { ...view, element, slides, carousel, scroll, max, count, enabled, identity };
}

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('variable-width native media carousel geometry', () => {
	it('disables Next at the physical end even when several final cards remain visible', () => {
		const { carousel, element, max } = fixture();
		expect(carousel.previousDisabled.value).toBe(true);
		expect(carousel.nextDisabled.value).toBe(false);
		carousel.moveTo(3);
		expect(element.scrollLeft).toBe(max);
		expect(carousel.activeIndex.value).toBe(3);
		expect(carousel.nextDisabled.value).toBe(true);
		expect(carousel.previousDisabled.value).toBe(false);
		carousel.moveTo(0);
		expect(carousel.previousDisabled.value).toBe(true);
		expect(carousel.activeIndex.value).toBe(0);
	});

	it('has no enabled edge controls when all cards already fit', () => {
		const { carousel } = fixture([160, 180]);
		expect(carousel.previousDisabled.value).toBe(true);
		expect(carousel.nextDisabled.value).toBe(true);
		expect(carousel.activeIndex.value).toBe(0);
	});

	it('moves Previous away from a clamped end with several thumbnails visible instead of getting stuck', () => {
		const { carousel, element, max } = fixture([220, 220, 220, 220, 220]);
		carousel.moveTo(4);
		expect(element.scrollLeft).toBe(max);
		carousel.moveBy(-1);
		expect(element.scrollLeft).toBeLessThan(max);
		expect(element.scrollLeft).toBe(456);
		carousel.moveBy(-1);
		expect(element.scrollLeft).toBe(228);
		carousel.moveBy(-1);
		expect(element.scrollLeft).toBe(0);
		expect(carousel.previousDisabled.value).toBe(true);
		carousel.moveBy(1);
		expect(element.scrollLeft).toBe(228);
	});

	it('moves edge buttons out of a clamped RTL end as well', () => {
		const { carousel, element, max } = fixture([220, 220, 220, 220, 220], true);
		carousel.moveTo(4);
		expect(element.scrollLeft).toBe(-max);
		carousel.moveBy(-1);
		expect(element.scrollLeft).toBe(-456);
		carousel.moveBy(-1);
		expect(element.scrollLeft).toBe(-228);
		carousel.moveBy(1);
		expect(element.scrollLeft).toBe(-456);
	});

	it('selects the nearest leading edge during an ordinary swipe', () => {
		const { carousel, element } = fixture();
		element.scrollLeft = 220;
		carousel.onScroll();
		expect(carousel.activeIndex.value).toBe(1);
		expect(carousel.previousDisabled.value).toBe(false);
		expect(carousel.nextDisabled.value).toBe(false);
	});

	it('treats RTL rendered boundaries independently from negative scrollLeft', () => {
		const { carousel, element, max } = fixture(undefined, true);
		expect(carousel.previousDisabled.value).toBe(true);
		carousel.moveTo(3);
		expect(element.scrollLeft).toBe(-max);
		expect(carousel.nextDisabled.value).toBe(true);
		expect(carousel.activeIndex.value).toBe(3);
		carousel.moveTo(0);
		expect(carousel.previousDisabled.value).toBe(true);
	});

	it('navigates from the focused card and retains its exact target when the browser clamps scrolling', () => {
		const { carousel, slides } = fixture();
		const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
		Object.defineProperty(event, 'target', { value: slides[1] });
		expect(carousel.onKeydown(event)).toBe(true);
		expect(event.defaultPrevented).toBe(true);
		expect(carousel.keyboardIndex.value).toBe(2);
		expect(carousel.activeIndex.value).toBe(3);
	});

	it('reverses arrow direction in RTL and supports Home and End', () => {
		const { carousel, slides } = fixture(undefined, true);
		for (const [key, expected] of [['ArrowLeft', 2], ['ArrowRight', 0], ['End', 3], ['Home', 0]] as const) {
			const event = new KeyboardEvent('keydown', { key, cancelable: true });
			Object.defineProperty(event, 'target', { value: slides[1] });
			expect(carousel.onKeydown(event)).toBe(true);
			expect(carousel.keyboardIndex.value).toBe(expected);
		}
	});

	it('never captures native inputs, video/audio controls, modified keys or unrelated keys', () => {
		const { carousel, element, scroll } = fixture();
		for (const tag of ['input', 'textarea', 'select', 'video', 'audio']) {
			const target = document.createElement(tag);
			element.append(target);
			const event = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
			Object.defineProperty(event, 'target', { value: target });
			expect(carousel.onKeydown(event)).toBe(false);
			expect(event.defaultPrevented).toBe(false);
		}
		for (const options of [{ key: 'Tab' }, { key: 'ArrowRight', ctrlKey: true }, { key: 'ArrowRight', shiftKey: true }]) {
			expect(carousel.onKeydown(new KeyboardEvent('keydown', options))).toBe(false);
		}
		expect(scroll).not.toHaveBeenCalled();
	});

	it('resets scroll and keyboard state for a replacement album with the same number of files', async () => {
		const { carousel, element, identity } = fixture();
		carousel.moveTo(3);
		identity.value = 'album-two';
		await nextTick(); await nextTick();
		expect(element.scrollLeft).toBe(0);
		expect(carousel.activeIndex.value).toBe(0);
		expect(carousel.keyboardIndex.value).toBe(0);
		expect(carousel.previousDisabled.value).toBe(true);
	});

	it('respects OS reduced motion even with animation enabled', () => {
		vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
		const { carousel, scroll } = fixture(undefined, false, true);
		carousel.moveTo(1);
		expect(scroll).toHaveBeenCalledWith({ left: 218, behavior: 'auto' });
	});

	it('does nothing when disabled and never scrolls beyond the requested index range', () => {
		const { carousel, enabled, scroll } = fixture();
		carousel.moveTo(-10);
		expect(carousel.activeIndex.value).toBe(0);
		carousel.moveTo(99);
		expect(carousel.activeIndex.value).toBe(3);
		enabled.value = false;
		scroll.mockClear();
		carousel.moveTo(1);
		expect(scroll).not.toHaveBeenCalled();
		expect(carousel.onKeydown(new KeyboardEvent('keydown', { key: 'End' }))).toBe(false);
		expect(carousel.previousDisabled.value).toBe(true);
		expect(carousel.nextDisabled.value).toBe(true);
	});
});
