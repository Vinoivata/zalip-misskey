/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkMediaList from '@/components/MkMediaList.vue';
import { preferState } from '../setup.unit.js';

const mocks = vi.hoisted(() => ({ popup: vi.fn(), reveal: vi.fn() }));
vi.mock('@/os.js', () => ({ popupAsyncWithDialog: mocks.popup }));
vi.mock('@/utility/sensitive-file.js', () => ({ canRevealFile: mocks.reveal }));
vi.mock('@/components/MkLightbox.vue', () => ({ default: { name: 'NativeLightbox', template: '<div />' } }));
vi.mock('@/components/MkMediaImage.vue', () => ({ default: {
	name: 'ImageFixture', props: ['image', 'raw', 'disableImageLink'], emits: ['mediaClick'],
	template: '<div :data-image-id="image.id" :data-sensitive="image.isSensitive" :data-raw="raw" @click="$emit(\'mediaClick\')" />',
} }));
vi.mock('@/components/MkMediaVideo.vue', () => ({ default: { name: 'VideoFixture', props: ['video'], template: '<div :data-video-id="video.id" />' } }));
vi.mock('@/components/MkMediaBanner.vue', () => ({ default: { name: 'BannerFixture', props: ['media'], template: '<div :data-banner-id="media.id" />' } }));

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
		const viewport = view.getByRole('group');
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
		await fireEvent.keyDown(view.getByRole('group'), { key: 'Enter' }); await settle();
		expect(mocks.reveal).toHaveBeenCalledExactlyOnceWith(photo);
		expect(mocks.popup).not.toHaveBeenCalled();
		mocks.reveal.mockResolvedValue(true);
		await fireEvent.keyDown(view.getByRole('group'), { key: ' ' }); await settle();
		expect(mocks.popup).toHaveBeenCalledTimes(1);
	});
});
