<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="refreshLibrary">
		<MkZalipSectionHeader :title="props.filter === 'favorites' ? i18n.ts.zalip.bookmarksHeading : i18n.ts.zalip.libraryHeading" :description="props.filter === 'favorites' ? i18n.ts.zalip.bookmarksDescription : i18n.ts.zalip.libraryDescription"/>
		<MkZalipBookmarkTabs active="content"/>
		<div class="_spacer" style="--MI_SPACER-w: 980px;">
			<div :class="$style.page">
				<ZalipContinueRail v-show="activeFilter === 'all' && !searchQuery" ref="continueRail"/>
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
						<button type="button" class="_button" :class="$style.stat" @click="activeFilter = 'favorites'"><i class="ti ti-bookmark"></i><strong>{{ favoriteCount }}</strong><span>{{ i18n.ts.zalip.contentBookmarks }}</span></button>
						<div :class="$style.stat"><i class="ti ti-chart-bar"></i><strong>{{ averageRating == null ? '—' : averageRating.toFixed(1) }}</strong><span>{{ i18n.ts.zalip.libraryAverageRating }}</span></div>
					</section>
					<div :class="$style.controls">
						<label :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model.trim="searchQuery" class="_input" type="search" :placeholder="i18n.ts.zalip.librarySearch" :aria-label="i18n.ts.zalip.librarySearch"></label>
						<label :class="$style.sort"><i class="ti ti-arrows-sort"></i><select v-model="sortOrder" class="_input" :aria-label="i18n.ts.zalip.librarySort"><option value="recent">{{ i18n.ts.zalip.librarySortRecent }}</option><option value="title">{{ i18n.ts.zalip.librarySortTitle }}</option><option value="rating">{{ i18n.ts.zalip.librarySortRating }}</option></select></label>
					</div>
					<div :class="$style.filters" role="group" :aria-label="i18n.ts.zalip.libraryStatus">
						<button v-for="filter in filters" :key="filter" type="button" class="_button" :class="[$style.filter, { [$style.activeFilter]: activeFilter === filter }]" :aria-pressed="activeFilter === filter" @click="activeFilter = filter">{{ filterLabel(filter) }} · {{ filterCount(filter) }}</button>
					</div>
					<div :class="$style.viewControls"><span>{{ i18n.tsx.zalip.libraryResultCount({ count: filteredEntries.length }) }}</span><div role="group" :aria-label="i18n.ts.zalip.catalogueView"><button type="button" class="_button" :aria-label="i18n.ts.zalip.catalogueTiles" :aria-pressed="viewMode === 'tiles'" @click="viewMode = 'tiles'"><i class="ti ti-layout-grid" aria-hidden="true"></i></button><button type="button" class="_button" :aria-label="i18n.ts.zalip.catalogueCards" :aria-pressed="viewMode === 'cards'" @click="viewMode = 'cards'"><i class="ti ti-list-details" aria-hidden="true"></i></button></div></div>
					<div v-if="filteredEntries.length === 0" :class="$style.empty"><i class="ti ti-filter-off"></i> {{ i18n.ts.zalip.libraryEmptyFilter }}</div>
					<div v-else :class="[$style.grid, { [$style.listView]: viewMode === 'cards' }]">
						<MkA v-for="entry in filteredEntries" :key="entry.work.id" :to="`/zalip/${entry.work.slug}`" :class="$style.card">
							<div :class="$style.poster">
								<img v-if="entry.work.posterPath" :src="tmdbImage(entry.work.posterPath)" :alt="entry.work.title" loading="lazy">
								<i v-else class="ti ti-movie"></i>
								<span v-if="entry.status" :class="$style.statusBadge"><i :class="statusIcon(entry.status)" aria-hidden="true"></i>{{ statusLabel(entry.status) }}</span>
							</div>
							<div :class="$style.body">
								<h2>{{ entry.work.title }}</h2>
								<p>{{ kindLabel(entry.work.kind) }}<span v-if="entry.work.releaseYear"> · {{ entry.work.releaseYear }}</span></p>
								<div :class="$style.meta"><span v-if="entry.episodesWatched">{{ i18n.tsx.zalip.libraryEpisodesWatched({ count: entry.episodesWatched.toString() }) }}</span><span :class="$style.icons"><span v-if="entry.personalRating != null" :class="$style.rating" :title="i18n.ts.zalip.libraryPersonalRating"><i class="ti ti-star-filled" aria-hidden="true"></i>{{ entry.personalRating }}</span><i v-if="entry.isReleaseSubscribed" class="ti ti-bell" :title="i18n.ts.zalip.libraryReleaseSubscribed" :aria-label="i18n.ts.zalip.libraryReleaseSubscribed"></i><i v-if="entry.isFavorite" class="ti ti-bookmark" :title="i18n.ts.zalip.inBookmarks" :aria-label="i18n.ts.zalip.inBookmarks"></i></span></div>
								<p v-if="viewMode === 'cards' && entry.work.description" :class="$style.synopsis">{{ entry.work.description }}</p>
							</div>
						</MkA>
					</div>
				</template>
			</div>
		</div>
	</component>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef, watch } from 'vue';
