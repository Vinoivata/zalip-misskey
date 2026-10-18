/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import MkLightboxItem from '@/components/MkLightbox.item.vue';
import type { Content } from '@/components/MkLightbox.item.vue';
import { i18n } from '@/i18n.js';
import { preferState } from '../setup.unit.js';

vi.mock('@/os.js', () => ({ popupMenu: vi.fn(), confirm: vi.fn().mockResolvedValue({ canceled: false }) }));
vi.mock('@/utility/get-file-menu.js', () => ({ getFileMenu: () => [] }));

const content: Content = { id: 'frame', type: 'image', url: 'https://media.example/original.jpg', thumbnailUrl: 'https://media.example/thumbnail.jpg', filename: 'Gallery frame', width: 1600, height: 900 };

async function settle() { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick(); } }

function setup(activated = true, animation = false, media = content) { return render(MkLightboxItem, { props: { content: media, activated, animation }, global: { stubs: { MkCondensedLine: { template: '<span><slot /></span>' }, MkLoading: { template: '<span role="progressbar" />' }, MkVideoControl: true } } }); }

function original(view: ReturnType<typeof render>) { return view.container.querySelector<HTMLImageElement>('[data-lightbox-original]')!; }

function pointer(target: HTMLElement, type: string, x: number, y: number, time: number) {
	const event = new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
	Object.defineProperty(event, 'timeStamp', { value: time }); target.dispatchEvent(event);
}

beforeEach(() => { preferState.animation = true; preferState.nsfw = 'respect'; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); preferState.animation = false; });

