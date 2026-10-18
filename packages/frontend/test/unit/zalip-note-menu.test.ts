/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick, ref } from 'vue';
import MkMenu from '@/components/MkMenu.vue';
import MkPopupMenu from '@/components/MkPopupMenu.vue';
import type { MenuItem } from '@/types/menu.js';

vi.mock('@/os.js', () => ({ popupMenu: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/components/MkModal.vue', () => ({ default: { template: '<div><slot type="popup" :maxHeight="400" /></div>' } }));

const directives = { hotkey: {} };
async function settle(): Promise<void> { await nextTick(); await Promise.resolve(); await nextTick(); }
afterEach(cleanup);

describe('scoped note action menu appearance', () => {
	it('is opt-in and preserves the native action order, dividers, dangerous actions and click behavior', async () => {
		const save = vi.fn(); const report = vi.fn();
		const items: MenuItem[] = [{ text: 'Save fixture', icon: 'ti ti-bookmark', action: save }, { type: 'divider' }, { text: 'Report fixture', icon: 'ti ti-flag', danger: true, action: report }];
		const view = render(MkMenu, { props: { items, appearance: 'zalip-note' }, global: { directives } }); await settle();
		expect(view.getByRole('menu').className).toContain('zalipNote');
		expect(view.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Save fixture', 'Report fixture']); expect(view.getAllByRole('separator')).toHaveLength(1);
		expect(view.getByRole('menuitem', { name: 'Report fixture' }).className).toContain('danger'); expect(save).not.toHaveBeenCalled(); expect(report).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole('menuitem', { name: 'Report fixture' })); await settle();
		expect(report).toHaveBeenCalledTimes(1); expect(view.emitted().close).toEqual([[true]]);
		view.unmount(); const native = render(MkMenu, { props: { items }, global: { directives } }); await settle(); expect(native.getByRole('menu').className).not.toContain('zalipNote');
	});
	it('keeps native checkbox, disabled, nested-menu and link semantics', async () => {
		const enabled = ref(false); const disabled = ref(false);
		const items: MenuItem[] = [{ type: 'switch', text: 'Enabled fixture', icon: 'ti ti-bell', ref: enabled }, { type: 'switch', text: 'Disabled fixture', ref: disabled, disabled: true }, { type: 'parent', text: 'More fixture', icon: 'ti ti-menu', children: [] }, { type: 'a', text: 'External fixture', href: 'https://example.test/', target: '_blank', icon: 'ti ti-external-link' }];
		const view = render(MkMenu, { props: { items, appearance: 'zalip-note' }, global: { directives } }); await settle();
		await fireEvent.click(view.getByRole('menuitemcheckbox', { name: 'Enabled fixture' })); expect(enabled.value).toBe(true);
		expect((view.getByRole('menuitemcheckbox', { name: 'Disabled fixture' }) as HTMLButtonElement).disabled).toBe(true);
		expect(view.getByRole('menuitem', { name: 'More fixture' }).querySelector('.ti-chevron-right')).toBeTruthy();
		expect(view.getByRole('menuitem', { name: 'External fixture' }).getAttribute('rel')).toBe('noopener noreferrer'); expect(disabled.value).toBe(false);
	});
	it('passes the scoped variant through the existing popup without replacing the menu or its max height', async () => {
		const view = render(MkPopupMenu, { props: { appearance: 'zalip-note', items: [{ text: 'Popup fixture', action: vi.fn() }] }, global: { directives } }); await settle();
		expect(view.getByRole('menu').className).toContain('zalipNote'); expect(view.getByRole('menuitem', { name: 'Popup fixture' })).toBeTruthy();
		const panel = view.getByRole('menu').firstElementChild as HTMLElement;
		expect(panel.style.maxHeight).toContain('400px');
	});
});
