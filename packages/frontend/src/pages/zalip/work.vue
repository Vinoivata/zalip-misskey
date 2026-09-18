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
					<div v-if="work.genres.length" :class="$style.genres" aria-label="Жанры"><span v-for="genre in work.genres" :key="genre">{{ genre }}</span></div>
					<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
					<p v-else :class="$style.description">Описание появится после редакторской проверки.</p>
					<section v-if="work.galleryPaths.length" :class="$style.gallery">
						<h2><i class="ti ti-photo"></i> Кадры</h2>
						<div :class="$style.galleryGrid">
							<a v-for="path in work.galleryPaths" :key="path" :href="tmdbBackdrop(path)" target="_blank" rel="noopener noreferrer" :aria-label="`Открыть кадр из ${work.title}`"><img :src="tmdbGalleryImage(path)" alt="" loading="lazy"></a>
						</div>
					</section>
					<section v-if="$i" :class="$style.player">
						<h2><i class="ti ti-device-tv"></i> Смотреть</h2>
						<p v-if="allohaPlayback == null">Проверяем доступность в Alloha…</p>
						<template v-else-if="allohaPlayback.available">
							<p>Плеер работает через Alloha. Озвучку можно выбрать здесь, а серию — в самом плеере без перезагрузки карточки.</p>
							<label v-if="allohaPlayback.translations.length > 1" :class="$style.translation"><span>Озвучка</span><select v-model="selectedAllohaTranslationId" class="_input" aria-label="Озвучка Alloha"><option v-for="translation in allohaPlayback.translations" :key="translation.id" :value="translation.id">{{ translationLabel(translation) }}</option></select></label>
							<button v-if="!allohaPlayerOpen" type="button" class="_button" :class="$style.playerButton" @click="allohaPlayerOpen = true"><i class="ti ti-player-play-filled"></i> Открыть плеер Alloha</button>
							<div v-else-if="activeAllohaIframe" :class="$style.playerFrame"><iframe :src="activeAllohaIframe" :title="`Плеер Alloha: ${work.title}`" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
							<p :class="$style.providerNotice">После открытия iframe Alloha может устанавливать свои cookies и обрабатывать данные по своим правилам.</p>
						</template>
						<p v-else :class="$style.playerUnavailable">В Alloha этот тайтл пока не найден. Доступность проверяется автоматически раз в час.</p>
					</section>
					<section v-else :class="$style.player"><h2><i class="ti ti-device-tv"></i> Смотреть</h2><p>Войдите в Zalip, чтобы открыть плеер и сохранить подписку на новые серии.</p></section>
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
												<MkA v-if="episode.discussionNoteId" :to="`/notes/${episode.discussionNoteId}/replies`"><i class="ti ti-messages"></i> Обсуждение серии</MkA>
												<button v-else-if="iAmAdmin" type="button" class="_button" :disabled="discussionCreatingEpisodeId === episode.id" @click="openEpisodeDiscussion(episode)"><i class="ti ti-message-plus"></i> {{ discussionCreatingEpisodeId === episode.id ? 'Открываем…' : 'Открыть обсуждение' }}</button>
												<span v-else>Обсуждение серии ещё не открыто.</span>
											</div>
										</div>
									</article>
									<p v-if="episodeDiscussionError" :class="$style.episodeState">{{ episodeDiscussionError }}</p>
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
						<MkA to="/timeline" :class="$style.feed"><i class="ti ti-news"></i> Лента</MkA>
						<MkA v-if="discussionNoteId" :to="`/notes/${discussionNoteId}/replies`" :class="$style.feed"><i class="ti ti-messages"></i> Обсуждение</MkA>
					</div>
					<p :class="$style.note"><template v-if="discussionNoteId">Комментарии, реакции и ответы открываются как обычная ветка Misskey.</template><template v-else>Обсуждение для этого тайтла появится здесь как обычная ветка Misskey — без второго аккаунта и отдельной системы комментариев.</template></p>
				</div>
			</article>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import { $i, iAmAdmin } from '@/i.js';
