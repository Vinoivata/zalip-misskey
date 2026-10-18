/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { note } from '../../.storybook/fakes.js';
import MkNoteSub from './MkNoteSub.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkNoteSub }, setup: () => ({ args }), template: '<div style="max-width: 600px; container-type: inline-size;"><MkNoteSub v-bind="args" /></div>' }; },
	args: { note: note(), thread: false },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkNoteSub>;

export const ParentContext = {
	...Default,
	render(args) { return { components: { MkNoteSub }, setup: () => ({ args, child: { ...note('child'), replyId: args.note?.id, text: 'A real reply to the parent above.' } }), template: '<div style="max-width: 600px; container-type: inline-size;"><MkNoteSub v-bind="args" thread /><MkNoteSub :note="child" /></div>' }; },
} satisfies StoryObj<typeof MkNoteSub>;
