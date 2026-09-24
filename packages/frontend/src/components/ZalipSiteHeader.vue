<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="[$style.root, { [$style.thread]: isThread, [$style.mobile]: mobile, [$style.hidden]: hidden }]" :inert="hidden">
	<template v-if="!mobile && !isThread">
		<nav :class="$style.desktopNav" :aria-label="i18n.ts.menu">
			<MkA to="/" exact :activeClass="$style.active">{{ navbarItemDef.zalip.title }}</MkA>
			<MkA to="/timeline" :activeClass="$style.active">{{ navbarItemDef.feed.title }}</MkA>
			<MkA to="/catalog" :activeClass="$style.active">{{ navbarItemDef.catalogue.title }}</MkA>
			<MkA to="/library" :activeClass="$style.active">{{ navbarItemDef.library.title }}</MkA>
		</nav>
		<button type="button" class="_button" :class="$style.desktopSearch" @click="openZalipSearch()"><MkZalipIcon name="search"/><span>{{ i18n.ts.zalip.search }}</span></button>
		<button type="button" class="_button" :class="$style.desktopAction" :aria-label="i18n.ts.zalip.appearanceTitle" @click="openAppearance"><MkZalipIcon :name="store.r.darkMode.value ? 'sun' : 'moon'"/></button>
		<button type="button" class="_button" :class="[$style.desktopAction, $style.desktopCreate]" :aria-label="i18n.ts.create" @click="openZalipCreateMenu($event)"><MkZalipIcon name="plus"/></button>
	</template>
	<template v-else>
	<button type="button" class="_button" :class="$style.create" :aria-label="isThread ? i18n.ts.zalip.back : i18n.ts.zalip.feedQuickPost" @click="isThread ? goBack() : openZalipCreateMenu($event)"><MkZalipIcon :name="isThread ? 'back' : 'plus'"/></button>
	<MkA v-if="!isThread" to="/" :class="$style.brand" :aria-label="i18n.ts.zalip.brand">zalip</MkA>
	<strong v-else :class="$style.title">{{ i18n.ts.zalip.discussion }}</strong>
	<button v-if="!isThread" type="button" class="_button" :class="$style.theme" :aria-label="store.r.darkMode.value ? i18n.ts.zalip.appearanceLight : i18n.ts.zalip.appearanceDark" @click="toggleTheme"><MkZalipIcon :name="store.r.darkMode.value ? 'sun' : 'moon'"/></button>
	<button v-if="!isThread" type="button" class="_button" :class="$style.search" :aria-label="i18n.ts.zalip.search" @click="openZalipSearch()"><MkZalipIcon name="search"/></button>
	</template>
</header>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { i18n } from '@/i18n.js';
import { applyZalipAppearance, getZalipAccent, getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { navbarItemDef } from '@/navbar.js';
import * as os from '@/os.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { openZalipCreateMenu } from '@/utility/zalip-create.js';
import { mainRouter } from '@/router.js';
import { store } from '@/store.js';

defineProps<{ hidden?: boolean; mobile?: boolean }>();
const isThread = computed(() => mainRouter.currentRoute.value.name === 'note');

function toggleTheme(): void {
	applyZalipAppearance(store.s.darkMode ? 'light' : 'dark', getZalipAccent() ?? 'sapphire');
}

function openAppearance(event: PointerEvent): void {
	void os.popupMenu(getZalipAppearanceMenu(), event.currentTarget ?? event.target, { align: 'right', width: 280 });
}

function goBack(): void {
	if (window.history.length > 1) window.history.back();
	else mainRouter.push('/timeline');
}
</script>

<style lang="scss" module>
.root {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 1200;
	display: grid;
	grid-template-columns: 44px minmax(0, 1fr) 44px 44px;
	align-items: center;
	height: 53px;
	padding: 0 10px;
	box-sizing: border-box;
	color: var(--zalip-social-muted);
	background: color-mix(in srgb, var(--zalip-social-panel) 85%, transparent);
	-webkit-backdrop-filter: blur(10px);
	backdrop-filter: blur(10px);
	transition: transform .3s cubic-bezier(.25, .46, .45, .94);
}
.hidden { transform: translateY(-100%); }
.create, .theme, .search { grid-row: 1; display: grid; place-items: center; width: 44px; height: 44px; }
.create { grid-column: 1; }
.theme { grid-column: 3; > svg { width: 22px; height: 22px; } }
.search { grid-column: 4; > svg { width: 22px; height: 22px; } }
.brand { position: absolute; left: 50%; transform: translateX(-50%); color: var(--zalip-social-fg); font-size: 28px; font-weight: 800; letter-spacing: -2px; line-height: 1; text-decoration: none; }
.title { grid-row: 1; grid-column: 2; text-align: center; color: var(--zalip-social-fg); font-size: 17px; }
.thread { grid-template-columns: 44px minmax(0, 1fr) 44px; border-bottom: 1px solid var(--zalip-social-border); }
.root:not(.mobile) { position: relative; display: flex; flex: 0 0 68px; gap: 10px; height: 68px; padding: 0 20px; border-bottom: 1px solid var(--zalip-social-border); background: var(--zalip-accent-wash); }
.thread:not(.mobile) { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; }
.desktopNav { display: flex; align-items: center; gap: 2px; white-space: nowrap; > a { padding: 10px 12px; border-radius: 99px; font-size: 14px; font-weight: 600; text-decoration: none; } > a:hover { background: var(--zalip-social-hover); } .active { color: var(--zalip-social-fg); background: var(--zalip-accent-soft); box-shadow: inset 0 0 0 1px var(--zalip-accent-border); } }
.desktopSearch { display: flex; align-items: center; gap: 10px; min-width: 44px; max-width: 320px; height: 40px; flex: 1; margin-left: auto; padding: 0 14px; border: 1px solid var(--zalip-social-border); border-radius: 99px; background: var(--zalip-social-panel); text-align: left; > svg { width: 20px; height: 20px; } }
.desktopAction { display: grid; place-items: center; flex: 0 0 40px; height: 40px; border-radius: 50%; &:hover { background: var(--zalip-accent-soft); } > svg { width: 22px; height: 22px; } }
.desktopCreate { color: var(--MI_THEME-fgOnAccent); background: var(--MI_THEME-accent); &:hover { background: var(--MI_THEME-accent); opacity: .85; } }
@media (prefers-reduced-motion: reduce) { .root { transition: none; } }
</style>
