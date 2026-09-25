<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div :class="$style.viewport">
		<div :class="$style.page">
			<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Загружаем тайтл…</div>
			<div v-else-if="work == null" :class="$style.state"><i class="ti ti-movie-off" aria-hidden="true"></i> Тайтл не найден или ещё не опубликован.</div>
			<article v-else :class="$style.work">

				<section :class="$style.hero">
					<div v-if="work.backdropPath" :class="$style.heroBackground" aria-hidden="true"><img :src="tmdbBackdrop(work.backdropPath)" alt=""></div>
					<div :class="$style.heroInner">
						<nav :class="$style.breadcrumb" :aria-label="i18n.ts.zalip.catalogueHeading"><MkA to="/catalog">{{ i18n.ts.zalip.catalogueHeading }}</MkA><i class="ti ti-chevron-right" aria-hidden="true"></i><span>{{ work.title }}</span></nav>
						<div v-if="work.logoPath" :class="$style.titleLogo"><img :src="tmdbImage(work.logoPath)" :alt="work.title"></div>
						<div :class="$style.heroContent">
							<aside :class="$style.sidebar">
								<div :class="$style.poster"><img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title"><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
								<div :class="$style.sidebarActions">
									<button type="button" class="_button" :class="$style.watchButton" @click="openPlayer"><i class="ti ti-player-play-filled" aria-hidden="true"></i>{{ i18n.ts.zalip.watchTitle }}</button>
									<button type="button" class="_button" :class="$style.sideButton" @click="focusDiscussion">{{ i18n.ts.zalip.discussTitle }}</button>
								</div>
							</aside>
							<div :class="$style.info">
								<p :class="$style.kind">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span></p>
								<h1>{{ work.title }}</h1>
								<p v-if="work.originalTitle && work.originalTitle !== work.title" :class="$style.original">{{ work.originalTitle }}</p>
								<div :class="$style.ratings">
									<span v-if="work.communityRating != null" :class="$style.communityRating" :aria-label="i18n.tsx.zalip.communityRating({ rating: work.communityRating.toFixed(1) })"><i class="ti ti-star" aria-hidden="true"></i><strong>{{ work.communityRating.toFixed(1) }}</strong><small>{{ i18n.tsx.zalip.workRatingCount({ count: work.ratingCount }) }}</small></span>
									<span v-else :class="$style.original">{{ i18n.ts.zalip.workNoRating }}</span>
								</div>
								<dl :class="$style.facts">
									<template v-if="work.releaseYear"><dt>{{ i18n.ts.zalip.workYear }}</dt><dd>{{ work.releaseYear }}</dd></template>
									<dt>{{ i18n.ts.zalip.workType }}</dt><dd>{{ kindLabel(work.kind) }}</dd>
									<template v-if="work.runtimeMinutes"><dt>{{ i18n.ts.zalip.workDuration }}</dt><dd>{{ runtimeLabel(work.runtimeMinutes, work.kind) }}</dd></template>
									<template v-if="work.seasons.length"><dt>{{ i18n.ts.zalip.workSeasons }}</dt><dd>{{ work.seasons.filter(season => season.seasonNumber > 0).length }}</dd></template>
									<template v-if="work.genres.length"><dt>{{ i18n.ts.zalip.catalogueGenres }}</dt><dd :class="$style.genres"><MkA v-for="genre in work.genres" :key="genre" :to="genreLink(genre)">{{ genre }}</MkA></dd></template>
								</dl>
							</div>
						</div>
					</div>
				</section>
				<div :class="$style.actionStrip" role="group" :aria-label="i18n.ts.zalip.workActions">
					<button type="button" class="_button" :class="{ [$style.actionActive]: personalRating != null }" :disabled="saving" @click="choosePersonalRating"><i class="ti ti-star" aria-hidden="true"></i><span>{{ personalRating == null ? i18n.ts.zalip.workRateAction : ratingLabel }}</span></button>
					<button type="button" class="_button" :class="{ [$style.actionActive]: saved }" :disabled="saving" @click="showLibraryMenu"><i class="ti ti-bookmark-plus" aria-hidden="true"></i><span>{{ saved ? libraryStatusText(libraryStatus) : i18n.ts.zalip.addToList }}</span></button>
					<button type="button" class="_button" @click="shareWork"><i class="ti ti-repeat" aria-hidden="true"></i><span>{{ i18n.ts.zalip.workRepost }}</span></button>
					<button type="button" class="_button" :aria-label="i18n.ts.zalip.more" :disabled="saving" @click="showWorkMenu"><i class="ti ti-dots" aria-hidden="true"></i><span>{{ i18n.ts.zalip.more }}</span></button>
				</div>
				<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
				<div :class="$style.content">

					<section ref="playerSection" :class="$style.player" :aria-label="i18n.ts.zalip.playerTab">
						<div :class="$style.playerTabs">
							<button type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'player' }]" :aria-pressed="playerView === 'player'" @click="playerView = 'player'"><i class="ti ti-list" aria-hidden="true"></i><span>{{ work.seasons.length ? i18n.ts.zalip.workEpisodes : i18n.ts.zalip.playerTab }}</span></button>
							<button v-if="work.trailerYoutubeKey" type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'trailer' }]" :aria-pressed="playerView === 'trailer'" @click="openTrailer"><i class="ti ti-player-play" aria-hidden="true"></i><span>{{ i18n.ts.zalip.trailerTab }}</span></button>
							<button type="button" class="_button" :class="$style.playerTab" @click="focusDiscussion"><i class="ti ti-messages" aria-hidden="true"></i><span>{{ i18n.ts.zalip.comments }}</span></button>
						</div>
						<div v-if="work.trailerYoutubeKey && playerView === 'trailer'" :class="$style.playerFrame"><iframe :src="youtubeEmbed(work.trailerYoutubeKey)" :title="i18n.ts.zalip.trailerTab + ': ' + work.title" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
						<template v-if="playerView === 'player'">
							<div ref="watchFrame" :class="$style.watchFrame">
								<div v-if="$i && allohaPlayerOpen && activeAllohaIframe" :class="$style.playerFrame"><iframe :key="activeAllohaIframeKey" :src="activeAllohaIframe" :title="i18n.ts.zalip.playerTab + ': ' + work.title" loading="lazy" referrerpolicy="origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
								<div v-else :class="$style.playerPreview">
									<img v-if="selectedEpisode?.stillPath || work.backdropPath" :src="tmdbBackdrop(selectedEpisode?.stillPath || work.backdropPath!)" alt="" loading="lazy">
									<button v-if="$i && allohaPlayback?.available" type="button" class="_button" :class="$style.playOverlay" :aria-label="i18n.ts.zalip.watchTitle" @click="openAllohaPlayer"><i class="ti ti-player-play-filled" aria-hidden="true"></i></button>
									<button v-else-if="!$i" type="button" class="_button" :class="$style.playerState" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i>{{ i18n.ts.zalip.playerSignIn }}</button>
									<p v-else :class="$style.playerState"><i :class="allohaPlayback == null ? 'ti ti-loader-2 ti-spin' : 'ti ti-clock'" aria-hidden="true"></i>{{ allohaPlayback == null ? i18n.ts.zalip.playerChecking : i18n.ts.zalip.playerUnavailable }}</p>
								</div>
								<div :class="$style.playerToolbar">
									<div v-if="work.seasons.length" :class="$style.episodeControls">
										<button type="button" class="_button" :disabled="previousEpisode == null" :aria-label="i18n.ts.zalip.playerPreviousEpisode" @click="selectRelativeEpisode(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="!episodes.length" aria-haspopup="dialog" :aria-expanded="episodeMenuOpen" @click="openEpisodeMenu">{{ selectedEpisode ? i18n.tsx.zalip.playerEpisodeNumber({ number: selectedEpisode.episodeNumber }) : i18n.ts.zalip.workEpisodes }}<i class="ti ti-chevron-down" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="nextEpisode == null" :aria-label="i18n.ts.zalip.playerNextEpisode" @click="selectRelativeEpisode(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
									</div>
									<button v-if="$i && selectedEpisodeProgress != null" type="button" class="_button" :class="[$style.watched, { [$style.actionActive]: episodeWatched }]" :disabled="saving || episodeWatched" @click="markEpisodeWatched"><i :class="episodeWatched ? 'ti ti-eye-check' : 'ti ti-eye'" aria-hidden="true"></i>{{ episodeWatched ? i18n.ts.zalip.playerWatched : i18n.ts.zalip.playerMarkWatched }}</button>
									<button v-if="$i && allohaPlayback?.available" type="button" class="_button" :class="$style.voiceButton" aria-haspopup="dialog" :aria-expanded="voiceMenuOpen" @click="openVoiceMenu"><span>{{ selectedVoiceLabel }}</span><i class="ti ti-volume" aria-hidden="true"></i></button>
								</div>
							</div>
							<div v-if="work.seasons.length" :class="$style.playerEpisodes">
								<div v-if="work.seasons.length > 1" :class="$style.seasonPicker"><span>{{ i18n.ts.zalip.workSeason }}</span><div><button v-for="season in work.seasons" :key="season.id" type="button" class="_button" :class="{ [$style.selectedSeasonPill]: selectedSeasonNumber === season.seasonNumber }" :aria-pressed="selectedSeasonNumber === season.seasonNumber" @click="selectSeason(season)">{{ season.seasonNumber === 0 ? i18n.ts.zalip.releaseSpecial : season.seasonNumber }}</button></div></div>
								<p v-if="episodesPending" :class="$style.episodeRailState"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
								<p v-else-if="!episodes.length" :class="$style.episodeRailState">{{ i18n.ts.zalip.playerEpisodesEmpty }}</p>
								<div v-else :class="$style.episodeRail" :aria-label="i18n.ts.zalip.workEpisodes" @pointerdown="episodeDrag.onPointerDown" @pointermove="episodeDrag.onPointerMove" @pointerup="episodeDrag.onPointerUp" @pointercancel="episodeDrag.onPointerCancel" @click.capture="episodeDrag.onClickCapture">
									<button v-for="episode in episodes" :key="episode.id" type="button" class="_button" :class="[$style.episodeTile, { [$style.selectedEpisodeTile]: selectedEpisode?.id === episode.id }]" :aria-pressed="selectedEpisode?.id === episode.id" @click="selectEpisode(episode)">
										<span :class="$style.episodeThumb"><img v-if="episode.stillPath" :src="tmdbGalleryImage(episode.stillPath)" alt="" loading="lazy"><i v-else class="ti ti-device-tv" aria-hidden="true"></i><span v-if="selectedEpisode?.id === episode.id" :class="$style.selectedPlay"><i class="ti ti-player-play-filled" aria-hidden="true"></i></span></span>
										<strong>{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}</strong>
										<small>{{ episode.title }}</small>
									</button>
								</div>
							</div>
						</template>
					</section>
					<section v-if="selectedEpisode" :class="$style.episodeGuide">
						<div :class="$style.episodeGuideContent">
							<p>{{ i18n.ts.zalip.episodeInformation }}</p>
							<h2>{{ episodeLabel(selectedEpisode) }}</h2>
							<span v-if="selectedEpisode.runtimeMinutes || selectedEpisode.airDate">{{ episodeMeta(selectedEpisode) }}</span>
							<p v-if="selectedEpisode.description">{{ selectedEpisode.description }}</p>
							<button type="button" class="_button" :class="$style.episodeDiscussButton" @click="selectDiscussionScope('episode')"><i class="ti ti-messages" aria-hidden="true"></i> {{ selectedEpisode.discussionNoteId ? i18n.ts.zalip.episodeComments : i18n.ts.zalip.discussEpisode }}</button>
						</div>
					</section>
					<section v-if="work.galleryPaths.length" :class="$style.gallery">
						<h2><i class="ti ti-photo" aria-hidden="true"></i> Кадры</h2>
						<div :class="$style.galleryGrid">
							<a v-for="path in work.galleryPaths" :key="path" :href="tmdbBackdrop(path)" target="_blank" rel="noopener noreferrer" :aria-label="`Открыть кадр из ${work.title}`"><img :src="tmdbGalleryImage(path)" alt="" loading="lazy"></a>
						</div>
					</section>
					<section ref="discussionSection" :class="$style.discussionArea">
						<div v-if="work.seasons.length" :class="$style.discussionScope" role="group" :aria-label="i18n.ts.zalip.discussionContext">
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'work' }]" :aria-pressed="discussionScope === 'work'" @click="selectDiscussionScope('work')"><i class="ti ti-movie" aria-hidden="true"></i> {{ i18n.ts.zalip.workDiscussionScope }}</button>
							<button v-if="selectedEpisode" type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'episode' }]" :aria-pressed="discussionScope === 'episode'" @click="selectDiscussionScope('episode')"><i class="ti ti-device-tv" aria-hidden="true"></i> {{ episodeLabel(selectedEpisode) }}</button>
						</div>
						<ZalipDiscussionPanel v-if="activeDiscussionNoteId" :noteId="activeDiscussionNoteId" :heading="activeDiscussionHeading"/>
						<section v-else :class="$style.discussionPending">
							<p><i class="ti ti-messages" aria-hidden="true"></i> {{ activeDiscussionEmptyText }}</p>
							<button v-if="$i" type="button" class="_button" :class="$style.openDiscussion" :disabled="openingDiscussionScope != null" @click="openActiveDiscussion"><i :class="openingDiscussionScope != null ? 'ti ti-loader-2 ti-spin' : 'ti ti-message-plus'" aria-hidden="true"></i> {{ openingDiscussionScope != null ? i18n.ts.zalip.openingDiscussion : i18n.ts.zalip.startDiscussion }}</button>
							<button v-else type="button" class="_button" :class="$style.openDiscussion" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i> {{ i18n.ts.zalip.loginToComment }}</button>
							<p v-if="discussionError" :class="$style.discussionError">{{ discussionError }}</p>
						</section>
					</section>
				</div>
			</article>
		</div>
	</div>
	<ZalipRatingDialog v-if="ratingDialogOpen" :initialRating="personalRating ?? 0" :saving="saving" :error="ratingError" @save="savePersonalRating" @later="closeRatingDialog" @closed="closeRatingDialog"/>

	<Teleport to="body">
		<MkModal v-if="episodeMenuOpen" ref="episodeModal" v-slot="{ maxHeight }" :class="$style.voiceOverlay" preferType="popup" :anchorElement="episodeAnchor" @click="episodeModal?.close()" @esc="episodeModal?.close()" @closed="episodeMenuOpen = false">
			<section :class="$style.episodeMenu" :style="maxHeight == null ? undefined : { maxHeight: `min(${maxHeight}px, 55dvh)` }" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.workEpisodes">
				<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="episodeQuery" type="search" :placeholder="i18n.ts.zalip.playerEpisodeSearch" :aria-label="i18n.ts.zalip.playerEpisodeSearch" @keydown.esc.stop.prevent="episodeModal?.close()"></label>
				<div :class="$style.episodeChoices">
					<button v-for="episode in filteredEpisodes" :key="episode.id" type="button" class="_button" :class="{ [$style.menuSelected]: selectedEpisodeId === episode.id }" :aria-pressed="selectedEpisodeId === episode.id" @click="selectEpisode(episode)">{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}<i v-if="selectedEpisodeId === episode.id" class="ti ti-check" aria-hidden="true"></i></button>
					<p v-if="!filteredEpisodes.length">{{ i18n.ts.zalip.searchNoResults }}</p>
				</div>
			</section>
		</MkModal>
		<MkModal v-if="voiceMenuOpen" ref="voiceModal" :class="$style.voiceOverlay" preferType="dialog" :returnFocusTo="voiceAnchor" @click="voiceModal?.close()" @esc="voiceModal?.close()" @closed="voiceMenuOpen = false">
			<section :class="$style.voiceDrawer" :style="viewportWidth <= 600 ? undefined : voicePanelPosition" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.playerVoices">
				<header><h2>{{ i18n.ts.zalip.playerTab }}</h2><button type="button" class="_button" :aria-label="i18n.ts.close" @click="voiceModal?.close()"><i class="ti ti-x" aria-hidden="true"></i></button></header>
				<span :class="$style.providerPill">ALLOHA</span>
				<h3>{{ i18n.ts.zalip.playerVoices }}</h3>
				<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="voiceQuery" type="search" :placeholder="i18n.ts.zalip.playerVoiceSearch" :aria-label="i18n.ts.zalip.playerVoiceSearch" @keydown.esc.stop.prevent="voiceModal?.close()"></label>
				<div :class="$style.voiceList">
					<button v-for="translation in filteredTranslations" :key="translation.id" type="button" class="_button" :class="{ [$style.menuSelected]: selectedAllohaTranslationId === translation.id }" :aria-pressed="selectedAllohaTranslationId === translation.id" @click="selectTranslation(translation.id)"><span>{{ translation.name }}</span><small v-if="translation.quality">{{ translation.quality }}</small><i v-if="selectedAllohaTranslationId === translation.id" class="ti ti-check" aria-hidden="true"></i></button>
					<p v-if="!filteredTranslations.length">{{ i18n.ts.zalip.searchNoResults }}</p>
				</div>
			</section>
		</MkModal>
	</Teleport>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { getEpisodeProgress } from '@/utility/zalip-episode-progress.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import ZalipDiscussionPanel from '@/components/ZalipDiscussionPanel.vue';
