/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { file } from '../../.storybook/fakes.js';
import sample from '../../assets/fedi.jpg';
import MkMediaList from './MkMediaList.vue';
import type { StoryObj } from '@storybook/vue3';

const photos = Array.from({ length: 3 }, (_, index) => ({ ...file(), id: `gallery-photo-${index}`, url: `${sample}#${index}`, thumbnailUrl: `${sample}#${index}` }));

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
