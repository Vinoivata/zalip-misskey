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

export const ZalipNote = { ...Default, args: { appearance: 'zalip-note', items: [
	{ text: i18n.ts.favorite, icon: 'ti ti-bookmark', action: () => {} },
	{ text: i18n.ts.muteThread, icon: 'ti ti-message-off', action: () => {} },
	{ text: i18n.ts.mute, icon: 'ti ti-eye-off', action: () => {} },
	{ text: i18n.ts.block, icon: 'ti ti-ban', action: () => {} },
	{ type: 'divider' },
	{ text: i18n.ts.reportAbuse, icon: 'ti ti-flag', danger: true, action: () => {} },
] } } satisfies StoryObj<typeof MkMenu>;
export const ZalipOwnNote = { ...ZalipNote, args: { appearance: 'zalip-note', items: [
	{ text: i18n.ts.favorite, icon: 'ti ti-bookmark', action: () => {} },
	{ text: i18n.ts.deleteAndEdit, icon: 'ti ti-edit', action: () => {} },
	{ text: i18n.ts.pin, icon: 'ti ti-pin', action: () => {} },
	{ type: 'divider' },
	{ text: i18n.ts.delete, icon: 'ti ti-trash', danger: true, action: () => {} },
] } } satisfies StoryObj<typeof MkMenu>;
export const ZalipNoteMobile = { ...ZalipNote, args: { ...ZalipNote.args, asDrawer: true }, parameters: { layout: 'centered', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkMenu>;
