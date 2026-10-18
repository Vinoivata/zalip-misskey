/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick, reactive, ref, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import { useZalipNoteViews } from '@/composables/use-zalip-note-views.js';
import { $i } from '@/i.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), account: { id: 'viewer' } }));
vi.mock('@/i.js', async () => { const { reactive } = await import('vue'); return { $i: reactive(controls.account) }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: controls.api }));

let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null; options: IntersectionObserverInit | undefined }> = [];
let visible = true;
let targetHeight = 240;
const visibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function enter(index = observers.length - 1, intersectionRatio = 1, intersectionHeight = targetHeight * intersectionRatio): void {
	const item = observers[index];
	item.callback([{ target: item.target, isIntersecting: intersectionRatio > 0, intersectionRatio, boundingClientRect: { height: targetHeight }, intersectionRect: { height: intersectionHeight, width: 100 } } as IntersectionObserverEntry], {} as IntersectionObserver);
}

function note(patch: Partial<Misskey.entities.Note & { zalipViewCount?: number }> = {}) {
	return { id: 'note', userId: 'author', text: 'Visible post', files: [], zalipViewCount: 0, ...patch } as Misskey.entities.Note & { zalipViewCount?: number };
}

function setup(initial = note()) {
	const current = reactive(initial);
	const enabled = ref(true);
	const show = ref(true);
	const Host = defineComponent({ setup() {
		const target = useTemplateRef<HTMLElement>('article');
		const count = useZalipNoteViews(target, () => current, () => enabled.value);
		return () => h('div', [show.value ? h('article', { ref: 'article' }, current.id) : null, h('output', String(count.value ?? 'absent'))]);
	} });
	return { ...render(Host), current, enabled, show };
}

async function tick(): Promise<void> { await nextTick(); await Promise.resolve(); await nextTick(); }

beforeEach(() => {
	vi.useFakeTimers(); observers = []; visible = true; targetHeight = 240; controls.account.id = 'viewer';
	controls.api.mockReset().mockResolvedValue({ counted: true, viewCount: 1 });
	vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height: targetHeight, width: 100 } as DOMRect));
	Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visible ? 'visible' : 'hidden' });
	vi.stubGlobal('IntersectionObserver', class {
		private entry: typeof observers[number];
		constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.entry = { callback, target: null, options }; observers.push(this.entry); }
		observe(element: Element): void { this.entry.target = element; }
		disconnect(): void { /* Tests can intentionally replay stale callbacks. */ }
	});
});
afterEach(() => {
	cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
	if (visibility) Object.defineProperty(document, 'visibilityState', visibility); else Reflect.deleteProperty(document, 'visibilityState');
});

