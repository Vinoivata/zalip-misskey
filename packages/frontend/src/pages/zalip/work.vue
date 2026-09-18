<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 980px;">
		<div :class="$style.page">
			<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin"></i> Загружаем тайтл…</div>
			<div v-else-if="work == null" :class="$style.state"><i class="ti ti-movie-off"></i> Тайтл не найден или ещё не опубликован.</div>
			<article v-else :class="$style.work">
				<div :class="$style.poster">
					<img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title">
					<i v-else class="ti ti-movie"></i>
				</div>
				<div :class="$style.info">
					<div v-if="work.backdropPath" :class="$style.backdrop">
						<img :src="tmdbBackdrop(work.backdropPath)" alt="" loading="lazy">
					</div>
					<p :class="$style.kind">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span><span v-if="work.runtimeMinutes"> · {{ runtimeLabel(work.runtimeMinutes, work.kind) }}</span></p>
					<h1>{{ work.title }}</h1>
					<p v-if="work.originalTitle" :class="$style.original">{{ work.originalTitle }}</p>
					<div v-if="work.genres.length" :class="$style.genres" aria-label="Жанры"><MkA v-for="genre in work.genres" :key="genre" :to="genreLink(genre)">{{ genre }}</MkA></div>
					<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
					<p v-else :class="$style.description">Описание появится после редакторской проверки.</p>
					<section v-if="work.galleryPaths.length" :class="$style.gallery">
						<h2><i class="ti ti-photo"></i> Кадры</h2>
						<div :class="$style.galleryGrid">
							<a v-for="path in work.galleryPaths" :key="path" :href="tmdbBackdrop(path)" target="_blank" rel="noopener noreferrer" :aria-label="`Открыть кадр из ${work.title}`"><img :src="tmdbGalleryImage(path)" alt="" loading="lazy"></a>
						</div>
					</section>
					<section :class="$style.player" aria-label="Просмотр">
						<div :class="$style.playerTabs">
							<span :class="$style.playerTabActive"><i class="ti ti-device-tv"></i> Смотреть</span>
							<span v-if="work.seasons.length" :class="$style.playerTab"><i class="ti ti-list-details"></i> Эпизоды</span>
							<button type="button" class="_button" :class="$style.playerTab" @click="focusDiscussion"><i class="ti ti-messages"></i> {{ discussionScope === 'episode' && selectedEpisode ? i18n.ts.zalip.episodeComments : i18n.ts.zalip.comments }}</button>
							<button v-if="$i" type="button" class="_button" :class="$style.playerShare" @click="shareWork"><i class="ti ti-share-3"></i><span>Поделиться</span></button>
						</div>
						<template v-if="$i">
							<p v-if="allohaPlayback == null" :class="$style.playerState"><i class="ti ti-loader-2 ti-spin"></i> Проверяем доступность в Alloha…</p>
							<template v-else-if="allohaPlayback.available">
								<div v-if="allohaPlayerOpen && activeAllohaIframe" :class="$style.playerFrame"><iframe :src="activeAllohaIframe" :title="`Плеер Alloha: ${work.title}`" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
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
								<p :class="$style.providerNotice">Внешний плеер Alloha переключает само видео в своём интерфейсе. Выбор серии здесь открывает её карточку, описание и ветку комментариев без перезагрузки страницы.</p>
							</template>
							<p v-else :class="$style.playerUnavailable"><i class="ti ti-clock"></i> В Alloha этот тайтл пока не найден. Доступность проверяется автоматически раз в час.</p>
						</template>
						<p v-else :class="$style.playerUnavailable"><i class="ti ti-login"></i> Войдите в Zalip, чтобы открыть плеер и сохранить подписку на новые серии.</p>

						<div v-if="work.seasons.length" :class="$style.playerEpisodes">
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
					<section v-if="work.seasons.length" :class="$style.seasons">
						<h2>Сезоны</h2>
						<div :class="$style.seasonList">
							<div v-for="season in work.seasons" :key="season.id" :class="$style.seasonBlock">
								<button type="button" class="_button" :class="[$style.season, { [$style.selectedSeason]: selectedSeasonNumber === season.seasonNumber }]" :aria-expanded="selectedSeasonNumber === season.seasonNumber" @click="toggleSeason(season)">
									<div><strong>{{ seasonLabel(season.seasonNumber, season.title) }}</strong><p v-if="season.airDate">{{ season.airDate.slice(0, 4) }}</p></div>
									<span v-if="season.episodeCount != null">{{ season.episodeCount }} эп.</span>
									<i :class="selectedSeasonNumber === season.seasonNumber ? 'ti ti-chevron-up' : 'ti ti-chevron-down'"></i>
								</button>
								<div v-if="selectedSeasonNumber === season.seasonNumber" :class="$style.episodes">
									<p v-if="episodesPending" :class="$style.episodeState"><i class="ti ti-loader-2 ti-spin"></i> Загружаем эпизоды…</p>
									<p v-else-if="episodes.length === 0" :class="$style.episodeState">Список серий пока не подготовлен редактором.</p>
									<article v-for="episode in episodes" v-else :key="episode.id" :class="[$style.episode, { [$style.episodeWithStill]: episode.stillPath }]">
										<img v-if="episode.stillPath" :class="$style.episodeStill" :src="tmdbGalleryImage(episode.stillPath)" :alt="`Кадр: ${episodeLabel(episode)}`" loading="lazy">
										<div :class="$style.episodeContent">
											<strong>{{ episodeLabel(episode) }}</strong>
											<span v-if="episode.runtimeMinutes || episode.airDate">{{ episodeMeta(episode) }}</span>
											<p v-if="episode.description">{{ episode.description }}</p>
											<div :class="$style.episodeActions">
												<button type="button" class="_button" @click="selectEpisodeAndFocusDiscussion(episode)"><i class="ti ti-messages"></i> {{ episode.discussionNoteId ? i18n.ts.zalip.episodeComments : i18n.ts.zalip.discussEpisode }}</button>
											</div>
										</div>
									</article>
								</div>
							</div>
						</div>
					</section>
					<section v-if="work.trailerYoutubeKey" :class="$style.trailer">
						<h2><i class="ti ti-player-play"></i> Официальный трейлер</h2>
						<p v-if="!trailerOpen">Трейлер открывается по вашему действию через YouTube без cookies.</p>
						<button v-if="!trailerOpen" type="button" class="_button" :class="$style.trailerButton" @click="trailerOpen = true"><i class="ti ti-player-play-filled"></i> Показать трейлер</button>
						<div v-else :class="$style.trailerFrame"><iframe :src="youtubeEmbed(work.trailerYoutubeKey)" :title="`Официальный трейлер: ${work.title}`" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
					</section>
					<div :class="$style.actions">
						<div v-if="$i" :class="$style.libraryControl">
							<select v-model="libraryStatus" class="_input" :disabled="saving" aria-label="Статус в библиотеке">
								<option v-for="status in libraryStatuses" :key="status" :value="status">{{ libraryStatusLabel(status) }}</option>
							</select>
							<button :class="$style.library" class="_button" :disabled="saving" @click="addToLibrary"><i class="ti ti-bookmark"></i> {{ saving ? 'Сохраняем…' : saved ? 'Обновить статус' : 'Добавить в библиотеку' }}</button>
						</div>
						<div v-if="$i" :class="$style.personalActions">
							<button type="button" class="_button" :class="[$style.favorite, { [$style.favorited]: isFavorite }]" :aria-pressed="isFavorite" :disabled="saving" @click="toggleFavorite"><i :class="isFavorite ? 'ti ti-star-filled' : 'ti ti-star'"></i> {{ isFavorite ? 'В избранном' : 'В избранное' }}</button>
							<label :class="$style.rating"><i class="ti ti-star"></i><span class="_visuallyHidden">Личная оценка</span><select v-model="personalRating" class="_input" :disabled="saving" aria-label="Личная оценка" @change="savePersonalRating"><option :value="null">Без оценки</option><option v-for="rating in 10" :key="rating" :value="rating">{{ rating }}/10</option></select></label>
							<label v-if="work.seasons.length" :class="$style.progress"><i class="ti ti-player-track-next"></i><span class="_visuallyHidden">Просмотрено эпизодов</span><input v-model.number="episodesWatched" class="_input" type="number" min="0" inputmode="numeric" :disabled="saving" aria-label="Просмотрено эпизодов" @change="saveEpisodesWatched"><span>эп.</span></label>
						</div>
						<button v-if="$i" type="button" class="_button" :class="[$style.subscription, { [$style.subscribed]: releaseSubscribed }]" :aria-pressed="releaseSubscribed" :disabled="saving" @click="toggleReleaseSubscription"><i :class="releaseSubscribed ? 'ti ti-bell-filled' : 'ti ti-bell'"></i> {{ releaseSubscribed ? 'Слежу за сериями' : 'Следить за сериями' }}</button>
						<button v-if="$i" type="button" class="_button" :class="$style.feed" @click="shareWork"><i class="ti ti-send"></i> Поделиться</button>
						<MkA to="/timeline" :class="$style.feed"><i class="ti ti-news"></i> Лента</MkA>
					</div>
					<section ref="discussionSection" :class="$style.discussionArea">
						<div v-if="work.seasons.length" :class="$style.discussionScope" role="group" :aria-label="i18n.ts.zalip.discussionContext">
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'work' }]" :aria-pressed="discussionScope === 'work'" @click="selectDiscussionScope('work')"><i class="ti ti-movie"></i> {{ i18n.ts.zalip.aboutTitle }}</button>
							<button v-if="selectedEpisode" type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'episode' }]" :aria-pressed="discussionScope === 'episode'" @click="selectDiscussionScope('episode')"><i class="ti ti-device-tv"></i> {{ episodeLabel(selectedEpisode) }}</button>
						</div>
						<ZalipDiscussionPanel v-if="activeDiscussionNoteId" :note-id="activeDiscussionNoteId" :heading="activeDiscussionHeading"/>
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
import { definePage } from '@/page.js';
import * as os from '@/os.js';
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

