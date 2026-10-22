/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import MkZalipReactionFloat from '@/components/MkZalipReactionFloat.vue';

const controls = vi.hoisted(() => ({ preferences: null as { animation: boolean } | null }));
vi.mock('@/preferences.js', async () => {
	const { reactive } = await import('vue');
	controls.preferences = reactive({ animation: true });
	return { prefer: { s: controls.preferences } };
});
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: defineComponent({ props: { reaction: String }, setup: props => () => h('span', { 'data-reaction': props.reaction }, props.reaction) }) }));

let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null }>;
let motion: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let target: HTMLElement;

function props() { return { noteId: 'a', target, reactions: { '👍': 5, '❤️': 2, '🔥': 1 }, reactionEmojis: {} }; }

function visibility(visible: boolean, index = observers.length - 1): void {
	const entry = observers[index];
	entry.callback([{ target: entry.target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver);
}

async function settle(): Promise<void> { await nextTick(); await nextTick(); }

beforeEach(() => {
	vi.useFakeTimers(); vi.setSystemTime(0); observers = []; controls.preferences!.animation = true;
	motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
	vi.stubGlobal('matchMedia', vi.fn(() => motion));
	vi.stubGlobal('IntersectionObserver', class {
		private entry: typeof observers[number];
		constructor(callback: IntersectionObserverCallback) { this.entry = { callback, target: null }; observers.push(this.entry); }
		observe(element: Element): void { this.entry.target = element; }
		disconnect(): void { /* Delayed callback replay tests ownership. */ }
	});
	target = document.createElement('article'); document.body.append(target);
});
afterEach(() => { cleanup(); target.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('visible existing reaction animation', () => {
	it('waits for visibility, represents actual counts only, and cleans up after one finite flight', async () => {
		const view = render(MkZalipReactionFloat, { props: props() }); await settle();
		expect(observers.at(-1)?.target).toBe(view.container.querySelector('[data-zalip-reaction-float]'));
		expect(observers.at(-1)?.target).not.toBe(target);
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		expect(view.container.querySelectorAll('[data-reaction="❤️"]')).toHaveLength(2);
		expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
		await vi.advanceTimersByTimeAsync(3300);
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('bounds huge counts and ignores invalid counts without inventing votes', async () => {
		const view = render(MkZalipReactionFloat, { props: { ...props(), reactions: { '👍': 1_000_000, '❤️': 1, invalid: NaN, zero: 0, negative: -2 } } }); await settle();
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(10);
		expect(view.container.querySelectorAll('[data-reaction="❤️"]')).toHaveLength(1);
		expect(view.container.querySelector('[data-reaction="invalid"]')).toBeNull();
	});
	it('stops offscreen and throttles repeated entry, while a new post has independent playback', async () => {
		const view = render(MkZalipReactionFloat, { props: props() }); await settle();
		visibility(true); await settle(); visibility(false); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		visibility(true); await settle(); expect(vi.getTimerCount()).toBe(0);
		await view.rerender({ noteId: 'b' }); await settle();
		visibility(true, 0); await settle(); expect(vi.getTimerCount()).toBe(0);
		visibility(true); await settle(); expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		view.unmount(); visibility(true); await settle(); expect(vi.getTimerCount()).toBe(0);
	});
	it('honours the animation preference and live reduced-motion changes', async () => {
		controls.preferences!.animation = false;
		const view = render(MkZalipReactionFloat, { props: props() }); await settle();
		expect(observers).toHaveLength(0);
		controls.preferences!.animation = true; await settle(); visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		motion.matches = true; motion.addEventListener.mock.calls[0][1](); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		view.unmount(); expect(motion.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
	});
	it('does not observe hidden/spoiler content and clears a flight when hidden', async () => {
		const view = render(MkZalipReactionFloat, { props: { ...props(), enabled: false } }); await settle(); expect(observers).toHaveLength(0);
		await view.rerender({ enabled: true }); await settle(); visibility(true); await settle();
		await view.rerender({ enabled: false }); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
	});
	it('clears a flight on KeepAlive deactivation and rejects old observers after reactivation', async () => {
		const shown = ref(true);
		const Host = defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(MkZalipReactionFloat, props()) : null }) });
		const view = render(Host); await settle();
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		const beforeDeactivation = observers.length - 1;
		shown.value = false; await settle();
		expect(vi.getTimerCount()).toBe(0);
		visibility(true, beforeDeactivation); await settle();
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(4001);
		shown.value = true; await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		expect(observers.length - 1).toBeGreaterThan(beforeDeactivation);
		visibility(true, beforeDeactivation); await settle();
		expect(vi.getTimerCount()).toBe(0);
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		view.unmount();
		visibility(true); await settle();
		expect(vi.getTimerCount()).toBe(0);
	});
	it('clears an active flight in a hidden document and re-observes only when visible again', async () => {
		const pageVisibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		const view = render(MkZalipReactionFloat, { props: props() }); await settle();
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		const beforeHidden = observers.length - 1;
		pageVisibility.mockReturnValue('hidden');
		document.dispatchEvent(new Event('visibilitychange')); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(0);
		expect(vi.getTimerCount()).toBe(0);
		visibility(true, beforeHidden); await settle();
		expect(observers.length - 1).toBe(beforeHidden);
		expect(vi.getTimerCount()).toBe(0);
		await vi.advanceTimersByTimeAsync(4001);
		pageVisibility.mockReturnValue('visible');
		document.dispatchEvent(new Event('visibilitychange')); await settle();
		expect(observers.length - 1).toBeGreaterThan(beforeHidden);
		visibility(true, beforeHidden); await settle();
		expect(vi.getTimerCount()).toBe(0);
		visibility(true); await settle();
		expect(view.container.querySelectorAll('[data-reaction]')).toHaveLength(8);
		view.unmount();
		const countAfterUnmount = observers.length;
		document.dispatchEvent(new Event('visibilitychange')); await settle();
		expect(observers).toHaveLength(countAfterUnmount);
		expect(vi.getTimerCount()).toBe(0);
	});
});
