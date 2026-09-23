<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1320px;">
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
				<aside :class="[$style.filters, { [$style.filtersOpen]: filtersOpen }]" :aria-label="i18n.ts.zalip.catalogueFiltersLabel">
					<div :class="$style.filtersHeading">
						<div><p>{{ i18n.ts.zalip.catalogueFilters }}</p><strong>{{ i18n.ts.zalip.catalogueRefine }}</strong></div>
						<button v-if="activeFilterCount" type="button" class="_button" :class="$style.reset" @click="resetFilters"><i class="ti ti-refresh"></i><span>{{ i18n.ts.zalip.catalogueReset }}</span></button>
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
							<button type="submit" class="_button" :class="$style.applyYears">{{ i18n.ts.zalip.catalogueApply }}</button>
						</form>
					</section>

					<section :class="$style.filterSection">
						<div :class="$style.filterLabel"><span>{{ i18n.ts.zalip.catalogueGenres }}</span><small>{{ selectedGenres.length }}/{{ MAX_SELECTED_GENRES }}</small></div>
						<label :class="$style.genreSearch"><i class="ti ti-search"></i><input v-model.trim="genreSearch" class="_input" type="search" :placeholder="i18n.ts.zalip.catalogueGenreSearch"></label>
						<div v-if="genresPending" :class="$style.genreLoading"><i class="ti ti-loader-2 ti-spin"></i> {{ i18n.ts.zalip.catalogueGenresLoading }}</div>
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
							<label :class="$style.sort"><i class="ti ti-arrows-sort"></i><span>{{ i18n.ts.zalip.catalogueSort }}</span><select v-model="sortInput" class="_input" :aria-label="i18n.ts.zalip.catalogueSort" @change="applySort"><option value="newest">{{ i18n.ts.zalip.catalogueSortNewest }}</option><option value="year-desc">{{ i18n.ts.zalip.catalogueSortYearDesc }}</option><option value="year-asc">{{ i18n.ts.zalip.catalogueSortYearAsc }}</option><option value="title">{{ i18n.ts.zalip.catalogueSortTitle }}</option></select></label>
							<button type="button" class="_button" :class="$style.openFilters" @click="filtersOpen = true"><i class="ti ti-adjustments-horizontal"></i><span>{{ i18n.ts.zalip.catalogueFilters }}</span><b v-if="activeFilterCount">{{ activeFilterCount }}</b></button>
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
					<div v-else :class="$style.grid">
						<MkA v-for="work in sortedWorks" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.card">
							<div :class="$style.poster"><img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title" loading="lazy"><i v-else class="ti ti-movie"></i><span :class="$style.cardKind"><i :class="kindIcon(work.kind)"></i>{{ kindLabel(work.kind) }}</span></div>
							<div :class="$style.cardBody"><p>{{ work.releaseYear ?? i18n.ts.zalip.catalogueUnknownYear }}</p><h3>{{ work.title }}</h3><span v-if="work.originalTitle">{{ work.originalTitle }}</span><div v-if="work.genres.length" :class="$style.cardGenres"><span v-for="genre in work.genres.slice(0, 2)" :key="genre">{{ genre }}</span></div></div>
						</MkA>
					</div>
					<p v-if="!pending && !loadError" :class="$style.resultCount">{{ i18n.tsx.zalip.catalogueResultCount({ shown: sortedWorks.length.toString(), total: '50' }) }}</p>
				</section>
			</div>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { useRouter } from '@/router.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

defineOptions({ name: 'ZalipCatalogue' });

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type CatalogueSort = 'newest' | 'year-desc' | 'year-asc' | 'title';
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
const genreOptions = ref<string[]>([]);
const pending = ref(true);
const genresPending = ref(true);
const loadError = ref(false);
const filtersOpen = ref(false);
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

function closeFilters(): void {
	filtersOpen.value = false;
	navigate({ filters: '' });
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
	if (from != null && to != null && from > to) return;
	navigate({ yearFrom: from?.toString() ?? '', yearTo: to?.toString() ?? '' });
}

function applySort(): void {
	navigate({ sort: sortInput.value });
}

function resetFilters(): void {
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
	try {
		genreOptions.value = await misskeyApiZalip<string[]>('zalip/genres/list');
	} finally {
		genresPending.value = false;
	}
}

watch(() => [props.genres, props.types, props.query, props.yearFrom, props.yearTo, props.sort, props.filters], () => {
	queryInput.value = props.query;
	yearFromInput.value = props.yearFrom;
	yearToInput.value = props.yearTo;
	sortInput.value = props.sort;
	filtersOpen.value = props.filters === '1';
	void loadWorks();
}, { immediate: true });