import { definePage } from '@/page.js';
import { useRouter } from '@/router.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

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
const router = useRouter();
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
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodeRequestId = ref(0);
const discussionCreatingEpisodeId = ref<string | null>(null);
const episodeDiscussionError = ref<string | null>(null);

const activeAllohaIframe = computed(() => {
	if (allohaPlayback.value == null) return null;
	return allohaPlayback.value.translations.find(translation => translation.id === selectedAllohaTranslationId.value)?.iframe
		?? allohaPlayback.value.iframe
		?? allohaPlayback.value.translations[0]?.iframe
		?? null;
});

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
	selectedSeasonNumber.value = null;
	episodes.value = [];
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
	} catch {
		work.value = null;
		discussionNoteId.value = null;
	} finally {
		pending.value = false;
	}
}

async function toggleSeason(season: ZalipSeason): Promise<void> {
	if (work.value == null) return;
	const requestId = ++episodeRequestId.value;
	if (selectedSeasonNumber.value === season.seasonNumber) {
		selectedSeasonNumber.value = null;
		episodes.value = [];
		episodesPending.value = false;
		return;
	}

	selectedSeasonNumber.value = season.seasonNumber;
	episodes.value = [];
	episodesPending.value = true;
	episodeDiscussionError.value = null;
	try {
		const loadedEpisodes = await misskeyApiZalip<ZalipEpisode[]>('zalip/seasons/episodes', {
			slug: work.value.slug,
			seasonNumber: season.seasonNumber,
		});
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = loadedEpisodes;
		}
	} catch {
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = [];
		}
	} finally {
		if (episodeRequestId.value === requestId) episodesPending.value = false;
	}
}

async function openEpisodeDiscussion(episode: ZalipEpisode): Promise<void> {
	if (!iAmAdmin) return;
	discussionCreatingEpisodeId.value = episode.id;
	episodeDiscussionError.value = null;
	try {
		const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/admin/episodes/discussions/create', { episodeId: episode.id });
		episode.discussionNoteId = discussion.noteId;
		router.push('/notes/:noteId/:initialTab?', { params: { noteId: discussion.noteId, initialTab: 'replies' } });
	} catch {
		episodeDiscussionError.value = 'Не удалось открыть обсуждение серии.';
	} finally {
		discussionCreatingEpisodeId.value = null;
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

.genres span {
	padding: 5px 9px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 650;
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
	padding: 15px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
	background: var(--MI_THEME-panel);
}

.player h2 {
	display: flex;
	align-items: center;
	gap: 8px;
	margin: 0;
	font-size: 1rem;
}

.player h2 i {
	color: var(--MI_THEME-accent);
}

.player p {
	margin: 8px 0 12px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.84rem;
}

.translation {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr);
	align-items: center;
	gap: 10px;
	margin-bottom: 10px;
	font-size: 0.84rem;
	font-weight: 650;
}

.translation select {
	min-width: 0;
}

.playerButton {
	display: inline-flex;
	align-items: center;
	gap: 8px;
	padding: 9px 12px;
	border-radius: 10px;
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	font-weight: 700;
}

.playerFrame {
	overflow: hidden;
	margin-top: 13px;
	aspect-ratio: 16 / 9;
	border-radius: 10px;
	background: #000;
}

.playerFrame iframe {
	display: block;
	width: 100%;
	height: 100%;
	border: 0;
}

.providerNotice {
	margin-bottom: 0 !important;
	font-size: 0.76rem !important;
}

.playerUnavailable {
	margin-bottom: 0 !important;
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

.note {
	margin: 28px 0 0;
	padding: 14px;
	border-left: 3px solid var(--MI_THEME-accent);
	background: var(--MI_THEME-panel);
	border-radius: 0 10px 10px 0;
	font-size: 0.88rem;
	color: var(--MI_THEME-fgTransparentWeak);
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
}
</style>
