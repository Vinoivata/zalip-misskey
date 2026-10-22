/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable import/no-default-export */
import type { StoryObj } from '@storybook/vue3';
import ZalipShareCard from './ZalipShareCard.vue';

export const Default = {
	render(args) {
		return { components: { ZalipShareCard }, setup: () => ({ args }), template: '<div style="width: 420px; max-width: 100%;"><ZalipShareCard v-bind="args" /></div>' };
	},
	args: {
		share: {
			slug: 'example-title', kind: 'movie' as const, title: 'Человек-паук: Через вселенные — длинное название тайтла',
			description: 'Карточка сохраняет полное название и читаемое описание даже в глубоко вложенном ответе.',
			releaseYear: 2026, genres: ['Фантастика', 'Приключения'], posterPath: null,
		},
	},
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof ZalipShareCard>;

export const NarrowReply = {
	...Default,
	render(args) { return { components: { ZalipShareCard }, setup: () => ({ args }), template: '<div style="width: 190px; max-width: 100%;"><ZalipShareCard v-bind="args" /></div>' }; },
} satisfies StoryObj<typeof ZalipShareCard>;

export const Preview = { ...Default, args: { ...Default.args, preview: true } } satisfies StoryObj<typeof ZalipShareCard>;
