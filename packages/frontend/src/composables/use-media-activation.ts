/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount, readonly, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** Start expensive media work once, shortly before its container becomes visible. */
export function useMediaActivation(target: Readonly<Ref<HTMLElement | null>>, deferred: () => boolean = () => true): Readonly<Ref<boolean>> {
	const active = ref(false);
	let observer: IntersectionObserver | undefined;
	const stop = (): void => {
		observer?.disconnect();
		observer = undefined;
	};

	watch([target, deferred], ([element, shouldDefer]) => {
		stop();
		if (active.value) return;
		if (!shouldDefer || typeof IntersectionObserver === 'undefined') {
			active.value = true;
			return;
		}
		if (!element) return;
		observer = new IntersectionObserver(entries => {
			if (!entries.some(entry => entry.isIntersecting)) return;
			active.value = true;
			stop();
		}, { rootMargin: '300px' });
		observer.observe(element);
	}, { immediate: true, flush: 'post' });

	onBeforeUnmount(stop);
	return readonly(active);
}