const libraryStatuses: LibraryStatus[] = ['watching', 'planned', 'completed', 'on_hold', 'dropped'];

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
const trailerOpen = ref(false);
const allohaPlayback = ref<AllohaPlayback | null>(null);
const allohaPlayerOpen = ref(false);
const selectedAllohaTranslationId = ref<number | null>(null);
const discussionNoteId = ref<string | null>(null);
const discussionError = ref<string | null>(null);
const discussionScope = ref<'work' | 'episode'>('work');
const openingDiscussionScope = ref<'work' | 'episode' | null>(null);
const discussionSection = ref<HTMLElement | null>(null);
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodeRequestId = ref(0);
const selectedEpisodeId = ref<string | null>(null);

const activeAllohaIframe = computed(() => {
	if (allohaPlayback.value == null) return null;
	return allohaPlayback.value.translations.find(translation => translation.id === selectedAllohaTranslationId.value)?.iframe
		?? allohaPlayback.value.iframe
		?? allohaPlayback.value.translations[0]?.iframe
		?? null;
});

const selectedEpisode = computed(() => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null);
const selectedEpisodeIndex = computed(() => selectedEpisode.value == null ? -1 : episodes.value.findIndex(episode => episode.id === selectedEpisode.value?.id));
const previousEpisode = computed(() => selectedEpisodeIndex.value > 0 ? episodes.value[selectedEpisodeIndex.value - 1] ?? null : null);
const nextEpisode = computed(() => selectedEpisodeIndex.value >= 0 ? episodes.value[selectedEpisodeIndex.value + 1] ?? null : null);
const activeDiscussionNoteId = computed(() => discussionScope.value === 'episode' ? selectedEpisode.value?.discussionNoteId ?? null : discussionNoteId.value);
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

