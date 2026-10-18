/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { http, HttpResponse } from 'msw';
import { file, note } from '../../.storybook/fakes.js';
import MkZalipCommentThread from './MkZalipCommentThread.vue';
import type { StoryObj } from '@storybook/vue3';

const parent = { ...note('000'), repliesCount: 2, reactionCount: 2, reactions: { '❤️': 2 }, text: 'A compact discussion with native reactions, reply and repost.' };
const reply = { ...note('001'), replyId: parent.id, repliesCount: 1, text: 'This direct reply is only loaded when its branch is expanded.' };
export const Default = {
	render(args) { return { components: { MkZalipCommentThread }, setup: () => ({ args }), template: '<div style="max-width: 780px; container-type: inline-size;"><MkZalipCommentThread v-bind="args" /></div>' }; },
	args: { note: parent, mock: true },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/replies', async ({ request }) => { const body = await request.json() as { noteId: string }; return HttpResponse.json(body.noteId === parent.id ? [reply] : []); })] } },
} satisfies StoryObj<typeof MkZalipCommentThread>;

export const WarningWithMedia = { ...Default, args: { ...Default.args, note: { ...parent, cw: 'Spoilers', text: 'The media stays concealed until the warning is opened.', files: [file(true), file()] } } } satisfies StoryObj<typeof MkZalipCommentThread>;
export const Private = { ...Default, args: { ...Default.args, note: { ...parent, visibility: 'followers' as const } } } satisfies StoryObj<typeof MkZalipCommentThread>;
export const Retry = { ...Default, parameters: { ...Default.parameters, msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.error())] } } } satisfies StoryObj<typeof MkZalipCommentThread>;
export const DepthLimit = { ...Default, args: { ...Default.args, depth: 4 } } satisfies StoryObj<typeof MkZalipCommentThread>;
export const LocalOnly = { ...Default, args: { ...Default.args, note: { ...parent, localOnly: true } } } satisfies StoryObj<typeof MkZalipCommentThread>;
export const NoReplies = { ...Default, args: { ...Default.args, note: { ...parent, repliesCount: 0 } } } satisfies StoryObj<typeof MkZalipCommentThread>;
