<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<PageWithHeader>
		<div class="_spacer" style="--MI_SPACER-w: 720px;">
			<article :class="$style.page">
				<p :class="$style.eyebrow"><i class="ti ti-heart-handshake"></i> CREDITS</p>
				<h1>Данные о кино</h1>
				<p>Информация, постеры и трейлеры в каталоге могут использовать данные <a href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer">The Movie Database (TMDB)</a>.</p>
				<p><strong>This product uses the TMDB API but is not endorsed or certified by TMDB.</strong></p>
				<MkA to="/" :class="$style.back"><i class="ti ti-arrow-left"></i> Вернуться к кино</MkA>
			</article>
		</div>
	</PageWithHeader>
</template>

<script lang="ts" setup>
import { definePage } from '@/page.js';

definePage(() => ({ title: 'Данные о кино', icon: 'ti ti-heart-handshake' }));
</script>

<style lang="scss" module>
.page { margin-top: 24px; padding: 30px; border-radius: 22px; background: var(--MI_THEME-panel); }
.eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--MI_THEME-accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; }
.page h1 { margin: 0 0 20px; font-size: 2rem; }
.page p { max-width: 600px; line-height: 1.65; color: var(--MI_THEME-fgTransparentWeak); }
.page strong { color: var(--MI_THEME-fg); }
.page a { color: var(--MI_THEME-accent); }
.back { display: inline-flex; align-items: center; gap: 8px; margin-top: 15px; padding: 10px 14px; border-radius: 999px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); font-weight: 700; text-decoration: none; }
@media (max-width: 600px) { .page { margin-top: 12px; padding: 24px 20px; } }
</style>
