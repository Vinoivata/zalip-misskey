/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { preferState } from '../setup.unit.js';

vi.mock('@/os.js', () => ({ claimZIndex: () => 2000 }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); preferState.animation = false; });

const MotionTransition = defineComponent({
	props: ['name', 'duration'],
	setup: (props, { slots }) => () => h('div', { 'data-testid': 'motion-transition', 'data-motion': props.name, 'data-duration': props.duration }, slots.default?.()),
});

function motionFixture(reduced = false, preferType: 'dialog' | 'drawer' | 'popup' = 'dialog') {
	const query = Object.assign(new EventTarget(), { matches: reduced, media: '(prefers-reduced-motion: reduce)' });
	const added = vi.spyOn(query, 'addEventListener');
	const removed = vi.spyOn(query, 'removeEventListener');
	vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
	const view = render(MkModal, { props: { preferType }, slots: { default: '<button>Dialog action</button>' }, global: { stubs: { transition: MotionTransition } } });
	return {
		view, added, removed,
		change(matches: boolean): void {
			query.matches = matches;
			query.dispatchEvent(Object.assign(new Event('change'), { matches }));
		},
	};
}

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

describe('native modal reduced motion', () => {
	it.each([['dialog', 'modal', '200'], ['drawer', 'modal-drawer', '200'], ['popup', 'modal-popup', '100']] as const)('preserves normal %s transition timing when both preferences allow motion', async (kind, name, duration) => {
		preferState.animation = true;
		const { view } = motionFixture(false, kind);
		await nextTick();
		expect(view.getByTestId('motion-transition').getAttribute('data-motion')).toBe(name);
		expect(view.getByTestId('motion-transition').getAttribute('data-duration')).toBe(duration);
	});

	it('suppresses names and duration initially when the OS requests reduced motion', async () => {
		preferState.animation = true;
		const { view } = motionFixture(true);
		await nextTick();
		expect(view.getByTestId('motion-transition').getAttribute('data-motion')).toBe('');
		expect(view.getByTestId('motion-transition').getAttribute('data-duration')).toBe('0');
	});

	it('keeps motion disabled when the saved preference is off', async () => {
		preferState.animation = false;
		const { view, change } = motionFixture(false);
		await nextTick();
		change(true); await nextTick(); change(false); await nextTick();
		expect(view.getByTestId('motion-transition').getAttribute('data-motion')).toBe('');
		expect(view.getByTestId('motion-transition').getAttribute('data-duration')).toBe('0');
	});

	it('honors live OS changes and removes the exact change listener when unmounted', async () => {
		preferState.animation = true;
		const { view, added, removed, change } = motionFixture(false);
		await nextTick();
		expect(added).toHaveBeenCalledExactlyOnceWith('change', expect.any(Function));
		change(true); await nextTick();
		expect(view.getByTestId('motion-transition').getAttribute('data-motion')).toBe('');
		expect(view.getByTestId('motion-transition').getAttribute('data-duration')).toBe('0');
		change(false); await nextTick();
		expect(view.getByTestId('motion-transition').getAttribute('data-motion')).toBe('modal');
		expect(view.getByTestId('motion-transition').getAttribute('data-duration')).toBe('200');
		view.unmount();
		expect(removed).toHaveBeenCalledExactlyOnceWith('change', added.mock.calls[0][1]);
	});
});
