/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Component } from 'vue';

type ChatPopup = { component?: Component; props?: Record<string, unknown> };

/** Unknown popups remain blocking; only known native passive overlays are exempt. */
export function hasBlockingChatPopup(popups: readonly ChatPopup[]): boolean {
	return popups.some(popup => {
		const component = popup.component as { name?: string; __name?: string; __asyncLoader?: () => Promise<unknown>; __asyncResolved?: { name?: string; __name?: string } } | undefined;
		const name = component?.__asyncResolved?.__name ?? component?.__asyncResolved?.name ?? component?.__name ?? component?.name;
		if (name === 'MkToast' || name === 'MkTooltip' || name === 'MkReactionTooltip') return false;
		// MkReactionIcon opens an async MkReactionTooltip before its component name resolves.
		// This exact native contract is not shared by menus, pickers or modal dialogs.
		const props = popup.props;
		if (typeof component?.__asyncLoader !== 'function') return true;
		if (props && Object.keys(props).length === 3 && Object.hasOwn(props, 'showing') && Object.hasOwn(props, 'reaction') && Object.hasOwn(props, 'anchorElement') && typeof props.reaction === 'string' && props.anchorElement instanceof HTMLElement) return false;
		// v-tooltip's async native MkTooltip uses exactly these five fields.
		if (props && Object.keys(props).length === 5 && Object.hasOwn(props, 'showing') && Object.hasOwn(props, 'text') && Object.hasOwn(props, 'asMfm') && Object.hasOwn(props, 'direction') && Object.hasOwn(props, 'anchorElement') && typeof props.text === 'string' && (props.asMfm === undefined || typeof props.asMfm === 'boolean') && ['top', 'bottom', 'left', 'right'].includes(String(props.direction)) && props.anchorElement instanceof HTMLElement) return false;
		return true;
	});
}
