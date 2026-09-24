<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkA :to="`/zalip/${share.slug}`" :class="[$style.card, { [$style.preview]: preview }]">
	<div :class="$style.poster">
		<img v-if="share.posterPath" :src="posterUrl(share.posterPath)" alt="" loading="lazy">
		<i v-else class="ti ti-movie"></i>
	</div>
	<div :class="$style.body">
		<strong :class="$style.title">{{ share.title }}</strong>
		<p :class="$style.meta"><i :class="kindIcon"></i>{{ kindLabel }}<span v-if="share.releaseYear != null"> · {{ share.releaseYear }}</span></p>
		<p v-if="share.genres.length" :class="$style.genres">{{ share.genres.slice(0, 3).join(' · ') }}</p>
		<p v-if="share.description" :class="$style.description">{{ share.description }}</p>
	</div>
</MkA>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import { i18n } from '@/i18n.js';
type ZalipShare = {
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	description: string | null;
	releaseYear: number | null;
	genres: string[];
	posterPath: string | null;
};

const props = defineProps<{
	share: ZalipShare;
	preview?: boolean;
}>();

const kindLabel = computed(() => ({ movie: i18n.ts.zalip.searchMovies, series: i18n.ts.zalip.searchSeries, anime: i18n.ts.zalip.searchAnime, animation: i18n.ts.zalip.searchAnimation })[props.share.kind]);
const kindIcon = computed(() => ({ movie: 'ti ti-movie', series: 'ti ti-device-tv', anime: 'ti ti-sparkles', animation: 'ti ti-mood-smile' })[props.share.kind]);

function posterUrl(path: string): string {
	return `https://image.tmdb.org/t/p/w342${path}`;
}
</script>

<style lang="scss" module>
.card {
	display: grid;
	grid-template-columns: 88px minmax(0, 1fr);
	gap: 0;
	padding: 0;
	margin-top: 10px;
	overflow: hidden;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 78%, transparent);
	border-radius: 14px;
	background: var(--zalip-social-raised);
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: border-color 0.15s ease;

	&:hover {
		border-color: color-mix(in srgb, var(--MI_THEME-accent) 42%, var(--MI_THEME-divider));
		background: color-mix(in srgb, var(--MI_THEME-panelHighlight) 64%, var(--MI_THEME-panel));
		text-decoration: none;
	}
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
}

.preview {
	margin: 12px 16px 2px;
	pointer-events: none;
}

.poster {
	position: relative;
	display: grid;
	align-self: stretch;
	aspect-ratio: 2 / 3;
	border-radius: 0;
	place-items: center;
	overflow: hidden;
	background: color-mix(in srgb, var(--MI_THEME-accent) 18%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
	font-size: 28px;

	img {
		width: 100%;
		height: 100%;
		position: absolute;
		inset: 0;
		object-fit: cover;
	}
}

.body {
	min-width: 0;
	padding: 12px 14px;
}

.meta,
.genres,
.description {
	margin: 0;
}

.meta {
	display: flex;
	align-items: center;
	gap: 5px;
	flex-wrap: wrap;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 12px;
	font-weight: 500;
	margin-top: 6px;
}

.title {
	display: block;
	margin-top: 3px;
	font-size: 16px;
	line-height: 1.3;
	overflow-wrap: anywhere;
}

.genres {
	display: none;
	margin-top: 4px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 12px;
	line-height: 1.4;
}

.description {
	display: -webkit-box;
	margin-top: 6px;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	color: var(--MI_THEME-fgTransparent);
	font-size: 13px;
	line-height: 1.5;
}

.open {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-top: 8px;
	color: var(--MI_THEME-accent);
	font-size: 12px;
	font-weight: 500;
}

@container (max-width: 360px) {
	.card {
		grid-template-columns: 72px minmax(0, 1fr);
		gap: 0;
		padding: 0;
	}

	.description {
		-webkit-line-clamp: 2;
	}
}
</style>
