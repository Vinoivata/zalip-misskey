<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div :class="$style.viewport">
		<main :class="$style.page">
			<header :class="$style.heading">
				<div>
					<p :class="$style.eyebrow"><i class="ti ti-layout-grid"></i> {{ i18n.ts.zalip.catalogueEyebrow }}</p>
					<h1>{{ i18n.ts.zalip.catalogueHeading }}</h1>
					<p>{{ i18n.ts.zalip.catalogueDescription }}</p>
					<div :class="$style.categoryTabs" role="group" :aria-label="i18n.ts.zalip.catalogueKinds">
						<button type="button" class="_button" :class="{ [$style.categoryActive]: selectedKinds.length === 0 }" :aria-pressed="selectedKinds.length === 0" @click="selectCategory()">{{ i18n.ts.zalip.catalogueAllKinds }}</button>
						<button v-for="kind in kinds" :key="kind" type="button" class="_button" :class="{ [$style.categoryActive]: selectedKinds.length === 1 && selectedKinds[0] === kind }" :aria-pressed="selectedKinds.length === 1 && selectedKinds[0] === kind" @click="selectCategory(kind)">{{ kindLabel(kind) }}</button>
					</div>
				</div>
				<form :class="$style.search" @submit.prevent="applySearch">
					<i class="ti ti-search"></i>
					<input v-model.trim="queryInput" class="_input" type="search" minlength="2" maxlength="100" :placeholder="i18n.ts.zalip.catalogueSearchPlaceholder" :aria-label="i18n.ts.zalip.catalogueSearchLabel">
					<button v-if="queryInput" type="button" class="_button" :aria-label="i18n.ts.zalip.catalogueClearSearch" @click="clearSearch"><i class="ti ti-x"></i></button>
					<button type="submit" class="_button">{{ i18n.ts.zalip.catalogueSubmitSearch }}</button>
				</form>
			</header>

			<div :class="$style.catalogueLayout">
				<aside id="catalogue-filters" ref="filtersPanel" tabindex="-1" :class="[$style.filters, { [$style.filtersOpen]: filtersOpen }]" :aria-label="i18n.ts.zalip.catalogueFiltersLabel">
					<div :class="$style.filtersHeading">
						<div><p>{{ i18n.ts.zalip.catalogueFilters }}</p><strong>{{ i18n.ts.zalip.catalogueRefine }}</strong></div>
						<button v-if="activeFilterCount" type="button" class="_button" :class="$style.reset" :aria-label="i18n.ts.zalip.catalogueReset" @click="resetFilters"><i class="ti ti-refresh"></i><span>{{ i18n.ts.zalip.catalogueReset }}</span></button>
						<button type="button" class="_button" :class="$style.closeFilters" :aria-label="i18n.ts.zalip.catalogueCloseFilters" @click="closeFilters"><i class="ti ti-x"></i></button>
					</div>

					<section :class="$style.filterSection">
						<div :class="$style.filterLabel"><span>{{ i18n.ts.zalip.catalogueKinds }}</span><small>{{ selectedKinds.length ? i18n.tsx.zalip.catalogueSelected({ count: selectedKinds.length.toString() }) : i18n.ts.zalip.catalogueAllTypes }}</small></div>
						<div :class="$style.kindGrid">
							<button v-for="kind in kinds" :key="kind" type="button" class="_button" :class="[$style.kindOption, { [$style.optionActive]: selectedKinds.includes(kind) }]" :aria-pressed="selectedKinds.includes(kind)" @click="toggleKind(kind)"><i :class="kindIcon(kind)"></i>{{ kindLabel(kind) }}</button>
						</div>
					</section>

					<section :class="$style.filterSection">
						<div :class="$style.filterLabel"><span>{{ i18n.ts.zalip.catalogueYear }}</span><small>{{ i18n.ts.zalip.catalogueYearHint }}</small></div>
						<form :class="$style.yearRange" @submit.prevent="applyYears">
							<label><span>{{ i18n.ts.zalip.catalogueFrom }}</span><input v-model="yearFromInput" class="_input" type="number" min="1888" max="2200" inputmode="numeric"></label>
							<label><span>{{ i18n.ts.zalip.catalogueTo }}</span><input v-model="yearToInput" class="_input" type="number" min="1888" max="2200" inputmode="numeric"></label>
							<p v-if="yearError" :class="$style.yearError" role="alert">{{ i18n.ts.zalip.catalogueInvalidYears }}</p>
							<button type="submit" class="_button" :class="$style.applyYears">{{ i18n.ts.zalip.catalogueApply }}</button>
						</form>
					</section>

					<section :class="$style.filterSection">
						<div :class="$style.filterLabel"><span>{{ i18n.ts.zalip.catalogueGenres }}</span><small>{{ selectedGenres.length }}/{{ MAX_SELECTED_GENRES }}</small></div>
						<label :class="$style.genreSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model.trim="genreSearch" class="_input" type="search" :aria-label="i18n.ts.zalip.catalogueGenreSearch" :placeholder="i18n.ts.zalip.catalogueGenreSearch"></label>
						<div v-if="genresPending" :class="$style.genreLoading"><i class="ti ti-loader-2 ti-spin"></i> {{ i18n.ts.zalip.catalogueGenresLoading }}</div>
						<button v-else-if="genresError" type="button" class="_button" :class="$style.moreGenres" @click="loadGenres">{{ i18n.ts.zalip.catalogueRetry }}</button>
						<div v-else :class="$style.genreOptions" role="list">
							<button v-for="genre in displayedGenres" :key="genre" type="button" class="_button" :class="[$style.genreOption, { [$style.optionActive]: selectedGenres.includes(genre) }]" :aria-pressed="selectedGenres.includes(genre)" :disabled="!selectedGenres.includes(genre) && selectedGenres.length >= MAX_SELECTED_GENRES" @click="toggleGenre(genre)"><i :class="selectedGenres.includes(genre) ? 'ti ti-check' : 'ti ti-plus'"></i>{{ genre }}</button>
						</div>
						<button v-if="shouldOfferMoreGenres" type="button" class="_button" :class="$style.moreGenres" @click="showAllGenres = !showAllGenres">{{ showAllGenres ? i18n.ts.zalip.catalogueCollapse : i18n.tsx.zalip.catalogueShowMore({ count: (matchingGenres.length - DISPLAYED_GENRES).toString() }) }}<i :class="showAllGenres ? 'ti ti-chevron-up' : 'ti ti-chevron-down'"></i></button>
					</section>
				</aside>

				<section :class="$style.results" aria-live="polite">
					<div :class="$style.toolbar">
						<div>
							<p :class="$style.eyebrow">{{ i18n.ts.zalip.catalogueEyebrow }}</p>
							<h2>{{ resultHeading }}</h2>
						</div>
						<div :class="$style.toolbarActions">
							<div :class="$style.viewSwitch" role="group" :aria-label="i18n.ts.zalip.catalogueView">
								<button type="button" class="_button" :aria-label="i18n.ts.zalip.catalogueTiles" :title="i18n.ts.zalip.catalogueTiles" :aria-pressed="viewMode === 'tiles'" @click="setView('tiles')"><i class="ti ti-layout-grid"></i></button>
								<button type="button" class="_button" :aria-label="i18n.ts.zalip.catalogueCards" :title="i18n.ts.zalip.catalogueCards" :aria-pressed="viewMode === 'cards'" @click="setView('cards')"><i class="ti ti-list-details"></i></button>
							</div>
							<label :class="$style.sort"><i class="ti ti-arrows-sort"></i><select v-model="sortInput" class="_input" :aria-label="i18n.ts.zalip.catalogueSort" @change="applySort"><option value="newest">{{ i18n.ts.zalip.catalogueSortNewest }}</option><option value="year-desc">{{ i18n.ts.zalip.catalogueSortYearDesc }}</option><option value="year-asc">{{ i18n.ts.zalip.catalogueSortYearAsc }}</option><option value="title">{{ i18n.ts.zalip.catalogueSortTitle }}</option></select></label>
							<button ref="filtersButton" type="button" class="_button" :class="$style.openFilters" :aria-label="i18n.ts.zalip.catalogueFilters" :aria-expanded="filtersOpen" aria-controls="catalogue-filters" @click="toggleFilters"><i class="ti ti-adjustments-horizontal"></i><span>{{ i18n.ts.zalip.catalogueFilters }}</span><b v-if="activeFilterCount">{{ activeFilterCount }}</b></button>
						</div>
					</div>

					<div v-if="activeFilterCount" :class="$style.activeFilters" :aria-label="i18n.ts.zalip.catalogueActiveFilters">
						<button v-for="kind in selectedKinds" :key="kind" type="button" class="_button" @click="toggleKind(kind)"><i :class="kindIcon(kind)"></i>{{ kindLabel(kind) }}<i class="ti ti-x"></i></button>
						<button v-for="genre in selectedGenres" :key="genre" type="button" class="_button" @click="toggleGenre(genre)"><i class="ti ti-tag"></i>{{ genre }}<i class="ti ti-x"></i></button>
						<button v-if="yearFrom || yearTo" type="button" class="_button" @click="navigate({ yearFrom: '', yearTo: '' })"><i class="ti ti-calendar"></i>{{ yearFrom || '…' }}—{{ yearTo || '…' }}<i class="ti ti-x"></i></button>
						<button v-if="query" type="button" class="_button" @click="clearSearch"><i class="ti ti-search"></i> «{{ query }}»<i class="ti ti-x"></i></button>
					</div>

					<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> {{ i18n.ts.zalip.catalogueLoadingCollection }}</div>
					<div v-else-if="loadError" :class="$style.empty"><i class="ti ti-alert-circle"></i><strong>{{ i18n.ts.zalip.catalogueLoadFailed }}</strong><button type="button" class="_button" @click="loadWorks">{{ i18n.ts.zalip.catalogueRetry }}</button></div>
					<div v-else-if="sortedWorks.length === 0" :class="$style.empty"><i class="ti ti-filter-off"></i><strong>{{ i18n.ts.zalip.catalogueNoResults }}</strong><span>{{ i18n.ts.zalip.catalogueNoResultsDescription }}</span><button type="button" class="_button" @click="resetFilters">{{ i18n.ts.zalip.catalogueResetFilters }}</button></div>
					<div v-else :class="[$style.grid, { [$style.listView]: viewMode === 'cards' }]">
						<MkA v-for="work in sortedWorks" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.card">
							<div :class="$style.poster">
								<img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" alt="" loading="lazy"><i v-else class="ti ti-movie"></i>
								<span v-if="library[work.id]" :class="[$style.status, $style[library[work.id]]]">{{ statusLabel(library[work.id]) }}</span>
							</div>
							<div :class="$style.cardBody">
								<h3>{{ work.title }}</h3>
								<p :class="$style.cardMeta"><span>{{ work.releaseYear ?? kindLabel(work.kind) }}</span><span v-if="work.communityRating != null" :aria-label="i18n.tsx.zalip.communityRating({ rating: work.communityRating.toFixed(1) })">· {{ work.communityRating.toFixed(1) }} <i class="ti ti-star-filled"></i></span><i v-if="library[work.id]" class="ti ti-bookmark-filled" :class="$style.saved" :aria-label="i18n.ts.zalip.libraryTotal"></i></p>
								<span v-if="work.originalTitle" :class="$style.originalTitle">{{ work.originalTitle }}</span>
								<p v-if="work.description" :class="$style.cardDescription">{{ work.description }}</p>
								<div v-if="work.genres.length" :class="$style.cardGenres">{{ work.genres.slice(0, 3).join(' · ') }}</div>
							</div>
						</MkA>
					</div>
					<p v-if="!pending && !loadError" :class="$style.resultCount">{{ i18n.tsx.zalip.catalogueResultCount({ shown: sortedWorks.length.toString(), total: '50' }) }}</p>
				</section>
			</div>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts">