onMounted(() => {
	void loadGenres();
});

definePage(() => ({ title: 'Каталог', icon: 'ti ti-layout-grid' }));
</script>

<style lang="scss" module>
.page { padding: 30px var(--MI-margin) 56px; }
.heading { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 0.72fr); align-items: end; gap: 30px; margin-bottom: 28px; }
.eyebrow { display: flex; gap: 7px; align-items: center; margin: 0 0 8px; color: var(--MI_THEME-accent); font-size: 0.72rem; font-weight: 750; letter-spacing: 0.11em; }
.heading h1, .toolbar h2 { margin: 0; letter-spacing: -0.035em; }
.heading h1 { font-size: clamp(2rem, 5vw, 3.2rem); }
.heading p:not(.eyebrow) { max-width: 620px; margin: 10px 0 0; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.55; }
.search { display: flex; align-items: center; gap: 8px; padding: 7px 8px 7px 14px; border: 1px solid var(--MI_THEME-divider); border-radius: 16px; background: var(--MI_THEME-panel); }
.search > i, .genreSearch > i { color: var(--MI_THEME-fgTransparentWeak); font-size: 1.1rem; }
.search input, .genreSearch input { min-width: 0; flex: 1; border: 0; background: transparent; }
.search button:last-child { padding: 9px 13px; border-radius: 10px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 750; }
.catalogueLayout { display: grid; grid-template-columns: minmax(260px, 300px) minmax(0, 1fr); gap: 28px; align-items: start; }
.filters { position: sticky; top: calc(var(--MI-header-height, 0px) + 16px); padding: 18px; border: 1px solid var(--MI_THEME-divider); border-radius: 22px; background: var(--MI_THEME-panel); }
.filtersHeading, .toolbar, .filterLabel, .toolbarActions, .activeFilters { display: flex; align-items: center; }
.filtersHeading { justify-content: space-between; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid var(--MI_THEME-divider); }
.filtersHeading p { margin: 0 0 3px; color: var(--MI_THEME-accent); font-size: 0.68rem; font-weight: 750; letter-spacing: 0.1em; }
.filtersHeading strong { font-size: 1.05rem; }
.reset, .closeFilters { display: inline-flex; gap: 6px; align-items: center; padding: 7px 9px; border-radius: 10px; color: var(--MI_THEME-fgTransparentWeak); }
.closeFilters { display: none; }
.filterSection { padding: 17px 0; border-bottom: 1px solid var(--MI_THEME-divider); }
.filterSection:last-child { padding-bottom: 0; border-bottom: 0; }
.filterLabel { justify-content: space-between; gap: 8px; margin-bottom: 10px; font-size: 0.88rem; font-weight: 750; }
.filterLabel small { color: var(--MI_THEME-fgTransparentWeak); font-size: 0.72rem; font-weight: 500; }
.kindGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.kindOption, .genreOption { display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--MI_THEME-divider); color: var(--MI_THEME-fgTransparentWeak); }
.kindOption { padding: 9px; border-radius: 11px; font-size: 0.78rem; font-weight: 700; }
.genreOption { padding: 8px 10px; border-radius: 999px; font-size: 0.75rem; }
.kindOption:hover, .genreOption:hover { border-color: color-mix(in srgb, var(--MI_THEME-accent) 55%, var(--MI_THEME-divider)); color: var(--MI_THEME-fg); }
.optionActive { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); }
.yearRange { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.yearRange label { display: grid; gap: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.7rem; }
.yearRange input { width: 100%; box-sizing: border-box; padding: 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 9px; background: var(--MI_THEME-bg); }
.applyYears { grid-column: 1 / -1; padding: 8px; border-radius: 9px; background: var(--MI_THEME-panelHighlight); font-size: 0.78rem; font-weight: 700; }
.genreSearch { display: flex; align-items: center; gap: 7px; margin-bottom: 10px; padding: 8px 9px; border-radius: 10px; background: var(--MI_THEME-bg); }
.genreOptions { display: flex; flex-wrap: wrap; gap: 6px; }
.genreLoading { display: flex; align-items: center; gap: 7px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.78rem; }
.moreGenres { display: flex; align-items: center; gap: 5px; margin-top: 10px; color: var(--MI_THEME-accent); font-size: 0.78rem; }
.results { min-width: 0; }
.toolbar { justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.toolbar h2 { font-size: 1.45rem; }
.toolbarActions { gap: 8px; }
.sort { position: relative; display: inline-flex; align-items: center; gap: 7px; padding: 9px 11px; border: 1px solid var(--MI_THEME-divider); border-radius: 11px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.78rem; }
.sort select { position: absolute; inset: 0; width: 100%; cursor: pointer; opacity: 0; }
.openFilters { display: none; align-items: center; gap: 7px; padding: 9px 11px; border-radius: 11px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 0.78rem; font-weight: 750; }
.openFilters b { display: grid; place-items: center; min-width: 17px; height: 17px; border-radius: 999px; background: color-mix(in srgb, var(--MI_THEME-fgOnAccent) 28%, transparent); font-size: 0.67rem; }
.activeFilters { flex-wrap: wrap; gap: 6px; margin-bottom: 16px; }
.activeFilters button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 8px; border-radius: 999px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-size: 0.74rem; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.card { min-width: 0; color: var(--MI_THEME-fg); text-decoration: none; }
.poster { position: relative; display: grid; aspect-ratio: 0.69; place-items: center; overflow: hidden; border-radius: 16px; background: var(--MI_THEME-panel); }
.poster img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.25s ease; }
.card:hover .poster img { transform: scale(1.035); }
.poster > i { color: var(--MI_THEME-fgTransparentWeak); font-size: 2.2rem; }
.cardKind { position: absolute; right: 8px; bottom: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 5px 7px; border-radius: 999px; background: color-mix(in srgb, var(--MI_THEME-bg) 85%, transparent); color: var(--MI_THEME-fg); font-size: 0.65rem; font-weight: 750; backdrop-filter: blur(8px); }
.cardBody { padding: 9px 2px 2px; }
.cardBody p, .cardBody h3, .cardBody > span { margin: 0; }
.cardBody p { color: var(--MI_THEME-accent); font-size: 0.7rem; font-weight: 700; }
.cardBody h3 { display: -webkit-box; overflow: hidden; margin-top: 4px; font-size: 0.93rem; line-height: 1.28; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.cardBody > span { display: block; overflow: hidden; margin-top: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.73rem; text-overflow: ellipsis; white-space: nowrap; }
.cardGenres { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 7px; }
.cardGenres span { padding: 3px 5px; border-radius: 6px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fgTransparentWeak); font-size: 0.63rem; }
.resultCount { margin: 18px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.75rem; text-align: center; }
.empty { display: grid; justify-items: center; gap: 9px; min-height: 360px; align-content: center; padding: 25px; border: 1px dashed var(--MI_THEME-divider); border-radius: 20px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; }
.empty > i { color: var(--MI_THEME-accent); font-size: 2rem; }
.empty strong { color: var(--MI_THEME-fg); }
.empty button { padding: 8px 11px; border-radius: 9px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); font-weight: 700; }

