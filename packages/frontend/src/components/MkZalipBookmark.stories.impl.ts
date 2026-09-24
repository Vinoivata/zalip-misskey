/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
import type { StoryObj } from '@storybook/vue3';
import { http, HttpResponse } from 'msw';
import MkZalipBookmark from './MkZalipBookmark.vue';

export const Default = {
	render(args) {
		return { components: { MkZalipBookmark }, setup: () => ({ args }), template: '<MkZalipBookmark v-bind="args"/>' };
	},
	args: { noteId: 'example-note' },
	parameters: {
		layout: 'centered',
		msw: { handlers: [http.post('/api/notes/state', () => HttpResponse.json({ isFavorited: false, isWatching: false }))] },
	},
} satisfies StoryObj<typeof MkZalipBookmark>;
