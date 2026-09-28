<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<nav :class="$style.root" :aria-label="i18n.ts.zalip.bookmarksHeading">
	<div :class="$style.tabs">
		<MkA to="/my/favorites" :class="$style.tab" :aria-current="active === 'posts' ? 'page' : undefined"><i class="ti ti-message-circle" aria-hidden="true"></i><span>{{ i18n.ts.zalip.postBookmarks }}</span></MkA>
		<MkA to="/library?filter=favorites" :class="$style.tab" :aria-current="active === 'content' ? 'page' : undefined"><i class="ti ti-movie" aria-hidden="true"></i><span>{{ i18n.ts.zalip.bookmarkContentTab }}</span></MkA>
	</div>
</nav>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';

defineProps<{ active: 'posts' | 'content' }>();
</script>

<style lang="scss" module>
.root { padding: 16px 24px; background: var(--MI_THEME-panel); border-bottom: 1px solid var(--MI_THEME-divider); }
.tabs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; padding: 4px; border-radius: 16px; background: var(--MI_THEME-panelHighlight); }
.tab { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 44px; border-radius: 12px; color: var(--MI_THEME-fgTransparentWeak); font-size: 14px; font-weight: 650; text-decoration: none; transition: background 150ms, color 150ms; }
.tab i { display: grid; place-items: center; width: 22px; height: 22px; font-size: 20px; }
.tab i::before { font-size: 1em; }
.tab:hover { color: var(--MI_THEME-fg); text-decoration: none; }
.tab[aria-current=page] { background: var(--MI_THEME-panel); color: var(--MI_THEME-accent); box-shadow: 0 1px 4px var(--MI_THEME-shadow); }
.tab:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
@media (max-width: 600px) { .root { padding: 12px 16px; } }
@media (prefers-reduced-motion: reduce) { .tab { transition: none; } }
</style>