// The router remounts query-driven pages; transfer only the intended focus.
let pendingFilterFocus: 'panel' | 'button' | null = null;
</script>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { miLocalStorage } from '@/local-storage.js';
import { $i } from '@/i.js';

defineOptions({ name: 'ZalipCatalogue' });

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type CatalogueSort = 'newest' | 'year-desc' | 'year-asc' | 'title';
type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';
type CatalogueQuery = {
	genres: string;
	types: string;
	query: string;
	yearFrom: string;
	yearTo: string;
	sort: CatalogueSort;
	filters: string;
};
type ZalipWork = {
	id: string;
	slug: string;
	kind: WorkKind;
	title: string;
	originalTitle: string | null;
	releaseYear: number | null;
	posterPath: string | null;
	genres: string[];
	description: string | null;
	communityRating: number | null;
};

const DISPLAYED_GENRES = 24;
const MAX_SELECTED_GENRES = 40;
const kinds: WorkKind[] = ['movie', 'series', 'anime', 'animation'];
const props = withDefaults(defineProps<{
	genres?: string;
	types?: string;
	query?: string;
	yearFrom?: string;
	yearTo?: string;
	sort?: CatalogueSort;
	filters?: string;
}>(), {
	genres: '',
	types: '',
	query: '',
	yearFrom: '',
	yearTo: '',
	sort: 'newest',
	filters: '',
});

