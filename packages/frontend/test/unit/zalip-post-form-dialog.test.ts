/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import MkPostFormDialog from '@/components/MkPostFormDialog.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ close: vi.fn(), canClose: vi.fn(), abort: vi.fn(), reduced: false }));
vi.mock('@/components/MkModal.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['preferType'], emits: ['click', 'esc', 'closed'], setup(props, { slots, emit, expose }) {
		expose({ close: controls.close });
		return () => h('div', { 'data-testid': 'modal', 'data-mode': props.preferType }, [h('button', { onClick: () => emit('click') }, 'Backdrop'), h('button', { onClick: () => emit('esc') }, 'Escape'), slots.default?.()]);
	} }) };
});
vi.mock('@/components/MkPostForm.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['mock', 'initialText', 'initialVisibility'], emits: ['cancel', 'posted'], setup(props, { emit, expose }) {
		expose({ canClose: controls.canClose, abortUploader: controls.abort });
		return () => h('div', { 'data-testid': 'form', 'data-visibility': props.initialVisibility, 'data-mock': String(props.mock) }, [h('span', props.initialText), h('button', { onClick: () => emit('cancel') }, 'Cancel form'), h('button', { onClick: () => emit('posted') }, 'Posted')]);
	} }) };
});
beforeEach(() => { vi.clearAllMocks(); controls.canClose.mockResolvedValue(true); controls.reduced = false; vi.stubGlobal('innerWidth', 1440); vi.stubGlobal('matchMedia', () => ({ matches: controls.reduced })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function settle(): Promise<void> { await nextTick(); await Promise.resolve(); await nextTick(); }

describe('responsive native composer dialog', () => {
	it('uses a centered desktop dialog and a native mobile drawer without dropping initial privacy or mock mode', async () => {
		const view = render(MkPostFormDialog, { props: { mock: true, initialText: 'Private draft', initialVisibility: 'followers' } });
		expect(view.getByTestId('modal').getAttribute('data-mode')).toBe('dialog');
		expect(view.getByRole('dialog', { name: i18n.ts.zalip._postForm.newPost }).getAttribute('aria-modal')).toBe('true');
		expect(view.getByTestId('form').getAttribute('data-visibility')).toBe('followers'); expect(view.getByTestId('form').getAttribute('data-mock')).toBe('true');
		vi.stubGlobal('innerWidth', 400); window.dispatchEvent(new Event('resize')); await settle();
		expect(view.getByTestId('modal').getAttribute('data-mode')).toBe('drawer');
	});
	it('preserves the native pending-upload close confirmation for backdrop, Escape and Cancel', async () => {
		controls.canClose.mockResolvedValue(false);
		const view = render(MkPostFormDialog);
		for (const action of ['Backdrop', 'Escape', 'Cancel form']) await fireEvent.click(view.getByRole('button', { name: action }));
		await settle(); expect(controls.canClose).toHaveBeenCalledTimes(3); expect(controls.abort).not.toHaveBeenCalled(); expect(controls.close).not.toHaveBeenCalled();
		controls.canClose.mockResolvedValue(true); await fireEvent.click(view.getByRole('button', { name: 'Cancel form' })); await settle();
		expect(controls.abort).toHaveBeenCalledTimes(1); expect(controls.close).toHaveBeenCalledExactlyOnceWith();
	});
	it('does not request a send animation when reduced motion is preferred', async () => {
		controls.reduced = true;
		const view = render(MkPostFormDialog);
		await fireEvent.click(view.getByRole('button', { name: 'Posted' }));
		expect(controls.close).toHaveBeenCalledExactlyOnceWith({ useSendAnimation: false });
	});
});
