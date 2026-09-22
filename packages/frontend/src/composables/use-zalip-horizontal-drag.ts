/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount } from 'vue';

type DragState = {
	element: HTMLElement;
	pointerId: number;
	startX: number;
	startY: number;
	startScrollLeft: number;
	moved: boolean;
};

export function useZalipHorizontalDrag() {
	let state: DragState | null = null;
	let draggedElement: HTMLElement | null = null;

	function preventNativeDrag(event: DragEvent): void {
		event.preventDefault();
	}

	function finishDrag(event?: PointerEvent): void {
		if (state == null) return;
		if (event != null && state.pointerId !== event.pointerId) return;

		const finished = state;
		state = null;
		window.removeEventListener('pointermove', onPointerMove);
		window.removeEventListener('pointerup', finishDrag);
		window.removeEventListener('pointercancel', finishDrag);
		finished.element.removeEventListener('dragstart', preventNativeDrag);
		if (finished.element.hasPointerCapture(finished.pointerId)) {
			finished.element.releasePointerCapture(finished.pointerId);
		}
		finished.element.removeAttribute('data-dragging');
		draggedElement = finished.moved ? finished.element : null;
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.pointerType !== 'mouse' || event.button !== 0) return;
		finishDrag();
		draggedElement = null;
		const element = event.currentTarget;
		if (!(element instanceof HTMLElement)) return;

		state = {
			element,
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			startScrollLeft: element.scrollLeft,
			moved: false,
		};
		// Capture only after a horizontal drag: capturing pointerdown retargets
		// ordinary clicks from the card link to the rail, making cards unclickable.
		element.addEventListener('dragstart', preventNativeDrag);
		window.addEventListener('pointermove', onPointerMove, { passive: false });
		window.addEventListener('pointerup', finishDrag);
		window.addEventListener('pointercancel', finishDrag);
	}

	function onPointerMove(event: PointerEvent): void {
		if (state == null || state.pointerId !== event.pointerId) return;
		const delta = event.clientX - state.startX;
		if (!state.moved) {
			if (Math.abs(delta) < 6) return;
			if (Math.abs(event.clientY - state.startY) > Math.abs(delta)) {
				finishDrag(event);
				return;
			}
			state.moved = true;
			state.element.dataset.dragging = 'true';
			state.element.setPointerCapture(event.pointerId);
		}
		event.preventDefault();
		state.element.scrollLeft = state.startScrollLeft - delta;
	}

	function onClickCapture(event: MouseEvent): void {
		// Do not swallow keyboard activation or the next intentional click.
		if (event.detail === 0 || event.currentTarget !== draggedElement) return;
		draggedElement = null;
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