describe('visible article dwell views', () => {
	it('requires one uninterrupted visible second, does not preload, and only updates a real aggregate', async () => {
		const view = setup(); await tick();
		expect(observers[0].options).toEqual({ rootMargin: '0px', threshold: 0.5 });
		await vi.advanceTimersByTimeAsync(2000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(999); expect(controls.api).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1); await tick();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('zalip/notes/views/record', { noteId: 'note' });
		expect(view.getByRole('status').textContent).toBe('1');
		enter(); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it('requires 120 visible pixels of a tall post, or the complete height of a shorter post', async () => {
		targetHeight = 6000;
		setup(); await tick(); expect(observers[0].options?.threshold).toBe(0.02);
		enter(0, 0.01, 60); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).not.toHaveBeenCalled();
		enter(0, 0.02, 120); await vi.advanceTimersByTimeAsync(999);
		enter(0, 0.01, 119); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).not.toHaveBeenCalled();
		cleanup(); targetHeight = 80;
		setup(); await tick(); expect(observers.at(-1)?.options?.threshold).toBe(1);
		enter(observers.length - 1, 0.99, 79); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it('restarts geometry observation after media changes the article height', async () => {
		let resize!: ResizeObserverCallback;
		const disconnect = vi.fn();
		vi.stubGlobal('ResizeObserver', class {
			constructor(callback: ResizeObserverCallback) { resize = callback; }
			observe(): void { /* Controlled resize delivery. */ }
			disconnect = disconnect;
		});
		const view = setup(); await tick(); enter(); await vi.advanceTimersByTimeAsync(700);
		targetHeight = 6000; resize([], {} as ResizeObserver);
		expect(observers).toHaveLength(2); expect(observers[1].options?.threshold).toBe(0.02);
		await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		enter(0); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
		view.unmount(); expect(disconnect).toHaveBeenCalledTimes(2);
	});
	it('restarts dwell after the article leaves the viewport or CW/mute predicate turns off', async () => {
		const view = setup(); await tick(); enter(); await vi.advanceTimersByTimeAsync(700); enter(0, 0);
		await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(500); view.enabled.value = false; await tick();
		await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		view.enabled.value = true; await tick(); enter(); await vi.advanceTimersByTimeAsync(1000);
		expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it('cancels hidden-tab dwell and requires a fresh visibility observation on return', async () => {
		setup(); await tick(); enter(); await vi.advanceTimersByTimeAsync(500);
		visible = false; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1000);
		expect(controls.api).not.toHaveBeenCalled();
		visible = true; document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it.each([{ userId: 'viewer' }, { isHidden: true }, { deletedAt: '2026-10-18T00:00:00Z' }, { renoteId: 'renote', text: null }])('does not record self/hidden/deleted/pure-renote content $userId', async patch => {
		setup(note(patch)); await tick(); await vi.advanceTimersByTimeAsync(2000);
		expect(observers).toHaveLength(0); expect(controls.api).not.toHaveBeenCalled();
	});
	it('does not record without an account or IntersectionObserver', async () => {
		controls.account.id = '';
		setup(); await tick(); expect(observers).toHaveLength(0);
		cleanup(); controls.account.id = 'viewer'; vi.stubGlobal('IntersectionObserver', undefined);
		setup(); await tick(); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).not.toHaveBeenCalled();
	});
	it('discards stale observer timers/responses after target, note, account or unmount changes', async () => {
		let finish!: (value: { counted: boolean; viewCount: number }) => void;
		controls.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = setup(); await tick(); enter(); await vi.advanceTimersByTimeAsync(1000);
		view.current.id = 'another'; await tick(); finish({ counted: true, viewCount: 99 }); await tick();
		expect(view.getByRole('status').textContent).toBe('0');
		enter(0); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
		enter(); await vi.advanceTimersByTimeAsync(500); view.show.value = false; await tick(); await vi.advanceTimersByTimeAsync(1000);
		expect(controls.api).toHaveBeenCalledTimes(1);
		view.unmount(); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it('does not retry a failed count automatically and accepts only nonnegative integer counts', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline'));
		const view = setup(note({ zalipViewCount: undefined })); await tick(); enter(); await vi.advanceTimersByTimeAsync(1000);
		enter(); await vi.advanceTimersByTimeAsync(2000); expect(controls.api).toHaveBeenCalledTimes(1); expect(view.getByRole('status').textContent).toBe('absent');
		view.current.zalipViewCount = 3; await tick(); expect(view.getByRole('status').textContent).toBe('3');
		view.current.zalipViewCount = -1; await tick(); expect(view.getByRole('status').textContent).toBe('3');
	});
	it('cancels the old-account timer and ignores its in-flight aggregate after another account becomes current', async () => {
		let finish!: (value: { counted: boolean; viewCount: number }) => void;
		controls.api.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = setup(); await tick(); enter(); await vi.advanceTimersByTimeAsync(500);
		$i!.id = 'other'; await tick(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).not.toHaveBeenCalled();
		enter(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
		$i!.id = 'third'; await tick(); finish({ counted: true, viewCount: 99 }); await tick();
		expect(view.getByRole('status').textContent).toBe('0');
	});
	it('does not count a deactivated KeepAlive page and requires a fresh dwell after reactivation', async () => {
		const show = ref(true);
		const Article = defineComponent({ setup() {
			const target = useTemplateRef<HTMLElement>('article');
			useZalipNoteViews(target, () => note(), () => true);
			return () => h('article', { ref: 'article' }, 'Article');
		} });
		render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => show.value ? h(Article) : null }) }));
		await tick(); enter(); await vi.advanceTimersByTimeAsync(500); show.value = false; await tick(); await vi.advanceTimersByTimeAsync(1000);
		expect(controls.api).not.toHaveBeenCalled();
		show.value = true; await tick(); enter(); await vi.advanceTimersByTimeAsync(1000); expect(controls.api).toHaveBeenCalledTimes(1);
	});
});
