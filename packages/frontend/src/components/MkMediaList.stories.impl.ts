/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { file } from '../../.storybook/fakes.js';
import { imageDataUrl } from '../../.storybook/fake-utils.js';
import sample from '../../assets/fedi.jpg';
import MkMediaList from './MkMediaList.vue';
import type { StoryObj } from '@storybook/vue3';

const photos = Array.from({ length: 3 }, (_, index) => ({ ...file(), id: `gallery-photo-${index}`, url: `${sample}#${index}`, thumbnailUrl: `${sample}#${index}` }));
const naturalPhotos = [{ width: 300, height: 400 }, { width: 640, height: 360 }, { width: 400, height: 400 }].map((size, index) => {
	const preview = imageDataUrl({ size }, `natural-gallery-${index}`);
	return { ...file(), id: `natural-photo-${index}`, name: `natural-${index}.png`, type: 'image/png', url: preview, thumbnailUrl: preview, properties: size };
});

export const Default = {
	render(args) {
		return { components: { MkMediaList }, setup: () => ({ args }), template: '<div style="width: min(780px, 100vw)"><MkMediaList v-bind="args" /></div>' };
	},
	args: { mediaList: photos },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkMediaList>;

export const Carousel = { ...Default, args: { ...Default.args, layout: 'carousel' } } satisfies StoryObj<typeof MkMediaList>;
export const SensitiveCarousel = { ...Carousel, args: { ...Carousel.args, mediaList: photos.map(photo => ({ ...photo, isSensitive: true })) } } satisfies StoryObj<typeof MkMediaList>;
export const SingleWithCarouselRequested = { ...Carousel, args: { ...Carousel.args, mediaList: [photos[0]] } } satisfies StoryObj<typeof MkMediaList>;
export const NaturalProportions = { ...Carousel, args: { ...Carousel.args, mediaList: naturalPhotos } } satisfies StoryObj<typeof MkMediaList>;
export const MobileNaturalProportions = { ...NaturalProportions, parameters: { layout: 'centered', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkMediaList>;
export const MixedAttachments = {
	...Carousel,
	args: { ...Carousel.args, mediaList: [naturalPhotos[0], { ...naturalPhotos[1], id: 'video-preview', name: 'video-preview.mp4', type: 'video/mp4', url: '/gallery-story-video.mp4' }, { ...file(), id: 'audio-banner', type: 'audio/mpeg', url: '/gallery-story-audio.mp3' }, naturalPhotos[2]] },
} satisfies StoryObj<typeof MkMediaList>;
export const MissingAndExtremeDimensions = {
	...Carousel,
	args: { ...Carousel.args, mediaList: [{ ...photos[0], properties: {} }, { ...photos[1], properties: { width: 20000, height: 400 } }, { ...photos[2], properties: { width: 100, height: 4000 } }] },
} satisfies StoryObj<typeof MkMediaList>;
export const MissingThumbnail = { ...Carousel, args: { ...Carousel.args, mediaList: [{ ...photos[0], thumbnailUrl: null }, photos[1]] } } satisfies StoryObj<typeof MkMediaList>;
export const BrokenThumbnail = { ...Carousel, args: { ...Carousel.args, mediaList: [{ ...photos[0], thumbnailUrl: '/gallery-story-missing.jpg' }, photos[1]] } } satisfies StoryObj<typeof MkMediaList>;
