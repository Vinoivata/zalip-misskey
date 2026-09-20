<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1180px;">
		<div :class="$style.page">
			<section :class="$style.hero">
				<div>
					<p :class="$style.eyebrow"><i class="ti ti-movie"></i> ZALIP CINEMA</p>
					<h1>Смотри. <em>Обсуждай.</em><br>Сохраняй истории.</h1>
					<p :class="$style.lead">Кино, сериалы и аниме живут в том же пространстве, что и ваша лента, профиль и уведомления.</p>
					<div :class="$style.actions">
						<MkA to="/timeline" :class="$style.primaryAction"><i class="ti ti-news"></i> Открыть ленту</MkA>
						<MkA to="/library" :class="$style.secondaryAction"><i class="ti ti-bookmark"></i> Моя библиотека</MkA>
						<MkA v-if="iAmAdmin" to="/zalip/editor" :class="$style.secondaryAction"><i class="ti ti-pencil"></i> Редактор</MkA>
					</div>
					<form :class="$style.search" @submit.prevent="openSearch">
						<i class="ti ti-search"></i>
						<input v-model.trim="searchQuery" class="_input" type="search" minlength="2" maxlength="100" placeholder="Поиск фильмов, сериалов и аниме" aria-label="Поиск по каталогу">
						<button v-if="searchQuery" type="button" class="_button" aria-label="Сбросить поиск" @click="searchQuery = ''"><i class="ti ti-x"></i></button>
						<button type="submit" class="_button"><span>Найти</span></button>
					</form>
				</div>
				<div :class="$style.orb" aria-hidden="true"><i class="ti ti-player-play-filled"></i></div>
			</section>

			<section v-if="showcaseItems.length" :class="$style.releases">
				<div :class="$style.sectionHeader">
					<div><p :class="$style.eyebrow">{{ showcaseEyebrow }}</p><h2>{{ showcaseTitle }}</h2></div>
					<span :class="$style.count">{{ showcaseItems.length }} {{ isEpisodeShowcase ? i18n.ts.zalip.updatesLabel : i18n.ts.zalip.titlesLabel }}</span>
				</div>
				<div :class="$style.releaseRail" role="list" :aria-label="showcaseTitle">
					<div v-for="item in showcaseItems" :key="item.id" :class="$style.releaseListItem" role="listitem">
						<MkA :to="`/zalip/${item.work.slug}`" :class="$style.releaseCard">
							<div :class="$style.releasePoster">
								<img v-if="item.work.posterPath" :src="tmdbImage(item.work.posterPath)" :alt="item.work.title" loading="lazy">
								<i v-else class="ti ti-movie"></i>
								<span :class="$style.releaseBadge"><i :class="isEpisodeShowcase ? 'ti ti-player-play-filled' : 'ti ti-sparkles'"></i><span :class="$style.releaseBadgeText">{{ item.badge }}</span></span>
							</div>
							<div :class="$style.releaseBody"><strong>{{ item.work.title }}</strong><span>{{ item.subtitle }}</span></div>
						</MkA>
					</div>
				</div>
			</section>

			<section :class="$style.catalogue">
				<div :class="$style.sectionHeader">
					<div><p :class="$style.eyebrow">КАТАЛОГ</p><h2>{{ catalogueTitle }}</h2></div>
					<div :class="$style.catalogueMeta"><MkA v-if="activeGenre || activeKind" :to="catalogueLink()" :class="$style.resetGenre"><i class="ti ti-x"></i> Все жанры</MkA><span v-if="works.length" :class="$style.count">{{ works.length }} тайтлов</span></div>
				</div>
				<div v-if="works.length || activeGenre || activeKind" :class="$style.catalogueControls">
					<div :class="$style.kindRail" :aria-label="i18n.ts.zalip.catalogueKinds" role="list">
						<MkA :to="catalogueLink({ genre: activeGenre })" :class="[$style.kindChip, { [$style.kindChipActive]: !activeKind }]" role="listitem"><i class="ti ti-layout-grid"></i>{{ i18n.ts.zalip.catalogueAllKinds }}</MkA>
						<MkA v-for="workKind in catalogueKinds" :key="workKind" :to="catalogueLink({ kind: workKind, genre: activeGenre })" :class="[$style.kindChip, { [$style.kindChipActive]: activeKind === workKind }]" role="listitem"><i :class="kindIcon(workKind)"></i>{{ kindLabel(workKind) }}</MkA>
					</div>
					<div :class="$style.filterLine">
						<button type="button" class="_button" :class="$style.sortControl" :aria-label="i18n.ts.zalip.catalogueSort" @click="showSortMenu"><i class="ti ti-arrows-sort"></i><span>{{ sortLabel }}</span><i class="ti ti-chevron-down"></i></button>
						<div :class="$style.genreRail" :aria-label="i18n.ts.zalip.catalogueGenres" role="list">
							<MkA :to="catalogueLink({ kind: activeKind })" :class="[$style.genreChip, { [$style.genreChipActive]: !activeGenre }]" role="listitem"><i class="ti ti-tag"></i>{{ i18n.ts.zalip.catalogueAllGenres }}</MkA>
							<MkA v-for="genreName in genreChips" :key="genreName" :to="catalogueLink({ kind: activeKind, genre: genreName })" :class="[$style.genreChip, { [$style.genreChipActive]: activeGenre === genreName }]" role="listitem">{{ genreName }}</MkA>
						</div>
					</div>
				</div>

				<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Загружаем каталог…</div>
				<div v-else-if="loadError" :class="$style.empty"><i class="ti ti-alert-circle"></i> Каталог временно недоступен.</div>
				<div v-else-if="works.length === 0" :class="$style.empty">
					<i class="ti ti-sparkles"></i>
					<strong>{{ activeGenre || activeKind ? i18n.ts.zalip.catalogueFilteredEmptyTitle : 'Каталог готов к первому тайтлу' }}</strong>
					<span>{{ activeGenre || activeKind ? i18n.ts.zalip.catalogueFilteredEmptyDescription : 'Администратор добавит его как черновик, проверит и только затем опубликует.' }}</span>
				</div>
				<div v-else :class="$style.grid">
					<MkA v-for="work in sortedWorks" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.card">
						<div :class="$style.poster">
							<img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title" loading="lazy">
							<i v-else class="ti ti-movie"></i>
						</div>
						<div :class="$style.cardBody">
							<p>{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span></p>
							<h3>{{ work.title }}</h3>
							<span v-if="work.originalTitle">{{ work.originalTitle }}</span>
						</div>
					</MkA>
				</div>
				<p :class="$style.credits">Метаданные каталога: <MkA to="/zalip/credits">TMDB и другие указанные источники</MkA>.</p>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { iAmAdmin } from '@/i.js';
import * as os from '@/os.js';
import { openZalipSearch } from '@/utility/zalip-search.js';

type ZalipWork = {
	id: string;
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	trailerYoutubeKey: string | null;
	genres: string[];
};

type ZalipReleaseEvent = {
	id: string;
	createdAt: string;
	work: ZalipWork;
	season: { seasonNumber: number; title: string };
	episode: { episodeNumber: number; title: string };
};

type ZalipShowcaseItem = {
	id: string;
	work: ZalipWork;
	badge: string;
	subtitle: string;
};

type WorkKind = ZalipWork['kind'];
type ZalipSort = 'year' | 'title';

const works = ref<ZalipWork[]>([]);
const catalogueGenres = ref<string[]>([]);
const releaseEvents = ref<ZalipReleaseEvent[]>([]);
const releaseEventsLoaded = ref(false);
const pending = ref(true);
const loadError = ref(false);
const searchQuery = ref('');
const sort = ref<ZalipSort>('year');
const props = withDefaults(defineProps<{ genre?: string; kind?: WorkKind }>(), { genre: '', kind: undefined });
const activeGenre = computed(() => props.genre.trim());
const activeKind = computed<WorkKind | ''>(() => props.kind ?? '');
const catalogueKinds: WorkKind[] = ['movie', 'series', 'anime', 'animation'];
const catalogueTitle = computed(() => activeGenre.value ? `Жанр: ${activeGenre.value}` : activeKind.value ? kindLabel(activeKind.value) : 'Новое и важное');
const isEpisodeShowcase = computed(() => releaseEvents.value.length > 0);
const showcaseItems = computed<ZalipShowcaseItem[]>(() => {
	if (releaseEvents.value.length > 0) return releaseEvents.value.map(release => ({
		id: release.id,
		work: release.work,
		badge: releaseLabel(release),
		subtitle: release.episode.title || i18n.ts.zalip.newEpisode,
	}));

	if (!releaseEventsLoaded.value) return [];
	if (activeGenre.value || activeKind.value) return [];
	return works.value.slice(0, 12).map(work => ({
		id: `catalogue-${work.id}`,
		work,
		badge: `${kindLabel(work.kind)}${work.releaseYear == null ? '' : ` · ${work.releaseYear}`}`,
		subtitle: work.originalTitle || i18n.ts.zalip.newCatalogueItem,
	}));
});
const showcaseEyebrow = computed(() => isEpisodeShowcase.value ? i18n.ts.zalip.freshEpisodes : i18n.ts.zalip.newCatalogue);
const showcaseTitle = computed(() => isEpisodeShowcase.value ? i18n.ts.zalip.freshEpisodesTitle : i18n.ts.zalip.newCatalogueTitle);
const sortLabel = computed(() => sort.value === 'year' ? i18n.ts.zalip.catalogueSortYear : i18n.ts.zalip.catalogueSortTitle);
const sortedWorks = computed(() => [...works.value].sort((left, right) => {
	if (sort.value === 'title') return left.title.localeCompare(right.title, 'ru');
	return (right.releaseYear ?? 0) - (left.releaseYear ?? 0) || left.title.localeCompare(right.title, 'ru');
}));
const genreChips = computed(() => Array.from(new Set([
	...catalogueGenres.value,
	...(activeGenre.value ? [activeGenre.value] : []),
])).sort((left, right) => left.localeCompare(right, 'ru')));

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: WorkKind): string {
	return ({ movie: i18n.ts.zalip.searchMovies, series: i18n.ts.zalip.searchSeries, anime: i18n.ts.zalip.searchAnime, animation: i18n.ts.zalip.searchAnimation })[kind];
}