import { useZalipPageReload } from '@/composables/use-zalip-page-reload.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import MkZalipSectionHeader from '@/components/MkZalipSectionHeader.vue';
import MkZalipBookmarkTabs from '@/components/MkZalipBookmarkTabs.vue';
import { prefer } from '@/preferences.js';
import { miLocalStorage } from '@/local-storage.js';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { importerImageUrl } from '@/utility/zalip-importer.js';
import { i18n } from '@/i18n.js';
import ZalipContinueRail from '@/pages/zalip/continue-rail.vue';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';
type LibraryFilter = LibraryStatus | 'all' | 'favorites' | 'subscribed' | 'rated';
type LibrarySort = 'recent' | 'title' | 'rating';

type LibraryEntry = {
	status: LibraryStatus | null;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	isReleaseSubscribed: boolean;
	work: {
		id: string;
		slug: string;
		kind: WorkKind;
		title: string;
		description?: string | null;
		releaseYear: number | null;
		posterPath: string | null;
	};
};

const props = defineProps<{ filter?: string }>();
const continueRail = useTemplateRef('continueRail');
const entries = ref<LibraryEntry[]>([]);
const pending = ref(true);
const loadError = ref(false);
let latestRequest = 0;
const activeFilter = ref<LibraryFilter>('all');
const searchQuery = ref('');
const sortOrder = ref<LibrarySort>('recent');
const filters: LibraryFilter[] = ['all', 'favorites', 'watching', 'planned', 'completed', 'on_hold', 'dropped', 'subscribed', 'rated'];
const viewMode = ref<'tiles' | 'cards'>(miLocalStorage.getItem('zalipLibraryView') === 'cards' ? 'cards' : 'tiles');
watch(viewMode, value => miLocalStorage.setItem('zalipLibraryView', value));
watch(() => props.filter, value => { activeFilter.value = filters.includes(value as LibraryFilter) ? value as LibraryFilter : 'all'; }, { immediate: true });

function matchesFilter(entry: LibraryEntry, filter: LibraryFilter): boolean {
	if (filter === 'all') return true;
	if (filter === 'favorites') return entry.isFavorite;
	if (filter === 'subscribed') return entry.isReleaseSubscribed;
	if (filter === 'rated') return entry.personalRating != null;
	return entry.status === filter;
}

function filterCount(filter: LibraryFilter): number { return entries.value.filter(entry => matchesFilter(entry, filter)).length; }

function filterLabel(filter: LibraryFilter): string {
	if (filter === 'all') return i18n.ts.zalip.libraryAll;
	if (filter === 'favorites') return i18n.ts.zalip.libraryBookmarks;
	if (filter === 'subscribed') return i18n.ts.zalip.librarySubscriptions;
	if (filter === 'rated') return i18n.ts.zalip.libraryRated;
	return statusLabel(filter);
}

function statusIcon(status: LibraryStatus): string { return ({ watching: 'ti ti-eye', planned: 'ti ti-bookmark', completed: 'ti ti-check', on_hold: 'ti ti-player-pause', dropped: 'ti ti-x' })[status]; }

const filteredEntries = computed(() => {
	const normalizedQuery = searchQuery.value.toLocaleLowerCase('ru');
	const filtered = entries.value.filter(entry => matchesFilter(entry, activeFilter.value)
		&& (!normalizedQuery || entry.work.title.toLocaleLowerCase('ru').includes(normalizedQuery)));
	if (sortOrder.value === 'title') return [...filtered].sort((left, right) => left.work.title.localeCompare(right.work.title, 'ru'));
	if (sortOrder.value === 'rating') return [...filtered].sort((left, right) => (right.personalRating ?? -1) - (left.personalRating ?? -1));
	return filtered;
});
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

