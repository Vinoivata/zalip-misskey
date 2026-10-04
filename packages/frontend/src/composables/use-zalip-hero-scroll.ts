/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, watch } from 'vue';
import { getScrollContainer } from '@@/js/scroll.js';
import type { Ref } from 'vue';

/** Keep the artwork behind the naturally scrolling title; never change layout height. */
export function useZalipHeroScroll(hero: Readonly<Ref<HTMLElement | null>>, artwork: Readonly<Ref<HTMLElement | null>>) {
	let active = true;
	let dispose: (() => void) | undefined;

	function connect(): void {
		dispose?.();
		dispose = undefined;
		const currentHero = hero.value;
		const currentCover = artwork.value;
		if (!active || !currentHero || !currentCover) return;
		const element = currentHero;
		const cover = currentCover;

		const container = getScrollContainer(element.parentElement);
		const scrollTarget = container ?? window;
		const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
		let frame: number | null = null;
		let lastShift = '';
		let lastOpacity = '';

		function reset(): void {
			element.style.removeProperty('--zalip-hero-shift');
			element.style.removeProperty('--zalip-hero-opacity');
			lastShift = '';
			lastOpacity = '';
		}

		function update(): void {
			frame = null;
			if (reducedMotion.matches) {
				reset();
				return;
			}
			// The hero can be below site chrome or a pull-to-refresh indicator.
			// Measure its untransformed box, not the moving artwork, to avoid feedback.
			const top = container ? container.getBoundingClientRect().top + container.clientTop : 0;
			const distance = Math.max(0, top - element.getBoundingClientRect().top);
			const height = cover.offsetHeight;
			if (height <= 0) {
				reset();
				return;
			}
			const progress = Math.min(1, distance / (height * 0.75));
			const eased = progress * progress * (3 - 2 * progress);
			const shift = `${Math.min(distance, height).toFixed(2)}px`;
			const opacity = (1 - eased).toFixed(3);
			// No Vue updates (or player rerenders) for each scroll frame.
			if (shift !== lastShift) element.style.setProperty('--zalip-hero-shift', shift);
			if (opacity !== lastOpacity) element.style.setProperty('--zalip-hero-opacity', opacity);
			lastShift = shift;
			lastOpacity = opacity;
		}

		function schedule(): void {
			frame ??= window.requestAnimationFrame(update);
		}

		const observer = new ResizeObserver(schedule);
		observer.observe(element);
		observer.observe(cover);
		scrollTarget.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule, { passive: true });
		reducedMotion.addEventListener('change', schedule);
		update();
		dispose = () => {
			if (frame != null) window.cancelAnimationFrame(frame);
			observer.disconnect();
			scrollTarget.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			reducedMotion.removeEventListener('change', schedule);
			reset();
		};
	}

	watch([hero, artwork], connect, { flush: 'post', immediate: true });
	onActivated(() => { active = true; connect(); });
	onDeactivated(() => { active = false; dispose?.(); dispose = undefined; });
	onBeforeUnmount(() => { active = false; dispose?.(); dispose = undefined; });
}