function kindIcon(kind: WorkKind): string {
	return ({ movie: 'ti ti-movie', series: 'ti ti-device-tv', anime: 'ti ti-sparkles', animation: 'ti ti-mood-smile' })[kind];
}

function catalogueLink(filters: { genre?: string; kind?: WorkKind | ''; } = {}): string {
	const params = new URLSearchParams();
	if (filters.kind) params.set('kind', filters.kind);
	if (filters.genre) params.set('genre', filters.genre);
	const query = params.toString();
	return query ? `/?${query}` : '/';
}

function releaseLabel(release: ZalipReleaseEvent): string {
	const season = release.season.seasonNumber === 0 ? 'Спецэпизод' : `Сезон ${release.season.seasonNumber}`;
	return `${season} · серия ${release.episode.episodeNumber}`;
}

function showSortMenu(event: MouseEvent): void {
	void os.popupMenu([
		{ type: 'label', text: i18n.ts.zalip.catalogueSort },
		{
			text: i18n.ts.zalip.catalogueSortYear,
			icon: 'ti ti-calendar',
			active: sort.value === 'year',
			action: () => { sort.value = 'year'; },
		},
		{
			text: i18n.ts.zalip.catalogueSortTitle,
			icon: 'ti ti-sort-a-z',
			active: sort.value === 'title',
			action: () => { sort.value = 'title'; },
		},
	], event.currentTarget ?? event.target, { align: 'left', width: 260 });
}

