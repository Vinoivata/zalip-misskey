/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import MkMenu from './MkMenu.vue';
import type { StoryObj } from '@storybook/vue3';
import { i18n } from '@/i18n.js';

export const Default = {
	render(args) { return { components: { MkMenu }, setup: () => ({ args }), template: '<MkMenu v-bind="args" />' }; },
	args: { items: [{ text: i18n.ts.save, icon: 'ti ti-bookmark', action: () => {} }, { text: i18n.ts.copyLink, icon: 'ti ti-link', action: () => {} }, { type: 'divider' }, { text: i18n.ts.reportAbuse, icon: 'ti ti-flag', danger: true, action: () => {} }] },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkMenu>;

export const ZalipNote = { ...Default, args: { ...Default.args, appearance: 'zalip-note' } } satisfies StoryObj<typeof MkMenu>;
export const ZalipNoteMobile = { ...ZalipNote, args: { ...ZalipNote.args, asDrawer: true }, parameters: { layout: 'centered', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkMenu>;