function seasonLabel(seasonNumber: number, title: string): string {
	return seasonNumber === 0 ? title : `Сезон ${seasonNumber}: ${title}`;
}

function episodeLabel(episode: ZalipEpisode): string {
	return `Серия ${episode.episodeNumber}: ${episode.title}`;
}

function genreLink(genre: string): string {
	return `/?genre=${encodeURIComponent(genre)}`;
}

function shareWork(): void {
	if (work.value == null) return;
	const { id, slug, kind, title, description, releaseYear, genres, posterPath } = work.value;
	os.post({ zalipWork: { id, slug, kind, title, description, releaseYear, genres, posterPath } });
}

function episodeMeta(episode: ZalipEpisode): string {
	return [episode.airDate?.slice(0, 4), episode.runtimeMinutes != null ? `${episode.runtimeMinutes} мин.` : null].filter((value): value is string => value != null).join(' · ');
}

function translationLabel(translation: AllohaPlayback['translations'][number]): string {
	return [translation.name, translation.quality, translation.resolutions.join('/')].filter((value): value is string => value != null && value !== '').join(' · ');
}

function libraryStatusLabel(status: LibraryStatus): string {
	return ({ watching: 'Смотрю', planned: 'В планах', completed: 'Просмотрено', on_hold: 'Отложено', dropped: 'Брошено' })[status];
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
	trailerOpen.value = false;
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

async function toggleSeason(season: ZalipSeason): Promise<void> {
	if (selectedSeasonNumber.value === season.seasonNumber) {
		selectedSeasonNumber.value = null;
		episodes.value = [];
		selectedEpisodeId.value = null;
		discussionScope.value = 'work';
		episodesPending.value = false;
		return;
	}
	await loadSeason(season);
}

function selectEpisode(episode: ZalipEpisode): void {
	const hasChanged = selectedEpisodeId.value !== episode.id;
	selectedEpisodeId.value = episode.id;
	discussionScope.value = 'episode';
	if (hasChanged) allohaPlayerOpen.value = false;
}

function selectRelativeEpisode(offset: -1 | 1): void {
	const episode = offset === -1 ? previousEpisode.value : nextEpisode.value;
	if (episode != null) selectEpisode(episode);
}

function openAllohaPlayer(): void {
	if (allohaPlayback.value?.available) allohaPlayerOpen.value = true;
}

async function selectEpisodeAndFocusDiscussion(episode: ZalipEpisode): Promise<void> {
	selectEpisode(episode);
	await nextTick();
	focusDiscussion();
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

async function addToLibrary(): Promise<void> {
	await updateLibrary();
}

async function toggleFavorite(): Promise<void> {
	await updateLibrary({ isFavorite: !isFavorite.value });
}

async function savePersonalRating(): Promise<void> {
	await updateLibrary({ personalRating: personalRating.value });
}

async function saveEpisodesWatched(): Promise<void> {
	await updateLibrary({ episodesWatched: normalizedEpisodesWatched() });
}

async function toggleReleaseSubscription(): Promise<void> {
	await updateLibrary({ isReleaseSubscribed: !releaseSubscribed.value });
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
	grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
	gap: 30px;
}

.poster {
	display: grid;
	place-items: center;
	overflow: hidden;
	aspect-ratio: 2 / 3;
	border-radius: 18px;
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 30%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 3rem;
}

.poster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
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
	font-size: clamp(1.9rem, 5vw, 3rem);
	line-height: 1.08;
	letter-spacing: -0.035em;
}

.backdrop {
	position: relative;
	margin-bottom: 18px;
	overflow: hidden;
	aspect-ratio: 16 / 7;
	border-radius: 16px;
	background: var(--MI_THEME-panelHighlight);
}

.backdrop::after {
	position: absolute;
	inset: 0;
	background: linear-gradient(90deg, rgb(0 0 0 / 18%), transparent 58%), linear-gradient(0deg, var(--MI_THEME-bg) 0%, transparent 34%);
	content: '';
}

.backdrop img {
	width: 100%;
	height: 100%;
	object-fit: cover;
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
	margin: 22px 0 0;
	white-space: pre-line;
	line-height: 1.65;
	color: var(--MI_THEME-fgTransparentWeak);
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

.playerShare {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	margin-left: auto;
	padding: 7px 10px;
	border-radius: 9px;
	background: color-mix(in srgb, var(--MI_THEME-accent) 16%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
	font-weight: 700;
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
	border-radius: 8px;
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

.trailer {
	margin-top: 24px;
	padding: 15px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
	background: var(--MI_THEME-panel);
}

.trailer h2 {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 1rem;
}

.trailer h2 i {
	color: var(--MI_THEME-accent);
}

.trailer p {
	margin: 8px 0 12px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.84rem;
}

.trailerButton {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 9px 12px;
	border-radius: 10px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-weight: 700;
}

.trailerFrame {
	overflow: hidden;
	margin-top: 13px;
	aspect-ratio: 16 / 9;
	border-radius: 10px;
	background: #000;
}

.trailerFrame iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
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

.actions {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-top: 24px;
}

.library, .feed {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border-radius: 999px;
	font-weight: 700;
	text-decoration: none;
}

.libraryControl {
	display: flex;
	gap: 8px;
}

.libraryControl select {
	max-width: 148px;
	border-radius: 999px;
}

.library {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.personalActions {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 8px;
}

.favorite, .rating, .progress {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	min-height: 40px;
	padding: 0 11px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	color: var(--MI_THEME-fg);
	font-weight: 700;
}

.favorite {
	background: var(--MI_THEME-panel);
}

.favorited {
	border-color: color-mix(in srgb, #f6be4f 55%, var(--MI_THEME-divider));
	background: color-mix(in srgb, #f6be4f 13%, var(--MI_THEME-panel));
	color: #d99c22;
}

.rating, .progress {
	background: var(--MI_THEME-panel);
	font-size: 0.84rem;
}

.rating i {
	color: #d99c22;
}

.rating select, .progress input {
	min-height: 30px;
	padding: 0 2px;
	border: 0;
	background: transparent;
	color: inherit;
	font: inherit;
}

.rating select {
	max-width: 106px;
}

.progress input {
	width: 42px;
	text-align: center;
}

.progress span {
	color: var(--MI_THEME-fgTransparentWeak);
}

.subscription {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 10px 14px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	color: var(--MI_THEME-fg);
	font-weight: 700;
}

.subscribed {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 55%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--MI_THEME-accent) 16%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);
}

.feed {
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
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
		padding-top: 12px;
	}

	.work {
		grid-template-columns: 120px minmax(0, 1fr);
		gap: 18px;
	}

	.info {
		grid-column: 1 / -1;
	}

	.backdrop {
		margin-inline: calc(var(--MI-margin) * -1);
		border-radius: 0;
	}

	.libraryControl {
		width: 100%;
	}

	.libraryControl select, .library {
		flex: 1;
	}

	.personalActions {
		width: 100%;
	}

	.galleryGrid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.episodeWithStill {
		grid-template-columns: 108px minmax(0, 1fr);
	}

	.playerTabs {
		padding-inline: 10px;
	}

	.playerTab, .playerTabActive {
		font-size: 0.76rem;
	}

	.playerShare span {
		display: none;
	}

	.playerToolbar {
		grid-template-columns: auto minmax(0, 1fr) auto;
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
		flex-basis: 112px;
	}

	.discussionScope {
		margin-top: 20px;
	}
}
</style>
