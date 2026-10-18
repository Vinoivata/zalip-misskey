/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** Native scrolling keeps touch gestures and nested media controls in the browser. */
export function useMediaCarousel(viewport: Ref<HTMLElement | null>, count: Ref<number>, enabled: Ref<boolean>, animate: () => boolean) {
	const activeIndex = ref(0);
	const previousDisabled = computed(() => activeIndex.value <= 0);
	const nextDisabled = computed(() => activeIndex.value >= count.value - 1);
	let observer: ResizeObserver | null = null;

	function items(): HTMLElement[] {
		return viewport.value ? Array.from(viewport.value.querySelectorAll<HTMLElement>('[data-carousel-item]')) : [];
	}

	function isRtl(): boolean {
		return viewport.value != null && window.getComputedStyle(viewport.value).direction === 'rtl';
	}

	function onScroll(): void {
		if (!enabled.value || !viewport.value) return;
		const bounds = viewport.value.getBoundingClientRect();
		const rtl = isRtl();
		let nearest = 0;
		let distance = Infinity;
		for (const [index, item] of items().entries()) {
			const rect = item.getBoundingClientRect();
			const delta = Math.abs(rtl ? rect.right - bounds.right : rect.left - bounds.left);
			if (delta < distance) { nearest = index; distance = delta; }
		}
		activeIndex.value = nearest;
	}

	function moveTo(index: number): void {
		if (!enabled.value || !viewport.value) return;
		const target = Math.max(0, Math.min(count.value - 1, index));
		const item = items().at(target);
		if (!item) return;
		const bounds = viewport.value.getBoundingClientRect();
		const rect = item.getBoundingClientRect();
		const delta = isRtl() ? rect.right - bounds.right : rect.left - bounds.left;
		const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		viewport.value.scrollTo({ left: viewport.value.scrollLeft + delta, behavior: animate() && !reducedMotion ? 'smooth' : 'auto' });
		activeIndex.value = target;
	}

	function onKeydown(event: KeyboardEvent): boolean {
		if (!enabled.value || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
		if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video, audio, [contenteditable="true"]')) return false;
		const target = event.key === 'Home' ? 0 : event.key === 'End' ? count.value - 1
			: event.key === 'ArrowRight' ? activeIndex.value + (isRtl() ? -1 : 1)
			: event.key === 'ArrowLeft' ? activeIndex.value + (isRtl() ? 1 : -1) : null;
		if (target == null) return false;
		event.preventDefault();
		event.stopPropagation();
		moveTo(target);
		return true;
	}

	watch([enabled, count], async () => {
		activeIndex.value = 0;
		await nextTick();
		if (enabled.value && viewport.value) viewport.value.scrollLeft = 0;
	}, { flush: 'post' });

	watch(viewport, element => {
		observer?.disconnect();
		observer = null;
		if (typeof ResizeObserver !== 'undefined' && element) {
			observer = new ResizeObserver(onScroll);
			observer.observe(element);
		}
	}, { flush: 'post' });
	onBeforeUnmount(() => observer?.disconnect());

	return { activeIndex, previousDisabled, nextDisabled, onScroll, moveTo, onKeydown };
}
