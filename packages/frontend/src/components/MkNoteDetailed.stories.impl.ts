/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */
 
import { http, HttpResponse } from 'msw';
import { provide } from 'vue';
import { file, note } from '../../.storybook/fakes.js';
import MkNoteDetailed from './MkNoteDetailed.vue';
import type { StoryObj } from '@storybook/vue3';
import { DI } from '@/di.js';

export const Default = {
	render(args) { return { components: { MkNoteDetailed }, setup: () => { provide(DI.mock, true); return { args }; }, template: '<div style="max-width: 600px; container-type: inline-size;"><MkNoteDetailed v-bind="args" /></div>' }; },
	args: { note: { ...note(), files: [file()] } },
	parameters: { layout: 'padded', msw: { handlers: [http.post('*/api/notes/children', () => HttpResponse.json([])), http.post('*/api/notes/state', () => HttpResponse.json({ isFavorited: false, isWatching: false }))] } },
} satisfies StoryObj<typeof MkNoteDetailed>;

export const Mobile = { ...Default, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkNoteDetailed>;

const discussion = { ...note(), id: 'discussion-fixture', text: 'Обсуждение: Fixture film — серия 2', isZalipDiscussionRoot: true, files: [] };
const comment = { ...note(), id: 'comment-fixture', text: 'The reposted episode comment, not its technical discussion root.', replyId: discussion.id, reply: discussion, files: [file()] };
export const RepostedContentComment = { ...Default, args: { note: { ...note(), text: null, files: [], poll: undefined, renoteId: comment.id, renote: comment } } } satisfies StoryObj<typeof MkNoteDetailed>;