const router = useRouter();
const works = ref<ZalipWork[]>([]);
const library = ref<Record<string, LibraryStatus>>({});
const viewMode = ref<'tiles' | 'cards'>(miLocalStorage.getItem('zalipCatalogueView') === 'cards' ? 'cards' : 'tiles');

function setView(value: 'tiles' | 'cards'): void {
	viewMode.value = value;
	miLocalStorage.setItem('zalipCatalogueView', value);
}

function statusLabel(status: LibraryStatus): string {
	return ({ watching: i18n.ts.zalip.statusWatching, planned: i18n.ts.zalip.statusPlanned, completed: i18n.ts.zalip.statusCompleted, on_hold: i18n.ts.zalip.statusOnHold, dropped: i18n.ts.zalip.statusDropped })[status];
}

async function loadLibrary(): Promise<void> {
	if (!$i) return;
	try {
		const entries = await misskeyApiZalip<{ status: LibraryStatus; work: { id: string } }[]>('zalip/library/list');
		library.value = Object.fromEntries(entries.map(entry => [entry.work.id, entry.status]));
	} catch {
		// Library badges are optional; catalogue browsing remains available.
	}
}

const genreOptions = ref<string[]>([]);
const pending = ref(true);
const genresPending = ref(true);
const loadError = ref(false);
const filtersOpen = computed(() => props.filters === '1');
const filtersPanel = useTemplateRef('filtersPanel');
const filtersButton = useTemplateRef('filtersButton');
const genresError = ref(false);
const yearError = ref(false);
const queryInput = ref('');
const yearFromInput = ref('');
const yearToInput = ref('');
const sortInput = ref<CatalogueSort>('newest');
const genreSearch = ref('');
const showAllGenres = ref(false);
let latestRequest = 0;

