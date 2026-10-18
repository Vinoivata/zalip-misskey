/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import MkImgWithBlurhash from '@/components/MkImgWithBlurhash.vue';

async function flushPromises(): Promise<void> {
	await nextTick();
	await new Promise<void>(resolve => setTimeout(resolve, 0));
}

describe('deferred blurhash images', () => {
	afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

	test('does not assign src or decode until visible, then decodes once', async () => {
		let notify: IntersectionObserverCallback | undefined;
		vi.stubGlobal('IntersectionObserver', class {
			constructor(callback: IntersectionObserverCallback) { notify = callback; }
			observe(): void { /* controlled viewport */ }
			disconnect(): void { /* controlled viewport */ }
		});
		const decode = vi.spyOn(HTMLImageElement.prototype, 'decode').mockResolvedValue();
		const result = render(MkImgWithBlurhash, {
			props: { src: '/original.webp', defer: true },
			global: { stubs: { MkBlurhash: true } },
		});
		await flushPromises();
		const image = result.container.querySelector('img')!;
		expect(image.hasAttribute('src')).toBe(false);
		expect(decode).not.toHaveBeenCalled();
		notify?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
		await flushPromises();
		expect(image.getAttribute('src')).toBe('/original.webp');
		expect(decode).toHaveBeenCalledOnce();
		expect(image.style.display).not.toBe('none');
	});

	test('a stale decode cannot reveal a newly changed source', async () => {
		let resolveFirst: (() => void) | undefined;
		let resolveSecond: (() => void) | undefined;
		vi.spyOn(HTMLImageElement.prototype, 'decode')
			.mockImplementationOnce(() => new Promise<void>(resolve => { resolveFirst = resolve; }))
			.mockImplementationOnce(() => new Promise<void>(resolve => { resolveSecond = resolve; }));
		const result = render(MkImgWithBlurhash, {
			props: { src: '/first.webp' },
			global: { stubs: { MkBlurhash: true } },
		});
		await flushPromises();
		await result.rerender({ src: '/second.webp' });
		await flushPromises();
		resolveFirst?.();
		await flushPromises();
		const image = result.container.querySelector('img')!;
		expect(image.getAttribute('src')).toBe('/second.webp');
		expect(image.style.display).toBe('none');
		resolveSecond?.();
		await flushPromises();
		expect(image.style.display).not.toBe('none');
	});
});
