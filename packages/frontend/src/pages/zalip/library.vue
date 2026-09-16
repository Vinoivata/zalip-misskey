<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<PageWithHeader>
		<div class="_spacer" style="--MI_SPACER-w: 980px;">
			<div :class="$style.page">
				<div :class="$style.heading">
					<div>
						<p :class="$style.eyebrow"><i class="ti ti-bookmark"></i> МОЯ БИБЛИОТЕКА</p>
						<h1>Сохранённое</h1>
					</div>
					<MkA to="/" :class="$style.browse"><i class="ti ti-search"></i> Найти тайтл</MkA>
				</div>

				<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Загружаем библиотеку…</div>
				<div v-else-if="entries.length === 0" :class="$style.empty">
					<i class="ti ti-bookmark-off"></i>
					<strong>Здесь пока пусто</strong>
					<span>Добавляйте фильмы, сериалы и аниме — это сохранится в вашем обычном аккаунте Misskey.</span>
					<MkA to="/" :class="$style.start">Перейти к каталогу</MkA>
				</div>
				<div v-else :class="$style.grid">
					<MkA v-for="entry in entries" :key="entry.work.id" :to="`/zalip/${entry.work.slug}`" :class="$style.card">
						<div :class="$style.poster">
							<img v-if="entry.work.posterPath" :src="tmdbImage(entry.work.posterPath)" :alt="entry.work.title" loading="lazy">
							<i v-else class="ti ti-movie"></i>
						</div>
						<div :class="$style.body">
							<div :class="$style.meta"><span>{{ statusLabel(entry.status) }}</span><i v-if="entry.isFavorite" class="ti ti-star-filled"></i></div>
							<h2>{{ entry.work.title }}</h2>
							<p>{{ kindLabel(entry.work.kind) }}<span v-if="entry.work.releaseYear"> · {{ entry.work.releaseYear }}</span></p>
						</div>
					</MkA>
				</div>
			</div>
		</div>
	</PageWithHeader>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';

type LibraryEntry = {
	status: LibraryStatus;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	work: {
		id: string;
		slug: string;
		kind: WorkKind;
		title: string;
		releaseYear: number | null;
		posterPath: string | null;
	};
};

const entries = ref<LibraryEntry[]>([]);
const pending = ref(true);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: WorkKind): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

function statusLabel(status: LibraryStatus): string {
	return ({
		watching: 'Смотрю',
		planned: 'В планах',
		completed: 'Просмотрено',
		on_hold: 'Отложено',
		dropped: 'Брошено',
	})[status];
}

onMounted(async () => {
	try {
		entries.value = await misskeyApiZalip<LibraryEntry[]>('zalip/library/list');
	} finally {
		pending.value = false;
	}
});

definePage(() => ({
	title: 'Библиотека',
	icon: 'ti ti-bookmark',
}));
</script>

<style lang="scss" module>
.page {
	padding: 24px var(--MI-margin) 52px;
}

.heading {
	display: flex;
	align-items: end;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 24px;
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 7px;
	margin: 0 0 8px;
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--MI_THEME-accent);
}

.heading h1 {
	margin: 0;
	font-size: 2rem;
}

.browse, .start {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-radius: 999px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
	font-weight: 700;
	text-decoration: none;
}

.empty {
	display: grid;
	justify-items: center;
	gap: 10px;
	padding: 52px 22px;
	border: 1px dashed var(--MI_THEME-divider);
	border-radius: 20px;
	text-align: center;
	color: var(--MI_THEME-fgTransparentWeak);
}

.empty i {
	font-size: 2rem;
	color: var(--MI_THEME-accent);
}

.empty strong {
	color: var(--MI_THEME-fg);
}

.start {
	margin-top: 8px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(165px, 1fr));
	gap: 14px;
}

.card {
	overflow: hidden;
	border-radius: 16px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: transform 0.2s ease;
}

.card:hover {
	transform: translateY(-3px);
}

.poster {
	display: grid;
	place-items: center;
	aspect-ratio: 2 / 3;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-accent);
	font-size: 2rem;
}

.poster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.body {
	padding: 12px;
}

.meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	color: var(--MI_THEME-accent);
	font-size: 0.75rem;
	font-weight: 700;
}

.body h2 {
	margin: 7px 0 5px;
	font-size: 0.95rem;
	line-height: 1.25;
}

.body p {
	margin: 0;
	font-size: 0.78rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

@media (max-width: 600px) {
	.page { padding-top: 12px; }
	.heading { align-items: start; }
	.browse { font-size: 0.8rem; }
	.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