const selectedGenres = computed(() => parseList(props.genres, MAX_SELECTED_GENRES));
const selectedKinds = computed(() => parseList(props.types, kinds.length).filter((kind): kind is WorkKind => kinds.includes(kind as WorkKind)));
const query = computed(() => props.query.trim());
const yearFrom = computed(() => parseYear(props.yearFrom));
const yearTo = computed(() => parseYear(props.yearTo));
const activeFilterCount = computed(() => selectedGenres.value.length + selectedKinds.value.length + Number(yearFrom.value != null || yearTo.value != null) + Number(query.value !== ''));
const matchingGenres = computed(() => genreOptions.value.filter(genre => genre.toLocaleLowerCase('ru').includes(genreSearch.value.toLocaleLowerCase('ru'))));
const displayedGenres = computed(() => showAllGenres.value || genreSearch.value ? matchingGenres.value : matchingGenres.value.slice(0, DISPLAYED_GENRES));
const shouldOfferMoreGenres = computed(() => !genreSearch.value && matchingGenres.value.length > DISPLAYED_GENRES);
const resultHeading = computed(() => pending.value ? i18n.ts.zalip.catalogueLoading : `${sortedWorks.value.length} ${pluralTitles(sortedWorks.value.length)}`);
const sortedWorks = computed(() => {
	const sorted = [...works.value];
	if (props.sort === 'title') return sorted.sort((left, right) => left.title.localeCompare(right.title, 'ru'));
	if (props.sort === 'year-asc') return sorted.sort((left, right) => (left.releaseYear ?? Number.MAX_SAFE_INTEGER) - (right.releaseYear ?? Number.MAX_SAFE_INTEGER) || left.title.localeCompare(right.title, 'ru'));
	if (props.sort === 'year-desc') return sorted.sort((left, right) => (right.releaseYear ?? 0) - (left.releaseYear ?? 0) || left.title.localeCompare(right.title, 'ru'));
	return sorted;
});

