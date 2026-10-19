<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="zalipDiscussionRoute(context)" :class="$style.root">
	<div :class="$style.poster">
		<img v-if="images.poster(context)" :src="images.poster(context)!" alt="" width="72" height="108" loading="lazy" decoding="async" @error="images.failed">
		<i v-else class="ti ti-movie" aria-hidden="true"></i>
	</div>
	<div :class="$style.text">
		<span :class="$style.label">{{ context.episodeId == null ? i18n.ts.zalip.contentDiscussionLabel : i18n.tsx.zalip.contentEpisodeDiscussionLabel({ episode: String(context.episodeNumber), season: String(context.seasonNumber) }) }}</span>
		<strong>{{ context.title }}</strong>
	</div>
	<i class="ti ti-chevron-right" aria-hidden="true"></i>
</MkA>
</template>

<script lang="ts" setup>
import type { ZalipDiscussionContext } from '@/utility/zalip-discussion-context.js';
import { zalipDiscussionRoute } from '@/utility/zalip-discussion-context.js';
import { useZalipImages } from '@/utility/zalip-image.js';
import { i18n } from '@/i18n.js';

defineProps<{ context: ZalipDiscussionContext }>();
const images = useZalipImages();
</script>

<style lang="scss" module>
.root { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 72px; box-sizing: border-box; padding: 12px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); color: var(--MI_THEME-fg); background: var(--zalip-social-raised); text-decoration: none; }
.root:hover { text-decoration: none; background: var(--MI_THEME-panelHighlight); }
.root:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.poster { flex: 0 0 48px; width: 48px; height: 72px; display: grid; place-items: center; overflow: hidden; border-radius: 6px; color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.text { flex: 1; min-width: 0; display: grid; gap: 5px; overflow-wrap: anywhere; }
.label { color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }
.text strong { font-size: 15px; }
</style>
