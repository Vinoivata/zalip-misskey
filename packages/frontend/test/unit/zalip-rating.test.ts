/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import ZalipRatingDialog from '@/components/ZalipRatingDialog.vue';
import { i18n } from '@/i18n.js';

vi.mock('@/components/MkModal.vue', () => ({
	default: defineComponent({
		emits: ['click', 'closed', 'esc'],
		setup(_, { slots, expose, emit }) { expose({ close: () => emit('closed') }); return () => h('div', slots.default?.()); },
	}),
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Zalip rating dialog', () => {
	it('shows a centered title, year and poster without confusing the personal and community ratings', () => {
		const view = render(ZalipRatingDialog, { props: { title: 'Movie', subtitle: '2026', posterUrl: '/poster.jpg' } });
		expect(view.getByRole('heading', { name: 'Movie' })).toBeTruthy();
		expect(view.getByText('2026')).toBeTruthy();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe('/poster.jpg');
		expect(view.emitted().save).toBeUndefined();
	});
	it('offers ten values and saves only after explicit confirmation', async () => {
		const view = render(ZalipRatingDialog);
		const numbers = view.getAllByRole('radio');
		expect(numbers).toHaveLength(10);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('7');
		await fireEvent.click(numbers[7]);
		expect(view.emitted().save).toBeUndefined();
		expect(view.getByRole('dialog').style.getPropertyValue('--rating-color')).toBe('var(--MI_THEME-success)');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.ratingSubmit }));
		expect(view.emitted().save).toEqual([[8]]);
		expect(view.emitted().closed).toBeUndefined();
	});
	it('supports keyboard navigation, score colors and endpoints', async () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 5 } });
		const rail = view.getByRole('radiogroup');
		expect(view.getByRole('dialog').style.getPropertyValue('--rating-color')).toBe('var(--MI_THEME-fgTransparentWeak)');
		await fireEvent.keyDown(rail, { key: 'ArrowLeft' });
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('4');
		expect(view.getByRole('dialog').style.getPropertyValue('--rating-color')).toBe('var(--MI_THEME-error)');
		await fireEvent.keyDown(rail, { key: 'Home' });
		await fireEvent.keyDown(rail, { key: 'ArrowLeft' });
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('1');
		await fireEvent.keyDown(rail, { key: 'End' });
		await fireEvent.keyDown(rail, { key: 'ArrowRight' });
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('10');
	});
	it('steps through desktop ratings without saving and disables the endpoint arrows', async () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 1 } });
		const previous = view.getByRole('button', { name: i18n.ts.zalip.ratingDecrease }) as HTMLButtonElement;
		const next = view.getByRole('button', { name: i18n.ts.zalip.ratingIncrease }) as HTMLButtonElement;
		expect(previous.disabled).toBe(true);
		expect(next.disabled).toBe(false);
		await fireEvent.click(next);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('2');
		expect(previous.disabled).toBe(false);
		await fireEvent.click(previous);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('1');
		await fireEvent.keyDown(view.getByRole('radiogroup'), { key: 'End' });
		expect(next.disabled).toBe(true);
		await fireEvent.click(previous);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('9');
		expect(view.emitted().save).toBeUndefined();
		expect(view.getByText(i18n.ts.zalip.ratingDesktopHint)).toBeTruthy();
	});
	it('keeps the mobile swipe hint without desktop arrow controls', () => {
		const mediaQuery = window.matchMedia('(max-width: 600px)');
		Object.defineProperty(mediaQuery, 'matches', { configurable: true, value: true });
		vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQuery);
		const view = render(ZalipRatingDialog);
		expect(view.queryByRole('button', { name: i18n.ts.zalip.ratingDecrease })).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.zalip.ratingIncrease })).toBeNull();
		expect(view.getByText(i18n.ts.zalip.ratingSwipeHint)).toBeTruthy();
		expect(view.getAllByRole('radio')).toHaveLength(10);
	});
	it('selects the nearest score when the native touch rail scrolls', async () => {
		const view = render(ZalipRatingDialog);
		const rail = view.getByRole('radiogroup');
		Object.defineProperty(rail.firstElementChild!, 'offsetWidth', { configurable: true, value: 104 });
		vi.spyOn(rail.firstElementChild!, 'getBoundingClientRect').mockReturnValue({ width: 93.6 } as DOMRect);
		rail.scrollLeft = 728;
		await fireEvent.scroll(rail);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('8');
		rail.scrollLeft = 2000;
		await fireEvent.scroll(rail);
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('10');
	});
	it('filters other titles by the personal score as the selection changes', async () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 8, workId: 'current', ratedWorks: [
			{ personalRating: 8, work: { id: 'current', title: 'Current title', posterPath: null } },
			{ personalRating: 8, work: { id: 'eight', title: 'Eight title', posterPath: '/eight.jpg' } },
			{ personalRating: 7, work: { id: 'seven', title: 'Seven title', posterPath: null } },
			{ personalRating: null, work: { id: 'none', title: 'Unrated title', posterPath: null } },
		] } });
		expect(view.getByText('Eight title')).toBeTruthy();
		expect(view.queryByText('Current title')).toBeNull();
		expect(view.queryByText('Seven title')).toBeNull();
		expect(view.queryByText('Unrated title')).toBeNull();
		await fireEvent.click(view.getAllByRole('radio')[6]);
		expect(view.getByText('Seven title')).toBeTruthy();
		expect(view.queryByText('Eight title')).toBeNull();
		await fireEvent.click(view.getAllByRole('radio')[0]);
		expect(view.getByText(i18n.ts.zalip.ratingNoSimilarTitles)).toBeTruthy();
	});

	it('stops a mouse drag released outside the rail without changing the score on return', async () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 8 } });
		const rail = view.getByRole('radiogroup');
		await fireEvent.pointerDown(rail, { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 1, clientX: 200 });
		await fireEvent.pointerUp(window, { pointerType: 'mouse', pointerId: 1, button: 0, buttons: 0 });
		await fireEvent.pointerMove(rail, { pointerType: 'mouse', pointerId: 1, buttons: 0, clientX: 100 });
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('8');
		expect(view.emitted().save).toBeUndefined();
	});
	it('keeps controls locked while saving, and retains recoverable errors', async () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 3, saving: true, error: 'Retry saving' } });
		expect([...view.getAllByRole('button'), ...view.getAllByRole('radio')].every(button => (button as HTMLButtonElement).disabled)).toBe(true);
		await fireEvent.keyDown(view.getByRole('radiogroup'), { key: 'End' });
		expect(view.getByRole('radio', { checked: true }).textContent).toBe('3');
		expect(view.getByRole('alert').textContent).toBe('Retry saving');
		await view.rerender({ saving: false });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.close }));
		expect(view.emitted().closed).toHaveLength(1);
		expect(view.emitted().save).toBeUndefined();
	});
	it('reports loading and offers retry if the rated library fails', async () => {
		const view = render(ZalipRatingDialog, { props: { relatedPending: true } });
		expect(view.getByText(i18n.ts.zalip.libraryLoading)).toBeTruthy();
		await view.rerender({ relatedPending: false, relatedError: true });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		expect(view.emitted().retry).toHaveLength(1);
	});
});