import ZalipRatingDialog from '@/components/ZalipRatingDialog.vue';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
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
	logoPath: string | null;
	communityRating: number | null;
	ratingCount: number;
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

const viewportWidth = ref(window.innerWidth);

function updateViewport(): void {
	viewportWidth.value = window.innerWidth;
	if (voiceMenuOpen.value) void nextTick(updateVoicePanelPosition);
}

window.addEventListener('resize', updateViewport, { passive: true });
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
const voiceMenuOpen = ref(false);
const episodeMenuOpen = ref(false);
const voiceAnchor = ref<HTMLElement | null>(null);
const episodeAnchor = ref<HTMLElement | null>(null);
const voiceModal = useTemplateRef('voiceModal');
const episodeModal = useTemplateRef('episodeModal');
const watchFrame = useTemplateRef('watchFrame');
const voicePanelPosition = ref<{ top: string; left: string; width: string; height: string }>();
const episodeQuery = ref('');
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
const voiceQuery = ref('');
const filteredTranslations = computed(() => (allohaPlayback.value?.translations ?? []).filter(translation => translation.name.toLocaleLowerCase('ru').includes(voiceQuery.value.trim().toLocaleLowerCase('ru'))));
const selectedVoiceLabel = computed(() => {
	const translation = allohaPlayback.value?.translations.find(item => item.id === selectedAllohaTranslationId.value);
	return translation?.name ?? 'Alloha';
});
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
const ratingDialogOpen = ref(false);
const ratingError = ref<string | null>(null);
const episodeDrag = useZalipHorizontalDrag();
const selectedEpisode = computed(() => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null);