@media (max-width: 1000px) {
	.heading { grid-template-columns: 1fr; align-items: start; }
	.search { max-width: 650px; }
	.catalogueLayout { grid-template-columns: minmax(230px, 270px) minmax(0, 1fr); gap: 18px; }
	.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

@media (max-width: 760px) {
	.page { padding: 16px var(--MI-margin) 40px; }
	.heading { gap: 18px; margin-bottom: 18px; }
	.heading h1 { font-size: 2rem; }
	.catalogueLayout { display: block; }
	.filters { position: fixed; z-index: 2000; top: 0; right: 0; bottom: 0; left: 0; display: none; overflow: auto; border: 0; border-radius: 0; }
	.filtersOpen { display: block; }
	.closeFilters { display: inline-flex; }
	.reset span { display: none; }
	.toolbar { align-items: flex-end; }
	.toolbarActions { flex-shrink: 0; }
	.sort span { display: none; }
	.openFilters { display: inline-flex; }
	.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
	.cardBody h3 { font-size: 0.86rem; }
}

@media (max-width: 420px) {
	.search button:last-child { padding: 8px 10px; }
	.search input::placeholder { font-size: 0.76rem; }
	.toolbar h2 { font-size: 1.18rem; }
	.openFilters span { display: none; }
}

/* Ongaku catalogue geometry and control density. */
.page {
	max-width: 1328px;
	margin: 0 auto;
	padding: 30px var(--zalip-container-offset) 56px;
}

.heading {
	display: block;
	margin-bottom: 24px;
}

.heading > div {
	max-width: var(--zalip-content-max-width);
}

.heading h1 {
	font-size: 2rem;
	letter-spacing: -0.025em;
}

.heading p:not(.eyebrow) {
	margin-top: 6px;
	font-size: 0.86rem;
}

.categoryTabs {
	display: flex;
	gap: 8px;
	margin-top: 18px;
	overflow-x: auto;
	padding-bottom: 2px;
}

.categoryTabs button {
	flex: 0 0 auto;
	height: 32px;
	padding: 0 15px;
	border: 1px solid transparent;
	border-radius: 16px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.8rem;
	font-weight: 650;
}

.categoryTabs .categoryActive {
	border-color: var(--MI_THEME-fg);
	color: var(--MI_THEME-fg);
}

.heading .search {
	max-width: var(--zalip-content-max-width);
	margin-top: 18px;
	border-radius: var(--zalip-radius);
}

.catalogueLayout {
	grid-template-columns: minmax(0, var(--zalip-content-max-width)) var(--zalip-aside-width);
	grid-template-areas: "results filters";
	gap: 24px;
	justify-content: center;
}

.results { grid-area: results; }
.filters { grid-area: filters; }

.filters {
	top: 16px;
	padding: 18px 16px;
	border: 0;
	border-radius: var(--zalip-radius-big);
	background: var(--MI_THEME-panel);
}

.filtersHeading {
	padding-bottom: 14px;
	border-bottom: 0;
}

.filtersHeading p {
	display: none;
}

.filtersHeading strong {
	font-size: 1.12rem;
}

.filterSection {
	padding: 16px 0;
	border-top: 1px solid var(--MI_THEME-divider);
	border-bottom: 0;
}

.filterLabel {
	margin-bottom: 12px;
	font-size: 0.9rem;
}

.kindGrid, .genreOptions {
	display: grid;
	grid-template-columns: 1fr;
	gap: 2px;
}

.kindOption, .genreOption {
	justify-content: flex-start;
	min-height: 36px;
	padding: 5px 7px;
	border: 0;
	border-radius: var(--zalip-radius-small);
	background: transparent;
	color: var(--MI_THEME-fg);
	font-size: 0.82rem;
}

.kindOption > i, .genreOption > i {
	display: grid;
	place-items: center;
	width: 22px;
	height: 22px;
	border-radius: 6px;
	background: var(--MI_THEME-panelHighlight);
	color: transparent;
	font-size: 0.72rem;
}

.kindOption.optionActive, .genreOption.optionActive {
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
}

.kindOption.optionActive > i, .genreOption.optionActive > i {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.genreSearch, .yearRange input {
	background: var(--MI_THEME-panelHighlight);
}

.genreSearch {
	height: 38px;
	box-sizing: border-box;
	border-radius: var(--zalip-radius);
}

.toolbar {
	min-height: 42px;
	margin-bottom: 14px;
}

.toolbar .eyebrow {
	display: none;
}

.toolbar h2 {
	font-size: 1.25rem;
}

.sort {
	height: 38px;
	box-sizing: border-box;
	border: 0;
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-panelHighlight);
}

.grid {
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 20px 16px;
}

.poster {
	border-radius: var(--zalip-radius-small);
	background: var(--MI_THEME-panelHighlight);
}

.cardKind {
	right: auto;
	bottom: 6px;
	left: 6px;
	border-radius: 12px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 88%, transparent);
}

