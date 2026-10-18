/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkMediaList from '@/components/MkMediaList.vue';
import mediaListSource from '@/components/MkMediaList.vue?raw';
import { i18n } from '@/i18n.js';
import { getStaticImageUrl } from '@/utility/media-proxy.js';
import { preferState } from '../setup.unit.js';

const mocks = vi.hoisted(() => ({ popup: vi.fn(), reveal: vi.fn() }));
vi.mock('@/os.js', () => ({ popupAsyncWithDialog: mocks.popup }));
vi.mock('@/utility/sensitive-file.js', async importOriginal => ({ ...await importOriginal<typeof import('@/utility/sensitive-file.js')>(), canRevealFile: mocks.reveal }));
vi.mock('@/utility/get-file-menu.js', () => ({ getFileMenu: () => [] }));
vi.mock('@/composables/use-media-activation.js', async () => {
	const { ref } = await import('vue');
	return { useMediaActivation: () => ref(true) };
});
vi.mock('@/components/MkLightbox.vue', () => ({ default: { name: 'NativeLightbox', template: '<div />' } }));
vi.mock('@/components/MkMediaImage.vue', () => ({ default: {
	name: 'ImageFixture', props: ['image', 'raw', 'disableImageLink'], emits: ['mediaClick'],
	template: '<div :data-image-id="image.id" :data-sensitive="image.isSensitive" :data-raw="raw" @click="$emit(\'mediaClick\')" />',
} }));
vi.mock('@/components/MkMediaVideo.vue', () => ({ default: { name: 'VideoFixture', props: ['video'], template: '<div :data-video-id="video.id" />' } }));
vi.mock('@/components/MkMediaBanner.vue', () => ({ default: { name: 'BannerFixture', props: ['media'], template: '<div :data-banner-id="media.id" />' } }));

const { default: NativeImage } = await vi.importActual<typeof import('@/components/MkMediaImage.vue')>('@/components/MkMediaImage.vue');

function file(id: string, type = 'image/jpeg', isSensitive = false): Misskey.entities.DriveFile {
	return { id, type, isSensitive, name: `${id}.jpg`, url: `https://social.example/files/${id}`, thumbnailUrl: `https://social.example/files/${id}-thumb`, properties: { width: 1600, height: 900 } } as Misskey.entities.DriveFile;
}

