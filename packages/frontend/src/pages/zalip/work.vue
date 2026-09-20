<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1180px;">
		<div :class="$style.page">
			<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin"></i> Загружаем тайтл…</div>
			<div v-else-if="work == null" :class="$style.state"><i class="ti ti-movie-off"></i> Тайтл не найден или ещё не опубликован.</div>
			<article v-else :class="$style.work">
				<section :class="$style.hero">
					<div v-if="work.backdropPath" :class="$style.heroBackground" aria-hidden="true">
						<img :src="tmdbBackdrop(work.backdropPath)" alt="" loading="lazy">
					</div>
					<div :class="$style.heroContent">
						<aside :class="$style.sidebar">
							<div :class="$style.poster">
								<img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title">
								<i v-else class="ti ti-movie"></i>
							</div>
							<div :class="$style.sidebarActions">
								<button type="button" class="_button" :class="$style.watchButton" @click="openPlayer"><i class="ti ti-player-play-filled"></i><span>{{ i18n.ts.zalip.watchTitle }}</span></button>
								<button type="button" class="_button" :class="[$style.sideButton, { [$style.sideButtonActive]: saved }]" :disabled="saving" @click="showLibraryMenu"><i :class="saved ? 'ti ti-bookmark-filled' : 'ti ti-plus'"></i><span>{{ i18n.ts.zalip.addToList }}</span></button>
								<button type="button" class="_button" :class="$style.sideButton" @click="focusDiscussion"><i class="ti ti-messages"></i><span>{{ i18n.ts.zalip.discussTitle }}</span></button>
							</div>
							<div :class="$style.quickActions" role="group" :aria-label="i18n.ts.zalip.workActions">
								<button type="button" class="_button" :class="[$style.quickAction, { [$style.quickActionActive]: isFavorite }]" :aria-label="i18n.ts.zalip.favoriteTitle" :aria-pressed="isFavorite" :disabled="saving" @click="toggleFavorite"><i :class="isFavorite ? 'ti ti-star-filled' : 'ti ti-star'"></i><span>{{ i18n.ts.zalip.favoriteTitle }}</span></button>
								<button v-if="work.seasons.length" type="button" class="_button" :class="[$style.quickAction, { [$style.quickActionActive]: releaseSubscribed }]" :aria-label="i18n.ts.zalip.releaseSubscriptionTitle" :aria-pressed="releaseSubscribed" :disabled="saving" @click="toggleReleaseSubscription"><i :class="releaseSubscribed ? 'ti ti-bell-filled' : 'ti ti-bell'"></i><span>{{ i18n.ts.zalip.releaseSubscriptionTitle }}</span></button>
								<button type="button" class="_button" :class="[$style.quickAction, { [$style.quickActionActive]: personalRating != null }]" :aria-label="i18n.ts.zalip.ratingTitle" :disabled="saving" @click="choosePersonalRating"><i :class="personalRating == null ? 'ti ti-star' : 'ti ti-star-filled'"></i><span>{{ ratingLabel }}</span></button>
								<button type="button" class="_button" :class="$style.quickAction" :aria-label="i18n.ts.zalip.shareTitle" @click="shareWork"><i class="ti ti-share-3"></i><span>{{ i18n.ts.zalip.shareTitle }}</span></button>
							</div>
						</aside>
						<div :class="$style.info">
							<div :class="$style.titleArea">
								<div :class="$style.titleContent">
									<p :class="$style.kind">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span><span v-if="work.runtimeMinutes"> · {{ runtimeLabel(work.runtimeMinutes, work.kind) }}</span></p>
									<h1>{{ work.title }}</h1>
									<p v-if="work.originalTitle" :class="$style.original">{{ work.originalTitle }}</p>
									<div v-if="work.genres.length" :class="$style.genres" aria-label="Жанры"><MkA v-for="genre in work.genres" :key="genre" :to="genreLink(genre)">{{ genre }}</MkA></div>
									<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
									<p v-else :class="$style.description">Описание появится после редакторской проверки.</p>
								</div>
							</div>
						</div>
					</div>
				</section>
				<div :class="$style.content">
					<section ref="playerSection" :class="$style.player" aria-label="Просмотр">
						<div :class="$style.playerTabs">
							<button type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'player' }]" :aria-label="i18n.ts.zalip.playerTab" :aria-pressed="playerView === 'player'" :title="i18n.ts.zalip.playerTab" @click="openPlayer"><i class="ti ti-device-tv"></i><span>{{ i18n.ts.zalip.playerTab }}</span></button>
							<button v-if="work.trailerYoutubeKey" type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'trailer' }]" :aria-label="i18n.ts.zalip.trailerTab" :aria-pressed="playerView === 'trailer'" :title="i18n.ts.zalip.trailerTab" @click="openTrailer"><i class="ti ti-player-play"></i><span>{{ i18n.ts.zalip.trailerTab }}</span></button>
						</div>
						<div v-if="work.trailerYoutubeKey" v-show="playerView === 'trailer'" :class="$style.playerFrame"><iframe :src="youtubeEmbed(work.trailerYoutubeKey)" :title="`Официальный трейлер: ${work.title}`" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
						<div v-show="playerView === 'player'">
						<template v-if="$i">
							<p v-if="allohaPlayback == null" :class="$style.playerState"><i class="ti ti-loader-2 ti-spin"></i> Проверяем доступность в Alloha…</p>
							<template v-else-if="allohaPlayback.available">
								<div v-if="allohaPlayerOpen && activeAllohaIframe" :class="$style.playerFrame"><iframe :key="activeAllohaIframeKey" :src="activeAllohaIframe" :title="`Плеер Alloha: ${work.title}`" loading="lazy" referrerpolicy="origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
								<div v-else :class="$style.playerPreview">
									<img v-if="selectedEpisode?.stillPath" :src="tmdbBackdrop(selectedEpisode.stillPath)" alt="" loading="lazy">
									<img v-else-if="work.backdropPath" :src="tmdbBackdrop(work.backdropPath)" alt="" loading="lazy">
									<div :class="$style.playerPreviewShade">
										<span>ALLOHA · ПЛЕЕР</span>
										<strong>{{ selectedEpisode ? episodeLabel(selectedEpisode) : work.title }}</strong>
										<button type="button" class="_button" :class="$style.playerButton" @click="openAllohaPlayer"><i class="ti ti-player-play-filled"></i> Открыть плеер</button>
									</div>
								</div>
								<div :class="$style.playerToolbar">
									<button type="button" class="_button" :class="$style.episodeNav" :disabled="previousEpisode == null" aria-label="Предыдущая серия" @click="selectRelativeEpisode(-1)"><i class="ti ti-chevron-left"></i></button>
									<div :class="$style.nowPlaying"><span>Выбрано</span><strong>{{ selectedEpisode ? episodeLabel(selectedEpisode) : kindLabel(work.kind) }}</strong></div>
									<button type="button" class="_button" :class="$style.episodeNav" :disabled="nextEpisode == null" aria-label="Следующая серия" @click="selectRelativeEpisode(1)"><i class="ti ti-chevron-right"></i></button>
									<label v-if="allohaPlayback.translations.length > 1" :class="$style.translation"><i class="ti ti-language"></i><span class="_visuallyHidden">Озвучка</span><select v-model="selectedAllohaTranslationId" class="_input" aria-label="Озвучка Alloha"><option v-for="translation in allohaPlayback.translations" :key="translation.id" :value="translation.id">{{ translationLabel(translation) }}</option></select></label>
									<span v-else :class="$style.providerLabel">Alloha</span>
								</div>
								<p :class="$style.providerNotice">{{ i18n.ts.zalip.playerEpisodeSwitchNotice }}</p>
							</template>
							<p v-else :class="$style.playerUnavailable"><i class="ti ti-clock"></i> В Alloha этот тайтл пока не найден. Доступность проверяется автоматически раз в час.</p>
						</template>
						<p v-else :class="$style.playerUnavailable"><i class="ti ti-login"></i> Войдите в Zalip, чтобы открыть плеер и сохранить подписку на новые серии.</p>
						</div>

						<div v-if="playerView === 'player' && work.seasons.length" :class="$style.playerEpisodes">
							<div :class="$style.seasonPicker"><span>Сезон</span><div><button v-for="season in work.seasons" :key="season.id" type="button" class="_button" :class="[$style.seasonPill, { [$style.selectedSeasonPill]: selectedSeasonNumber === season.seasonNumber }]" @click="selectSeason(season)">{{ season.seasonNumber === 0 ? 'Спец.' : season.seasonNumber }}</button></div></div>
							<p v-if="episodesPending" :class="$style.episodeRailState"><i class="ti ti-loader-2 ti-spin"></i> Загружаем эпизоды…</p>
							<p v-else-if="episodes.length === 0" :class="$style.episodeRailState">Список серий пока готовится редактором.</p>
							<div v-else :class="$style.episodeRail" aria-label="Серии выбранного сезона">
								<button v-for="episode in episodes" :key="episode.id" type="button" class="_button" :class="[$style.episodeTile, { [$style.selectedEpisodeTile]: selectedEpisode?.id === episode.id }]" :aria-pressed="selectedEpisode?.id === episode.id" @click="selectEpisode(episode)">
									<img v-if="episode.stillPath" :src="tmdbGalleryImage(episode.stillPath)" :alt="`Кадр: ${episodeLabel(episode)}`" loading="lazy">
									<span v-else :class="$style.episodeTileFallback"><i class="ti ti-device-tv"></i></span>
									<strong>Эпизод {{ episode.episodeNumber }}</strong>
									<small>{{ episode.title }}</small>
								</button>
							</div>
						</div>
					</section>
					<section v-if="selectedEpisode" :class="$style.episodeGuide">
						<div v-if="selectedEpisode.stillPath" :class="$style.episodeGuideStill"><img :src="tmdbGalleryImage(selectedEpisode.stillPath)" :alt="`Кадр: ${episodeLabel(selectedEpisode)}`" loading="lazy"></div>
						<div :class="$style.episodeGuideContent">
							<p>{{ i18n.ts.zalip.episodeInformation }}</p>
							<h2>{{ episodeLabel(selectedEpisode) }}</h2>
							<span v-if="selectedEpisode.runtimeMinutes || selectedEpisode.airDate">{{ episodeMeta(selectedEpisode) }}</span>
							<p v-if="selectedEpisode.description">{{ selectedEpisode.description }}</p>
							<button type="button" class="_button" :class="$style.episodeDiscussButton" @click="selectDiscussionScope('episode')"><i class="ti ti-messages"></i> {{ selectedEpisode.discussionNoteId ? i18n.ts.zalip.episodeComments : i18n.ts.zalip.discussEpisode }}</button>
						</div>
					</section>
					<section v-if="work.galleryPaths.length" :class="$style.gallery">
						<h2><i class="ti ti-photo"></i> Кадры</h2>
						<div :class="$style.galleryGrid">
							<a v-for="path in work.galleryPaths" :key="path" :href="tmdbBackdrop(path)" target="_blank" rel="noopener noreferrer" :aria-label="`Открыть кадр из ${work.title}`"><img :src="tmdbGalleryImage(path)" alt="" loading="lazy"></a>
						</div>
					</section>
					<section ref="discussionSection" :class="$style.discussionArea">
						<div v-if="work.seasons.length" :class="$style.discussionScope" role="group" :aria-label="i18n.ts.zalip.discussionContext">
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'work' }]" :aria-pressed="discussionScope === 'work'" @click="selectDiscussionScope('work')"><i class="ti ti-movie"></i> {{ i18n.ts.zalip.workDiscussionScope }}</button>
							<button v-if="selectedEpisode" type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'episode' }]" :aria-pressed="discussionScope === 'episode'" @click="selectDiscussionScope('episode')"><i class="ti ti-device-tv"></i> {{ episodeLabel(selectedEpisode) }}</button>
						</div>
						<ZalipDiscussionPanel v-if="activeDiscussionNoteId" :noteId="activeDiscussionNoteId" :heading="activeDiscussionHeading"/>
						<section v-else :class="$style.discussionPending">
							<p><i class="ti ti-messages"></i> {{ activeDiscussionEmptyText }}</p>
							<button v-if="$i" type="button" class="_button" :class="$style.openDiscussion" :disabled="openingDiscussionScope != null" @click="openActiveDiscussion"><i :class="openingDiscussionScope != null ? 'ti ti-loader-2 ti-spin' : 'ti ti-message-plus'"></i> {{ openingDiscussionScope != null ? i18n.ts.zalip.openingDiscussion : i18n.ts.zalip.startDiscussion }}</button>
							<button v-else type="button" class="_button" :class="$style.openDiscussion" @click="signInForDiscussion"><i class="ti ti-login"></i> {{ i18n.ts.zalip.loginToComment }}</button>
							<p v-if="discussionError" :class="$style.discussionError">{{ discussionError }}</p>
						</section>
					</section>
				</div>
			</article>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, watch } from 'vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import ZalipDiscussionPanel from '@/components/ZalipDiscussionPanel.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';

