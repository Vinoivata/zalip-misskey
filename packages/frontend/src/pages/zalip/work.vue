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
					<p :class="$style.kind">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span></p>
					<h1>{{ work.title }}</h1>
					<p v-if="work.originalTitle" :class="$style.original">{{ work.originalTitle }}</p>
					<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
					<p v-else :class="$style.description">Описание появится после редакторской проверки.</p>
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
									<article v-for="episode in episodes" v-else :key="episode.id" :class="$style.episode">
										<strong>{{ episodeLabel(episode) }}</strong>
										<span v-if="episode.runtimeMinutes || episode.airDate">{{ episodeMeta(episode) }}</span>
										<p v-if="episode.description">{{ episode.description }}</p>
										<div :class="$style.episodeActions">
											<MkA v-if="episode.discussionNoteId" :to="`/notes/${episode.discussionNoteId}/replies`"><i class="ti ti-messages"></i> Обсуждение серии</MkA>
											<button v-else-if="iAmAdmin" type="button" class="_button" :disabled="discussionCreatingEpisodeId === episode.id" @click="openEpisodeDiscussion(episode)"><i class="ti ti-message-plus"></i> {{ discussionCreatingEpisodeId === episode.id ? 'Открываем…' : 'Открыть обсуждение' }}</button>
											<span v-else>Обсуждение серии ещё не открыто.</span>
										</div>
									</article>
									<p v-if="episodeDiscussionError" :class="$style.episodeState">{{ episodeDiscussionError }}</p>
								</div>
							</div>
						</div>
					</section>
					<div :class="$style.actions">
						<button v-if="$i" :class="$style.library" class="_button" :disabled="saving" @click="addToLibrary"><i class="ti ti-bookmark"></i> {{ saved ? 'В библиотеке' : 'Добавить в библиотеку' }}</button>
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
import { ref, watch } from 'vue';
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
	posterPath: string | null;
	backdropPath: string | null;
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

const props = defineProps<{ slug: string }>();
const router = useRouter();
const work = ref<ZalipWork | null>(null);
const pending = ref(true);
const saving = ref(false);
const saved = ref(false);
const discussionNoteId = ref<string | null>(null);
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodeRequestId = ref(0);
const discussionCreatingEpisodeId = ref<string | null>(null);
const episodeDiscussionError = ref<string | null>(null);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: ZalipWork['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
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

async function load(): Promise<void> {
	pending.value = true;
	work.value = null;
	selectedSeasonNumber.value = null;
	episodes.value = [];
	episodeRequestId.value++;
	try {
		work.value = await misskeyApiZalip<ZalipWork>('zalip/works/show', { slug: props.slug });
		const discussion = await misskeyApiZalip<{ noteId: string | null }>('zalip/discussions/show', { workId: work.value.id });
		discussionNoteId.value = discussion.noteId;
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

async function addToLibrary(): Promise<void> {
	if (work.value == null || !$i) return;
	saving.value = true;
	try {
		await misskeyApiZalip('zalip/library/update', { workId: work.value.id, status: 'planned' });
		saved.value = true;
	} finally {
		saving.value = false;
	}
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

.original {
	margin: 8px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
}

.description {
	margin: 22px 0 0;
	white-space: pre-line;
	line-height: 1.65;
	color: var(--MI_THEME-fgTransparentWeak);
}

.seasons {
	margin-top: 24px;
}

.seasons h2 {
	margin: 0 0 10px;
	font-size: 1rem;
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

.library {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
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
}
</style>
