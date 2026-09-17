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
				</div>
				<div :class="$style.orb" aria-hidden="true"><i class="ti ti-player-play-filled"></i></div>
			</section>

			<section :class="$style.catalogue">
				<div :class="$style.sectionHeader">
					<div><p :class="$style.eyebrow">КАТАЛОГ</p><h2>Новое и важное</h2></div>
					<span v-if="works.length" :class="$style.count">{{ works.length }} тайтлов</span>
				</div>

				<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Загружаем каталог…</div>
				<div v-else-if="loadError" :class="$style.empty"><i class="ti ti-alert-circle"></i> Каталог временно недоступен.</div>
				<div v-else-if="works.length === 0" :class="$style.empty">
					<i class="ti ti-sparkles"></i>
					<strong>Каталог готов к первому тайтлу</strong>
					<span>Администратор добавит его как черновик, проверит и только затем опубликует.</span>
				</div>
				<div v-else :class="$style.grid">
					<MkA v-for="work in works" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.card">
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
import { onMounted, ref } from 'vue';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { iAmAdmin } from '@/i.js';

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

const works = ref<ZalipWork[]>([]);
const pending = ref(true);
const loadError = ref(false);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: ZalipWork['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

onMounted(async () => {
	try {
		works.value = await misskeyApiZalip<ZalipWork[]>('zalip/works/list', { limit: 20 });
	} catch {
		loadError.value = true;
	} finally {
		pending.value = false;
	}
});

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

	.orb {
		display: none;
	}

	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
