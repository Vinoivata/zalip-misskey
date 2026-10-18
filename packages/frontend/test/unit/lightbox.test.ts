/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import MkLightbox from '@/components/MkLightbox.vue';
import type { Content } from '@/components/MkLightbox.item.vue';
import { i18n } from '@/i18n.js';
import { preferState } from '../setup.unit.js';

vi.mock('@/os.js', () => ({ claimZIndex: () => 3000 }));
vi.mock('@/utility/touch.js', () => ({ isTouchUsing: false }));
vi.mock('@/components/MkLightbox.item.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({
		props: ['content', 'activated', 'animation'], emits: ['close'],
		setup(props, { emit, expose }) {
			expose({ onActive: () => {}, onDeactive: () => {}, closeThis: () => emit('close') });
			return () => h('section', { 'data-testid': props.content.id, 'data-activated': props.activated, 'data-animation': props.animation }, [h('button', { onClick: () => emit('close') }, props.content.id)]);
		},
	}) };
});

const MotionTransition = defineComponent({
	props: ['duration', 'enterActiveClass'],
	setup: (props, { slots }) => () => h('div', { 'data-testid': 'transition', 'data-duration': JSON.stringify(props.duration), 'data-motion': props.enterActiveClass }, slots.default?.()),
});

async function settle() { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick(); } }

function contents(count = 5): Content[] { return Array.from({ length: count }, (_, i) => ({ id: `image-${i}`, type: 'image', url: `https://media.example/original-${i}.jpg` })); }

function motionQuery(initial = false) {
	const query = Object.assign(new EventTarget(), { matches: initial, media: '(prefers-reduced-motion: reduce)' });
	const added = vi.spyOn(query, 'addEventListener');
	const removed = vi.spyOn(query, 'removeEventListener');
	vi.spyOn(window, 'matchMedia').mockReturnValue(query as unknown as MediaQueryList);
	return { added, removed, change(matches: boolean) { query.matches = matches; query.dispatchEvent(Object.assign(new Event('change'), { matches })); } };
}

function opener() { const button = document.createElement('button'); button.textContent = 'Open gallery'; document.body.append(button); button.focus(); return button; }

function active(view: ReturnType<typeof render>) { return Array.from(view.container.querySelectorAll<HTMLElement>('section[data-activated="true"]')).map(element => element.dataset.testid); }

beforeEach(() => {
	preferState.animation = false;
	window.history.replaceState({ before: true }, '', '/gallery#before');
	vi.spyOn(window.history, 'back').mockImplementation(() => {});
	motionQuery();
});
afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); preferState.animation = false; });

