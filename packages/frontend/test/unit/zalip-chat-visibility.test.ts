/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import { hasBlockingChatPopup } from '@/utility/zalip-chat-visibility.js';

const asyncComponent = { __asyncLoader: async () => ({}) };

describe('chat popup visibility', () => {
	it('keeps unknown popups, native menus and modal dialogs blocking', () => {
		for (const popup of [{}, { component: { __name: 'MkPopupMenu' } }, { component: { __name: 'MkDialog' } }, { component: asyncComponent, props: { anchorElement: document.createElement('button') } }]) expect(hasBlockingChatPopup([popup])).toBe(true);
	});
	it('does not pause chats or cancel voice capture for native passive toasts and resolved tooltips', () => {
		for (const name of ['MkToast', 'MkTooltip', 'MkReactionTooltip']) expect(hasBlockingChatPopup([{ component: { __name: name } }])).toBe(false);
		expect(hasBlockingChatPopup([{ component: { __name: 'AsyncComponentWrapper', __asyncResolved: { __name: 'MkReactionTooltip' } } }])).toBe(false);
	});
	it('recognizes the exact async native reaction tooltip before its loader resolves', () => {
		const props = { showing: ref(true), reaction: '❤️', anchorElement: document.createElement('span') };
		expect(hasBlockingChatPopup([{ component: asyncComponent, props }])).toBe(false);
		expect(hasBlockingChatPopup([{ component: asyncComponent, props: { ...props, modal: true } }])).toBe(true);
		expect(hasBlockingChatPopup([{ component: { __name: 'UnknownModal' }, props }])).toBe(true);
	});
	it('recognizes only the native v-tooltip contract and still blocks any real overlay alongside it', () => {
		const tooltip = { component: asyncComponent, props: { showing: ref(true), text: 'Hint', asMfm: undefined, direction: 'top', anchorElement: document.createElement('button') } };
		expect(hasBlockingChatPopup([tooltip])).toBe(false);
		expect(hasBlockingChatPopup([tooltip, { component: { __name: 'MkDialog' } }])).toBe(true);
		expect(hasBlockingChatPopup([{ ...tooltip, props: { ...tooltip.props, extra: true } }])).toBe(true);
	});
});