function parseList(value: string, limit: number): string[] {
	return Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean))).slice(0, limit);
}

function parseYear(value: string): number | undefined {
	const year = Number.parseInt(value, 10);
	return Number.isInteger(year) && year >= 1888 && year <= 2200 ? year : undefined;
}

function pluralTitles(count: number): string {
	const last = count % 10;
	const lastTwo = count % 100;
	if (last === 1 && lastTwo !== 11) return i18n.ts.zalip.catalogueTitleOne;
	if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return i18n.ts.zalip.catalogueTitleFew;
	return i18n.ts.zalip.catalogueTitleMany;
}

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: WorkKind): string {
	return ({ movie: i18n.ts.zalip.catalogueKindMovie, series: i18n.ts.zalip.catalogueKindSeries, anime: i18n.ts.zalip.catalogueKindAnime, animation: i18n.ts.zalip.catalogueKindAnimation })[kind];
}

function kindIcon(kind: WorkKind): string {
	return ({ movie: 'ti ti-movie', series: 'ti ti-device-tv', anime: 'ti ti-sparkles', animation: 'ti ti-mood-smile' })[kind];
}

function navigate(patch: Partial<CatalogueQuery>): void {
	const next: CatalogueQuery = {
		genres: props.genres,
		types: props.types,
		query: props.query,
		yearFrom: props.yearFrom,
		yearTo: props.yearTo,
		sort: props.sort,
		filters: filtersOpen.value ? '1' : '',
		...patch,
	};
	router.push('/catalog', {
		query: {
			...(next.genres ? { genres: next.genres } : {}),
			...(next.types ? { types: next.types } : {}),
			...(next.query ? { q: next.query } : {}),
			...(next.yearFrom ? { yearFrom: next.yearFrom } : {}),
			...(next.yearTo ? { yearTo: next.yearTo } : {}),
			...(next.sort !== 'newest' ? { sort: next.sort } : {}),
			...(next.filters === '1' ? { filters: '1' } : {}),
		},
	});
}

function toggleFilters(): void {
	const open = !filtersOpen.value;
	pendingFilterFocus = open ? 'panel' : 'button';
	navigate({ filters: open ? '1' : '' });
}

function closeFilters(): void {
	pendingFilterFocus = 'button';
	navigate({ filters: '' });
}

async function restoreFilterFocus(): Promise<void> {
	await nextTick();
	if (!pendingFilterFocus) return;
	const target = pendingFilterFocus === 'panel' ? filtersPanel.value : filtersButton.value;
	if (target?.isConnected) {
		target.focus();
		pendingFilterFocus = null;
	}
}

function toggleKind(kind: WorkKind): void {
	const next = selectedKinds.value.includes(kind) ? selectedKinds.value.filter(item => item !== kind) : [...selectedKinds.value, kind];
	navigate({ types: next.join(',') });
}

function selectCategory(kind?: WorkKind): void {
	navigate({ types: kind ?? '' });
}

function toggleGenre(genre: string): void {
	const selected = selectedGenres.value;
	if (!selected.includes(genre) && selected.length >= MAX_SELECTED_GENRES) return;
	const next = selected.includes(genre) ? selected.filter(item => item !== genre) : [...selected, genre];
	navigate({ genres: next.join(',') });
}

function applySearch(): void {
	navigate({ query: queryInput.value.trim() });
}

function clearSearch(): void {
	queryInput.value = '';
	navigate({ query: '' });
}

function applyYears(): void {
	const from = parseYear(yearFromInput.value);
	const to = parseYear(yearToInput.value);
	yearError.value = from != null && to != null && from > to;
	if (yearError.value) return;
	navigate({ yearFrom: from?.toString() ?? '', yearTo: to?.toString() ?? '' });
}

function applySort(): void {
	navigate({ sort: sortInput.value });
}

function resetFilters(): void {
	yearError.value = false;
	queryInput.value = '';
	yearFromInput.value = '';
	yearToInput.value = '';
	sortInput.value = 'newest';
	navigate({ genres: '', types: '', query: '', yearFrom: '', yearTo: '', sort: 'newest' });
}

