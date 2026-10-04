/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { useZalipHeroScroll } from '@/composables/use-zalip-hero-scroll.js';

const cleanups: Array<() => void> = [];
let frames: Map<number, FrameRequestCallback>;
let motion: EventTarget & { matches: boolean };
let resizeCallbacks: ResizeObserverCallback[];
let disconnect: ReturnType<typeof vi.fn>;

beforeEach(() => {
	frames = new Map();
	let id = 0;
	vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++id, callback); return id; });
	vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(key => { frames.delete(key); });
	motion = Object.assign(new EventTarget(), { matches: false });
	vi.spyOn(window, 'matchMedia').mockReturnValue(motion as MediaQueryList);
	resizeCallbacks = [];
	disconnect = vi.fn();
	vi.stubGlobal('ResizeObserver', class {
		constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
		observe = vi.fn();
		disconnect = disconnect;
	});
});

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function flushFrame() {
	const pending = [...frames.values()];
	frames.clear();
	for (const callback of pending) callback(0);
}

async function fixture(nested = true, headerInset = 0) {
	const host = document.createElement('div');
	document.body.appendChild(host);
	const hero = ref<HTMLElement | null>(null);
	const artwork = ref<HTMLElement | null>(null);
	const visible = ref(true);
	const hasArtwork = ref(true);
	const key = ref('first');
	let height = 240;
	let scroll = 0;
	let top = 60;
	const Child = defineComponent({ setup() {
		useZalipHeroScroll(hero, artwork);
		return () => h('section', { ref: hero, key: key.value }, hasArtwork.value ? h('div', { ref: artwork }) : h('img', { alt: 'Poster fallback' }));
	} });
	const Other = defineComponent({ render: () => h('p', 'Another page') });
	const app = createApp({ render: () => h('div', { style: nested ? 'overflow-y: auto' : '' }, [h(KeepAlive, null, { default: () => visible.value ? h(Child) : h(Other) })]) });
	app.mount(host);
	const container = host.firstElementChild as HTMLElement;
	container.style.scrollPaddingTop = `${headerInset}px`;
	container.getBoundingClientRect = () => ({ top } as DOMRect);
	function measure() {
		hero.value!.getBoundingClientRect = () => ({ top: (nested ? top + headerInset : 0) - scroll } as DOMRect);
		if (artwork.value) Object.defineProperty(artwork.value, 'offsetHeight', { configurable: true, get: () => height });
	}
	await nextTick();
	measure();
	window.dispatchEvent(new Event('resize'));
	flushFrame();
	let mounted = true;
	function unmount() { if (mounted) app.unmount(); mounted = false; }
	cleanups.push(() => { unmount(); host.remove(); });
	return {
		hero, artwork, visible, hasArtwork, key, container, measure, unmount,
		shift: () => hero.value!.style.getPropertyValue('--zalip-hero-shift'),
		opacity: () => Number(hero.value!.style.getPropertyValue('--zalip-hero-opacity')),
		reveal: () => hero.value!.style.getPropertyValue('--zalip-hero-reveal'),
		scroll: (value: number) => { scroll = value; (nested ? container : window).dispatchEvent(new Event('scroll')); flushFrame(); },
		resize: (value: number) => { height = value; top = 85; resizeCallbacks.at(-1)!([], {} as ResizeObserver); flushFrame(); },
	};
}

describe('Zalip title cover scroll', () => {
	it('starts at the mobile header boundary instead of waiting for the screen edge', async () => {
		const view = await fixture(true, 53);
		expect(view.opacity()).toBe(1);
		view.scroll(20);
		expect(view.shift()).toBe('20.00px');
		expect(view.opacity()).toBeLessThan(1);
		expect(view.reveal()).toBe('220.00px');
		// Hiding the header must not reset the scroll origin partway through.
		view.container.style.setProperty('--zalip-chrome-top', '0px');
		view.scroll(90);
		expect(view.opacity()).toBe(0.5);
		view.scroll(240);
		expect(view.reveal()).toBe('0.00px');
		view.scroll(0);
		expect(view.reveal()).toBe('240.00px');
		expect(view.shift()).toBe('0.00px');
	});

	it('fades the cover behind the rising title and restores it on reverse scrolling', async () => {
		const view = await fixture();
		expect(view.opacity()).toBe(1);
		view.scroll(90);
		expect(view.shift()).toBe('90.00px');
		expect(view.opacity()).toBe(0.5);
		view.scroll(180);
		expect(view.opacity()).toBe(0);
		view.scroll(2000);
		expect(view.shift()).toBe('240.00px');
		view.scroll(90);
		expect(view.opacity()).toBe(0.5);
		view.scroll(-50);
		expect(view.opacity()).toBe(1);
		expect(view.shift()).toBe('0.00px');
		expect(view.hero.value!.style.height).toBe('');
		expect(view.container.scrollTop).toBe(0);
	});

	it('recalculates cover size and supports document scrolling', async () => {
		const view = await fixture(false);
		view.scroll(90);
		expect(view.opacity()).toBe(0.5);
		view.resize(480);
		expect(view.opacity()).toBeCloseTo(0.844, 3);
		view.resize(0);
		expect(view.shift()).toBe('');
	});

	it('coalesces scroll events into one animation frame', async () => {
		const view = await fixture();
		for (let i = 0; i < 12; i++) view.container.dispatchEvent(new Event('scroll'));
		expect(frames.size).toBe(1);
		flushFrame();
		expect(frames.size).toBe(0);
	});

	it('respects live reduced-motion changes without changing the native scroll', async () => {
		motion.matches = true;
		const view = await fixture();
		view.scroll(90);
		expect(view.shift()).toBe('');
		expect(view.reveal()).toBe('');
		motion.matches = false;
		motion.dispatchEvent(new Event('change'));
		flushFrame();
		expect(view.opacity()).toBe(0.5);
		motion.matches = true;
		motion.dispatchEvent(new Event('change'));
		flushFrame();
		expect(view.shift()).toBe('');
	});

	it('leaves poster-only titles untouched and reconnects when artwork or route changes', async () => {
		const view = await fixture();
		view.hasArtwork.value = false;
		await nextTick();
		expect(view.shift()).toBe('');
		view.scroll(90);
		expect(frames.size).toBe(0);
		view.hasArtwork.value = true;
		await nextTick();
		view.measure();
		view.scroll(90);
		expect(view.opacity()).toBe(0.5);
		const previous = view.hero.value!;
		view.key.value = 'second';
		await nextTick();
		view.measure();
		view.scroll(0);
		expect(previous.style.getPropertyValue('--zalip-hero-shift')).toBe('');
		expect(view.opacity()).toBe(1);
	});

	it('releases listeners and queued frames for cached pages and restores on activation', async () => {
		const view = await fixture();
		view.scroll(90);
		view.container.dispatchEvent(new Event('scroll'));
		view.visible.value = false;
		await nextTick();
		expect(frames.size).toBe(0);
		expect(disconnect).toHaveBeenCalled();
		view.container.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		expect(frames.size).toBe(0);
		view.visible.value = true;
		await nextTick();
		expect(view.opacity()).toBe(0.5);
		const element = view.hero.value!;
		view.container.dispatchEvent(new Event('scroll'));
		view.unmount();
		expect(frames.size).toBe(0);
		expect(element.style.getPropertyValue('--zalip-hero-shift')).toBe('');
		view.container.dispatchEvent(new Event('scroll'));
		window.dispatchEvent(new Event('resize'));
		motion.dispatchEvent(new Event('change'));
		expect(frames.size).toBe(0);
	});
});