describe('real fullscreen media loading and gestures', () => {
	it('loads nothing for an unvisited item and uses lazy async thumbnails only after activation', async () => {
		const view = setup(false); await settle(); expect(view.queryByRole('img')).toBeNull();
		await view.rerender({ activated: true }); await settle();
		expect(original(view).getAttribute('src')).toBe(content.url); expect(original(view).getAttribute('alt')).toBe(content.filename);
		const thumbnail = view.container.querySelector<HTMLImageElement>(`img[src="${content.thumbnailUrl}"]`)!;
		expect(thumbnail.loading).toBe('lazy'); expect(thumbnail.getAttribute('decoding')).toBe('async');
		await view.rerender({ activated: false }); await settle(); expect(view.queryByRole('img')).toBeNull();
	});
	it('does not request an unvisited sensitive video thumbnail or bypass its reveal guard', async () => {
		const media: Content = { ...content, type: 'video', file: { isSensitive: true } as NonNullable<Content['file']> };
		const view = setup(false, false, media); await settle(); expect(view.container.querySelector('img, video')).toBeNull();
		await view.rerender({ activated: true }); await settle();
		const thumbnail = view.container.querySelector('img')!;
		expect(thumbnail.getAttribute('src')).toBe(content.thumbnailUrl); expect(thumbnail.loading).toBe('lazy'); expect(thumbnail.getAttribute('decoding')).toBe('async'); expect(view.container.querySelector('video')).toBeNull(); expect(view.getByText(i18n.ts.clickToShow)).toBeTruthy();
	});
	it('replaces an original error with a localized explicit retry and clears the spinner', async () => {
		const view = setup(); await settle(); const failed = original(view);
		expect(view.getByRole('progressbar')).toBeTruthy(); await fireEvent.error(failed);
		expect(view.getByRole('status').textContent).toContain(i18n.ts.cannotLoad); expect(view.queryByRole('progressbar')).toBeNull(); expect(original(view)).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		const retried = original(view); expect(retried).not.toBe(failed); expect(retried.getAttribute('src')).toBe(content.url); expect(view.queryByRole('status')).toBeNull();
		await fireEvent.load(retried); expect(view.queryByRole('progressbar')).toBeNull();
	});
	it('ignores detached image events after retry instead of completing or failing the new request', async () => {
		const view = setup(); await settle(); const failed = original(view); await fireEvent.error(failed);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await fireEvent.load(failed); expect(view.getByRole('progressbar')).toBeTruthy();
		await fireEvent.error(failed); expect(view.queryByRole('status')).toBeNull(); expect(original(view)).toBeTruthy();
	});
	it('drops a failed thumbnail without replacing its URL or creating a second original', async () => {
		const view = setup(); await settle(); const image = original(view);
		await fireEvent.error(view.container.querySelector(`img[src="${content.thumbnailUrl}"]`)!);
		expect(view.container.querySelector(`img[src="${content.thumbnailUrl}"]`)).toBeNull(); expect(original(view)).toBe(image); expect(view.container.querySelectorAll('[data-lightbox-original]')).toHaveLength(1);
		await fireEvent.load(image); expect(view.queryByRole('progressbar')).toBeNull(); expect(view.queryByRole('status')).toBeNull();
	});
	it('retries video errors, ignores old metadata and pauses a video evicted from the retained window', async () => {
		const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
		const view = setup(true, false, { ...content, type: 'video', url: 'https://media.example/video.mp4' }); await settle();
		const first = view.container.querySelector('video')!; await fireEvent.error(first);
		expect(view.getByRole('status')).toBeTruthy(); expect(view.queryByRole('progressbar')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry }));
		await fireEvent.loadedMetadata(first); expect(view.getByRole('progressbar')).toBeTruthy();
		await fireEvent.loadedMetadata(view.container.querySelector('video')!); expect(view.queryByRole('progressbar')).toBeNull();
		await view.rerender({ activated: false }); await settle(); expect(pause).toHaveBeenCalledTimes(1); expect(view.container.querySelector('video')).toBeNull();
	});
	it('names its menu/close controls and preserves native horizontal and vertical swipe actions', async () => {
		const view = setup(); await settle(); expect(view.getByRole('button', { name: i18n.ts.more })).toBeTruthy(); expect(view.getByRole('button', { name: i18n.ts.close })).toBeTruthy();
		const main = view.container.firstElementChild!.firstElementChild as HTMLElement;
		main.setPointerCapture = vi.fn(); main.releasePointerCapture = vi.fn();
		pointer(main, 'pointerdown', 300, 100, 0); pointer(main, 'pointermove', 50, 100, 50); pointer(main, 'pointerup', 50, 100, 60); await settle(); expect(view.emitted().next).toHaveLength(1);
		pointer(main, 'pointerdown', 50, 100, 100); pointer(main, 'pointermove', 300, 100, 150); pointer(main, 'pointerup', 300, 100, 160); await settle(); expect(view.emitted().prev).toHaveLength(1);
		pointer(main, 'pointerdown', 100, 100, 200); pointer(main, 'pointermove', 100, 400, 250); pointer(main, 'pointerup', 100, 400, 260); await settle(); expect(view.emitted().close).toHaveLength(1);
	});
	it('keeps wheel zoom without an idle animation loop and disables inertia when motion is off', async () => {
		const raf = vi.spyOn(window, 'requestAnimationFrame');
		const view = setup(); await settle(); const main = view.container.firstElementChild!.firstElementChild as HTMLElement;
		main.setPointerCapture = vi.fn(); main.releasePointerCapture = vi.fn();
		await fireEvent.wheel(main, { deltaY: -1, clientX: 100, clientY: 100 }); await settle();
		expect(main.firstElementChild?.getAttribute('style')).toContain('scale(1.1)'); expect(raf).not.toHaveBeenCalled();
		pointer(main, 'pointerdown', 100, 100, 0); pointer(main, 'pointermove', 180, 100, 50); pointer(main, 'pointerup', 180, 100, 60); await settle(); expect(raf).not.toHaveBeenCalled();
	});
	it('cancels a running inertia frame after a live motion change and on unmount', async () => {
		const raf = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(101); const cancel = vi.spyOn(window, 'cancelAnimationFrame');
		const view = setup(true, true); await settle(); const main = view.container.firstElementChild!.firstElementChild as HTMLElement;
		main.setPointerCapture = vi.fn(); main.releasePointerCapture = vi.fn();
		await fireEvent.wheel(main, { deltaY: -1, clientX: 100, clientY: 100 }); await settle();
		pointer(main, 'pointerdown', 100, 100, 0); pointer(main, 'pointermove', 180, 100, 50); pointer(main, 'pointerup', 180, 100, 60); await settle(); expect(raf).toHaveBeenCalledTimes(1);
		await view.rerender({ animation: false }); await settle(); expect(cancel).toHaveBeenCalledWith(101);
		const calls = raf.mock.calls.length; raf.mock.calls[0][0](100); expect(raf).toHaveBeenCalledTimes(calls);
		view.unmount();
	});
});
