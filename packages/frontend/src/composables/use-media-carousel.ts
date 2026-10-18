/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';

/** Native scrolling keeps touch gestures and nested media controls in the browser. */
export function useMediaCarousel(viewport: Ref<HTMLElement | null>, count: Ref<number>, enabled: Ref<boolean>, animate: () => boolean, identity: () => unknown = () => null) {
	const activeIndex = ref(0);
	const keyboardIndex = ref(0);
	const atStart = ref(true);
	const atEnd = ref(false);
	const previousDisabled = computed(() => !enabled.value || count.value < 2 || atStart.value);
	const nextDisabled = computed(() => !enabled.value || count.value < 2 || atEnd.value);
	let observer: ResizeObserver | null = null;
	let resetGeneration = 0;

	function items(): HTMLElement[] {
		return viewport.value ? Array.from(viewport.value.querySelectorAll<HTMLElement>('[data-carousel-item]')) : [];
	}

	function isRtl(): boolean {
		return viewport.value != null && window.getComputedStyle(viewport.value).direction === 'rtl';
	}

	function onScroll(): void {
		if (!enabled.value || !viewport.value) return;
		const bounds = viewport.value.getBoundingClientRect();
		if (bounds.right - bounds.left <= 0) return;
		const rtl = isRtl();
		const slides = items();
		const first = slides.at(0)?.getBoundingClientRect();
		const last = slides.at(-1)?.getBoundingClientRect();
		if (!first || !last) return;
		// Compare rendered edges rather than scrollLeft: RTL engines and mixed widths differ.
		atStart.value = rtl ? first.right <= bounds.right + 2 : first.left >= bounds.left - 2;
		atEnd.value = rtl ? last.left >= bounds.left - 2 : last.right <= bounds.right + 2;
		if (atStart.value) { activeIndex.value = 0; return; }
		if (atEnd.value) { activeIndex.value = Math.max(0, count.value - 1); return; }
		let nearest = 0;
		let distance = Infinity;
		for (const [index, item] of slides.entries()) {
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
		const smooth = animate() && !reducedMotion;
		viewport.value.scrollTo({ left: viewport.value.scrollLeft + delta, behavior: smooth ? 'smooth' : 'auto' });
		activeIndex.value = target;
		if (!smooth) onScroll();
	}

	function moveBy(direction: -1 | 1): void {
		if (!enabled.value || !viewport.value || (direction < 0 ? previousDisabled.value : nextDisabled.value)) return;
		const bounds = viewport.value.getBoundingClientRect();
		const rtl = isRtl();
		let target: number | null = null;
		let distance = Infinity;
		for (const [index, item] of items().entries()) {
			const rect = item.getBoundingClientRect();
			const leading = rtl ? bounds.right - rect.right : rect.left - bounds.left;
			if (leading * direction > 2 && Math.abs(leading) < distance) { target = index; distance = Math.abs(leading); }
		}
		// At a clamped end, the penultimate card can already be fully visible.
		// Choose a genuinely earlier/later edge instead of repeatedly targeting that card.
		if (target != null) moveTo(target);
	}

	function onKeydown(event: KeyboardEvent): boolean {
		if (!enabled.value || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
		if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video, audio, [contenteditable="true"]')) return false;
		const focusedSlide = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-carousel-item]') : null;
		const focusedIndex = focusedSlide ? items().indexOf(focusedSlide) : -1;
		const base = focusedIndex >= 0 ? focusedIndex : activeIndex.value;
		const target = event.key === 'Home' ? 0 : event.key === 'End' ? count.value - 1
			: event.key === 'ArrowRight' ? base + (isRtl() ? -1 : 1)
			: event.key === 'ArrowLeft' ? base + (isRtl() ? 1 : -1) : null;
		if (target == null) return false;
		event.preventDefault();
		event.stopPropagation();
		moveTo(target);
		keyboardIndex.value = Math.max(0, Math.min(count.value - 1, target));
		return true;
	}

	watch([enabled, count, identity], async () => {
		const generation = ++resetGeneration;
		activeIndex.value = 0;
		keyboardIndex.value = 0;
		atStart.value = true;
		atEnd.value = false;
		await nextTick();
		if (generation !== resetGeneration) return;
		if (enabled.value && viewport.value) {
			viewport.value.scrollLeft = 0;
			onScroll();
		}
	}, { flush: 'post' });

	watch(viewport, element => {
		observer?.disconnect();
		observer = null;
		if (typeof ResizeObserver !== 'undefined' && element) {
			observer = new ResizeObserver(onScroll);
			observer.observe(element);
		}
		onScroll();
	}, { flush: 'post' });
	onBeforeUnmount(() => { resetGeneration++; observer?.disconnect(); });

	return { activeIndex, keyboardIndex, previousDisabled, nextDisabled, onScroll, moveTo, moveBy, onKeydown };
}
