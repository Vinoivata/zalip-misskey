<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="$style.root">
	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.catalogue.title" :title="navbarItemDef.catalogue.title" to="/catalog">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.catalogue.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.catalogue.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.feed.title" :title="navbarItemDef.feed.title" to="/timeline">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.feed.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.feed.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.library.title" :title="navbarItemDef.library.title" to="/library">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.library.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.library.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.notifications.title" :title="navbarItemDef.notifications.title" to="/my/notifications">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.notifications.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.notifications.title }}</span>
			<span v-if="$i?.hasUnreadNotification" :class="$style.itemIndicator" class="_blink">
				<span class="_indicateCounter" :class="$style.itemIndicateValueIcon">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount }}</span>
			</span>
		</div>
	</MkA>

	<button type="button" class="_button" :class="$style.item" :aria-label="i18n.ts.zalip.more" :title="i18n.ts.zalip.more" @click="openMoreMenu">
		<div :class="$style.itemInner">
			<i :class="$style.itemIcon" class="ti ti-menu-2"></i><span :class="$style.itemText">{{ i18n.ts.zalip.more }}</span>
		</div>
	</button>
</div>
</template>

<script lang="ts" setup>
import { $i } from '@/i.js';
import { navbarItemDef } from '@/navbar.js';
import { i18n } from '@/i18n.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';
import type { MenuItem } from '@/types/menu.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';

function signIn(): void {
	void pleaseLogin();
}

function openMoreMenu(event: PointerEvent): void {
	const accountItems: MenuItem[] = $i
		? [{ type: 'link', text: navbarItemDef.profile.title, icon: navbarItemDef.profile.icon, to: `/@${$i.username}` }]
		: [{ text: i18n.ts.login, icon: 'ti ti-login', action: () => signIn() }];

	void os.popupMenu([
		{ type: 'link', text: i18n.ts.home, icon: 'ti ti-home', to: '/' },
		{ text: i18n.ts.zalip.search, icon: 'ti ti-search', action: () => openZalipSearch() },
		{ type: 'link', text: navbarItemDef.updates.title, icon: navbarItemDef.updates.icon, to: '/updates' },
		{ type: 'divider' },
		...accountItems,
		...($i ? [
			{ type: 'link' as const, text: i18n.ts.settings, icon: 'ti ti-settings', to: '/settings' },
			{ type: 'link' as const, text: i18n.ts.widgets, icon: 'ti ti-layout', to: '/my/widgets' },
		] : []),
		{ type: 'divider' },
		...getZalipAppearanceMenu(),
	], event.currentTarget ?? event.target, { align: 'right', width: 280 });
}

</script>

<style lang="scss" module>
.root {
	position: relative;
	z-index: 1200;
	padding: 4px max(8px, env(safe-area-inset-left, 0px)) env(safe-area-inset-bottom, 0px) max(8px, env(safe-area-inset-right, 0px));
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	width: 100%;
	box-sizing: border-box;
	background: var(--MI_THEME-navBg);
	color: var(--MI_THEME-navFg);
	border-top: solid 1px var(--MI_THEME-divider);
	box-shadow: 0 -10px 30px color-mix(in srgb, black 12%, transparent);
}

.item {
	display: flex;
	align-items: stretch;
	justify-content: center;
	min-width: 0;
	min-height: 54px;
	padding: 4px 0;
	color: inherit;
	text-decoration: none;

	&.active {
		color: var(--MI_THEME-accent);

		.itemInner { background: var(--MI_THEME-accentedBg); }
	}
}

.itemInner {
	position: relative;
	display: grid;
	justify-items: center;
	gap: 4px;
	padding: 5px 0;
	width: 100%;
	max-width: 64px;
	margin: auto;
	border-radius: 10px;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:active {
		background: var(--MI_THEME-panelHighlight);
	}
}

.itemIcon {
	font-size: 22px;
}

.itemText {
	max-width: 100%;
	overflow: hidden;
	font-size: 10px;
	font-weight: 650;
	line-height: 1.1;
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.itemIndicator {
	position: absolute;
	top: 0;
	right: 2px;
	color: var(--MI_THEME-indicator);
	font-size: 10px;
	pointer-events: none;

	&:has(.itemIndicateValueIcon) {
		animation: none;
		font-size: 8px;
	}
}

@media (max-width: 400px) {
	.root {
		padding-inline: 2px;
	}

	.item {
		min-height: 54px;
	}

	.itemInner {
		max-width: 70px;
		padding: 7px 0;
	}

}
</style>
