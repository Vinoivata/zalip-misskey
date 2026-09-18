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
		<p :class="$style.meta"><i :class="kindIcon"></i>{{ kindLabel }}<span v-if="share.releaseYear != null"> · {{ share.releaseYear }}</span></p>
		<strong :class="$style.title">{{ share.title }}</strong>
		<p v-if="share.genres.length" :class="$style.genres">{{ share.genres.slice(0, 3).join(' · ') }}</p>
		<p v-if="share.description" :class="$style.description">{{ share.description }}</p>
		<span :class="$style.open"><i class="ti ti-player-play"></i> Открыть тайтл</span>
	</div>
</MkA>
</template>

<script lang="ts" setup>
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

const kindLabel = ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[props.share.kind];
const kindIcon = ({ movie: 'ti ti-movie', series: 'ti ti-device-tv', anime: 'ti ti-sparkles', animation: 'ti ti-mood-smile' })[props.share.kind];

function posterUrl(path: string): string {
	return `https://image.tmdb.org/t/p/w342${path}`;
}
</script>

<style lang="scss" module>
.card {
	display: grid;
	grid-template-columns: 92px minmax(0, 1fr);
	gap: 0;
	margin-top: 12px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
	background: linear-gradient(135deg, color-mix(in srgb, var(--MI_THEME-panel) 94%, var(--MI_THEME-accent) 6%), var(--MI_THEME-panel));
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: border-color 0.15s ease, transform 0.15s ease;

	&:hover {
		border-color: color-mix(in srgb, var(--MI_THEME-accent) 52%, var(--MI_THEME-divider));
		transform: translateY(-1px);
	}
}

.preview {
	margin: 12px 16px 2px;
	pointer-events: none;
}

.poster {
	position: relative;
	display: grid;
	min-height: 138px;
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
	padding: 13px 14px 12px;
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
	color: var(--MI_THEME-accent);
	font-size: 0.78em;
	font-weight: 700;
}

.title {
	display: block;
	margin-top: 4px;
	font-size: 1.03em;
	line-height: 1.3;
}

.genres {
	margin-top: 4px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78em;
}

.description {
	display: -webkit-box;
	margin-top: 8px;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	color: var(--MI_THEME-fgTransparent);
	font-size: 0.84em;
	line-height: 1.35;
}

.open {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	margin-top: 10px;
	color: var(--MI_THEME-accent);
	font-size: 0.8em;
	font-weight: 700;
}

@container (max-width: 360px) {
	.card {
		grid-template-columns: 76px minmax(0, 1fr);
	}

	.poster {
		min-height: 118px;
	}

	.description {
		-webkit-line-clamp: 1;
	}
}
</style>