const filteredEpisodes = computed(() => episodes.value.filter(episode => `${episode.episodeNumber} ${episode.title}`.toLocaleLowerCase('ru').includes(episodeQuery.value.trim().toLocaleLowerCase('ru'))));
const selectedEpisodeProgress = computed(() => getEpisodeProgress(work.value?.seasons ?? [], selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
const episodeWatched = computed(() => selectedEpisodeProgress.value != null && episodesWatched.value >= selectedEpisodeProgress.value);

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
	return `/catalog?genres=${encodeURIComponent(genre)}`;
}

function episodeMeta(episode: ZalipEpisode): string {
	return [episode.airDate ? new Date(episode.airDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null, episode.runtimeMinutes != null ? `${episode.runtimeMinutes} мин.` : null].filter((value): value is string => value != null).join(' · ');
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
	voiceMenuOpen.value = false;
	episodeMenuOpen.value = false;
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
			selectedEpisodeId.value = loadedEpisodes.find(episode => (getEpisodeProgress(work.value?.seasons ?? [], season.seasonNumber, episode.episodeNumber) ?? 0) > episodesWatched.value)?.id
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
	episodeModal.value?.close();
	selectedEpisodeId.value = episode.id;
	discussionScope.value = 'episode';
}

function selectRelativeEpisode(offset: -1 | 1): void {
	const episode = offset === -1 ? previousEpisode.value : nextEpisode.value;
	if (episode != null) selectEpisode(episode);
}

function openEpisodeMenu(event: MouseEvent): void {
	episodeAnchor.value = event.currentTarget as HTMLElement;
	episodeQuery.value = '';
	episodeMenuOpen.value = true;
}

function openVoiceMenu(event: MouseEvent): void {
	voiceAnchor.value = event.currentTarget as HTMLElement;
	voiceQuery.value = '';
	updateVoicePanelPosition();
	voiceMenuOpen.value = true;
}

function updateVoicePanelPosition(): void {
	const rect = watchFrame.value?.getBoundingClientRect();
	if (!rect) return;
	const width = Math.min(340, Math.max(280, rect.width * 0.42), window.innerWidth - 32);
	const height = Math.min(Math.max(320, rect.height), window.innerHeight - 32);
	voicePanelPosition.value = {
		top: `${Math.max(16, Math.min(rect.top, window.innerHeight - height - 16))}px`,
		left: `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`,
		width: `${width}px`,
		height: `${height}px`,
	};
}

function selectTranslation(id: number): void {
	selectedAllohaTranslationId.value = id;
	voiceModal.value?.close();
}

async function markEpisodeWatched(): Promise<void> {
	if (!$i || saving.value || selectedEpisodeProgress.value == null || episodeWatched.value) return;
	try {
		await updateLibrary({ episodesWatched: selectedEpisodeProgress.value, status: libraryStatus.value === 'planned' ? 'watching' : libraryStatus.value });
	} catch {
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

function showWorkMenu(event: MouseEvent): void {
	void os.popupMenu([
		{ text: i18n.ts.zalip.favoriteTitle, icon: 'ti ti-heart', active: isFavorite.value, action: () => void toggleFavorite() },
		...(work.value?.seasons.length ? [{ text: i18n.ts.zalip.releaseSubscriptionTitle, icon: 'ti ti-bell', active: releaseSubscribed.value, action: () => void toggleReleaseSubscription() }] : []),
		{ text: i18n.ts.zalip.discussTitle, icon: 'ti ti-messages', action: focusDiscussion },
	], event.currentTarget);
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
			icon: isFavorite.value ? 'ti ti-heart-filled' : 'ti ti-heart',
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
	ratingDialogOpen.value = true;
	ratingError.value = null;
}

function closeRatingDialog(): void {
	ratingDialogOpen.value = false;
}

async function savePersonalRating(rating: number): Promise<void> {
	if (saving.value) return;
	ratingError.value = null;
	try {
		await updateLibrary({ personalRating: rating });
		closeRatingDialog();
	} catch {
		ratingError.value = i18n.ts.zalip.libraryUpdateFailed;
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
.viewport { container-type: inline-size; }
.page { max-width: 960px; margin: 0 auto; padding-bottom: 48px; min-width: 0; color: var(--zalip-social-fg); background: var(--zalip-social-panel); }
.work, .content { min-width: 0; }
.state { display: grid; place-content: center; gap: 12px; min-height: 300px; text-align: center; color: var(--zalip-social-muted); }
.hero { position: relative; isolation: isolate; overflow: hidden; }
.heroBackground { position: absolute; z-index: -2; inset: 0; }
.heroBackground img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.hero::after { content: ''; position: absolute; z-index: -1; inset: 0; background: linear-gradient(0deg, var(--zalip-social-panel) 0%, color-mix(in srgb, var(--zalip-social-panel) 78%, transparent) 35%, color-mix(in srgb, var(--zalip-social-panel) 45%, transparent) 100%); }
.heroInner { padding: 24px 28px 28px; }
.breadcrumb { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--zalip-social-muted); }
.breadcrumb span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titleLogo { display: flex; justify-content: flex-end; align-items: center; height: 100px; margin: 10px 8px 12px; }
.titleLogo img { max-width: 220px; max-height: 80px; object-fit: contain; filter: drop-shadow(0 2px 8px var(--zalip-glass-shadow)); }
.heroContent { display: grid; grid-template-columns: minmax(160px, 30%) minmax(0, 1fr); gap: 28px; margin-top: 32px; align-items: start; }
.titleLogo + .heroContent { margin-top: 0; }
.sidebar, .info { min-width: 0; }
.poster { display: grid; place-items: center; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 12px; background: var(--zalip-social-raised); box-shadow: 0 10px 35px var(--zalip-glass-shadow); }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster > i { font-size: 48px; color: var(--zalip-social-muted); }
.sidebarActions { display: grid; gap: 7px; margin-top: 12px; }
.watchButton, .sideButton { display: flex; justify-content: center; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border-radius: 99px; font-size: 13px; font-weight: 650; }
.watchButton { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.sideButton { border: 1px solid var(--zalip-social-border); background: color-mix(in srgb, var(--zalip-social-panel) 60%, transparent); }
.kind { margin: 2px 0 8px; font-size: 12px; color: var(--zalip-social-muted); }
.info h1 { font-size: clamp(24px, 3.6cqi, 34px); letter-spacing: -.035em; line-height: 1.12; margin: 0; overflow-wrap: anywhere; }
.original { color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; margin: 10px 0 0; }
.ratings { margin: 20px 0 24px; }
.communityRating { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.communityRating > i { color: var(--MI_THEME-accent); font-size: 23px; }
.communityRating strong { font-size: 22px; }
.communityRating small { color: var(--zalip-social-muted); font-size: 12px; }
.facts { display: grid; grid-template-columns: minmax(90px, .8fr) minmax(0, 1.5fr); gap: 12px 14px; margin: 0; font-size: 13px; line-height: 1.5; }
.facts dt { color: var(--zalip-social-muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.genres { display: flex; gap: 6px 10px; flex-wrap: wrap; }
.genres a { border-bottom: 1px solid var(--zalip-social-border); text-decoration: none; }
.actionStrip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 8px 24px 20px; }
.actionStrip button { display: flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 8px; min-height: 76px; border-radius: 16px; padding: 14px 6px 8px; color: var(--zalip-social-muted); font-size: 12px; line-height: 1.4; text-align: center; }
.actionStrip i { font-size: 25px; }
.actionStrip button:hover { background: var(--zalip-accent-wash); }
.actionStrip .actionActive, .actionActive { color: var(--MI_THEME-accent); }
.description { margin: 0; padding: 0 28px 30px; line-height: 1.7; font-size: 15px; white-space: pre-line; }
.content { padding: 0 24px; }
.player { scroll-margin-top: 20px; }
.playerTabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-bottom: 18px; padding: 2px; }
.playerTab { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; padding: 10px 12px; border: 1px solid transparent; border-radius: 14px; color: var(--zalip-social-muted); font-weight: 600; font-size: 13px; }
.playerTabActive { color: var(--zalip-social-fg); background: var(--zalip-accent-wash); border-color: var(--zalip-accent-border); }
.watchFrame { overflow: hidden; border-radius: 16px; background: var(--zalip-social-raised); }
.playerFrame, .playerPreview { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--zalip-social-bg); }
.playerFrame iframe { display: block; width: 100%; height: 100%; border: 0; }
.playerPreview { display: grid; place-items: center; }
.playerPreview > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.playOverlay { position: relative; display: grid; place-items: center; width: 72px; height: 72px; border: 2px solid var(--MI_THEME-fgOnAccent); border-radius: 8px; color: var(--MI_THEME-fgOnAccent); background: color-mix(in srgb, var(--MI_THEME-accent) 65%, transparent); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.playOverlay i { font-size: 38px; }
.playerState { position: relative; display: flex; align-items: center; gap: 9px; max-width: 80%; box-sizing: border-box; margin: 0; padding: 16px; border-radius: 16px; background: color-mix(in srgb, var(--zalip-social-panel) 90%, transparent); color: var(--zalip-social-fg); line-height: 1.5; font-size: 13px; }
.playerToolbar { display: flex; align-items: center; gap: 8px; padding: 10px; flex-wrap: wrap; }
.episodeControls { display: flex; align-items: center; gap: 5px; }
.episodeControls button, .voiceButton { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 9px 11px; border-radius: 12px; background: var(--zalip-social-hover); font-size: 12px; font-weight: 600; }
.episodeControls button:disabled { opacity: .35; }
.voiceButton { margin-left: auto; max-width: 52%; }
.voiceButton span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.voiceButton i { flex-shrink: 0; font-size: 18px; }
.watched { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; font-size: 11px; }
.watched i { font-size: 18px; }
.playerEpisodes { margin-top: 12px; }
.seasonPicker { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 12px; color: var(--zalip-social-muted); }
.seasonPicker > div { display: flex; gap: 6px; overflow-x: auto; }
.seasonPicker button { min-width: 34px; padding: 8px 10px; border-radius: 10px; background: var(--zalip-social-raised); }
.seasonPicker .selectedSeasonPill { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.episodeRail { display: flex; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; padding: 2px 0 12px; touch-action: pan-x pan-y; }
.episodeTile { flex: 0 0 132px; min-width: 0; text-align: left; }
.episodeThumb { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 12px; background: var(--zalip-social-raised); }
.episodeThumb > img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.selectedPlay { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--zalip-social-panel) 20%, transparent); color: var(--MI_THEME-accent); font-size: 34px; }
.selectedPlay i { filter: drop-shadow(0 1px 3px var(--zalip-social-panel)); }
.episodeTile strong { display: block; margin-top: 8px; font-size: 13px; }
.episodeTile small { display: block; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--zalip-social-muted); font-size: 11px; }
.selectedEpisodeTile .episodeThumb { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
.episodeRailState { color: var(--zalip-social-muted); font-size: 13px; }
.episodeGuide { margin: 28px 0; }
.episodeGuideContent > p:first-child { margin: 0 0 12px; font-weight: 700; font-size: 16px; color: var(--zalip-social-fg); }
.episodeGuideContent h2 { font-size: 15px; margin: 0 0 8px; }
.episodeGuideContent > span, .episodeGuideContent > p { font-size: 13px; color: var(--zalip-social-muted); line-height: 1.6; }
.episodeDiscussButton { display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; color: var(--MI_THEME-accent); font-size: 13px; }
.gallery { margin: 32px 0; }
.gallery h2 { font-size: 17px; }
.galleryGrid { display: flex; gap: 10px; overflow-x: auto; }
.galleryGrid a { flex: 0 0 180px; }
.galleryGrid img { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; }
.discussionArea { margin-top: 30px; scroll-margin-top: 20px; }
.discussionScope { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 16px; }
.scopeButton { flex: 0 0 auto; padding: 10px 13px; border-radius: 99px; background: var(--zalip-social-raised); color: var(--zalip-social-muted); font-size: 12px; }
.scopeButtonActive { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.discussionPending { padding: 20px; border: 1px solid var(--zalip-social-border); border-radius: 16px; color: var(--zalip-social-muted); font-size: 14px; }
.openDiscussion { padding: 10px 16px; border-radius: 99px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.discussionError { color: var(--MI_THEME-error); }
.episodeMenu, .voiceDrawer { box-sizing: border-box; background: var(--zalip-social-raised); color: var(--zalip-social-fg); box-shadow: 0 8px 40px var(--zalip-glass-shadow); }
.episodeMenu { width: min(250px, calc(100vw - 32px)); max-height: 55dvh; padding: 8px; border-radius: 16px; display: flex; flex-direction: column; }
.menuSearch { display: flex; flex-shrink: 0; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 12px; padding: 10px; background: var(--zalip-social-hover); color: var(--zalip-social-muted); }
.menuSearch:focus-within { border-color: var(--MI_THEME-accent); }
.menuSearch input { min-width: 0; width: 100%; border: 0; outline: none; padding: 0; color: var(--zalip-social-fg); background: transparent; font: inherit; font-size: 14px; }
.episodeChoices { overflow-y: auto; min-height: 0; padding-top: 6px; }
.episodeChoices button { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 12px 10px; border-radius: 10px; text-align: left; font-size: 14px; }
.episodeChoices p, .voiceList p { color: var(--zalip-social-muted); font-size: 13px; }
.voiceOverlay :global(._modalBg) { -webkit-backdrop-filter: none; backdrop-filter: none; }
.voiceDrawer { position: fixed; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 18px; border-radius: 16px; }
.voiceDrawer header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.voiceDrawer h2 { margin: 0; font-size: 18px; }
.voiceDrawer header button { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--zalip-social-hover); }
.providerPill { display: inline-block; margin: 18px 0; padding: 9px 12px; border-radius: 99px; background: var(--zalip-social-hover); font-size: 13px; font-weight: 700; }
.voiceDrawer h3 { margin: 0 0 14px; padding-top: 18px; border-top: 1px solid var(--zalip-social-border); font-size: 16px; }
.voiceList { display: grid; gap: 6px; margin-top: 12px; }
.voiceList button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 42px; padding: 10px 12px; box-sizing: border-box; border-radius: 12px; background: var(--zalip-social-hover); text-align: left; }
.voiceList button span { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.voiceList small { color: var(--zalip-social-muted); font-size: 11px; }
.voiceList .menuSelected, .episodeChoices .menuSelected { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
@container (max-width: 600px) {
	.heroInner { padding: 16px 18px 20px; }
	.breadcrumb { font-size: 11px; }
	.titleLogo { justify-content: center; height: 76px; margin: 20px 0; }
	.titleLogo img { max-width: 180px; max-height: 76px; }
	.heroContent { display: flex; flex-direction: column; gap: 28px; margin-top: 28px; }
	.sidebar { width: min(62%, 240px); min-width: 180px; margin: 0 auto; }
	.heroBackground { max-height: 660px; }
	.heroBackground img { object-position: 58% top; }
	.hero::after { background: linear-gradient(0deg, var(--zalip-social-panel) 3%, var(--zalip-social-panel) 25%, color-mix(in srgb, var(--zalip-social-panel) 60%, transparent) 60%, color-mix(in srgb, var(--zalip-social-panel) 35%, transparent)); }
	.info { width: 100%; }
	.info h1 { font-size: 27px; }
	.kind { font-size: 12px; }
	.ratings { margin: 16px 0 22px; }
	.facts { font-size: 13px; grid-template-columns: minmax(95px, 1fr) minmax(0, 1.5fr); }
	.actionStrip { padding: 0 12px 20px; gap: 2px; }
	.actionStrip button { font-size: 11px; padding-inline: 2px; }
	.description { padding: 0 18px 26px; font-size: 14px; }
	.content { padding: 0 12px; }
	.playerTabs { gap: 3px; }
	.playerTab { padding: 10px; font-size: 12px; }
	.playerToolbar { gap: 7px; padding: 10px; }
	.voiceButton { flex-basis: 100%; max-width: 100%; min-width: 0; }
	.watched { margin-left: auto; max-width: 40%; font-size: 10px; }
	.episodeControls { gap: 4px; }
	.episodeControls button { padding: 8px 9px; font-size: 11px; }
	.episodeTile { flex-basis: 112px; }
	.playOverlay { width: 58px; height: 58px; }
	.playerState { padding: 12px; font-size: 12px; }
}
@media (max-width: 600px) {
	.voiceDrawer { position: fixed; inset: 0 0 0 auto; width: min(360px, 90vw); max-height: none; height: 100dvh; padding: 18px 16px max(24px, env(safe-area-inset-bottom)); border-radius: 0; overscroll-behavior: contain; }
}
</style>
