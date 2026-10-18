/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { note } from '../../.storybook/fakes.js';
import MkNoteHeader from './MkNoteHeader.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkNoteHeader }, setup: () => ({ args }), template: '<div style="width: min(100%, 420px);"><MkNoteHeader v-bind="args" /></div>' }; },
	args: { note: note(), stacked: true },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkNoteHeader>;

const longName = note();
longName.user = { ...longName.user, name: 'A long author display name that must not push the time outside the card', username: 'a_long_account_name', isBot: true };
export const LongName = { ...Default, args: { ...Default.args, note: longName } } satisfies StoryObj<typeof MkNoteHeader>;
export const Private = { ...Default, args: { ...Default.args, note: { ...note(), visibility: 'followers' } } } satisfies StoryObj<typeof MkNoteHeader>;
