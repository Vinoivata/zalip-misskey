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
					<div :class="$style.actions">
						<button v-if="$i" :class="$style.library" class="_button" :disabled="saving" @click="addToLibrary"><i class="ti ti-bookmark"></i> {{ saved ? 'В библиотеке' : 'Добавить в библиотеку' }}</button>
						<MkA to="/timeline" :class="$style.feed"><i class="ti ti-news"></i> Лента</MkA>
					</div>
					<p :class="$style.note">Обсуждение, реакции и уведомления будут показаны здесь как обычная ветка Misskey.</p>
				</div>
			</article>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
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
};

const props = defineProps<{ slug: string }>();
const work = ref<ZalipWork | null>(null);
const pending = ref(true);
const saving = ref(false);
const saved = ref(false);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: ZalipWork['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

async function load(): Promise<void> {
	pending.value = true;
	work.value = null;
	try {
		work.value = await misskeyApiZalip<ZalipWork>('zalip/works/show', { slug: props.slug });
	} catch {
		work.value = null;
	} finally {
		pending.value = false;
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
