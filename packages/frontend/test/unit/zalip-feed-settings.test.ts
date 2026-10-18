/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import MkZalipFeed from '@/components/MkZalipFeed.vue';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ popup: vi.fn(), post: vi.fn(), login: vi.fn(), reload: vi.fn(), storeSet: vi.fn(), reset: () => {}, dismiss: () => {} }));
vi.mock('@/i.js', () => ({ $i: { id: 'fixture-viewer' } }));
vi.mock('@/os.js', () => ({ popupMenu: controls.popup, post: controls.post }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/timelines.js', () => ({ availableBasicTimelines: () => ['local', 'home', 'social', 'global'], isAvailableBasicTimeline: () => true, isBasicTimeline: () => true }));
vi.mock('@/store.js', async () => {
	const { ref } = await import('vue');
	const initial = () => ({ src: 'local', filter: { withRenotes: true, withReplies: true, withSensitive: false, onlyFiles: false } });
	const tl = ref(initial());
	controls.reset = () => { tl.value = initial(); };
	return { store: { s: { get tl() { return tl.value; } }, r: { tl }, set: (key: string, value: ReturnType<typeof initial>) => { controls.storeSet(key, value); tl.value = value; } } };
});
vi.mock('@/components/MkStreamingNotesTimeline.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['src', 'withReplies'], setup: (props, { expose }) => { expose({ reloadTimeline: controls.reload }); return () => h('div', { 'data-testid': 'timeline', 'data-src': props.src, 'data-with-replies': props.withReplies }); } }) };
});

function setup() {
	return render(MkZalipFeed, { global: { stubs: { MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }), MkAvatar: true } } });
}
async function settle(): Promise<void> { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }
function items(): MenuItem[] { return controls.popup.mock.calls.at(-1)![0]; }

beforeEach(() => {
	vi.clearAllMocks(); controls.reset(); controls.login.mockResolvedValue(false);
	controls.popup.mockImplementation(() => new Promise<void>(resolve => { controls.dismiss = resolve; }));
});
afterEach(() => { controls.dismiss(); cleanup(); });

describe('native feed settings surface', () => {
	it('announces open/close and passes only the scoped appearance without invoking actions on open', async () => {
		const view = setup(); await settle();
		const button = view.getByRole('button', { name: i18n.ts.zalip.feedSettings });
		expect(button.getAttribute('aria-haspopup')).toBe('menu'); expect(button.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(button); await settle();
		expect(button.getAttribute('aria-expanded')).toBe('true'); expect(button.className).toContain('modeActive');
		expect(controls.popup).toHaveBeenCalledTimes(1); expect(controls.popup.mock.calls[0][1]).toBe(button); expect(controls.popup.mock.calls[0][2]).toEqual({ align: 'right', width: 300, appearance: 'zalip-note' });
		expect(controls.reload).not.toHaveBeenCalled(); expect(controls.storeSet).not.toHaveBeenCalled(); expect(controls.post).not.toHaveBeenCalled(); expect(controls.login).not.toHaveBeenCalled();
		controls.dismiss(); await settle(); expect(button.getAttribute('aria-expanded')).toBe('false'); expect(button.className).not.toContain('modeActive');
	});
	it('preserves the three native switch refs, links, dividers and explicit reload action', async () => {
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip.feedSettings })); await settle();
		const switches = items().filter(item => 'type' in item && item.type === 'switch');
		expect(switches.map(item => item.text)).toEqual([i18n.ts.showRenotes, i18n.ts.withSensitive, i18n.ts.fileAttachedOnly]);
		expect(switches.map(item => item.ref.value)).toEqual([true, false, false]); expect(items().filter(item => 'type' in item && item.type === 'divider')).toHaveLength(2);
		const links = items().filter(item => 'type' in item && item.type === 'link'); expect(links.map(item => item.to)).toEqual(['/my/lists', '/my/antennas', '/channels']);
		switches[0].ref.value = false; await settle(); expect(controls.storeSet.mock.calls.at(-1)).toEqual(['tl', { src: 'local', filter: { withRenotes: false, withReplies: true, withSensitive: false, onlyFiles: false } }]);
		switches[1].ref.value = true; switches[2].ref.value = true; await settle();
		expect(controls.storeSet.mock.calls.at(-1)?.[1].filter).toEqual({ withRenotes: false, withReplies: true, withSensitive: true, onlyFiles: true });
		expect(view.getByTestId('timeline').getAttribute('data-with-replies')).toBe('false');
		const reload = items().find(item => 'text' in item && item.text === i18n.ts.reload);
		if (!reload || !('action' in reload)) throw new Error('Expected native reload action');
		reload.action(new Event('click') as PointerEvent); expect(controls.reload).toHaveBeenCalledTimes(1);
	});
	it('ignores rapid duplicate opens and permits a new menu after the current one closes', async () => {
		const view = setup(); await settle(); const button = view.getByRole('button', { name: i18n.ts.zalip.feedSettings });
		await fireEvent.click(button); await fireEvent.click(button); await settle(); expect(controls.popup).toHaveBeenCalledTimes(1);
		controls.dismiss(); await settle(); await fireEvent.click(button); await settle(); expect(controls.popup).toHaveBeenCalledTimes(2); expect(button.getAttribute('aria-expanded')).toBe('true');
	});
});
