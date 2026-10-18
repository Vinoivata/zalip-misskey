/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import MkZalipImageGallery from '@/components/MkZalipImageGallery.vue';
import { normalizeZalipGallery } from '@/utility/zalip-image-gallery.js';
import { preferState } from '../setup.unit.js';

const mocks = vi.hoisted(() => ({ popup: vi.fn(), dispose: vi.fn() }));
vi.mock('@/os.js', () => ({ popupAsyncWithDialog: mocks.popup }));
vi.mock('@/components/MkLightbox.vue', () => ({ default: { name: 'NativeLightbox', template: '<div />' } }));

const images = [
	{ url: 'https://social.example/files/original-one', thumbnailUrl: 'https://social.example/files/thumb-one', width: 1600, height: 900, alt: 'First frame' },
	{ url: 'https://social.example/files/original-two', width: 1200, height: 1800, alt: 'Second frame' },
	{ url: 'https://social.example/files/original-three', alt: 'Third frame' },
];

async function settle(): Promise<void> { for (let i = 0; i < 5; i++) { await Promise.resolve(); await nextTick(); } }

function geometry(view: ReturnType<typeof render>): { viewport: HTMLElement; slides: HTMLButtonElement[]; scroll: ReturnType<typeof vi.fn>; maxScroll: number } {
	const viewport = view.getByRole('group');
	const slides = Array.from(viewport.querySelectorAll<HTMLButtonElement>('[data-carousel-item]'));
	vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 600, width: 600 } as DOMRect));
	for (const [index, slide] of slides.entries()) vi.spyOn(slide, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 228 - viewport.scrollLeft, right: index * 228 + 220 - viewport.scrollLeft, width: 220 } as DOMRect));
	const maxScroll = Math.max(0, slides.length * 220 + (slides.length - 1) * 8 - 600);
	const scroll = vi.fn((options?: ScrollToOptions | number) => { viewport.scrollLeft = Math.max(0, Math.min(maxScroll, typeof options === 'number' ? options : options?.left ?? 0)); });
	viewport.scrollTo = scroll;
	return { viewport, slides, scroll, maxScroll };
}

