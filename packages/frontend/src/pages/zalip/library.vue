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
						<p :class="$style.eyebrow"><i class="ti ti-bookmark"></i> {{ i18n.ts.zalip.libraryEyebrow }}</p>
						<h1>{{ i18n.ts.zalip.libraryHeading }}</h1>
						<p :class="$style.description">{{ i18n.ts.zalip.libraryDescription }}</p>
					</div>
					<MkA to="/catalog" :class="$style.browse"><i class="ti ti-search"></i> {{ i18n.ts.zalip.libraryBrowse }}</MkA>
				</div>

				<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> {{ i18n.ts.zalip.libraryLoading }}</div>
				<div v-else-if="loadError"><p role="alert">{{ i18n.ts.zalip.libraryLoadFailed }}</p><MkError @retry="loadLibrary"/></div>
				<div v-else-if="entries.length === 0" :class="$style.empty">
					<i class="ti ti-bookmark-off"></i>
					<strong>{{ i18n.ts.zalip.libraryEmptyTitle }}</strong>
					<span>{{ i18n.ts.zalip.libraryEmptyDescription }}</span>
					<MkA to="/catalog" :class="$style.start">{{ i18n.ts.zalip.libraryGoToCatalogue }}</MkA>
				</div>
				<template v-else>
					<section :class="$style.summary" :aria-label="i18n.ts.zalip.libraryStats">
						<div :class="$style.stat"><i class="ti ti-books"></i><strong>{{ entries.length }}</strong><span>{{ i18n.ts.zalip.libraryTotal }}</span></div>
						<div :class="$style.stat"><i class="ti ti-player-play"></i><strong>{{ statusCounts.watching }}</strong><span>{{ i18n.ts.zalip.libraryWatching }}</span></div>
						<div :class="$style.stat"><i class="ti ti-star-filled"></i><strong>{{ favoriteCount }}</strong><span>{{ i18n.ts.zalip.libraryFavorites }}</span></div>
						<div :class="$style.stat"><i class="ti ti-chart-bar"></i><strong>{{ averageRating == null ? '—' : averageRating.toFixed(1) }}</strong><span>{{ i18n.ts.zalip.libraryAverageRating }}</span></div>
					</section>
					<section v-if="continueEntries.length" :class="$style.continueSection">
						<div :class="$style.sectionHeading"><h2>{{ i18n.ts.zalip.libraryContinue }}</h2><span>{{ continueEntries.length }}</span></div>
						<div :class="$style.continueRail">
							<MkA v-for="entry in continueEntries" :key="entry.work.id" :to="`/zalip/${entry.work.slug}`" :class="$style.continueCard">
								<img v-if="entry.work.posterPath" :src="tmdbImage(entry.work.posterPath)" :alt="entry.work.title" loading="lazy">
								<i v-else class="ti ti-movie"></i>
								<span>{{ entry.work.title }}</span><small v-if="entry.episodesWatched">{{ i18n.tsx.zalip.libraryEpisodesWatched({ count: entry.episodesWatched.toString() }) }}</small>
							</MkA>
						</div>
					</section>
					<div :class="$style.controls">
						<label :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model.trim="searchQuery" class="_input" type="search" :placeholder="i18n.ts.zalip.librarySearch" :aria-label="i18n.ts.zalip.librarySearch"></label>
						<label :class="$style.sort"><i class="ti ti-arrows-sort"></i><select v-model="sortOrder" class="_input" :aria-label="i18n.ts.zalip.librarySort"><option value="recent">{{ i18n.ts.zalip.librarySortRecent }}</option><option value="title">{{ i18n.ts.zalip.librarySortTitle }}</option><option value="rating">{{ i18n.ts.zalip.librarySortRating }}</option></select></label>
					</div>
					<div :class="$style.filters" role="tablist" :aria-label="i18n.ts.zalip.libraryStatus">
						<button v-for="filter in filters" :key="filter" type="button" class="_button" :class="[$style.filter, { [$style.activeFilter]: activeFilter === filter }]" role="tab" :aria-selected="activeFilter === filter" @click="activeFilter = filter">{{ filter === 'all' ? `${i18n.ts.zalip.libraryAll} · ${entries.length}` : `${statusLabel(filter)} · ${statusCounts[filter]}` }}</button>
					</div>
					<div v-if="filteredEntries.length === 0" :class="$style.empty"><i class="ti ti-filter-off"></i> {{ i18n.ts.zalip.libraryEmptyFilter }}</div>
					<div v-else :class="$style.grid">
						<MkA v-for="entry in filteredEntries" :key="entry.work.id" :to="`/zalip/${entry.work.slug}`" :class="$style.card">
						<div :class="$style.poster">
							<img v-if="entry.work.posterPath" :src="tmdbImage(entry.work.posterPath)" :alt="entry.work.title" loading="lazy">
							<i v-else class="ti ti-movie"></i>
						</div>
						<div :class="$style.body">
							<div :class="$style.meta"><span>{{ statusLabel(entry.status) }}</span><span :class="$style.icons"><span v-if="entry.personalRating != null" :class="$style.rating" :title="i18n.ts.zalip.libraryPersonalRating"><i class="ti ti-star-filled"></i>{{ entry.personalRating }}</span><i v-if="entry.isReleaseSubscribed" class="ti ti-bell-filled" :title="i18n.ts.zalip.libraryReleaseSubscribed"></i><i v-if="entry.isFavorite" class="ti ti-star-filled" :title="i18n.ts.zalip.libraryFavorite"></i></span></div>
							<h2>{{ entry.work.title }}</h2>
							<p>{{ kindLabel(entry.work.kind) }}<span v-if="entry.work.releaseYear"> · {{ entry.work.releaseYear }}</span><span v-if="entry.episodesWatched"> · {{ i18n.tsx.zalip.libraryEpisodesWatched({ count: entry.episodesWatched.toString() }) }}</span></p>
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
import { i18n } from '@/i18n.js';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';
type LibraryFilter = LibraryStatus | 'all';
type LibrarySort = 'recent' | 'title' | 'rating';

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
const loadError = ref(false);
const activeFilter = ref<LibraryFilter>('all');
const searchQuery = ref('');
const sortOrder = ref<LibrarySort>('recent');
const filters: LibraryFilter[] = ['all', 'watching', 'planned', 'completed', 'on_hold', 'dropped'];
const filteredEntries = computed(() => {
	const normalizedQuery = searchQuery.value.toLocaleLowerCase('ru');
	const filtered = entries.value.filter(entry => (activeFilter.value === 'all' || entry.status === activeFilter.value)
		&& (!normalizedQuery || entry.work.title.toLocaleLowerCase('ru').includes(normalizedQuery)));
	if (sortOrder.value === 'title') return [...filtered].sort((left, right) => left.work.title.localeCompare(right.work.title, 'ru'));
	if (sortOrder.value === 'rating') return [...filtered].sort((left, right) => (right.personalRating ?? -1) - (left.personalRating ?? -1));
	return filtered;
});
const continueEntries = computed(() => entries.value.filter(entry => entry.status === 'watching').slice(0, 8));
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
	return ({ movie: i18n.ts.zalip.catalogueKindMovie, series: i18n.ts.zalip.catalogueKindSeries, anime: i18n.ts.zalip.catalogueKindAnime, animation: i18n.ts.zalip.catalogueKindAnimation })[kind];
}

