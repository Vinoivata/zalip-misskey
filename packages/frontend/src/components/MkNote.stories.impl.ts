/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { http, HttpResponse } from 'msw';
import { file, note } from '../../.storybook/fakes.js';
import MkNote from './MkNote.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkNote }, setup: () => ({ args }), template: '<div style="max-width: 600px; container-type: inline-size;"><MkNote v-bind="args" /></div>' }; },
	args: { note: note(), mock: true },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/replies', () => HttpResponse.json([]))] } },
} satisfies StoryObj<typeof MkNote>;

export const LongTextWithMedia = { ...Default, args: { ...Default.args, note: { ...note(), text: 'A long film discussion with a visible image after the text.\n'.repeat(15), files: [file()] } } } satisfies StoryObj<typeof MkNote>;
export const Warning = { ...Default, args: { ...Default.args, note: { ...note(), cw: 'Spoilers', text: 'Content revealed only after the warning is opened.', files: [file(true)] } } } satisfies StoryObj<typeof MkNote>;
export const Mobile = { ...LongTextWithMedia, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkNote>;

const discussion = { ...note(), id: 'discussion-fixture', text: 'Обсуждение: Fixture film', isZalipDiscussionRoot: true, files: [] };
const comment = { ...note(), id: 'comment-fixture', text: 'The actual comment remains visible in its repost, together with its image.', replyId: discussion.id, reply: discussion, files: [file()] };
export const RepostedContentComment = { ...Default, args: { ...Default.args, note: { ...note(), text: null, files: [], poll: undefined, renoteId: comment.id, renote: comment } } } satisfies StoryObj<typeof MkNote>;
export const WithoutReplies = { ...Default, args: { ...Default.args, note: { ...note(), repliesCount: 0, text: 'A post rail is visible even before the first reply.' } } } satisfies StoryObj<typeof MkNote>;
