/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import { HttpResponse, http } from 'msw';
import { action } from 'storybook/actions';
import type { StoryObj } from '@storybook/vue3';
import { channel } from '../../.storybook/fakes.js';
import MkZalipCommunityPicker from './MkZalipCommunityPicker.vue';

const example = { ...channel(), name: 'Кино и сериалы', description: 'Обсуждения, премьеры и впечатления о просмотренном.', isArchived: false };
export const Default = {
	render(args) { return { components: { MkZalipCommunityPicker }, setup: () => ({ args, selected: action('selected') }), template: '<MkZalipCommunityPicker v-bind="args" @selected="selected"/>' }; },
	args: { currentChannelId: null },
	parameters: { layout: 'fullscreen', msw: { handlers: [http.post('/api/channels/followed', () => HttpResponse.json([example])), http.post('/api/channels/search', () => HttpResponse.json([example]))] } },
} satisfies StoryObj<typeof MkZalipCommunityPicker>;
export const Selected = { ...Default, args: { currentChannelId: example.id } } satisfies StoryObj<typeof MkZalipCommunityPicker>;
export const Mobile = { ...Default, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipCommunityPicker>;
