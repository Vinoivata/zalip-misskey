<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="[$style.root, { [$style.thread]: isThread, [$style.mobile]: mobile, [$style.hidden]: hidden }]" :inert="hidden">
	<button type="button" class="_button" :class="$style.create" :aria-label="isThread ? i18n.ts.zalip.back : i18n.ts.zalip.feedQuickPost" @click="isThread ? goBack() : openZalipCreateMenu($event)"><MkZalipIcon :name="isThread ? 'back' : 'plus'"/></button>
	<MkA v-if="!isThread" to="/" :class="$style.brand" :aria-label="i18n.ts.zalip.brand">zalip</MkA>
	<strong v-else :class="$style.title">{{ i18n.ts.zalip.discussion }}</strong>
	<button v-if="!isThread" type="button" class="_button" :class="$style.theme" :aria-label="store.r.darkMode.value ? i18n.ts.zalip.appearanceLight : i18n.ts.zalip.appearanceDark" @click="toggleTheme"><MkZalipIcon :name="store.r.darkMode.value ? 'sun' : 'moon'"/></button>
	<button v-if="!isThread" type="button" class="_button" :class="$style.search" :aria-label="i18n.ts.zalip.search" @click="openZalipSearch()"><MkZalipIcon name="search"/></button>
</header>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { i18n } from '@/i18n.js';
import { applyZalipAppearance, getZalipAccent } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { openZalipCreateMenu } from '@/utility/zalip-create.js';
import { mainRouter } from '@/router.js';
import { store } from '@/store.js';

defineProps<{ hidden?: boolean; mobile?: boolean }>();
const isThread = computed(() => mainRouter.currentRoute.value.name === 'note');

function toggleTheme(): void {
	applyZalipAppearance(store.s.darkMode ? 'light' : 'dark', getZalipAccent() ?? 'sapphire');
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
.root:not(.mobile) { display: none; }
.thread:not(.mobile) { display: grid; height: 64px; }
@media (prefers-reduced-motion: reduce) { .root { transition: none; } }
</style>
