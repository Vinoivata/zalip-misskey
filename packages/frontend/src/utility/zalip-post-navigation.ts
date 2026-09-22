/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Native links, controls, embedded content, text selection and swipe gestures
// own their interactions; only the surrounding post opens its discussion.
export function shouldOpenZalipPost(event: MouseEvent, article: HTMLElement, start?: { x: number; y: number }): boolean {
	if (event.defaultPrevented || event.button !== 0 || event.detail > 1 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return false;
	if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return false;
	if (window.getSelection()?.toString().trim()) return false;
	const target = event.target instanceof Element ? event.target : null;
	if (!target || !article.contains(target) || target.closest('article') !== article) return false;
	const control = target.closest('a, button, input, textarea, select, label, summary, audio, video, iframe, img, canvas, [role="button"], [role="link"], [role="checkbox"], [tabindex], [contenteditable="true"], [data-zalip-post-interactive]');
	return !control || !article.contains(control);
}

export function createZalipPostNavigation(open: () => void) {
	let timer: number | undefined;

	function cancel(): void {
		window.clearTimeout(timer);
		timer = undefined;
	}

	return {
		cancel,
		click(event: MouseEvent, article: HTMLElement, start?: { x: number; y: number }): void {
			cancel();
			if (!shouldOpenZalipPost(event, article, start)) return;
			// Let a second click or text selection claim the gesture before navigating.
			timer = window.setTimeout(() => {
				timer = undefined;
				if (article.isConnected && shouldOpenZalipPost(event, article, start)) open();
			}, 300);
		},
	};
}