type ZalipWork = {
	id: string;
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	genres: string[];
	runtimeMinutes: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	galleryPaths: string[];
	trailerYoutubeKey: string | null;
	seasons: Array<{
		id: string;
		seasonNumber: number;
		title: string;
		originalTitle: string | null;
		description: string | null;
		posterPath: string | null;
		airDate: string | null;
		episodeCount: number | null;
	}>;
};

type ZalipSeason = ZalipWork['seasons'][number];

type ZalipEpisode = {
	id: string;
	episodeNumber: number;
	title: string;
	originalTitle: string | null;
	description: string | null;
	airDate: string | null;
	stillPath: string | null;
	runtimeMinutes: number | null;
	discussionNoteId: string | null;
};

type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';

type LibraryEntry = {
	status: LibraryStatus;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	isReleaseSubscribed: boolean;
	work: { id: string };
};

type LibraryUpdate = Pick<LibraryEntry, 'status' | 'episodesWatched' | 'personalRating' | 'isFavorite' | 'isReleaseSubscribed'>;

type AllohaPlayback = {
	available: boolean;
	iframe: string | null;
	translations: Array<{ id: number; name: string; quality: string | null; resolutions: string[]; iframe: string }>;
	lastCheckedAt: string | null;
};

const props = defineProps<{ slug: string }>();
const work = ref<ZalipWork | null>(null);
const pending = ref(true);
const saving = ref(false);
const saved = ref(false);
const libraryStatus = ref<LibraryStatus>('planned');
const episodesWatched = ref(0);
const personalRating = ref<number | null>(null);
const isFavorite = ref(false);
const releaseSubscribed = ref(false);
const playerView = ref<'player' | 'trailer'>('player');
const allohaPlayback = ref<AllohaPlayback | null>(null);
const allohaPlayerOpen = ref(false);
const selectedAllohaTranslationId = ref<number | null>(null);
const discussionNoteId = ref<string | null>(null);
const discussionError = ref<string | null>(null);
const discussionScope = ref<'work' | 'episode'>('work');
const openingDiscussionScope = ref<'work' | 'episode' | null>(null);
const discussionSection = ref<HTMLElement | null>(null);
const playerSection = ref<HTMLElement | null>(null);
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodeRequestId = ref(0);
const selectedEpisodeId = ref<string | null>(null);
const selectedEpisode = computed(() => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null);

