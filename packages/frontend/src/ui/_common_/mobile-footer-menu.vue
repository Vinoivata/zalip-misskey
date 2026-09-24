<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.wrap, { [$style.hidden]: hidden }]">
	<nav :class="$style.root" :aria-label="i18n.ts.menu" :inert="hidden">
		<MkA v-for="item in items" :key="item.to" :class="$style.item" :activeClass="$style.active" :aria-label="item.label" :title="item.label" :to="item.to" :exact="item.to === '/'">
			<MkZalipIcon :name="item.icon"/>
			<span v-if="item.to === '/my/notifications' && $i?.hasUnreadNotification" :class="$style.indicator"></span>
		</MkA>
		<button type="button" class="_button" :class="$style.item" :aria-label="i18n.ts.zalip.more" @click="openMoreMenu">
			<MkAvatar v-if="$i" :user="$i" :class="$style.avatar"/>
			<MkZalipIcon v-else name="person"/>
		</button>
	</nav>
</div>
<button v-if="hidden" type="button" class="_button" :class="$style.create" :aria-label="i18n.ts.zalip.feedQuickPost" @click="writePost"><MkZalipIcon name="plus"/></button>
</template>

<script lang="ts" setup>
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import type { ZalipIconName } from '@/components/MkZalipIcon.vue';
import { $i } from '@/i.js';
import { navbarItemDef } from '@/navbar.js';
import { i18n } from '@/i18n.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';
import type { MenuItem } from '@/types/menu.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { openZalipCreateMenu } from '@/utility/zalip-create.js';

defineProps<{ hidden?: boolean }>();

const items: { to: string; icon: ZalipIconName; label: string }[] = [
	{ to: '/timeline', icon: 'home', label: navbarItemDef.feed.title },
	{ to: '/', icon: 'reels', label: navbarItemDef.zalip.title },
	{ to: '/my/notifications', icon: 'heart', label: i18n.ts.notifications },
	{ to: '/chat', icon: 'messages', label: i18n.ts.zalip.messages },
];

function writePost(event: PointerEvent): void {
	openZalipCreateMenu(event);
}

function openMoreMenu(event: PointerEvent): void {
	const accountItems: MenuItem[] = $i
		? [{ type: 'link', text: navbarItemDef.profile.title, icon: navbarItemDef.profile.icon, to: '/@' + $i.username }]
		: [{ text: i18n.ts.login, icon: 'ti ti-login', action: () => { void pleaseLogin(); } }];

	void os.popupMenu([
		...accountItems,
		{ type: 'link', text: navbarItemDef.catalogue.title, icon: 'ti ti-movie', to: '/catalog' },
		{ type: 'link', text: navbarItemDef.library.title, icon: 'ti ti-bookmark', to: '/library' },
		{ type: 'link', text: i18n.ts.favorites, icon: 'ti ti-star', to: '/my/favorites' },
		{ text: i18n.ts.zalip.search, icon: 'ti ti-search', action: () => openZalipSearch() },
		{ type: 'link', text: navbarItemDef.updates.title, icon: navbarItemDef.updates.icon, to: '/updates' },
		...($i?.isAdmin ? [{ type: 'link' as const, text: i18n.ts.zalip.addContent, icon: 'ti ti-square-plus', to: '/zalip/editor' }] : []),
		...($i?.isAdmin || $i?.isModerator ? [{ type: 'link' as const, text: i18n.ts.controlPanel, icon: 'ti ti-shield', to: '/admin' }] : []),
		{ type: 'divider' },
		...($i ? [
			{ type: 'link' as const, text: i18n.ts.settings, icon: 'ti ti-settings', to: '/settings' },
			{ type: 'link' as const, text: i18n.ts.widgets, icon: 'ti ti-layout', to: '/my/widgets' },
		] : []),
		...getZalipAppearanceMenu(),
	], event.currentTarget ?? event.target, { align: 'right', width: 280 });
}
</script>

<style lang="scss" module>
.wrap {
	position: absolute;
	z-index: 1200;
	bottom: max(24px, env(safe-area-inset-bottom, 0px));
	left: 0;
	right: 0;
	display: flex;
	justify-content: center;
	padding: 0 16px;
	pointer-events: none;
	transition: transform .4s cubic-bezier(.34, 1.56, .64, 1), opacity .25s ease;
}
.hidden { transform: translateY(calc(100% + 40px)); opacity: 0; }
.root, .create {
	background: var(--zalip-glass);
	-webkit-backdrop-filter: blur(22px) saturate(1.6) contrast(.9);
	backdrop-filter: blur(22px) saturate(1.6) contrast(.9);
	box-shadow: 0 10px 30px var(--zalip-glass-shadow), inset 0 1px var(--zalip-glass-highlight);
}
.root {
	position: relative;
	display: flex;
	align-items: center;
	width: 100%;
	max-width: 400px;
	height: 68px;
	padding: 0 8px;
	box-sizing: border-box;
	border: 1px solid var(--zalip-glass-highlight);
	border-radius: 34px;
	pointer-events: auto;
}
.item {
	position: relative;
	display: grid;
	place-items: center;
	flex: 1;
	height: 100%;
	min-width: 0;
	color: var(--zalip-social-subtle);
	text-decoration: none;
	-webkit-tap-highlight-color: transparent;
	&::before {
		content: '';
		position: absolute;
		width: 55px;
		max-width: 100%;
		height: 46px;
		border-radius: 28px;
		transition: background .2s ease, transform .2s ease;
	}
	> svg, > .avatar { position: relative; width: 24px; height: 24px; }
	&.active {
		color: var(--zalip-social-fg);
		&::before { background: var(--zalip-glass-active); transform: scaleX(1.12); }
	}
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); border-radius: 30px; }
	> .avatar { width: 32px; height: 32px; opacity: .85; }
}
.indicator { position: absolute; top: 16px; right: 24%; width: 6px; height: 6px; border: 2px solid var(--zalip-social-panel); border-radius: 50%; background: var(--MI_THEME-indicator); }
.create {
	position: absolute;
	z-index: 1190;
	bottom: max(24px, env(safe-area-inset-bottom, 0px));
	right: 16px;
	display: grid;
	place-items: center;
	width: 56px;
	height: 56px;
	border: 1px solid var(--zalip-glass-highlight);
	border-radius: 16px;
	color: var(--zalip-social-fg);
	> svg { width: 28px; height: 28px; }
}
@media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
</style>