.cardBody {
	padding: 7px 0 0;
}

.cardBody p {
	display: none;
}

.cardBody h3 {
	margin-top: 0;
	font-size: 0.86rem;
	font-weight: 650;
}

.cardBody > span, .cardGenres {
	display: none;
}

@media (max-width: 1180px) {
	.catalogueLayout {
		grid-template-columns: minmax(0, 1fr) 300px;
	}
}

@media (max-width: 980px) {
	.catalogueLayout { display: block; }
	.filters { position: fixed; z-index: 2000; inset: 0; display: none; overflow: auto; border-radius: 0; }
	.filtersOpen { display: block; }
	.closeFilters, .openFilters { display: inline-flex; }
	.grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

@media (max-width: 767px) {
	.page { padding: 18px var(--zalip-container-offset) 40px; }
	.heading h1 { font-size: 1.55rem; }
	.heading p:not(.eyebrow) { display: none; }
	.heading .search { display: none; }
	.categoryTabs { margin-right: calc(var(--zalip-container-offset) * -1); padding-right: var(--zalip-container-offset); }
	.toolbar { align-items: center; }
	.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 10px; }
	.poster { border-radius: 8px; }
	.cardBody h3 { font-size: 0.78rem; }
}

@media (max-width: 420px) {
	.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap-inline: 8px; }
	.toolbar h2 { display: none; }
	.toolbarActions { width: 100%; justify-content: space-between; }
	.sort { flex: 1; }
	.cardKind { padding: 3px 5px; font-size: 0.58rem; }
}
</style>