const activeAllohaIframe = computed(() => {
	if (allohaPlayback.value == null) return null;
	const iframe = allohaPlayback.value.translations.find(translation => translation.id === selectedAllohaTranslationId.value)?.iframe
		?? allohaPlayback.value.iframe
		?? allohaPlayback.value.translations[0]?.iframe
		?? null;
	if (iframe == null || selectedEpisode.value == null || selectedSeasonNumber.value == null) return iframe;
	try {
		const url = new URL(iframe);
		url.searchParams.set('season', selectedSeasonNumber.value.toString());
		url.searchParams.set('episode', selectedEpisode.value.episodeNumber.toString());
		return url.toString();
	} catch {
		return iframe;
	}
});

const activeAllohaIframeKey = computed(() => [
	selectedSeasonNumber.value ?? 'movie',
	selectedEpisode.value?.id ?? 'title',
	selectedAllohaTranslationId.value ?? 'default',
].join(':'));
const selectedEpisodeIndex = computed(() => selectedEpisode.value == null ? -1 : episodes.value.findIndex(episode => episode.id === selectedEpisode.value?.id));
const previousEpisode = computed(() => selectedEpisodeIndex.value > 0 ? episodes.value[selectedEpisodeIndex.value - 1] ?? null : null);
const nextEpisode = computed(() => selectedEpisodeIndex.value >= 0 ? episodes.value[selectedEpisodeIndex.value + 1] ?? null : null);
const activeDiscussionNoteId = computed(() => discussionScope.value === 'episode' ? selectedEpisode.value?.discussionNoteId ?? null : discussionNoteId.value);
const ratingLabel = computed(() => personalRating.value == null ? i18n.ts.zalip.ratingUnset : i18n.tsx.zalip.ratingValue({ rating: personalRating.value.toString() }));
const activeDiscussionHeading = computed(() => {
	if (discussionScope.value === 'episode' && selectedEpisode.value != null && work.value != null) return i18n.tsx.zalip.episodeDiscussionHeading({ title: work.value.title, episode: episodeLabel(selectedEpisode.value) });
	return work.value == null ? i18n.ts.zalip.comments : i18n.tsx.zalip.workDiscussionHeading({ title: work.value.title });
});
const activeDiscussionEmptyText = computed(() => discussionScope.value === 'episode' && selectedEpisode.value != null
	? i18n.tsx.zalip.emptyEpisodeDiscussion({ episode: episodeLabel(selectedEpisode.value) })
	: i18n.ts.zalip.emptyWorkDiscussion);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function tmdbBackdrop(path: string): string {
	return `https://image.tmdb.org/t/p/w1280${path}`;
}

