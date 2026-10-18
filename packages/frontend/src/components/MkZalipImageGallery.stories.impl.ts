/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onBeforeUnmount } from 'vue';
import sample from '../../assets/fedi.jpg';
import MkZalipImageGallery from './MkZalipImageGallery.vue';
import type { StoryObj } from '@storybook/vue3';
import { prefer } from '@/preferences.js';

const imageUrl = new URL(sample, window.location.origin).href;

export const Default = {
	render(args) {
		return { components: { MkZalipImageGallery }, setup: () => ({ args }), template: '<div style="width: min(780px, 100vw)"><MkZalipImageGallery v-bind="args" /></div>' };
	},
	args: { images: [{ url: `${imageUrl}#one`, width: 1024, height: 270 }, { url: `${imageUrl}#two`, width: 1024, height: 270 }, { url: `${imageUrl}#three`, width: 1024, height: 270 }] },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkZalipImageGallery>;

export const Single = { ...Default, args: { images: [{ url: imageUrl, width: 1024, height: 270 }] } } satisfies StoryObj<typeof MkZalipImageGallery>;
export const Desktop = { ...Default } satisfies StoryObj<typeof MkZalipImageGallery>;
export const Mobile = { ...Default, parameters: { layout: 'centered', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipImageGallery>;
export const ManyFrames = { ...Default, args: { images: Array.from({ length: 18 }, (_, index) => ({ url: `${imageUrl}#frame-${index}`, width: 1024, height: 270 })) } } satisfies StoryObj<typeof MkZalipImageGallery>;
export const BrokenThumbnail = { ...Default, args: { images: [{ url: imageUrl, thumbnailUrl: new URL('/missing-gallery-thumbnail.jpg', window.location.origin).href }] } } satisfies StoryObj<typeof MkZalipImageGallery>;
export const DataSaver = {
	...Default,
	render(args) {
		return { components: { MkZalipImageGallery }, setup() {
			// Story-only memory override: do not persist or sync real preferences.
			const previous = prefer.s.dataSaver;
			const temporary = { ...previous, media: true };
			prefer.s.dataSaver = temporary;
			onBeforeUnmount(() => { if (prefer.s.dataSaver === temporary) prefer.s.dataSaver = previous; });
			return { args };
		}, template: '<div style="width: min(780px, 100vw)"><MkZalipImageGallery v-bind="args" /></div>' };
	},
} satisfies StoryObj<typeof MkZalipImageGallery>;