function tmdbImage(path: string): string | undefined {
	return importerImageUrl(path) ?? undefined;
}

function kindLabel(kind: WorkKind): string {
	return ({ movie: i18n.ts.zalip.catalogueKindMovie, series: i18n.ts.zalip.catalogueKindSeries, anime: i18n.ts.zalip.catalogueKindAnime, animation: i18n.ts.zalip.catalogueKindAnimation })[kind];
}

function statusLabel(status: LibraryStatus | null): string {
	if (status == null) return i18n.ts.zalip.libraryNoStatus;
	return ({ watching: i18n.ts.zalip.libraryWatching, planned: i18n.ts.zalip.libraryPlanned, completed: i18n.ts.zalip.libraryCompleted, on_hold: i18n.ts.zalip.libraryOnHold, dropped: i18n.ts.zalip.libraryDropped })[status];
}

async function loadLibrary(): Promise<void> {
	const request = ++latestRequest;
	pending.value = true;
	loadError.value = false;
	try {
		const library = await misskeyApiZalip<LibraryEntry[]>('zalip/library/list');
		if (request === latestRequest) entries.value = library.filter(entry => entry.status != null || entry.isFavorite || entry.isReleaseSubscribed || entry.personalRating != null || entry.episodesWatched > 0);
	} catch {
		if (request === latestRequest) loadError.value = true;
	} finally {
		if (request === latestRequest) pending.value = false;
	}
}

async function refreshLibrary(): Promise<void> { await Promise.all([loadLibrary(), continueRail.value?.refresh()]); }

useZalipPageReload(loadLibrary);

definePage(() => ({
	title: props.filter === 'favorites' ? i18n.ts.zalip.bookmarksHeading : i18n.ts.zalip.libraryHeading,
	icon: 'ti ti-bookmark',
}));
</script>

<style lang="scss" module>
.page {
	padding: 24px var(--MI-margin) 52px;
}

.start {
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
	grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
	gap: 22px 14px;
}
.viewControls { display: flex; align-items: center; justify-content: space-between; margin: 0 0 16px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.viewControls > div { display: flex; border-radius: 99px; background: var(--MI_THEME-panelHighlight); padding: 3px; }
.viewControls button { display: grid; place-items: center; width: 38px; height: 36px; border-radius: 99px; font-size: 20px; }
.viewControls button[aria-pressed=true] { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.viewControls i::before, .icons i::before { font-size: 1em; }
.listView { grid-template-columns: 1fr; gap: 22px; }
.listView .card { display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 18px; }
.listView .body { padding: 2px 0; }
.listView .body h2 { margin-top: 0; font-size: 17px; -webkit-line-clamp: 3; }
.body .synopsis { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; margin-top: 10px; font-size: 13px; line-height: 1.6; }
.statusBadge { position: absolute; bottom: 7px; left: 5px; right: 5px; display: flex; align-items: center; justify-content: center; gap: 4px; padding: 4px 3px; box-sizing: border-box; border-radius: 99px; background: color-mix(in srgb, var(--MI_THEME-accent) 88%, transparent); color: var(--MI_THEME-fgOnAccent); font-size: 10px; line-height: 1.25; font-weight: 650; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.statusBadge i::before { font-size: 1em; }

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
	min-width: 0;
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: transform 0.2s ease;
}

.card:hover {
	transform: translateY(-3px);
}

.poster {
	position: relative;
	overflow: hidden;
	border-radius: 14px;
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
	padding: 0;
}

.meta {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
	color: var(--MI_THEME-accent);
	font-size: 0.75rem;
	font-weight: 700;
	margin-top: 6px;
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
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	overflow: hidden;
	font-size: 0.85rem;
	line-height: 1.25;
}

.body p {
	margin: 0;
	font-size: 0.78rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

@media (max-width: 600px) {
	.page { padding: 12px 0 32px; }
	.summary { display: none; }
	.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 10px; }
	.listView { grid-template-columns: 1fr; }
	.listView .card { grid-template-columns: minmax(88px, 29%) minmax(0, 1fr); gap: 14px; }
	.body h2 { font-size: 12px; }
	.body p, .meta { font-size: 10px; }
	.controls { gap: 7px; }
	.sort { max-width: 144px; }
	.sort select { max-width: 110px; }
}
</style>