async function loadCatalogue(): Promise<void> {
	pending.value = true;
	loadError.value = false;
	releaseEventsLoaded.value = false;
	try {
		works.value = await misskeyApiZalip<ZalipWork[]>('zalip/works/list', {
			limit: 20,
			...(activeGenre.value ? { genre: activeGenre.value } : {}),
			...(activeKind.value ? { kind: activeKind.value } : {}),
		});
		try {
			catalogueGenres.value = await misskeyApiZalip<string[]>('zalip/genres/list');
		} catch {
			// Keep the last successful facet list if a transient facet request fails.
		}
		try {
			releaseEvents.value = await misskeyApiZalip<ZalipReleaseEvent[]>('zalip/releases/list', { limit: 12 });
			releaseEventsLoaded.value = true;
		} catch {
			releaseEvents.value = [];
		}
	} catch {
		loadError.value = true;
	} finally {
		pending.value = false;
	}
}

function openSearch(): void {
	openZalipSearch('catalogue', searchQuery.value.trim());
}

watch([activeGenre, activeKind], () => {
	searchQuery.value = '';
	void loadCatalogue();
}, { immediate: true });

definePage(() => ({
	title: 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.page {
	padding: 24px var(--MI-margin) 52px;
}

.hero {
	position: relative;
	overflow: hidden;
	display: grid;
	grid-template-columns: minmax(0, 1fr) 180px;
	gap: 24px;
	padding: 36px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-accent) 30%, var(--MI_THEME-divider));
	border-radius: 24px;
	background:
		radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--MI_THEME-accent) 28%, transparent), transparent 48%),
		var(--MI_THEME-panel);
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 7px;
	margin: 0 0 10px;
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--MI_THEME-accent);
}