beforeEach(() => {
	mocks.popup.mockReset().mockResolvedValue({ dispose: mocks.dispose });
	mocks.dispose.mockClear();
	preferState.dataSaver = { media: false, avatar: false, urlPreview: false, code: false };
	preferState.animation = false;
	preferState.imageNewTab = false;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('URL artwork gallery with the native fullscreen viewer', () => {
	it('rejects executable/credential URLs, deduplicates originals and retains only real dimensions', () => {
		expect(normalizeZalipGallery(['javascript:alert(1)', 'data:image/png;base64,AAA', 'https://user:password@example.com/image.jpg', images[0], images[0], '/poster.jpg', { url: images[1].url, thumbnailUrl: 'javascript:alert(1)', width: -1, height: Infinity }])).toEqual([
			{ ...images[0] },
			{ url: 'https://image.tmdb.org/t/p/original/poster.jpg', thumbnailUrl: null, width: null, height: null, alt: '' },
			{ url: images[1].url, thumbnailUrl: null, width: null, height: null, alt: '' },
		]);
	});
	it('renders lazy async thumbnails and opens original URL contents without a fake DriveFile', async () => {
		const view = render(MkZalipImageGallery, { props: { images } });
		const thumbnails = view.getAllByRole('img');
		expect(thumbnails[0].getAttribute('src')).toBe(images[0].thumbnailUrl);
		expect(thumbnails[0].getAttribute('loading')).toBe('lazy');
		expect(thumbnails[0].getAttribute('decoding')).toBe('async');
		expect(thumbnails[0].getAttribute('width')).toBe('1600');
		await fireEvent.click(view.getByRole('button', { name: 'Second frame (2 / 3)' })); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(1);
		const options = mocks.popup.mock.calls[0][1];
		expect(options.defaultIndex).toBe(1);
		expect(options.contents.map((content: { url: string }) => content.url)).toEqual(images.map(image => image.url));
		expect(options.contents.every((content: Record<string, unknown>) => !('file' in content))).toBe(true);
		expect(view.container.querySelector('iframe, video')).toBeNull();
	});
	it('supports previous/next, keyboard navigation and native swipe scroll position', async () => {
		const frames = Array.from({ length: 5 }, (_, index) => ({ url: `https://social.example/files/frame-${index}`, alt: `Frame ${index + 1}` }));
		const view = render(MkZalipImageGallery, { props: { images: frames } });
		const { viewport, slides, scroll, maxScroll } = geometry(view);
		await settle(); await fireEvent.scroll(viewport);
		const controls = view.getAllByRole('button').filter(button => !button.hasAttribute('data-carousel-item')) as HTMLButtonElement[];
		expect(controls[0].disabled).toBe(true);
		await fireEvent.click(controls[1]);
		expect(scroll).toHaveBeenLastCalledWith({ left: 228, behavior: 'auto' });
		expect(view.getByText('2 / 5')).toBeTruthy();
		await fireEvent.keyDown(slides[1], { key: 'End' });
		expect(document.activeElement).toBe(slides[4]); expect(viewport.scrollLeft).toBe(maxScroll);
		await fireEvent.scroll(viewport);
		expect(controls[1].disabled).toBe(true);
		await fireEvent.click(controls[0]);
		expect(scroll).toHaveBeenLastCalledWith({ left: 456, behavior: 'auto' });
		expect(viewport.scrollLeft).toBeLessThan(maxScroll);
		expect(controls[1].disabled).toBe(false);
		viewport.scrollLeft = maxScroll; await fireEvent.scroll(viewport);
		await fireEvent.keyDown(slides[4], { key: 'ArrowLeft' }); expect(document.activeElement).toBe(slides[3]);
		viewport.scrollLeft = 0;
		await fireEvent.scroll(viewport);
		expect(view.getByText('1 / 5')).toBeTruthy();
		await fireEvent.keyDown(slides[0], { key: 'ArrowRight' });
		expect(document.activeElement).toBe(slides[1]);
	});
	it('falls back from an unavailable thumbnail to the original, then to a stable placeholder', async () => {
		const view = render(MkZalipImageGallery, { props: { images: [images[0]] } });
		await fireEvent.error(view.getByRole('img'));
		expect(view.getByRole('img').getAttribute('src')).toBe(images[0].url);
		await fireEvent.error(view.getByRole('img'));
		expect(view.queryByRole('img')).toBeNull();
		expect(view.getAllByRole('button')).toHaveLength(1);
		await fireEvent.click(view.getByRole('button')); await settle();
		expect(mocks.popup.mock.calls[0][1].contents[0].url).toBe(images[0].url);
	});
	it('honors data saver without preloading thumbnails, and image-new-tab only after an explicit action', async () => {
		preferState.dataSaver = { media: true };
		const view = render(MkZalipImageGallery, { props: { images } });
		expect(view.queryByRole('img')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'First frame (1 / 3)' })); await settle();
		expect(mocks.popup.mock.calls[0][1].contents.every((content: { thumbnailUrl: string | null }) => content.thumbnailUrl == null)).toBe(true);
		preferState.imageNewTab = true;
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		await fireEvent.click(view.getByRole('button', { name: 'Third frame (3 / 3)' }));
		expect(open).toHaveBeenCalledExactlyOnceWith(images[2].url, '_blank', 'noopener,noreferrer');
		expect(mocks.popup).toHaveBeenCalledTimes(1);
	});
	it('keeps cinema frames compact with edge navigation instead of a large slide and separate control row', () => {
		const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/MkZalipImageGallery.vue'), 'utf8');
		expect(source).toContain('flex: 0 0 220px;'); expect(source).toContain('height: 124px;'); expect(source).toContain('object-fit: cover;');
		expect(source).toContain('@container (max-width: 500px) { .slide { flex-basis: 168px; width: 168px; height: 95px; }');
		expect(source).not.toContain('flex: 0 0 100%;'); expect(source).not.toContain('$style.controls');
		expect(source).toContain('width: 44px;'); expect(source).toContain('width: 32px; height: 32px;'); expect(source).toContain('@media (pointer: coarse) { .control { display: none; } }');
	});
	it('loads at most the initial three previews until observed, then only the nearby window', async () => {
		const observations: Array<{ callback: IntersectionObserverCallback; options?: IntersectionObserverInit; elements: Element[]; disconnect: () => void }> = [];
		vi.stubGlobal('IntersectionObserver', class {
			private item: typeof observations[number];
			constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.item = { callback, options, elements: [], disconnect: vi.fn() }; observations.push(this.item); }
			observe(element: Element): void { this.item.elements.push(element); }
			disconnect(): void { this.item.disconnect(); }
		});
		const many = Array.from({ length: 18 }, (_, index) => ({ url: `https://social.example/files/frame-${index}`, alt: `Frame ${index}` }));
		const view = render(MkZalipImageGallery, { props: { images: many } }); await settle();
		expect(view.getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(many.slice(0, 3).map(image => image.url));
		const observed = observations.at(-1)!; expect(observed.options).toEqual({ root: view.getByRole('group'), rootMargin: '0px 220px', threshold: 0 }); expect(observed.elements).toHaveLength(18);
		observed.callback(observed.elements.map((target, index) => ({ target, isIntersecting: index >= 6 && index <= 8 } as IntersectionObserverEntry)), {} as IntersectionObserver); await settle();
		expect(view.getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(many.slice(6, 9).map(image => image.url));
		const replacement = many.map(image => ({ ...image, url: `${image.url}-replacement` })); await view.rerender({ images: replacement }); await settle();
		expect(observed.disconnect).toHaveBeenCalled();
		observed.callback([{ target: observed.elements[17], isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver); await settle();
		expect(view.getAllByRole('img').map(image => image.getAttribute('src'))).toEqual(replacement.slice(0, 3).map(image => image.url));
		view.unmount(); expect(observations.at(-1)!.disconnect).toHaveBeenCalled();
	});
	it('serializes fullscreen opens, permits a new open after close, and does not leak a late popup after unmount', async () => {
		let finish!: (value: { dispose: () => void }) => void;
		mocks.popup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = render(MkZalipImageGallery, { props: { images } }); await settle();
		await fireEvent.click(view.getByRole('button', { name: 'First frame (1 / 3)' })); await fireEvent.click(view.getByRole('button', { name: 'Second frame (2 / 3)' }));
		expect(mocks.popup).toHaveBeenCalledTimes(1); expect(view.getByRole('group').getAttribute('aria-busy')).toBe('true');
		finish({ dispose: mocks.dispose }); await settle(); expect(view.getByRole('group').getAttribute('aria-busy')).toBe('false');
		await fireEvent.click(view.getByRole('button', { name: 'Second frame (2 / 3)' })); expect(mocks.popup).toHaveBeenCalledTimes(1);
		mocks.popup.mock.calls[0][2].closed(); await settle(); expect(mocks.dispose).toHaveBeenCalledTimes(1);
		mocks.popup.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		await fireEvent.click(view.getByRole('button', { name: 'Third frame (3 / 3)' })); expect(mocks.popup).toHaveBeenCalledTimes(2);
		view.unmount(); const lateDispose = vi.fn(); finish({ dispose: lateDispose }); await settle(); expect(lateDispose).toHaveBeenCalledTimes(1);
	});
	it('discards stale URL-list popup results without clearing a newer opening state', async () => {
		const pending: Array<(value: { dispose: () => void }) => void> = [];
		mocks.popup.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
		const view = render(MkZalipImageGallery, { props: { images } }); await settle();
		await fireEvent.click(view.getByRole('button', { name: 'First frame (1 / 3)' }));
		const replacement = images.map(image => ({ ...image, url: `${image.url}-new` })); await view.rerender({ images: replacement }); await settle();
		await fireEvent.click(view.getByRole('button', { name: 'Second frame (2 / 3)' })); expect(pending).toHaveLength(2);
		const oldDispose = vi.fn(); pending[0]({ dispose: oldDispose }); await settle();
		expect(oldDispose).toHaveBeenCalledTimes(1); expect(view.getByRole('group').getAttribute('aria-busy')).toBe('true');
		const newDispose = vi.fn(); pending[1]({ dispose: newDispose }); await settle(); expect(view.getByRole('group').getAttribute('aria-busy')).toBe('false');
		mocks.popup.mock.calls[1][2].closed(); expect(newDispose).toHaveBeenCalledTimes(1);
	});
	it('allows an explicit retry after a native fullscreen-loader failure', async () => {
		mocks.popup.mockRejectedValueOnce(new Error('loader unavailable'));
		const view = render(MkZalipImageGallery, { props: { images } }); await settle();
		await fireEvent.click(view.getByRole('button', { name: 'First frame (1 / 3)' })); await settle();
		expect(view.getByRole('group').getAttribute('aria-busy')).toBe('false');
		await fireEvent.click(view.getByRole('button', { name: 'First frame (1 / 3)' })); await settle(); expect(mocks.popup).toHaveBeenCalledTimes(2);
	});
});
