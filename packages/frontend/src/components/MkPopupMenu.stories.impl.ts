/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import MkPopupMenu from './MkPopupMenu.vue';
import type { StoryObj } from '@storybook/vue3';
import { i18n } from '@/i18n.js';

export const Default = {
	render(args) {
		return {
			components: { MkPopupMenu },
			setup() { return { args, anchor: ref<HTMLElement | null>(null), open: ref(true), label: i18n.ts.more }; },
			template: '<button ref="anchor" class="_button" @click="open = true">{{ label }}</button><MkPopupMenu v-if="open" v-bind="args" :anchorElement="anchor" @closed="open = false" />',
		};
	},
	args: { items: [{ text: i18n.ts.favorite, icon: 'ti ti-bookmark', action: () => {} }, { text: i18n.ts.muteThread, icon: 'ti ti-message-off', action: () => {} }, { type: 'divider' }, { text: i18n.ts.reportAbuse, icon: 'ti ti-flag', danger: true, action: () => {} }] },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkPopupMenu>;

export const ZalipNote = { ...Default, args: { ...Default.args, appearance: 'zalip-note' } } satisfies StoryObj<typeof MkPopupMenu>;
export const ZalipNoteMobile = { ...ZalipNote, parameters: { layout: 'fullscreen', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkPopupMenu>;
