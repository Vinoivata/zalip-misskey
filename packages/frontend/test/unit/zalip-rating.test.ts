/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import ZalipRatingDialog from '@/components/ZalipRatingDialog.vue';

vi.mock('@/components/MkModal.vue', () => ({
	default: defineComponent({
		emits: ['click', 'closed', 'esc'],
		setup(_, { slots }) { return () => h('div', slots.default?.()); },
	}),
}));

afterEach(cleanup);

describe('Zalip rating dialog', () => {
	it('offers ten values and disables saving until one is chosen', async () => {
		const view = render(ZalipRatingDialog);
		const stars = view.getAllByRole('button', { pressed: false });
		expect(stars).toHaveLength(10);
		const submit = view.container.querySelector('footer button:last-child') as HTMLButtonElement;
		expect(submit.disabled).toBe(true);
		await fireEvent.click(stars[7]);
		expect(submit.disabled).toBe(false);
		expect(view.getByRole('dialog').style.getPropertyValue('--rating-color')).toBe('var(--MI_THEME-success)');
		await fireEvent.click(submit);
		expect(view.emitted().save).toEqual([[8]]);
		// The caller, not the click handler, closes only after persistence succeeds.
		expect(view.getByRole('dialog')).toBeTruthy();
	});

	it('keeps all stars disabled while saving and exposes a recoverable error', () => {
		const view = render(ZalipRatingDialog, { props: { initialRating: 3, saving: true, error: 'Retry saving' } });
		expect(view.getByRole('dialog').style.getPropertyValue('--rating-color')).toBe('var(--MI_THEME-error)');
		expect(view.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
		expect(view.getByRole('alert').textContent).toBe('Retry saving');
	});
});