function tmdbGalleryImage(path: string): string {
	return `https://image.tmdb.org/t/p/w780${path}`;
}

function youtubeEmbed(key: string): string {
	return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?rel=0&modestbranding=1`;
}

function kindLabel(kind: ZalipWork['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

function runtimeLabel(runtimeMinutes: number, kind: ZalipWork['kind']): string {
	return kind === 'movie' ? `${runtimeMinutes} мин.` : `~${runtimeMinutes} мин./эп.`;
}

function episodeLabel(episode: ZalipEpisode): string {
	return `Серия ${episode.episodeNumber}: ${episode.title}`;
}

function genreLink(genre: string): string {
	return `/?genre=${encodeURIComponent(genre)}`;
}

function episodeMeta(episode: ZalipEpisode): string {
	return [episode.airDate?.slice(0, 4), episode.runtimeMinutes != null ? `${episode.runtimeMinutes} мин.` : null].filter((value): value is string => value != null).join(' · ');
}

function translationLabel(translation: AllohaPlayback['translations'][number]): string {
	return [translation.name, translation.quality, translation.resolutions.join('/')].filter((value): value is string => value != null && value !== '').join(' · ');
}

function libraryStatusText(status: LibraryStatus): string {
	return ({
		planned: i18n.ts.zalip.libraryPlanned,
		watching: i18n.ts.zalip.libraryWatching,
		on_hold: i18n.ts.zalip.libraryOnHold,
		completed: i18n.ts.zalip.libraryCompleted,
		dropped: i18n.ts.zalip.libraryDropped,
	})[status];
}

function libraryStatusCaption(status: LibraryStatus): string {
	return ({
		planned: i18n.ts.zalip.libraryPlannedCaption,
		watching: i18n.ts.zalip.libraryWatchingCaption,
		on_hold: i18n.ts.zalip.libraryOnHoldCaption,
		completed: i18n.ts.zalip.libraryCompletedCaption,
		dropped: i18n.ts.zalip.libraryDroppedCaption,
	})[status];
}

function libraryStatusIcon(status: LibraryStatus): string {
	return ({
		planned: 'ti ti-bookmark',
		watching: 'ti ti-eye',
		on_hold: 'ti ti-player-pause',
		completed: 'ti ti-check',
		dropped: 'ti ti-x',
	})[status];
}

async function load(): Promise<void> {
	pending.value = true;
	work.value = null;
	saved.value = false;
	libraryStatus.value = 'planned';
	episodesWatched.value = 0;
	personalRating.value = null;
	isFavorite.value = false;
	releaseSubscribed.value = false;
	playerView.value = 'player';
	allohaPlayback.value = null;
	allohaPlayerOpen.value = false;
	selectedAllohaTranslationId.value = null;
	discussionError.value = null;
	discussionScope.value = 'work';
	openingDiscussionScope.value = null;
	selectedSeasonNumber.value = null;
	episodes.value = [];
	selectedEpisodeId.value = null;
	episodeRequestId.value++;
	try {
		work.value = await misskeyApiZalip<ZalipWork>('zalip/works/show', { slug: props.slug });
		const [discussion, entries, playback] = await Promise.all([
			misskeyApiZalip<{ noteId: string | null }>('zalip/discussions/show', { workId: work.value.id }),
			$i ? misskeyApiZalip<LibraryEntry[]>('zalip/library/list') : Promise.resolve([]),
			$i ? misskeyApiZalip<AllohaPlayback>('zalip/playback/alloha/show', { slug: work.value.slug }).catch(() => null) : Promise.resolve(null),
		]);
		discussionNoteId.value = discussion.noteId;
		const entry = entries.find(candidate => candidate.work?.id === work.value?.id);
		saved.value = entry != null;
		libraryStatus.value = entry?.status ?? 'planned';
		episodesWatched.value = entry?.episodesWatched ?? 0;
		personalRating.value = entry?.personalRating ?? null;
		isFavorite.value = entry?.isFavorite ?? false;
		releaseSubscribed.value = entry?.isReleaseSubscribed ?? false;
		allohaPlayback.value = playback;
		selectedAllohaTranslationId.value = playback?.translations[0]?.id ?? null;
		const initialSeason = work.value.seasons.find(season => season.seasonNumber > 0) ?? work.value.seasons[0];
		if (initialSeason != null) void selectSeason(initialSeason);
	} catch {
		work.value = null;
		discussionNoteId.value = null;
	} finally {
		pending.value = false;
	}
}

async function loadSeason(season: ZalipSeason): Promise<void> {
	if (work.value == null) return;
	const requestId = ++episodeRequestId.value;
	selectedSeasonNumber.value = season.seasonNumber;
	episodes.value = [];
	selectedEpisodeId.value = null;
	if (discussionScope.value === 'episode') discussionScope.value = 'work';
	episodesPending.value = true;
	try {
		const loadedEpisodes = await misskeyApiZalip<ZalipEpisode[]>('zalip/seasons/episodes', {
			slug: work.value.slug,
			seasonNumber: season.seasonNumber,
		});
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = loadedEpisodes;
			selectedEpisodeId.value = loadedEpisodes.find(episode => episode.episodeNumber > episodesWatched.value)?.id
				?? loadedEpisodes[0]?.id
				?? null;
		}
	} catch {
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = [];
		}
	} finally {
		if (episodeRequestId.value === requestId) episodesPending.value = false;
	}
}

async function selectSeason(season: ZalipSeason): Promise<void> {
	if (selectedSeasonNumber.value === season.seasonNumber && (episodes.value.length > 0 || episodesPending.value)) return;
	await loadSeason(season);
}

function selectEpisode(episode: ZalipEpisode): void {
	selectedEpisodeId.value = episode.id;
	discussionScope.value = 'episode';
}

function selectRelativeEpisode(offset: -1 | 1): void {
	const episode = offset === -1 ? previousEpisode.value : nextEpisode.value;
	if (episode != null) selectEpisode(episode);
}

function openAllohaPlayer(): void {
	if (allohaPlayback.value?.available) allohaPlayerOpen.value = true;
}

async function selectDiscussionScope(scope: 'work' | 'episode'): Promise<void> {
	if (scope === 'episode' && selectedEpisode.value == null) return;
	discussionScope.value = scope;
	await nextTick();
	focusDiscussion();
}

function focusDiscussion(): void {
	discussionSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function focusPlayer(): void {
	playerSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openPlayer(): void {
	playerView.value = 'player';
	focusPlayer();
	if ($i && allohaPlayback.value?.available) allohaPlayerOpen.value = true;
}

function openTrailer(): void {
	playerView.value = 'trailer';
	focusPlayer();
}

async function signInForDiscussion(): Promise<void> {
	await pleaseLogin({ path: window.location.pathname + window.location.search });
}

async function openActiveDiscussion(): Promise<void> {
	if (!$i || work.value == null || openingDiscussionScope.value != null) return;
	const scope = discussionScope.value;
	const episode = selectedEpisode.value;
	if (scope === 'episode' && episode == null) return;
	openingDiscussionScope.value = scope;
	discussionError.value = null;
	try {
		if (scope === 'episode' && episode != null) {
			const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/episodes/discussions/ensure', { episodeId: episode.id });
			episode.discussionNoteId = discussion.noteId;
		} else {
			const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/discussions/ensure', { workId: work.value.id });
			discussionNoteId.value = discussion.noteId;
		}
		await nextTick();
		focusDiscussion();
	} catch {
		discussionError.value = scope === 'episode' ? i18n.ts.zalip.openEpisodeDiscussionFailed : i18n.ts.zalip.openWorkDiscussionFailed;
	} finally {
		openingDiscussionScope.value = null;
	}
}

function normalizedEpisodesWatched(): number {
	return Number.isFinite(episodesWatched.value) ? Math.max(0, Math.trunc(episodesWatched.value)) : 0;
}

function applyLibraryEntry(entry: LibraryEntry): void {
	saved.value = true;
	libraryStatus.value = entry.status;
	episodesWatched.value = entry.episodesWatched;
	personalRating.value = entry.personalRating;
	isFavorite.value = entry.isFavorite;
	releaseSubscribed.value = entry.isReleaseSubscribed;
}

async function updateLibrary(patch: Partial<LibraryUpdate> = {}): Promise<void> {
	if (work.value == null || !$i) return;
	saving.value = true;
	try {
		const entry = await misskeyApiZalip<LibraryEntry>('zalip/library/update', {
			workId: work.value.id,
			status: libraryStatus.value,
			episodesWatched: normalizedEpisodesWatched(),
			personalRating: personalRating.value,
			isFavorite: isFavorite.value,
			isReleaseSubscribed: releaseSubscribed.value,
			...patch,
		});
		applyLibraryEntry(entry);
	} finally {
		saving.value = false;
	}
}

async function showLibraryMenu(event: MouseEvent): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (work.value == null) return;
	void os.popupMenu([
		{ type: 'label', text: i18n.ts.zalip.libraryMenuTitle, caption: work.value.title },
		{
			text: i18n.ts.zalip.favoriteTitle,
			caption: i18n.ts.zalip.favoriteCaption,
			icon: isFavorite.value ? 'ti ti-star-filled' : 'ti ti-star',
			active: isFavorite.value,
			action: () => void toggleFavorite(),
		},
		null,
		{ type: 'label', text: i18n.ts.zalip.libraryStatusHeading },
		...(['planned', 'watching', 'on_hold', 'completed', 'dropped'] as const).map(status => ({
			text: libraryStatusText(status),
			caption: libraryStatusCaption(status),
			icon: libraryStatusIcon(status),
			active: saved.value && libraryStatus.value === status,
			action: () => void setLibraryStatus(status),
		})),
	], event.currentTarget, { align: 'left', width: 320 });
}

async function setLibraryStatus(status: LibraryStatus): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (saving.value) return;
	const previousStatus = libraryStatus.value;
	libraryStatus.value = status;
	try {
		await updateLibrary({ status });
	} catch {
		libraryStatus.value = previousStatus;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function toggleFavorite(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (saving.value) return;
	const previousFavorite = isFavorite.value;
	isFavorite.value = !isFavorite.value;
	try {
		await updateLibrary({ isFavorite: isFavorite.value });
	} catch {
		isFavorite.value = previousFavorite;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function toggleReleaseSubscription(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (saving.value) return;
	const previousSubscription = releaseSubscribed.value;
	releaseSubscribed.value = !releaseSubscribed.value;
	try {
		await updateLibrary({ isReleaseSubscribed: releaseSubscribed.value });
	} catch {
		releaseSubscribed.value = previousSubscription;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function choosePersonalRating(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (saving.value) return;
	const { canceled, result } = await os.select({
		title: i18n.ts.zalip.ratingTitle,
		default: personalRating.value ?? 0,
		items: [
			{ value: 0, label: i18n.ts.zalip.ratingClear },
			...Array.from({ length: 10 }, (_, index) => {
				const rating = index + 1;
				return { value: rating, label: i18n.tsx.zalip.ratingValue({ rating: rating.toString() }) };
			}),
		],
	});
	if (canceled || result == null) return;
	const previousRating = personalRating.value;
	personalRating.value = result === 0 ? null : result;
	try {
		await updateLibrary({ personalRating: personalRating.value });
	} catch {
		personalRating.value = previousRating;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

function shareWork(): void {
	if (work.value == null) return;
	const { id, slug, kind, title, description, releaseYear, genres, posterPath } = work.value;
	void os.post({
		zalipWork: { id, slug, kind, title, description, releaseYear, genres, posterPath },
	});
}

watch(() => props.slug, () => void load(), { immediate: true });

definePage(() => ({
	title: work.value?.title ?? 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.page {
	padding: 24px var(--MI-margin) 52px;
}

.state {
	display: grid;
	place-items: center;
	gap: 10px;
	min-height: 240px;
	border: 1px dashed var(--MI_THEME-divider);
	border-radius: 20px;
	color: var(--MI_THEME-fgTransparentWeak);
}

.state i {
	font-size: 2rem;
	color: var(--MI_THEME-accent);
}

.work {
	display: grid;
	gap: 24px;
}

.hero {
	position: relative;
	min-height: 480px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: calc(var(--MI-radius) * 2);
	background: var(--MI_THEME-panel);
}

.hero::after {
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, color-mix(in srgb, var(--MI_THEME-bg) 96%, transparent) 0%, color-mix(in srgb, var(--MI_THEME-bg) 78%, transparent) 50%, color-mix(in srgb, var(--MI_THEME-bg) 56%, transparent) 100%), linear-gradient(0deg, color-mix(in srgb, var(--MI_THEME-bg) 98%, transparent) 0%, color-mix(in srgb, var(--MI_THEME-bg) 38%, transparent) 62%, color-mix(in srgb, var(--MI_THEME-bg) 60%, transparent) 100%);
	content: '';
	pointer-events: none;
}

.heroBackground {
	position: absolute;
	inset: 0;
	opacity: 0.9;
}

.heroBackground img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.heroContent {
	position: relative;
	z-index: 1;
	display: grid;
	grid-template-columns: minmax(190px, 230px) minmax(0, 1fr);
	align-items: end;
	gap: 32px;
	min-height: 480px;
	padding: 42px;
}

.content {
	min-width: 0;
}

.sidebar {
	align-self: start;
}

.poster {
	display: grid;
	place-items: center;
	overflow: hidden;
	aspect-ratio: 2 / 3;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-fg) 16%, transparent);
	border-radius: calc(var(--MI-radius) + 4px);
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 30%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 3rem;
}

.poster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.sidebarActions {
	display: grid;
	gap: 8px;
	margin-top: 12px;
}

.watchButton, .sideButton {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 42px;
	padding: 9px 12px;
	border-radius: calc(var(--MI-radius) / 1.2);
	font-size: 0.86rem;
	font-weight: 750;
}

.watchButton {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.sideButton {
	border: 1px solid color-mix(in srgb, var(--MI_THEME-fg) 18%, transparent);
	background: color-mix(in srgb, var(--MI_THEME-panel) 82%, transparent);
	backdrop-filter: blur(12px);
	color: var(--MI_THEME-fg);
}

.sideButtonActive {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 72%, var(--MI_THEME-divider));
	color: var(--MI_THEME-accent);
}

.quickActions {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 6px;
	margin-top: 8px;
}

.quickAction:last-child:nth-child(odd) {
	grid-column: 1 / -1;
}

.quickAction {
	display: flex;
	min-width: 0;
	min-height: 34px;
	align-items: center;
	justify-content: center;
	gap: 5px;
	padding: 6px 4px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-fg) 14%, transparent);
	border-radius: calc(var(--MI-radius) / 1.35);
	background: color-mix(in srgb, var(--MI_THEME-panel) 72%, transparent);
	backdrop-filter: blur(12px);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.66rem;
	font-weight: 700;
	white-space: nowrap;
}

.quickAction i {
	font-size: 0.9rem;
}

.quickActionActive {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 68%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--MI_THEME-accent) 16%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
}

.titleArea {
	scroll-margin-top: 72px;
}

.kind {
	margin: 5px 0 8px;
	font-size: 0.78rem;
	font-weight: 700;
	letter-spacing: 0.09em;
	color: var(--MI_THEME-accent);
}

.info h1 {
	margin: 0;
	font-size: clamp(2.15rem, 5vw, 3.75rem);
	line-height: 1.08;
	letter-spacing: -0.035em;
}

.original {
	margin: 8px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
}

.genres {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	margin-top: 12px;
}

.genres a {
	display: inline-flex;
	align-items: center;
	padding: 5px 9px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 650;
	text-decoration: none;
	transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.genres a:hover, .genres a:focus-visible {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 65%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--MI_THEME-accent) 14%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
}

.description {
	max-width: 800px;
	margin: 18px 0 0;
	white-space: pre-line;
	line-height: 1.6;
	color: color-mix(in srgb, var(--MI_THEME-fg) 82%, transparent);
}

.gallery {
	margin-top: 24px;
}

.gallery h2 {
	display: flex;
	align-items: center;
	gap: 7px;
	margin: 0 0 10px;
	font-size: 1rem;
}

.gallery h2 i {
	color: var(--MI_THEME-accent);
}

.galleryGrid {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 8px;
}

.galleryGrid a {
	display: block;
	overflow: hidden;
	aspect-ratio: 16 / 9;
	border-radius: 10px;
	background: var(--MI_THEME-panelHighlight);
}

.galleryGrid img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	transition: transform 0.18s ease;
}

.galleryGrid a:hover img, .galleryGrid a:focus-visible img {
	transform: scale(1.04);
}

.seasons {
	margin-top: 24px;
}

.seasons h2 {
	margin: 0 0 10px;
	font-size: 1rem;
}

.player {
	margin-top: 24px;
	scroll-margin-top: 72px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 18px;
	background: var(--MI_THEME-panel);
}

.playerTabs {
	display: flex;
	align-items: center;
	min-height: 54px;
	gap: 8px;
	padding: 0 14px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	overflow-x: auto;
}

.playerTab, .playerTabActive {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	min-height: 52px;
	border-bottom: 2px solid transparent;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.84rem;
	font-weight: 700;
	text-decoration: none;
	white-space: nowrap;
}

.playerTabActive {
	border-color: var(--MI_THEME-accent);
	color: var(--MI_THEME-fg);
}

.playerState, .playerUnavailable {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	padding: 24px 18px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.86rem;
}

.playerPreview, .playerFrame {
	position: relative;
	overflow: hidden;
	aspect-ratio: 16 / 9;
	background: #050607;
}

.playerPreview > img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
	opacity: 0.68;
}

.playerPreviewShade {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: 24px;
	background: linear-gradient(90deg, rgb(0 0 0 / 74%), rgb(0 0 0 / 35%)), linear-gradient(0deg, rgb(0 0 0 / 56%), transparent 58%);
	color: #fff;
	text-align: center;
}

.playerPreviewShade > span {
	font-size: 0.7rem;
	font-weight: 800;
	letter-spacing: 0.12em;
	color: color-mix(in srgb, var(--MI_THEME-accent) 72%, white);
}

.playerPreviewShade > strong {
	max-width: 540px;
	font-size: clamp(1.1rem, 3vw, 1.7rem);
	line-height: 1.15;
}

.playerButton {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
	padding: 10px 14px;
	border-radius: 10px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-weight: 800;
}

.playerFrame iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
}

.playerToolbar {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto minmax(140px, 0.8fr);
	align-items: center;
	gap: 8px;
	padding: 10px 12px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: color-mix(in srgb, var(--MI_THEME-bg) 35%, var(--MI_THEME-panel));
}

.episodeNav {
	display: grid;
	place-items: center;
	width: 34px;
	height: 34px;
	border-radius: 9px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
}

.episodeNav:disabled {
	opacity: 0.42;
}

.nowPlaying {
	display: grid;
	gap: 1px;
	min-width: 0;
}

.nowPlaying span {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.68rem;
	font-weight: 650;
}

.nowPlaying strong {
	overflow: hidden;
	font-size: 0.82rem;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.translation {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	padding: 0 8px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 9px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
}

.translation select {
	min-width: 0;
	width: 100%;
	height: 34px;
	padding: 0;
	border: 0;
	background: transparent;
	color: var(--MI_THEME-fg);
	font-size: 0.78rem;
}

.providerLabel {
	justify-self: end;
	padding: 8px 10px;
	border-radius: 9px;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 700;
}

.providerNotice {
	margin: 0;
	padding: 10px 14px 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.74rem;
	line-height: 1.45;
}

.playerEpisodes {
	padding: 14px;
	scroll-margin-top: 80px;
}

.seasonPicker {
	display: flex;
	align-items: center;
	gap: 10px;
	margin-bottom: 12px;
}

.seasonPicker > span {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 700;
}

.seasonPicker > div {
	display: flex;
	gap: 5px;
	overflow-x: auto;
}

.seasonPill {
	min-width: 32px;
	min-height: 30px;
	padding: 0 8px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: calc(var(--MI-radius) / 2);
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 750;
}

.selectedSeasonPill {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 68%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--MI_THEME-accent) 18%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
}

.episodeRailState {
	margin: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.8rem;
}

.episodeRail {
	display: flex;
	gap: 10px;
	overflow-x: auto;
	padding-bottom: 2px;
	scroll-snap-type: x proximity;
}

.episodeTile {
	display: grid;
	grid-template-rows: 70px auto auto;
	gap: 4px;
	flex: 0 0 122px;
	overflow: hidden;
	padding: 0 0 8px;
	border: 1px solid transparent;
	border-radius: 10px;
	background: transparent;
	color: var(--MI_THEME-fg);
	text-align: left;
	scroll-snap-align: start;
}

.episodeTile > img, .episodeTileFallback {
	width: 100%;
	height: 70px;
	border-radius: 9px;
	object-fit: cover;
	background: var(--MI_THEME-panelHighlight);
}

.episodeTileFallback {
	display: grid;
	place-items: center;
	color: var(--MI_THEME-fgTransparentWeak);
}

.episodeTile strong, .episodeTile small {
	overflow: hidden;
	padding: 0 4px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.episodeTile strong {
	font-size: 0.76rem;
}

.episodeTile small {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.68rem;
}

.selectedEpisodeTile {
	border-color: var(--MI_THEME-accent);
	background: color-mix(in srgb, var(--MI_THEME-accent) 12%, var(--MI_THEME-panel));
}

.episodeGuide {
	display: grid;
	grid-template-columns: minmax(150px, 230px) minmax(0, 1fr);
	gap: 16px;
	margin-top: 18px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
	background: var(--MI_THEME-panel);
}

.episodeGuideStill {
	min-height: 150px;
	background: var(--MI_THEME-panelHighlight);
}

.episodeGuideStill img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.episodeGuideContent {
	display: grid;
	align-content: center;
	gap: 5px;
	padding: 16px 18px 16px 0;
}

.episodeGuideContent > p {
	margin: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.8rem;
	line-height: 1.5;
}

.episodeGuideContent > p:first-child {
	font-size: 0.72rem;
	font-weight: 750;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.episodeGuideContent h2 {
	margin: 0;
	font-size: 1.05rem;
}

.episodeGuideContent > span {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.episodeDiscussButton {
	justify-self: start;
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-top: 5px;
	padding: 7px 10px;
	border-radius: 8px;
	background: color-mix(in srgb, var(--MI_THEME-accent) 14%, var(--MI_THEME-panelHighlight));
	color: var(--MI_THEME-accent);
	font-size: 0.8rem;
	font-weight: 700;
}

.seasonList {
	display: grid;
	gap: 8px;
}

.seasonBlock {
	border-radius: 12px;
	background: var(--MI_THEME-panel);
}

.season {
	display: flex;
	width: 100%;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 11px 13px;
	border-radius: 12px;
	color: var(--MI_THEME-fg);
	text-align: left;
}

.selectedSeason {
	background: color-mix(in srgb, var(--MI_THEME-accent) 18%, var(--MI_THEME-panel));
}

.season strong {
	font-size: 0.9rem;
}

.season p, .season > span {
	margin: 3px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.episodes {
	display: grid;
	gap: 1px;
	margin: 0 12px 12px;
	overflow: hidden;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 10px;
}

.episode, .episodeState {
	margin: 0;
	padding: 10px 12px;
	background: var(--MI_THEME-panelHighlight);
}

.episode {
	display: grid;
	gap: 3px;
}

.episodeWithStill {
	grid-template-columns: 132px minmax(0, 1fr);
	gap: 10px;
}

.episodeStill {
	width: 100%;
	height: 100%;
	min-height: 74px;
	border-radius: 7px;
	object-fit: cover;
	background: var(--MI_THEME-panel);
}

.episodeContent {
	display: grid;
	gap: 3px;
}

.episode strong {
	font-size: 0.85rem;
}

.episode span, .episode p, .episodeState {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.episode p {
	margin: 4px 0 0;
	line-height: 1.45;
}

.episodeActions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.episodeActions a, .episodeActions button {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	padding: 5px 7px;
	border-radius: 7px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-accent);
	font-weight: 700;
	text-decoration: none;
}

.discussionArea {
	scroll-margin-top: 72px;
}

.discussionScope {
	display: flex;
	gap: 7px;
	margin-top: 28px;
	padding-bottom: 10px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	overflow-x: auto;
}

.scopeButton {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	padding: 8px 11px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.82rem;
	font-weight: 700;
}

.scopeButtonActive {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 64%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--MI_THEME-accent) 15%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
}

.discussionPending {
	margin-top: 28px;
	padding: 18px;
	border: 1px dashed var(--MI_THEME-divider);
	border-radius: 14px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.86rem;
}

.discussionPending p {
	margin: 0;
}

.discussionPending p + p {
	margin-top: 10px;
}

.openDiscussion {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	margin-top: 12px;
	padding: 8px 11px;
	border-radius: 9px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-weight: 700;
}

.discussionError {
	color: var(--MI_THEME-error);
}

@media (max-width: 600px) {
	.page {
		padding: 12px var(--MI-margin) 28px;
	}

	.work {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.hero {
		min-height: 0;
		border-radius: calc(var(--MI-radius) + 4px);
	}

	.hero::after {
		background: linear-gradient(0deg, color-mix(in srgb, var(--MI_THEME-bg) 96%, transparent) 0%, color-mix(in srgb, var(--MI_THEME-bg) 74%, transparent) 62%, color-mix(in srgb, var(--MI_THEME-bg) 54%, transparent) 100%);
	}

	.heroContent {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 18px;
		min-height: 0;
		padding: 108px 16px 18px;
	}

	.sidebar {
		display: grid;
		grid-template-columns: minmax(102px, 116px) minmax(0, 1fr);
		align-items: start;
		gap: 0 14px;
	}

	.poster {
		border-radius: calc(var(--MI-radius) + 2px);
	}

	.sidebarActions {
		grid-template-columns: minmax(0, 1fr);
		gap: 8px;
		margin: 0;
	}

	.quickActions {
		grid-column: 1 / -1;
		margin-top: 10px;
	}

	.quickAction {
		min-height: 38px;
		font-size: 0.7rem;
	}

	.watchButton, .sideButton {
		min-height: 44px;
		padding: 9px 10px;
		font-size: 0.78rem;
	}

	.watchButton {
		grid-column: auto;
	}

	.info {
		min-width: 0;
	}

	.kind {
		margin-top: 0;
	}

	.info h1 {
		font-size: clamp(1.7rem, 9vw, 2.2rem);
	}

	.description {
		margin-top: 16px;
		line-height: 1.55;
	}

	.galleryGrid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.episodeWithStill {
		grid-template-columns: 108px minmax(0, 1fr);
	}

	.playerTabs {
		min-height: 46px;
		gap: 2px;
		padding-inline: 8px;
	}

	.playerTab, .playerTabActive {
		min-height: 44px;
		padding: 0 7px;
		font-size: 0.72rem;
	}

	.playerToolbar {
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 10px;
		padding: 10px;
	}

	.episodeNav {
		width: 40px;
		height: 40px;
	}

	.translation, .providerLabel {
		grid-column: 1 / -1;
		justify-self: stretch;
	}

	.providerLabel {
		justify-self: stretch;
		text-align: center;
	}

	.episodeTile {
		flex-basis: 118px;
	}

	.episodeGuide {
		grid-template-columns: 1fr;
		gap: 0;
	}

	.episodeGuideStill {
		aspect-ratio: 16 / 8;
		min-height: 0;
	}

	.episodeGuideContent {
		padding: 14px;
	}

	.discussionScope {
		margin-top: 20px;
	}
}

@media (max-width: 420px) {
	.sidebar {
		grid-template-columns: 96px minmax(0, 1fr);
		gap: 0 12px;
	}

	.watchButton, .sideButton {
		padding-inline: 7px;
	}

	.playerTab, .playerTabActive {
		justify-content: center;
		min-width: 42px;
		padding-inline: 9px;
	}

	.playerTab > span, .playerTabActive > span {
		display: none;
	}

	.playerEpisodes {
		padding: 12px 10px;
	}

	.seasonPill {
		min-width: 36px;
		min-height: 36px;
	}
}
</style>