.hero h1 {
	margin: 0;
	font-size: clamp(2rem, 6vw, 3.7rem);
	line-height: 1.04;
	letter-spacing: -0.04em;
}

.hero h1 em {
	font-style: normal;
	color: var(--MI_THEME-accent);
}

.lead {
	max-width: 590px;
	margin: 18px 0 0;
	line-height: 1.6;
	color: var(--MI_THEME-fgTransparentWeak);
}

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 24px;
}

.search {
	display: flex;
	align-items: center;
	gap: 8px;
	max-width: 640px;
	margin-top: 24px;
	padding: 6px 7px 6px 14px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 35%, var(--MI_THEME-panel));
	color: var(--MI_THEME-fgTransparentWeak);
}

.search input {
	min-width: 0;
	flex: 1;
	padding: 7px 0;
	border: 0;
	background: transparent;
}

.search button {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 34px;
	padding: 0 11px;
	border-radius: 999px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
	font-weight: 700;
}

.search button:last-child {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.primaryAction, .secondaryAction {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-radius: 999px;
	font-weight: 700;
	text-decoration: none;
}

.primaryAction {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.secondaryAction {
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
}

.orb {
	align-self: center;
	display: grid;
	place-items: center;
	width: 150px;
	aspect-ratio: 1;
	border-radius: 50%;
	background: linear-gradient(145deg, color-mix(in srgb, var(--MI_THEME-accent) 78%, white), var(--MI_THEME-accent));
	box-shadow: 0 22px 52px color-mix(in srgb, var(--MI_THEME-accent) 35%, transparent);
	color: var(--MI_THEME-fgOnAccent);
	font-size: 3rem;
}

.catalogue {
	margin-top: 36px;
}

.releases {
	margin-top: 32px;
}

.sectionHeader {
	display: flex;
	align-items: end;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 16px;
}

.sectionHeader h2 {
	margin: 0;
	font-size: 1.35rem;
}

.count {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.85rem;
}

.catalogueMeta {
	display: flex;
	align-items: center;
	justify-content: end;
	gap: 10px;
}

.catalogueControls {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 10px;
	margin: -2px 0 18px;
}

.filterLine {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}

.kindRail {
	display: flex;
	gap: 7px;
	min-width: 0;
	overflow-x: auto;
	padding: 1px;
	scrollbar-width: none;
}

.kindRail::-webkit-scrollbar {
	display: none;
}

.kindChip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	padding: 9px 12px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-accent) 28%, var(--MI_THEME-divider));
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 85%, transparent);
	color: var(--MI_THEME-fg);
	font-size: 0.8rem;
	font-weight: 750;
	text-decoration: none;
}

.kindChip:hover,
.kindChip:focus-visible {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	text-decoration: none;
}

