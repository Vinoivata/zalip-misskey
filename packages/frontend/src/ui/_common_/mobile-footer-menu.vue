<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="$style.root">
	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="i18n.ts.home" :title="i18n.ts.home" to="/">
		<div :class="$style.itemInner">
			<i :class="$style.itemIcon" class="ti ti-home-2"></i><span :class="$style.itemText">{{ i18n.ts.home }}</span>
		</div>
	</MkA>

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

	<button type="button" class="_button" :class="[$style.item, $style.accountItem]" :aria-label="i18n.ts.zalip.more" :title="i18n.ts.zalip.more" @click="openMoreMenu">
		<div :class="$style.itemInner">
			<MkAvatar v-if="$i" :user="$i" :class="$style.profileAvatar"/>
			<i v-else :class="$style.itemIcon" class="ti ti-menu-2"></i><span :class="$style.itemText">{{ i18n.ts.zalip.more }}</span>
			<span v-if="$i?.hasUnreadNotification" :class="$style.itemIndicator" class="_blink">
				<span class="_indicateCounter" :class="$style.itemIndicateValueIcon">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount }}</span>
			</span>
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
		...($i ? [{ type: 'link' as const, text: navbarItemDef.notifications.title, icon: navbarItemDef.notifications.icon, to: '/my/notifications' }] : []),
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
	align-self: center;
	margin: 0 12px max(12px, env(safe-area-inset-bottom, 0px));
	padding: 5px max(7px, env(safe-area-inset-left, 0px)) 5px max(7px, env(safe-area-inset-right, 0px));
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	width: min(calc(100% - 24px), 510px);
	box-sizing: border-box;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 60%, transparent);
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-navBg) 70%, #050507);
	color: var(--MI_THEME-navFg);
	box-shadow: 0 16px 44px color-mix(in srgb, var(--MI_THEME-shadow) 56%, transparent), 0 0 0 1px color-mix(in srgb, var(--MI_THEME-fg) 7%, transparent), inset 0 1px color-mix(in srgb, var(--MI_THEME-fg) 16%, transparent);
	backdrop-filter: blur(28px) saturate(1.3);
}

.item {
	display: flex;
	align-items: stretch;
	justify-content: center;
	min-width: 0;
	min-height: 58px;
	padding: 5px 0;
	color: inherit;
	text-decoration: none;

	&.active {
		color: var(--MI_THEME-fg);

		.itemInner {
			background: color-mix(in srgb, var(--MI_THEME-fg) 17%, transparent);
			color: var(--MI_THEME-fg);
			box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--MI_THEME-fg) 8%, transparent);
		}
	}
}

.itemInner {
	position: relative;
	display: grid;
	place-items: center;
	width: 46px;
	height: 46px;
	margin: auto;
	border-radius: 50%;
	transition: transform 0.16s ease, background 0.16s ease, color 0.16s ease, box-shadow .16s ease;

	&:hover {
		background: color-mix(in srgb, var(--MI_THEME-panelHighlight) 85%, transparent);
	}

	&:active {
		transform: scale(0.92);
	}
}

.itemIcon {
	font-size: 23px;
}

.accountItem .itemInner {
	background: color-mix(in srgb, var(--MI_THEME-accent) 76%, #1f5920);
	color: var(--MI_THEME-fgOnAccent);
	box-shadow: 0 5px 16px color-mix(in srgb, var(--MI_THEME-accent) 30%, transparent);
}

.accountItem .itemInner:hover { background: var(--MI_THEME-accent); }
.accountItem.active .itemInner { background: color-mix(in srgb, var(--MI_THEME-accent) 88%, #1f5920); color: var(--MI_THEME-fgOnAccent); }

.profileAvatar { width: 38px; height: 38px; border-radius: 50%; }

.itemText {
	display: none;
}

.itemIndicator {
	position: absolute;
	top: -1px;
	right: -1px;
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
		width: calc(100% - 20px);
		margin-inline: 10px;
		padding-inline: 2px;
	}

	.item {
		min-height: 56px;
	}

	.itemInner {
		width: 44px;
		height: 44px;
	}

}
</style>