async function loadWorks(): Promise<void> {
	const requestId = ++latestRequest;
	pending.value = true;
	loadError.value = false;
	try {
		const response = await misskeyApiZalip<ZalipWork[]>('zalip/works/list', {
			limit: 50,
			...(selectedGenres.value.length ? { genres: selectedGenres.value } : {}),
			...(selectedKinds.value.length ? { kinds: selectedKinds.value } : {}),
			...(query.value.length >= 2 ? { query: query.value } : {}),
			...(yearFrom.value != null ? { yearFrom: yearFrom.value } : {}),
			...(yearTo.value != null ? { yearTo: yearTo.value } : {}),
		});
		if (requestId === latestRequest) works.value = response;
	} catch {
		if (requestId === latestRequest) loadError.value = true;
	} finally {
		if (requestId === latestRequest) pending.value = false;
	}
}

async function loadGenres(): Promise<void> {
	genresPending.value = true;
	genresError.value = false;
	try {
		genreOptions.value = await misskeyApiZalip<string[]>('zalip/genres/list');
	} catch {
		genresError.value = true;
	} finally {
		genresPending.value = false;
	}
}

watch(() => [props.genres, props.types, props.query, props.yearFrom, props.yearTo], () => {
	queryInput.value = props.query;
	yearFromInput.value = props.yearFrom;
	yearToInput.value = props.yearTo;
	void loadWorks();
}, { immediate: true });
watch(() => props.sort, value => { sortInput.value = value; }, { immediate: true });

onMounted(() => {
	void loadGenres();
	void loadLibrary();
	void restoreFilterFocus();
});
onActivated(() => { void restoreFilterFocus(); void loadLibrary(); });

definePage(() => ({ title: i18n.ts.zalip.catalogueHeading, icon: 'ti ti-layout-grid', needWideArea: true }));
</script>

