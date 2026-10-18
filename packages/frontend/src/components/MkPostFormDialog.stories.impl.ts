/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import MkPostFormDialog from './MkPostFormDialog.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkPostFormDialog }, setup: () => ({ args }), template: '<MkPostFormDialog v-bind="args" />' }; },
	args: { mock: true, initialText: 'A read-only preview: posting is disabled in this story.' },
	parameters: { layout: 'fullscreen' },
} satisfies StoryObj<typeof MkPostFormDialog>;
export const Mobile = { ...Default, parameters: { ...Default.parameters, viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkPostFormDialog>;
