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
				<template v-else>
					<section :class="$style.summary" aria-label="Статистика библиотеки">
						<div :class="$style.stat"><i class="ti ti-books"></i><strong>{{ entries.length }}</strong><span>В библиотеке</span></div>
						<div :class="$style.stat"><i class="ti ti-player-play"></i><strong>{{ statusCounts.watching }}</strong><span>Смотрю</span></div>
						<div :class="$style.stat"><i class="ti ti-star-filled"></i><strong>{{ favoriteCount }}</strong><span>В избранном</span></div>
						<div :class="$style.stat"><i class="ti ti-chart-bar"></i><strong>{{ averageRating == null ? '—' : averageRating.toFixed(1) }}</strong><span>Средняя оценка</span></div>
					</section>
					<div :class="$style.filters" role="tablist" aria-label="Статус библиотеки">
						<button v-for="filter in filters" :key="filter" type="button" class="_button" :class="[$style.filter, { [$style.activeFilter]: activeFilter === filter }]" role="tab" :aria-selected="activeFilter === filter" @click="activeFilter = filter">{{ filter === 'all' ? `Все · ${entries.length}` : `${statusLabel(filter)} · ${statusCounts[filter]}` }}</button>
					</div>
					<div v-if="filteredEntries.length === 0" :class="$style.empty"><i class="ti ti-filter-off"></i> В этой категории пока нет тайтлов.</div>
					<div v-else :class="$style.grid">
						<MkA v-for="entry in filteredEntries" :key="entry.work.id" :to="`/zalip/${entry.work.slug}`" :class="$style.card">
						<div :class="$style.poster">
							<img v-if="entry.work.posterPath" :src="tmdbImage(entry.work.posterPath)" :alt="entry.work.title" loading="lazy">
							<i v-else class="ti ti-movie"></i>
						</div>
						<div :class="$style.body">
							<div :class="$style.meta"><span>{{ statusLabel(entry.status) }}</span><span :class="$style.icons"><span v-if="entry.personalRating != null" :class="$style.rating" title="Личная оценка"><i class="ti ti-star-filled"></i>{{ entry.personalRating }}</span><i v-if="entry.isReleaseSubscribed" class="ti ti-bell-filled" title="Отслеживаются новые серии"></i><i v-if="entry.isFavorite" class="ti ti-star-filled" title="В избранном"></i></span></div>
							<h2>{{ entry.work.title }}</h2>
							<p>{{ kindLabel(entry.work.kind) }}<span v-if="entry.work.releaseYear"> · {{ entry.work.releaseYear }}</span><span v-if="entry.episodesWatched"> · {{ entry.episodesWatched }} эп.</span></p>
						</div>
						</MkA>
					</div>
				</template>
			</div>
		</div>
	</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';
type LibraryFilter = LibraryStatus | 'all';

type LibraryEntry = {
	status: LibraryStatus;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	isReleaseSubscribed: boolean;
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
const activeFilter = ref<LibraryFilter>('all');
const filters: LibraryFilter[] = ['all', 'watching', 'planned', 'completed', 'on_hold', 'dropped'];
const filteredEntries = computed(() => activeFilter.value === 'all' ? entries.value : entries.value.filter(entry => entry.status === activeFilter.value));
const favoriteCount = computed(() => entries.value.filter(entry => entry.isFavorite).length);
const ratedEntries = computed(() => entries.value.filter((entry): entry is LibraryEntry & { personalRating: number } => entry.personalRating != null));
const averageRating = computed(() => ratedEntries.value.length === 0 ? null : ratedEntries.value.reduce((sum, entry) => sum + entry.personalRating, 0) / ratedEntries.value.length);
const statusCounts = computed(() => ({
	watching: entries.value.filter(entry => entry.status === 'watching').length,
	planned: entries.value.filter(entry => entry.status === 'planned').length,
	completed: entries.value.filter(entry => entry.status === 'completed').length,
	on_hold: entries.value.filter(entry => entry.status === 'on_hold').length,
	dropped: entries.value.filter(entry => entry.status === 'dropped').length,
}));

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

.summary {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 10px;
	margin-bottom: 18px;
}

.stat {
	display: grid;
	grid-template-columns: auto 1fr;
	align-items: center;
	column-gap: 8px;
	padding: 12px;
	border-radius: 14px;
	background: var(--MI_THEME-panel);
}

.stat i {
	grid-row: span 2;
	color: var(--MI_THEME-accent);
	font-size: 1.2rem;
}

.stat strong {
	font-size: 1.1rem;
	line-height: 1.1;
}

.stat span {
	margin-top: 2px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.7rem;
}

.filters {
	display: flex;
	gap: 8px;
	margin-bottom: 18px;
	overflow-x: auto;
	padding-bottom: 2px;
}

.filter {
	flex: 0 0 auto;
	padding: 8px 11px;
	border-radius: 999px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 700;
}

.activeFilter {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
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

.icons {
	display: inline-flex;
	align-items: center;
	gap: 6px;
}

.rating {
	display: inline-flex;
	align-items: center;
	gap: 2px;
	color: #d99c22;
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
	.summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
