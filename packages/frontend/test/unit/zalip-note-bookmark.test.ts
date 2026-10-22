/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Ref } from 'vue';
import MkZalipBookmark from '@/components/MkZalipBookmark.vue';
import { changeNoteBookmark, noteBookmarkState } from '@/utility/zalip-note-bookmarks.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ session: null as Ref<{ id: string; token: string } | null> | null, api: vi.fn(), alert: vi.fn(), login: vi.fn() }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref({ id: 'viewer', token: 'fixture-token' }); return { get $i() { return controls.session!.value; } }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/os.js', () => ({ alert: controls.alert }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));

let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null }>;
let remote: Map<string, boolean>;
let counter = 0;
async function settle(): Promise<void> { for (let i = 0; i < 12; i++) { await Promise.resolve(); await nextTick(); } }
function enter(index = observers.length - 1): void { const item = observers[index]; item.callback([{ target: item.target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], {} as IntersectionObserver); }
function writes(): unknown[][] { return controls.api.mock.calls.filter(call => call[0] !== 'notes/state'); }
function Copies() { return defineComponent({ setup: () => () => h('div', [h(MkZalipBookmark, { noteId: 'a' }), h(MkZalipBookmark, { noteId: 'a' })]) }); }

beforeEach(() => {
	vi.clearAllMocks(); observers = []; remote = new Map(); controls.session!.value = { id: `viewer-${++counter}`, token: `fixture-token-${counter}` }; noteBookmarkState.clear();
	controls.alert.mockResolvedValue(undefined); controls.login.mockResolvedValue(false);
	controls.api.mockImplementation(async (endpoint: string, data: { noteId: string }) => {
		if (endpoint === 'notes/state') return { isFavorited: remote.get(data.noteId) ?? false, isMutedThread: false };
		remote.set(data.noteId, endpoint === 'notes/favorites/create');
		return undefined;
	});
	vi.stubGlobal('IntersectionObserver', class {
		private item: typeof observers[number];
		constructor(callback: IntersectionObserverCallback) { this.item = { callback, target: null }; observers.push(this.item); }
		observe(target: Element): void { this.item.target = target; }
		disconnect(): void { /* Replaying disconnected observers tests generation guards. */ }
	});
});
afterEach(() => { cleanup(); noteBookmarkState.clear(); vi.unstubAllGlobals(); });

describe('visible shared note bookmarks', () => {
	it('does not request state for offscreen notes and coalesces duplicate visible copies', async () => {
		const view = render(Copies()); await settle(); expect(controls.api).not.toHaveBeenCalled();
		enter(0); enter(1); await settle(); expect(controls.api).toHaveBeenCalledTimes(1);
		expect(view.getAllByRole('button', { name: i18n.ts.favorite, pressed: false })).toHaveLength(2);
	});
	it('reflects a menu/helper mutation in all copies and rereads authoritative state before the next toggle', async () => {
		const view = render(Copies()); await settle(); enter(0); enter(1); await settle();
		await changeNoteBookmark('a', true, () => true); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.unfavorite, pressed: true })).toHaveLength(2);
		// A change outside this client must not cause an incorrect first write.
		remote.set('a', false);
		await fireEvent.click(view.getAllByRole('button')[0]); await settle();
		expect(writes().map(call => call[0])).toEqual(['notes/favorites/create', 'notes/favorites/create']);
		expect(writes().every(call => call[2] === controls.session!.value!.token)).toBe(true);
	});
	it('serializes writes across multiple mounted copies', async () => {
		const view = render(Copies()); await settle(); enter(0); enter(1); await settle();
		await Promise.all(view.getAllByRole('button').map(button => fireEvent.click(button))); await settle();
		expect(writes()).toHaveLength(1); expect(view.getAllByRole('button', { pressed: true })).toHaveLength(2);
	});
	it.each(['note', 'account', 'unmount'] as const)('does not write after %s changes during the safety read', async kind => {
		let finish!: (value: { isFavorited: boolean; isMutedThread: boolean }) => void;
		controls.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = render(MkZalipBookmark, { props: { noteId: 'a' } }); await settle();
		await fireEvent.click(view.getByRole('button')); await settle();
		if (kind === 'note') await view.rerender({ noteId: 'b' });
		if (kind === 'account') controls.session!.value = { id: 'other', token: 'other-fixture-token' };
		if (kind === 'unmount') view.unmount();
		await settle(); finish({ isFavorited: false, isMutedThread: false }); await settle();
		expect(writes()).toHaveLength(0); expect(controls.alert).not.toHaveBeenCalled();
	});
	it('ignores stale observer callbacks after changing the note or unmounting', async () => {
		const view = render(MkZalipBookmark, { props: { noteId: 'a' } }); await settle(); const first = observers.length - 1;
		await view.rerender({ noteId: 'b' }); await settle(); enter(first); await settle(); expect(controls.api).not.toHaveBeenCalled();
		const last = observers.length - 1; view.unmount(); enter(last); await settle(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('retries a failed initial read before choosing a mutation, and does not write if the safety read fails', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline'));
		const view = render(MkZalipBookmark, { props: { noteId: 'a' } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button')); await settle(); expect(writes()).toHaveLength(0); expect(controls.alert).toHaveBeenCalledWith({ type: 'error', text: i18n.ts.cannotLoad });
		await fireEvent.click(view.getByRole('button')); await settle(); expect(writes()).toHaveLength(1); expect(view.getByRole('button', { pressed: true })).toBeTruthy();
	});
	it('reconciles a successful server write with a lost response without retrying that write', async () => {
		controls.api.mockImplementation(async (endpoint: string, data: { noteId: string }) => {
			if (endpoint === 'notes/state') return { isFavorited: remote.get(data.noteId) ?? false, isMutedThread: false };
			remote.set(data.noteId, true); throw new Error('response lost');
		});
		const view = render(MkZalipBookmark, { props: { noteId: 'a' } }); await settle(); await fireEvent.click(view.getByRole('button')); await settle();
		expect(writes()).toHaveLength(1); expect(view.getByRole('button', { pressed: true })).toBeTruthy(); expect(controls.alert).not.toHaveBeenCalled();
	});
	it('has keyboard-focus demand fallback and performs no hidden or mock prefetch', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		const view = render(MkZalipBookmark, { props: { noteId: 'a' } }); await settle(); expect(controls.api).not.toHaveBeenCalled();
		await fireEvent.focus(view.getByRole('button')); await settle(); expect(controls.api).toHaveBeenCalledTimes(1);
		view.unmount(); controls.api.mockClear(); render(MkZalipBookmark, { props: { noteId: 'a', mock: true } }); await settle(); expect(controls.api).not.toHaveBeenCalled();
	});
});
