/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
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

function geometry(view: ReturnType<typeof render>): { viewport: HTMLElement; slides: HTMLButtonElement[]; scroll: ReturnType<typeof vi.fn> } {
	const viewport = view.getByRole('group');
	const slides = Array.from(viewport.querySelectorAll<HTMLButtonElement>('[data-carousel-item]'));
	vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 600 } as DOMRect));
	for (const [index, slide] of slides.entries()) vi.spyOn(slide, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 608 - viewport.scrollLeft, right: index * 608 + 600 - viewport.scrollLeft } as DOMRect));
	const scroll = vi.fn((options?: ScrollToOptions | number) => { viewport.scrollLeft = typeof options === 'number' ? options : options?.left ?? 0; });
	viewport.scrollTo = scroll;
	return { viewport, slides, scroll };
}

beforeEach(() => {
	mocks.popup.mockReset().mockResolvedValue({ dispose: mocks.dispose });
	preferState.dataSaver = { media: false, avatar: false, urlPreview: false, code: false };
	preferState.animation = false;
	preferState.imageNewTab = false;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
		const view = render(MkZalipImageGallery, { props: { images } });
		const { viewport, slides, scroll } = geometry(view);
		const controls = view.getAllByRole('button').filter(button => !button.hasAttribute('data-carousel-item')) as HTMLButtonElement[];
		expect(controls[0].disabled).toBe(true);
		await fireEvent.click(controls[1]);
		expect(scroll).toHaveBeenLastCalledWith({ left: 608, behavior: 'auto' });
		expect(view.getByText('2 / 3')).toBeTruthy();
		await fireEvent.keyDown(slides[1], { key: 'End' });
		expect(document.activeElement).toBe(slides[2]);
		expect(controls[1].disabled).toBe(true);
		viewport.scrollLeft = 0;
		await fireEvent.scroll(viewport);
		expect(view.getByText('1 / 3')).toBeTruthy();
		await fireEvent.keyDown(slides[0], { key: 'ArrowRight' });
		expect(view.getByText('2 / 3')).toBeTruthy();
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
});