.kindChipActive {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.sortControl {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	flex: 0 0 auto;
	padding: 10px 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	font-size: 0.82rem;
	font-weight: 700;
}

.sortControl i:last-child {
	font-size: 0.9rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

.genreRail {
	display: flex;
	gap: 7px;
	min-width: 0;
	overflow-x: auto;
	padding: 1px;
	scrollbar-width: none;
}

.genreRail::-webkit-scrollbar {
	display: none;
}

.genreChip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	flex: 0 0 auto;
	padding: 9px 11px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 700;
	text-decoration: none;
	transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.genreChip:hover {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 55%, var(--MI_THEME-divider));
	color: var(--MI_THEME-fg);
	text-decoration: none;
}

.genreChipActive {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.resetGenre {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--MI_THEME-accent);
	font-size: 0.82rem;
	font-weight: 700;
	text-decoration: none;
}

.empty {
	display: grid;
	justify-items: center;
	gap: 10px;
	padding: 48px 20px;
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

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	gap: 14px;
}

.releaseRail {
	display: flex;
	gap: 12px;
	overflow-x: auto;
	overflow-y: hidden;
	padding: 1px 1px 10px;
	scroll-padding-inline: 1px;
	scroll-snap-type: x proximity;
	scrollbar-color: color-mix(in srgb, var(--MI_THEME-accent) 55%, transparent) transparent;
}

.releaseListItem {
	flex: 0 0 clamp(145px, 16.5vw, 184px);
	scroll-snap-align: start;
}

.releaseCard {
	display: block;
	height: 100%;
	overflow: hidden;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 78%, transparent);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.releaseCard:hover {
	transform: translateY(-3px);
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 50%, var(--MI_THEME-divider));
	box-shadow: 0 12px 28px color-mix(in srgb, var(--MI_THEME-shadow) 32%, transparent);
}

.releaseCard:focus-visible {
	outline: 2px solid var(--MI_THEME-accent);
	outline-offset: 3px;
}

.releasePoster {
	position: relative;
	display: grid;
	place-items: center;
	overflow: hidden;
	aspect-ratio: 2 / 3;
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 26%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 2rem;
}

.releasePoster::after {
	position: absolute;
	inset: 40% 0 0;
	background: linear-gradient(transparent, color-mix(in srgb, var(--MI_THEME-bg) 84%, transparent));
	content: '';
	pointer-events: none;
}

.releasePoster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.releaseBadge {
	position: absolute;
	z-index: 1;
	bottom: 8px;
	left: 8px;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	max-width: calc(100% - 16px);
	overflow: hidden;
	padding: 4px 7px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 82%, transparent);
	backdrop-filter: blur(8px);
	color: var(--MI_THEME-fg);
	font-size: 0.67rem;
	font-weight: 700;
	line-height: 1.2;
}

.releaseBadge i {
	flex: 0 0 auto;
	color: var(--MI_THEME-accent);
	font-size: 0.78rem;
}

.releaseBadgeText {
	overflow: hidden;
	min-width: 0;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.releaseBody {
	display: grid;
	gap: 4px;
	padding: 10px 11px 12px;
}

.releaseBody strong,
.releaseBody span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.releaseBody strong {
	font-size: 0.86rem;
	line-height: 1.25;
}

.releaseBody span {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.74rem;
}

.credits {
	margin: 22px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.credits a {
	color: var(--MI_THEME-accent);
}

.card {
	overflow: hidden;
	border-radius: 16px;
	background: var(--MI_THEME-panel);
	text-decoration: none;
	color: var(--MI_THEME-fg);
	transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
	transform: translateY(-3px);
	box-shadow: 0 12px 30px color-mix(in srgb, var(--MI_THEME-shadow) 38%, transparent);
}

.poster {
	display: grid;
	place-items: center;
	aspect-ratio: 2 / 3;
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 26%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 2.3rem;
}

.poster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.cardBody {
	padding: 12px;
}

.cardBody p, .cardBody span {
	margin: 0;
	font-size: 0.78rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

.cardBody h3 {
	margin: 5px 0;
	font-size: 0.95rem;
	line-height: 1.25;
}

@media (max-width: 600px) {
	.page {
		padding-top: 12px;
	}

	.hero {
		grid-template-columns: 1fr;
		padding: 28px 22px;
	}

	.search {
		margin-top: 20px;
	}

	.orb {
		display: none;
	}

	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.releaseRail {
		gap: 10px;
		margin-right: calc(var(--MI-margin) * -1);
		padding-right: var(--MI-margin);
	}

	.releaseListItem {
		flex-basis: 142px;
	}

	.catalogueControls {
		align-items: stretch;
	}

	.filterLine {
		align-items: stretch;
		flex-direction: column;
	}

	.sortControl {
		align-self: flex-start;
	}
}
</style>