function statusLabel(status: LibraryStatus): string {
	return ({ watching: i18n.ts.zalip.libraryWatching, planned: i18n.ts.zalip.libraryPlanned, completed: i18n.ts.zalip.libraryCompleted, on_hold: i18n.ts.zalip.libraryOnHold, dropped: i18n.ts.zalip.libraryDropped })[status];
}

async function loadLibrary(): Promise<void> {
	pending.value = true;
	loadError.value = false;
	try {
		entries.value = await misskeyApiZalip<LibraryEntry[]>('zalip/library/list');
	} catch {
		loadError.value = true;
	} finally {
		pending.value = false;
	}
}

onMounted(loadLibrary);

definePage(() => ({
	title: i18n.ts.zalip.libraryHeading,
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

.description {
	max-width: 620px;
	margin: 8px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
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

.continueSection {
	margin: 0 0 22px;
}

.sectionHeading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 10px;
}

.sectionHeading h2 {
	margin: 0;
	font-size: 1.05rem;
}

.sectionHeading span {
	display: grid;
	place-items: center;
	min-width: 24px;
	height: 24px;
	border-radius: 999px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.73rem;
	font-weight: 750;
}

.continueRail {
	display: flex;
	gap: 10px;
	overflow-x: auto;
	padding: 2px;
	scrollbar-width: none;
}

.continueRail::-webkit-scrollbar { display: none; }

.continueCard {
	position: relative;
	display: grid;
	grid-template-columns: 46px minmax(126px, 1fr);
	grid-template-rows: min-content min-content;
	gap: 3px 10px;
	flex: 0 0 210px;
	overflow: hidden;
	min-height: 66px;
	padding: 9px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	text-decoration: none;
}

.continueCard img, .continueCard > i {
	grid-row: span 2;
	width: 46px;
	height: 62px;
	border-radius: 8px;
	object-fit: cover;
	background: var(--MI_THEME-panelHighlight);
}

.continueCard > i { display: grid; place-items: center; color: var(--MI_THEME-accent); }
.continueCard span { align-self: end; overflow: hidden; font-size: 0.82rem; font-weight: 750; line-height: 1.22; text-overflow: ellipsis; white-space: nowrap; }
.continueCard small { color: var(--MI_THEME-fgTransparentWeak); font-size: 0.72rem; }

.controls {
	display: flex;
	gap: 10px;
	margin-bottom: 12px;
}

.search, .sort {
	display: flex;
	align-items: center;
	gap: 8px;
	height: 42px;
	box-sizing: border-box;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
}

.search { flex: 1; min-width: 0; padding-inline: 12px; }
.search input { min-width: 0; width: 100%; border: 0; background: transparent; color: var(--MI_THEME-fg); }
.sort { padding-left: 11px; }
.sort select { height: 100%; border: 0; background: transparent; color: var(--MI_THEME-fg); font-weight: 650; }

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
	color: var(--MI_THEME-warn);
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
	.heading { flex-wrap: wrap; }
	.heading > div { min-width: 0; }
	.description { display: none; }
	.browse { font-size: 0.8rem; }
	.summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	.controls { gap: 7px; }
	.sort { max-width: 144px; }
	.sort select { max-width: 110px; }
}
</style>
