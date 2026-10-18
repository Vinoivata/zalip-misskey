/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { http, HttpResponse } from 'msw';
import { note } from '../../.storybook/fakes.js';
import MkZalipReplyPreview from './MkZalipReplyPreview.vue';
import type { StoryObj } from '@storybook/vue3';

const reply = { ...note(), replyId: 'parent', text: 'A real reply preview remains a link to the discussion.' };
export const Default = {
	render(args) { return { components: { MkZalipReplyPreview }, setup: () => ({ args }), template: '<div style="max-width: 600px; padding: 16px 16px 16px 64px;"><MkZalipReplyPreview v-bind="args" /></div>' }; },
	args: { noteId: 'parent', replyCount: 1 },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([reply]))] } },
} satisfies StoryObj<typeof MkZalipReplyPreview>;

export const Warning = { ...Default, args: { ...Default.args, noteId: 'cw-parent' }, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([{ ...reply, replyId: 'cw-parent', cw: 'Spoilers', text: 'This text must not be shown in the bubble.' }]))] } } } satisfies StoryObj<typeof MkZalipReplyPreview>;
export const NoVisibleReply = { ...Default, args: { ...Default.args, noteId: 'empty-parent' }, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([]))] } } } satisfies StoryObj<typeof MkZalipReplyPreview>;
