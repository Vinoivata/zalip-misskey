/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount } from 'vue';

type DragState = {
	element: HTMLElement;
	pointerId: number;
	startX: number;
	startScrollLeft: number;
	moved: boolean;
};

export function useZalipHorizontalDrag() {
	let state: DragState | null = null;
	let suppressClickUntil = 0;

	function finishDrag(event?: PointerEvent): void {
		if (state == null) return;
		if (event != null && state.pointerId !== event.pointerId) return;

		if (state.element.hasPointerCapture(state.pointerId)) {
			state.element.releasePointerCapture(state.pointerId);
		}
		state.element.removeAttribute('data-dragging');
		if (state.moved) suppressClickUntil = Date.now() + 250;
		state = null;
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		const element = event.currentTarget;
		if (!(element instanceof HTMLElement)) return;

		state = {
			element,
			pointerId: event.pointerId,
			startX: event.clientX,
			startScrollLeft: element.scrollLeft,
			moved: false,
		};
		element.setPointerCapture(event.pointerId);
	}

	function onPointerMove(event: PointerEvent): void {
		if (state == null || state.pointerId !== event.pointerId) return;
		const delta = event.clientX - state.startX;
		if (Math.abs(delta) > 4) {
			state.moved = true;
			state.element.dataset.dragging = 'true';
			event.preventDefault();
		}
		state.element.scrollLeft = state.startScrollLeft - delta;
	}

	function onClickCapture(event: MouseEvent): void {
		if (Date.now() >= suppressClickUntil) return;
		event.preventDefault();
		event.stopPropagation();
	}

	onBeforeUnmount(() => finishDrag());

	return {
		onPointerDown,
		onPointerMove,
		onPointerUp: finishDrag,
		onPointerCancel: finishDrag,
		onClickCapture,
	};
}
