/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import MkModal from '@/components/MkModal.vue';

vi.mock('@/os.js', () => ({ claimZIndex: () => 2000 }));

afterEach(cleanup);

describe('modal focus cleanup', () => {
	it('releases the page when an open modal is removed by its parent', async () => {
		const open = ref(true);
		const view = render(defineComponent({
			setup: () => () => h('div', [
				h('button', { 'data-testid': 'page-action' }, 'Page action'),
				open.value ? h(MkModal, { preferType: 'dialog' }, { default: () => h('button', 'Dialog action') }) : null,
			]),
		}));
		await nextTick();
		const button = view.getByTestId('page-action');
		expect(button.inert).toBe(true);
		open.value = false;
		await nextTick();
		expect(button.inert).toBe(false);
		expect((view.container as HTMLElement).inert).not.toBe(true);
	});

	it('keeps the page blocked until the last nested modal is removed', async () => {
		const first = ref(true);
		const second = ref(true);
		const view = render(defineComponent({
			setup: () => () => h('div', [
				h('button', { 'data-testid': 'page-action' }, 'Page action'),
				first.value ? h(MkModal, { preferType: 'dialog' }, { default: () => h('button', 'First dialog') }) : null,
				second.value ? h(MkModal, { preferType: 'dialog' }, { default: () => h('button', 'Second dialog') }) : null,
			]),
		}));
		await nextTick();
		second.value = false;
		await nextTick();
		expect(view.getByTestId('page-action').inert).toBe(true);
		first.value = false;
		await nextTick();
		expect(view.getByTestId('page-action').inert).toBe(false);
	});
});