<style lang="scss" module>
.viewport { container-type: inline-size; }
.page { max-width: 1180px; margin: 0 auto; padding: 28px 24px 64px; min-width: 0; box-sizing: border-box; }
.heading { margin-bottom: 24px; }
.eyebrow { display: flex; gap: 7px; align-items: center; margin: 0 0 8px; color: var(--MI_THEME-accent); font-size: 11px; font-weight: 700; letter-spacing: .08em; }
.heading h1 { margin: 0; font-size: 28px; letter-spacing: -.035em; }
.heading p:not(.eyebrow) { margin: 8px 0 0; color: var(--zalip-social-muted); font-size: 14px; line-height: 1.5; }
.categoryTabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-top: 20px; padding: 2px 0; }
.categoryTabs button { flex: 0 0 auto; padding: 9px 16px; border: 1px solid var(--zalip-social-border); border-radius: 99px; background: var(--zalip-social-panel); color: var(--zalip-social-muted); font-size: 14px; }
.categoryTabs .categoryActive { background: var(--zalip-accent-soft); border-color: var(--zalip-accent-border); color: var(--zalip-social-fg); font-weight: 650; }
.search { display: flex; align-items: center; gap: 10px; max-width: 780px; margin-top: 20px; padding: 7px 8px 7px 16px; border: 1px solid var(--zalip-social-border); border-radius: 16px; background: var(--zalip-social-panel); }
.search > i, .genreSearch > i { color: var(--zalip-social-muted); font-size: 20px; }
.search input, .genreSearch input { min-width: 0; flex: 1; border: 0; color: var(--zalip-social-fg); background: transparent; font-size: 14px; }
.search button:last-child { min-height: 38px; padding: 0 18px; border-radius: 12px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 650; }
.search:focus-within, .genreSearch:focus-within { border-color: var(--MI_THEME-accent); }
.catalogueLayout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; grid-template-areas: "results filters"; gap: 24px; align-items: start; }
.results { grid-area: results; min-width: 0; }
.filters { grid-area: filters; position: sticky; top: 20px; min-width: 0; padding: 18px; border: 1px solid var(--zalip-social-border); border-radius: 20px; background: var(--zalip-social-panel); }
.filtersHeading, .toolbar, .filterLabel, .toolbarActions { display: flex; align-items: center; gap: 10px; }
.filtersHeading { justify-content: space-between; }
.filtersHeading p, .toolbar .eyebrow { display: none; }
.filtersHeading strong { font-size: 16px; }
.reset, .closeFilters { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; min-width: 36px; color: var(--zalip-social-muted); border-radius: 99px; }
.reset span { display: none; }
.closeFilters { display: none; }
.filterSection { padding-top: 18px; margin-top: 18px; border-top: 1px solid var(--zalip-social-border); }
.filterLabel { justify-content: space-between; margin-bottom: 12px; font-size: 13px; font-weight: 650; flex-wrap: wrap; }
.filterLabel small { color: var(--zalip-social-muted); font-size: 11px; font-weight: 400; }
.kindGrid, .genreOptions { display: grid; gap: 4px; }
.kindOption, .genreOption { display: flex; align-items: center; gap: 9px; min-height: 38px; padding: 6px 8px; border: 1px solid transparent; border-radius: 10px; font-size: 13px; text-align: left; }
.kindOption > i, .genreOption > i { display: grid; place-items: center; flex: 0 0 22px; width: 22px; height: 22px; border-radius: 6px; background: var(--zalip-social-hover); color: var(--zalip-social-muted); }
.kindOption:hover, .genreOption:hover { background: var(--zalip-accent-wash); }
.optionActive { background: var(--zalip-accent-soft); border-color: var(--zalip-accent-border); }
.optionActive > i { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.yearRange { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.yearRange label { display: grid; gap: 6px; min-width: 0; color: var(--zalip-social-muted); font-size: 12px; }
.yearRange input { min-width: 0; width: 100%; height: 40px; box-sizing: border-box; padding: 8px; border: 1px solid var(--zalip-social-border); border-radius: 10px; color: var(--zalip-social-fg); background: var(--zalip-social-raised); }
.applyYears { grid-column: 1 / -1; min-height: 38px; border-radius: 10px; color: var(--zalip-social-fg); background: var(--zalip-accent-soft); font-size: 13px; }
.yearError { grid-column: 1 / -1; margin: 0; color: var(--MI_THEME-error); font-size: 12px; }
.genreSearch { display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--zalip-social-border); border-radius: 10px; margin-bottom: 10px; background: var(--zalip-social-raised); }
.genreLoading { font-size: 13px; color: var(--zalip-social-muted); }
.moreGenres { display: flex; align-items: center; gap: 6px; min-height: 40px; margin-top: 8px; color: var(--MI_THEME-accent); font-size: 13px; }
.toolbar { justify-content: space-between; flex-wrap: wrap; min-height: 44px; margin-bottom: 18px; }
.toolbar h2 { margin: 0; font-size: 20px; letter-spacing: -.025em; }
.toolbarActions { flex-wrap: wrap; }
.sort { display: inline-flex; align-items: center; gap: 6px; min-height: 40px; padding: 0 10px; border: 1px solid var(--zalip-social-border); border-radius: 12px; background: var(--zalip-social-panel); color: var(--zalip-social-muted); }
.sort select { min-width: 0; max-width: 180px; padding: 8px 0; border: 0; background: transparent; color: var(--zalip-social-fg); font-size: 13px; cursor: pointer; }
.openFilters { display: none; align-items: center; gap: 8px; min-height: 40px; padding: 0 13px; border: 1px solid var(--zalip-accent-border); border-radius: 12px; background: var(--zalip-accent-soft); font-size: 13px; font-weight: 600; }
.openFilters b { font-size: 11px; color: var(--MI_THEME-accent); }
.activeFilters { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.activeFilters button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 1px solid var(--zalip-accent-border); border-radius: 99px; background: var(--zalip-accent-soft); font-size: 12px; }
.viewSwitch { display: flex; padding: 3px; border: 1px solid var(--zalip-social-border); border-radius: 99px; background: var(--zalip-social-panel); }
.viewSwitch button { width: 36px; height: 34px; border-radius: 99px; color: var(--zalip-social-muted); font-size: 19px; }
.viewSwitch button[aria-pressed="true"] { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 26px 18px; }
.card { min-width: 0; color: var(--zalip-social-fg); text-decoration: none; }
.poster { position: relative; display: grid; aspect-ratio: 2 / 3; place-items: center; overflow: hidden; border-radius: 14px; background: var(--zalip-social-raised); }
.poster img { width: 100%; height: 100%; object-fit: cover; transition: transform .2s; }
.card:hover .poster img { transform: scale(1.025); }
.poster > i { color: var(--zalip-social-muted); font-size: 32px; }
.status { --status-color: var(--MI_THEME-accent); position: absolute; bottom: 7px; left: 6px; right: 6px; padding: 4px 5px; border-radius: 99px; color: var(--MI_THEME-fg); text-align: center; font-size: 11px; font-weight: 650; -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); background: color-mix(in srgb, var(--status-color) 42%, var(--MI_THEME-panel) 90%); }
.watching, .completed { --status-color: var(--MI_THEME-success); }
.planned { --status-color: var(--MI_THEME-accent); }
.on_hold { --status-color: var(--MI_THEME-warn); }
.dropped { --status-color: var(--MI_THEME-error); }
.cardBody { padding-top: 10px; }
.cardMeta { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; margin: 5px 0 0; font-size: 12px; color: var(--zalip-social-muted); }
.saved { color: var(--MI_THEME-warn); }
.cardBody h3 { display: -webkit-box; overflow: hidden; margin: 0; font-size: 14px; font-weight: 650; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.originalTitle, .cardDescription, .cardGenres { display: none; }
.listView { grid-template-columns: 1fr; gap: 24px; }
.listView .card { display: grid; grid-template-columns: 124px minmax(0, 1fr); gap: 20px; align-items: start; }
.listView .cardBody { padding: 0; }
.listView .cardBody h3 { font-size: 19px; }
.listView .cardMeta { margin-top: 8px; font-size: 14px; }
.listView .cardDescription { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; margin: 12px 0 0; font-size: 14px; line-height: 1.6; color: var(--zalip-social-muted); }
.listView .cardGenres { display: block; margin-top: 10px; font-size: 12px; color: var(--zalip-social-muted); }
.resultCount { margin: 24px 0 0; color: var(--zalip-social-muted); font-size: 12px; text-align: center; }
.empty { display: grid; justify-items: center; gap: 12px; align-content: center; min-height: 320px; padding: 24px; border: 1px dashed var(--zalip-social-border); border-radius: 20px; color: var(--zalip-social-muted); text-align: center; }
.empty > i { color: var(--MI_THEME-accent); font-size: 28px; }
.empty strong { color: var(--zalip-social-fg); }
.empty button { padding: 10px 18px; border-radius: 99px; background: var(--zalip-accent-soft); color: var(--zalip-social-fg); }
@container (max-width: 900px) {
	.catalogueLayout { display: flex; flex-direction: column; gap: 20px; }
	.results { width: 100%; }
	.filters { position: static; display: none; width: 100%; box-sizing: border-box; }
	.filtersOpen { display: block; }
	.closeFilters, .openFilters { display: inline-flex; }
	.kindGrid, .genreOptions { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
	.yearRange { max-width: 400px; }
}
@container (max-width: 600px) {
	.page { padding: 20px 16px 40px; }
	.heading h1 { font-size: 24px; }
	.heading p:not(.eyebrow), .heading .eyebrow { display: none; }
	.categoryTabs { margin-top: 16px; gap: 6px; }
	.categoryTabs button { padding: 8px 13px; font-size: 13px; }
	.search { margin-top: 16px; padding-left: 12px; }
	.search input { font-size: 13px; }
	.search button:last-child { padding: 0 12px; }
	.toolbar { gap: 12px; }
	.toolbar h2 { font-size: 18px; }
	.toolbarActions { width: 100%; flex-wrap: nowrap; }
	.sort { flex: 1; min-width: 0; }
	.sort select { width: 100%; }
	.openFilters { flex-shrink: 0; padding: 0 12px; }
	.openFilters span { display: none; }
	.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 22px 12px; }
	.listView { grid-template-columns: 1fr; }
	.listView .card { grid-template-columns: 104px minmax(0, 1fr); gap: 16px; }
	.listView .cardBody h3 { font-size: 16px; }
	.listView .cardDescription { font-size: 13px; margin-top: 8px; -webkit-line-clamp: 4; }
	.listView .cardGenres { display: none; }
	.poster { border-radius: 12px; }
	.cardBody h3 { font-size: 13px; }
}
@container (max-width: 360px) { .grid:not(.listView) { grid-template-columns: repeat(2, minmax(0, 1fr)); } .toolbarActions { gap: 6px; } }
@media (prefers-reduced-motion: reduce) { .poster img { transition: none; } }
</style>