describe('real shared fullscreen viewer lifecycle', () => {
	it('focuses a named modal and makes every inactive slide inert', async () => {
		const button = opener();
		const view = render(MkLightbox, { props: { contents: contents(), defaultIndex: 1 } }); await settle();
		const dialog = view.getByRole('dialog', { name: i18n.ts.images });
		expect(dialog.getAttribute('aria-modal')).toBe('true'); expect(dialog.getAttribute('tabindex')).toBe('-1'); expect(document.activeElement).toBe(dialog);
		expect(button.inert).toBe(true);
		for (let i = 0; i < 5; i++) expect(view.getByTestId(`image-${i}`).parentElement?.hasAttribute('inert')).toBe(i !== 1);
		expect(view.getByRole('button', { name: i18n.ts.next })).toBeTruthy(); expect(view.getByRole('button', { name: i18n.ts.zalip._importer.previous })).toBeTruthy();
		view.unmount(); expect(button.inert).toBe(false); expect(document.activeElement).toBe(button);
	});
	it('loads originals only after visiting and bounds retained originals to visited neighbours', async () => {
		const view = render(MkLightbox, { props: { contents: contents() } }); await settle();
		expect(active(view)).toEqual(['image-0']);
		await fireEvent.keyDown(document, { key: 'ArrowRight' }); await settle(); expect(active(view)).toEqual(['image-0', 'image-1']);
		await fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true }); await settle(); expect(active(view)).toEqual(['image-1', 'image-2']);
		await fireEvent.keyDown(document, { key: 'ArrowRight', repeat: true }); await settle(); expect(active(view)).toEqual(['image-2', 'image-3']);
		expect(view.getByTestId('image-4').dataset.activated).toBe('false');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.previous })); await settle(); expect(active(view).length).toBeLessThanOrEqual(3);
	});
	it('wraps Tab inside current controls and does not handle a higher modal key event', async () => {
		const view = render(MkLightbox, { props: { contents: contents(2) } }); await settle();
		const first = view.getByRole('button', { name: 'image-0' }); const last = view.getByRole('button', { name: i18n.ts.next });
		last.focus(); await fireEvent.keyDown(last, { key: 'Tab' }); expect(document.activeElement).toBe(first);
		await fireEvent.keyDown(first, { key: 'Tab', shiftKey: true }); expect(document.activeElement).toBe(last);
		const dialog = view.getByRole('dialog'); dialog.inert = true;
		await fireEvent.keyDown(document, { key: 'ArrowRight' }); await settle(); expect(active(view)).toEqual(['image-0']);
		dialog.inert = false;
	});
	it('closes once with native Back, removes hotkeys during the fade and restores focus', async () => {
		const button = opener();
		const removed = vi.spyOn(document, 'removeEventListener');
		const view = render(MkLightbox, { props: { contents: contents(2) }, global: { stubs: { transition: false } } }); await settle();
		await fireEvent.keyDown(document, { key: 'Escape' });
		expect(window.history.back).toHaveBeenCalledTimes(1); expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function));
		await fireEvent.keyDown(document, { key: 'ArrowRight' }); await settle(); expect(active(view)).toEqual(['image-0']);
		await waitFor(() => expect(document.activeElement).toBe(button));
		expect(button.inert).toBe(false);
	});
	it('cleans hidden sources, exact listeners and its owned hash when forcibly disposed', async () => {
		const button = opener(); const query = motionQuery();
		const source = document.createElement('img'); source.style.visibility = 'visible'; document.body.append(source);
		const images = contents(2); images[1].sourceElement = source;
		const removed = vi.spyOn(window, 'removeEventListener');
		const view = render(MkLightbox, { props: { contents: images } }); await settle();
		await fireEvent.keyDown(document, { key: 'ArrowRight' }); await settle(); expect(source.style.visibility).toBe('hidden');
		view.unmount(); await settle();
		expect(source.style.visibility).toBe('visible'); expect(button.inert).toBe(false); expect(document.activeElement).toBe(button);
		expect(window.location.pathname + window.location.hash).toBe('/gallery#before'); expect(window.history.state).toEqual({ before: true }); expect(window.history.back).not.toHaveBeenCalled();
		expect(removed).toHaveBeenCalledWith('resize', expect.any(Function)); expect(removed).toHaveBeenCalledWith('popstate', expect.any(Function)); expect(query.removed).toHaveBeenCalledWith('change', query.added.mock.calls[0][1]);
	});
	it('never rewrites a newer route or focuses a disconnected opener', async () => {
		const button = opener();
		const view = render(MkLightbox, { props: { contents: contents(1) } }); await settle();
		button.remove(); const focus = vi.spyOn(button, 'focus');
		const copiedState = window.history.state;
		window.history.replaceState(copiedState, '', '/new-route#pswp');
		view.unmount(); await settle(); expect(window.location.pathname).toBe('/new-route'); expect(window.history.state).toEqual(copiedState); expect(focus).not.toHaveBeenCalled();
	});
	it('handles browser Back without adding a second history navigation, and can reopen cleanly', async () => {
		const view = render(MkLightbox, { props: { contents: contents(1) } }); await settle();
		window.history.replaceState({ before: true }, '', '/gallery#before');
		window.dispatchEvent(new PopStateEvent('popstate', { state: { before: true } })); await settle(); expect(window.history.back).not.toHaveBeenCalled();
		view.unmount(); const reopened = render(MkLightbox, { props: { contents: contents(2), defaultIndex: 1 } }); await settle();
		expect(document.activeElement).toBe(reopened.getByRole('dialog')); expect(active(reopened)).toEqual(['image-1']);
	});
	it('disposes a stale popup over a newer viewer without navigating or releasing the newer focus trap', async () => {
		const button = opener();
		const current = render(MkLightbox, { props: { contents: contents(2) } }); await settle();
		const currentDialog = current.getByRole('dialog'); const currentState = window.history.state;
		const stale = render(MkLightbox, { props: { contents: [{ id: 'stale', type: 'image', url: 'https://media.example/stale.jpg' }] } }); await settle();
		stale.unmount(); await settle();
		expect(window.history.state).toEqual(currentState); expect(window.history.back).not.toHaveBeenCalled(); expect(currentDialog.inert).toBe(false); expect(button.inert).toBe(true); expect(document.activeElement).toBe(currentDialog);
		await fireEvent.keyDown(document, { key: 'ArrowRight' }); await settle(); expect(active(current)).toEqual(['image-0', 'image-1']);
		current.unmount(); expect(button.inert).toBe(false); expect(window.location.hash).toBe('#before');
	});
	it('passes live reduced-motion and zero timings to the viewer and removes its listener', async () => {
		preferState.animation = true; const query = motionQuery();
		const view = render(MkLightbox, { props: { contents: contents(1) }, global: { stubs: { transition: MotionTransition } } }); await settle();
		expect(view.getByTestId('transition').dataset.duration).toBe('{"enter":200,"leave":200}'); expect(view.getByTestId('image-0').dataset.animation).toBe('true');
		query.change(true); await settle(); expect(view.getByTestId('transition').dataset.duration).toBe('{"enter":0,"leave":0}'); expect(view.getByTestId('transition').dataset.motion).toBe(''); expect(view.getByTestId('image-0').dataset.animation).toBe('false');
		query.change(false); await settle(); expect(view.getByTestId('image-0').dataset.animation).toBe('true');
		view.unmount(); expect(query.removed).toHaveBeenCalledWith('change', query.added.mock.calls[0][1]);
	});
});
