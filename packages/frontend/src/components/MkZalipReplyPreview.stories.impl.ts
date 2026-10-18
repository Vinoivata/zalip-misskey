/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { http, HttpResponse } from 'msw';
import { ref } from 'vue';
import { note } from '../../.storybook/fakes.js';
import MkZalipReplyPreview from './MkZalipReplyPreview.vue';
import MkZalipIcon from './MkZalipIcon.vue';
import type { StoryObj } from '@storybook/vue3';
import { i18n } from '@/i18n.js';

const reply = { ...note(), replyId: 'parent', text: 'A real reply preview remains a link to the discussion.' };
export const Default = {
	render(args) { return { components: { MkZalipReplyPreview, MkZalipIcon }, setup: () => ({ args, i18n, replyAnchor: ref<HTMLElement | null>(null) }), template: '<div style="max-width: 600px; padding: 16px 16px 16px 64px;"><MkZalipReplyPreview v-bind="args" :replyAnchor="replyAnchor"/><footer style="display: flex; align-items: center; gap: 14px; margin-top: 8px;"><span style="display: inline-flex; align-items: center; gap: 5px;"><MkZalipIcon name="mood" style="width: 20px; height: 20px;"/>0</span><button ref="replyAnchor" type="button" class="_button" :aria-label="i18n.ts.reply" style="display: inline-flex; align-items: center; gap: 5px; min-height: 44px;"><MkZalipIcon name="reply" style="width: 20px; height: 20px;"/>1</button></footer></div>' }; },
	args: { noteId: 'parent', replyCount: 1 },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([reply]))] } },
} satisfies StoryObj<typeof MkZalipReplyPreview>;

export const Warning = { ...Default, args: { ...Default.args, noteId: 'cw-parent' }, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([{ ...reply, replyId: 'cw-parent', cw: 'Spoilers', text: 'This text must not be shown in the bubble.' }]))] } } } satisfies StoryObj<typeof MkZalipReplyPreview>;
export const NoVisibleReply = { ...Default, args: { ...Default.args, noteId: 'empty-parent' }, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([]))] } } } satisfies StoryObj<typeof MkZalipReplyPreview>;
export const ShortReply = { ...Default, args: { ...Default.args, noteId: 'short-parent' }, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([{ ...reply, replyId: 'short-parent', text: 'OK' }]))] } } } satisfies StoryObj<typeof MkZalipReplyPreview>;
