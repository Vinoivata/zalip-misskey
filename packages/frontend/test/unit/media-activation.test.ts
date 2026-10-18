/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import { useMediaActivation } from '@/composables/use-media-activation.js';

describe('media viewport activation', () => {
	afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

	test('defers work until near viewport, activates once and disconnects', async () => {
		let notify: IntersectionObserverCallback | undefined;
		const disconnect = vi.fn();
		const observe = vi.fn();
		const constructor = vi.fn();
		vi.stubGlobal('IntersectionObserver', class {
			constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) { notify = callback; constructor(options); }
			observe = observe;
			disconnect = disconnect;
		});
		const result = render(defineComponent({
			setup() {
				const target = ref<HTMLElement | null>(null);
				const active = useMediaActivation(target);
				return () => h('div', { ref: target }, active.value ? 'active' : 'deferred');
			},
		}));
		await nextTick();
		expect(result.getByText('deferred')).toBeTruthy();
		expect(constructor).toHaveBeenCalledWith({ rootMargin: '300px' });
		expect(observe).toHaveBeenCalledOnce();
		notify?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
		await nextTick();
		expect(result.getByText('deferred')).toBeTruthy();
		notify?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
		await nextTick();
		expect(result.getByText('active')).toBeTruthy();
		expect(disconnect).toHaveBeenCalledOnce();
	});

	test.each([false, true])('keeps eager media and browsers without observers usable (%s)', async (deferred) => {
		vi.stubGlobal('IntersectionObserver', undefined);
		const result = render(defineComponent({
			setup() {
				const target = ref<HTMLElement | null>(null);
				const active = useMediaActivation(target, () => deferred);
				return () => h('div', { ref: target }, String(active.value));
			},
		}));
		await nextTick();
		expect(result.getByText('true')).toBeTruthy();
	});

	test('disconnects without activating unmounted media', async () => {
		const disconnect = vi.fn();
		vi.stubGlobal('IntersectionObserver', class {
			observe(): void { /* no viewport entry */ }
			disconnect = disconnect;
		});
		const result = render(defineComponent({
			setup() {
				const target = ref<HTMLElement | null>(null);
				useMediaActivation(target);
				return () => h('div', { ref: target });
			},
		}));
		await nextTick();
		result.unmount();
		expect(disconnect).toHaveBeenCalledOnce();
	});
});