async function settle(): Promise<void> { for (let i = 0; i < 5; i++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => {
	mocks.popup.mockReset().mockResolvedValue({ dispose: vi.fn() });
	mocks.reveal.mockReset().mockResolvedValue(true);
	preferState.animation = false;
	preferState.imageNewTab = false;
	preferState.mediaListWithOneImageAppearance = '1_1';
	preferState.showMediaListByGridInWideArea = true;
	preferState.enableHighQualityImagePlaceholders = false;
	preferState.dataSaver = { media: false };
	preferState.loadRawImages = false;
	preferState.disableShowingAnimatedImages = false;
	preferState.nsfw = 'respect';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('optional native attachment carousel', () => {
	it('keeps the original grid as the default and the single-image preference even when carousel is requested', () => {
		const grid = render(MkMediaList, { props: { mediaList: [file('one'), file('two')] } });
		expect(grid.queryByRole('group')).toBeNull();
		expect(grid.queryByRole('button')).toBeNull();
		expect(grid.container.querySelectorAll('[data-image-id]')).toHaveLength(2);
		grid.unmount();
		const single = render(MkMediaList, { props: { mediaList: [file('one')], layout: 'carousel' } });
		expect(single.queryByRole('group')).toBeNull();
		expect(single.container.querySelector('[style]')?.getAttribute('style')).toContain('1.7777777777777777 / 1');
	});
	it('retains actual native image/video/banner components, sensitive flags, raw preference and file identity', async () => {
		const photo = file('sensitive', 'image/jpeg', true);
		const video = file('video', 'video/mp4');
		const audio = file('audio', 'audio/mpeg');
		const view = render(MkMediaList, { props: { mediaList: [photo, video, audio], raw: true, layout: 'carousel' } });
		expect(view.container.querySelector('[data-image-id="sensitive"]')?.getAttribute('data-sensitive')).toBe('true');
		expect(view.container.querySelector('[data-image-id="sensitive"]')?.getAttribute('data-raw')).toBe('true');
		expect(view.container.querySelector('[data-video-id="video"]')).toBeTruthy();
		expect(view.container.querySelector('[data-banner-id="audio"]')).toBeTruthy();
		await fireEvent.click(view.container.querySelector('[data-image-id="sensitive"]')!); await settle();
		const options = mocks.popup.mock.calls[0][1];
		expect(options.contents).toHaveLength(2);
		expect(options.contents[0].file).toStrictEqual(photo);
		expect(options.contents[1].file).toStrictEqual(video);
		expect(options.contents[0].url).toBe(photo.url);
	});
	it('supports horizontal buttons/swipe while leaving native video keyboard controls alone', async () => {
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two'), file('three')], layout: 'carousel' } });
		const viewport = view.getByRole('group', { name: i18n.ts.images });
		const slides = Array.from(viewport.querySelectorAll<HTMLElement>('[data-carousel-item]'));
		vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 600 } as DOMRect));
		for (const [index, slide] of slides.entries()) vi.spyOn(slide, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 608 - viewport.scrollLeft, right: index * 608 + 600 - viewport.scrollLeft } as DOMRect));
		const scroll = vi.fn((options?: ScrollToOptions | number) => { viewport.scrollLeft = typeof options === 'number' ? options : options?.left ?? 0; });
		viewport.scrollTo = scroll;
		const controls = view.getAllByRole('button') as HTMLButtonElement[];
		expect(controls[0].disabled).toBe(true);
		await fireEvent.click(controls[1]);
		expect(scroll).toHaveBeenLastCalledWith({ left: 608, behavior: 'auto' });
		await fireEvent.keyDown(viewport, { key: 'End' });
		expect(view.getByText('3 / 3')).toBeTruthy();
		viewport.scrollLeft = 0;
		await fireEvent.scroll(viewport);
		expect(view.getByText('1 / 3')).toBeTruthy();
		const input = document.createElement('input');
		viewport.append(input);
		await fireEvent.keyDown(input, { key: 'ArrowRight' });
		expect(view.getByText('1 / 3')).toBeTruthy();
	});
	it('does not bypass sensitive confirmation when opening the active slide using the keyboard', async () => {
		const photo = file('one', 'image/jpeg', true);
		const view = render(MkMediaList, { props: { mediaList: [photo, file('two')], layout: 'carousel' } });
		mocks.reveal.mockResolvedValue(false);
		await fireEvent.keyDown(view.getByRole('group', { name: i18n.ts.images }), { key: 'Enter' }); await settle();
		expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(photo);
		expect(mocks.popup).not.toHaveBeenCalled();
		mocks.reveal.mockResolvedValue(true);
		await fireEvent.keyDown(view.getByRole('group', { name: i18n.ts.images }), { key: ' ' }); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(1);
	});
	it('focuses and opens the requested narrow card even when the physical strip is already at its end', async () => {
		const files = [file('one'), file('two'), file('three')];
		const view = render(MkMediaList, { props: { mediaList: files, layout: 'carousel' } });
		const viewport = view.getByRole('group', { name: i18n.ts.images });
		const slides = Array.from(viewport.querySelectorAll<HTMLElement>('[data-carousel-item]'));
		vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, right: 600 } as DOMRect));
		for (const [index, slide] of slides.entries()) vi.spyOn(slide, 'getBoundingClientRect').mockImplementation(() => ({ left: index * 216 - viewport.scrollLeft, right: index * 216 + 210 - viewport.scrollLeft } as DOMRect));
		viewport.scrollTo = (options?: ScrollToOptions | number): void => { viewport.scrollLeft = Math.min(42, Math.max(0, typeof options === 'number' ? options : options?.left ?? 0)); };
		await fireEvent.scroll(viewport);
		await fireEvent.keyDown(viewport, { key: 'ArrowRight' });
		expect(document.activeElement).toBe(slides[1]);
		expect(view.getByText('3 / 3')).toBeTruthy();
		expect(slides[1].getAttribute('aria-label')).toBe('two.jpg (2 / 3)');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.previous }));
		expect(viewport.scrollLeft).toBe(0);
		await fireEvent.keyDown(slides[1], { key: 'Enter' }); await settle();
		expect(mocks.reveal).toHaveBeenCalledWith(files[1]);
		expect(mocks.popup.mock.calls[0][1].defaultIndex).toBe(1);
	});
	it('sizes heterogeneous cards from real metadata without changing the single/grid layout', () => {
		const portrait = { ...file('portrait'), properties: { width: 900, height: 1200 } };
		const landscape = file('landscape');
		const panorama = { ...file('panorama'), properties: { width: 18000, height: 1000 } };
		const missing = { ...file('missing'), properties: { width: 0, height: Infinity } };
		const view = render(MkMediaList, { props: { mediaList: [portrait, landscape, panorama, missing], layout: 'carousel' } });
		const slides = view.container.querySelectorAll<HTMLElement>('[data-carousel-item]');
		expect(Array.from(slides, slide => slide.style.getPropertyValue('--media-ratio'))).toEqual(['0.75', '1.7777777777777777', '3', '1.7777777777777777']);
		expect(mediaListSource).toContain('--carousel-height: clamp(240px, 55cqw, 320px)');
		expect(mediaListSource).toContain('calc(100cqw - 32px)');
		expect(mediaListSource).toContain('flex: 0 0 auto');
		expect(mediaListSource).toMatch(/\.carouselControls\s*\{\s*position: absolute;\s*inset: 0;/u);
		view.unmount();
		const grid = render(MkMediaList, { props: { mediaList: [portrait, landscape] } });
		expect(grid.container.querySelector('[style*="--media-ratio"]')).toBeNull();
	});
	it('keeps a single native viewer open until closed, then allows reopening and retry after an import error', async () => {
		let resolve!: (popup: { dispose: () => void }) => void;
		mocks.popup.mockReturnValueOnce(new Promise<{ dispose: () => void }>(done => { resolve = done; }));
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		const image = view.container.querySelector('[data-image-id="one"]')!;
		await fireEvent.click(image); await settle();
		await fireEvent.click(image); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(1);
		resolve({ dispose: vi.fn() }); await settle();
		await fireEvent.click(image); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(1);
		mocks.popup.mock.calls[0][2].closed();
		mocks.popup.mockRejectedValueOnce(new Error('fixture import failure'));
		await fireEvent.click(image); await settle();
		await fireEvent.click(image); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(3);
	});
	it('does not open a replaced file after its sensitive confirmation resolves late', async () => {
		let resolve!: (allowed: boolean) => void;
		mocks.reveal.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		await fireEvent.keyDown(view.getByRole('group', { name: i18n.ts.images }), { key: 'Enter' });
		await view.rerender({ mediaList: [file('replacement'), file('other')] });
		resolve(true); await settle();
		expect(mocks.popup).not.toHaveBeenCalled();
	});
	it('disposes a late native popup after unmount instead of leaving an orphan viewer open', async () => {
		let finish!: (popup: { dispose: () => void }) => void;
		mocks.popup.mockReturnValueOnce(new Promise<{ dispose: () => void }>(resolve => { finish = resolve; }));
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		await fireEvent.click(view.container.querySelector('[data-image-id="one"]')!);
		view.unmount();
		const dispose = vi.fn(); finish({ dispose }); await settle();
		expect(dispose).toHaveBeenCalledTimes(1);
		mocks.popup.mock.calls[0][2].closed();
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	it('does not open a new tab when sensitive confirmation resolves after the gallery unmounts', async () => {
		preferState.imageNewTab = true;
		const open = vi.spyOn(window, 'open').mockReturnValue(null);
		let resolve!: (allowed: boolean) => void;
		mocks.reveal.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		await fireEvent.keyDown(view.getByRole('group', { name: i18n.ts.images }), { key: 'Enter' });
		view.unmount(); resolve(true); await settle();
		expect(open).not.toHaveBeenCalled();
		expect(mocks.popup).not.toHaveBeenCalled();
	});
	it('invalidates a replaced media list without clearing a newer pending viewer', async () => {
		const pending: Array<(popup: { dispose: () => void }) => void> = [];
		mocks.popup.mockImplementation(() => new Promise<{ dispose: () => void }>(resolve => { pending.push(resolve); }));
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		await fireEvent.click(view.container.querySelector('[data-image-id="one"]')!);
		await view.rerender({ mediaList: [{ ...file('one'), url: 'https://social.example/files/new-one' }, file('two')] });
		await fireEvent.click(view.container.querySelector('[data-image-id="one"]')!);
		expect(pending).toHaveLength(2);
		const oldDispose = vi.fn(); pending[0]({ dispose: oldDispose }); await settle();
		expect(oldDispose).toHaveBeenCalledTimes(1);
		expect(view.getByRole('group', { name: i18n.ts.images }).getAttribute('aria-busy')).toBe('true');
		const newDispose = vi.fn(); pending[1]({ dispose: newDispose }); await settle();
		expect(view.getByRole('group', { name: i18n.ts.images }).getAttribute('aria-busy')).toBe('false');
		mocks.popup.mock.calls[1][2].closed(); expect(newDispose).toHaveBeenCalledTimes(1);
	});
	it('disposes exactly once when the native viewer closes before its loader promise resolves', async () => {
		const dispose = vi.fn();
		mocks.popup.mockImplementationOnce((_component, _props, events) => {
			events.closed();
			return Promise.resolve({ dispose });
		});
		const view = render(MkMediaList, { props: { mediaList: [file('one'), file('two')], layout: 'carousel' } });
		await fireEvent.click(view.container.querySelector('[data-image-id="one"]')!); await settle();
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(view.getByRole('group', { name: i18n.ts.images }).getAttribute('aria-busy')).toBe('false');
		await fireEvent.click(view.container.querySelector('[data-image-id="two"]')!); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(2);
	});
});

describe('native image source fallback', () => {
	it('uses an available original when no thumbnail exists and retains explicit image actions', async () => {
		const photo = { ...file('no-thumb'), thumbnailUrl: null };
		const view = render(NativeImage, { props: { image: photo, disableImageLink: true } });
		expect(view.getByRole('img').getAttribute('src')).toBe(photo.url);
		await fireEvent.click(view.getByRole('img'));
		expect(view.emitted().mediaClick).toHaveLength(1);
	});
	it('falls back thumbnail→original→placeholder and resets failures for a replacement image', async () => {
		const photo = file('fallback');
		const view = render(NativeImage, { props: { image: photo, disableImageLink: true } });
		expect(view.getByRole('img').getAttribute('src')).toBe(photo.thumbnailUrl);
		await fireEvent.error(view.getByRole('img'));
		expect(view.getByRole('img').getAttribute('src')).toBe(photo.url);
		await fireEvent.error(view.getByRole('img'));
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.getByRole('img').getAttribute('aria-label')).toBe(photo.name);
		await fireEvent.click(view.getByRole('img'));
		expect(view.emitted().mediaClick).toHaveLength(1);
		const next = file('next');
		await view.rerender({ image: next });
		expect(view.getByRole('img').getAttribute('src')).toBe(next.thumbnailUrl);
	});
	it('catches thumbnail errors inside the native high-quality placeholder component', async () => {
		preferState.enableHighQualityImagePlaceholders = true;
		const photo = file('blurhash');
		const view = render(NativeImage, { props: { image: photo, disableImageLink: true } });
		await settle();
		const thumbnail = view.container.querySelector('img')!;
		expect(thumbnail.getAttribute('src')).toBe(photo.thumbnailUrl);
		await fireEvent.error(thumbnail); await settle();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe(photo.url);
	});
	it('does not preload either source in data saver and preserves sensitive confirmation before revealing', async () => {
		preferState.dataSaver = { media: true };
		const photo = file('private', 'image/jpeg', true);
		const view = render(NativeImage, { props: { image: photo, disableImageLink: true } });
		expect(view.container.querySelector('img')).toBeNull();
		mocks.reveal.mockResolvedValue(false);
		await fireEvent.click(view.getByText(i18n.ts.clickToShow)); await settle();
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.emitted().mediaClick).toBeUndefined();
		mocks.reveal.mockResolvedValue(true);
		await fireEvent.click(view.getByText(i18n.ts.clickToShow)); await settle();
		expect(view.getByRole('img').getAttribute('src')).toBe(photo.thumbnailUrl);
		expect(view.emitted().mediaClick).toBeUndefined();
	});
	it('retains raw/static preferences and ignores late sensitive reveal for a replaced file', async () => {
		const photo = file('raw');
		const view = render(NativeImage, { props: { image: photo, raw: true, disableImageLink: true } });
		expect(view.getByRole('img').getAttribute('src')).toBe(photo.url);
		view.unmount();
		const sensitive = render(NativeImage, { props: { image: file('sensitive', 'image/jpeg', true), disableImageLink: true } });
		let resolve!: (allowed: boolean) => void;
		mocks.reveal.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
		await fireEvent.click(sensitive.getByText(i18n.ts.clickToShow));
		await sensitive.rerender({ image: file('replacement', 'image/jpeg', true) });
		resolve(true); await settle();
		expect(sensitive.getByText(i18n.ts.clickToShow)).toBeTruthy();
		expect(sensitive.emitted().mediaClick).toBeUndefined();
	});
	it('never falls back to an animated original when static images are requested', async () => {
		preferState.disableShowingAnimatedImages = true;
		const photo = file('animated', 'image/gif');
		const view = render(NativeImage, { props: { image: photo, disableImageLink: true } });
		expect(view.getByRole('img').getAttribute('src')).toBe(getStaticImageUrl(photo.url));
		await fireEvent.error(view.getByRole('img'));
		expect(view.container.querySelector('img')).toBeNull();
	});
});
