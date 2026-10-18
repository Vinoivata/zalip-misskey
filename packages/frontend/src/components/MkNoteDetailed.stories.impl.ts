/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { http, HttpResponse } from 'msw';
import { file, note } from '../../.storybook/fakes.js';
import MkNoteDetailed from './MkNoteDetailed.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkNoteDetailed }, setup: () => ({ args }), template: '<div style="max-width: 600px; container-type: inline-size;"><MkNoteDetailed v-bind="args" /></div>' }; },
	args: { note: { ...note(), files: [file()] } },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/children', () => HttpResponse.json([])), http.post('*/api/notes/state', () => HttpResponse.json({ isFavorited: false, isWatching: false }))] } },
} satisfies StoryObj<typeof MkNoteDetailed>;

export const Mobile = { ...Default, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkNoteDetailed>;
