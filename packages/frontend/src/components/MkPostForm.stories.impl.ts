/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { note } from '../../.storybook/fakes.js';
import MkPostForm from './MkPostForm.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkPostForm }, setup: () => ({ args }), template: '<div style="width: min(600px, 100vw)"><MkPostForm v-bind="args" /></div>' }; },
	args: { mock: true, autofocus: false, instant: true },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkPostForm>;

export const WithWarning = { ...Default, args: { ...Default.args, initialText: 'A draft remains private until its author explicitly submits it.', initialCw: 'Spoilers', initialVisibility: 'followers' } } satisfies StoryObj<typeof MkPostForm>;
export const Reply = { ...Default, args: { ...Default.args, reply: note() } } satisfies StoryObj<typeof MkPostForm>;
export const Mobile = { ...WithWarning, parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkPostForm>;
