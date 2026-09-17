<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 880px;">
		<div :class="$style.page">
			<header :class="$style.heading">
				<div><p :class="$style.eyebrow"><i class="ti ti-bell"></i> ПОДПИСКИ</p><h1>Новые серии</h1><p>Здесь появляются обновления только по тайтлам, за которыми вы следите.</p></div>
				<MkA to="/library" :class="$style.library"><i class="ti ti-bookmark"></i> Библиотека</MkA>
			</header>

			<div v-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Загружаем обновления…</div>
			<div v-else-if="events.length === 0" :class="$style.empty"><i class="ti ti-bell-off"></i><strong>Пока нет новых серий</strong><span>На странице тайтла включите «Следить за сериями», чтобы его будущие обновления появились здесь.</span><MkA to="/" :class="$style.start">Открыть каталог</MkA></div>
			<div v-else :class="$style.list">
				<MkA v-for="event in events" :key="event.id" :to="`/zalip/${event.work.slug}`" :class="$style.event">
					<img v-if="event.work.posterPath" :src="tmdbImage(event.work.posterPath)" :alt="event.work.title" loading="lazy">
					<div><p>{{ event.work.title }}</p><h2>{{ releaseLabel(event) }}</h2><span>{{ dateLabel(event.createdAt) }}</span></div>
				</MkA>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type ReleaseEvent = {
	id: string;
	createdAt: string;
	work: { slug: string; title: string; posterPath: string | null; };
	season: { seasonNumber: number; title: string; };
	episode: { episodeNumber: number; title: string; };
};

const events = ref<ReleaseEvent[]>([]);
const pending = ref(true);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function releaseLabel(event: ReleaseEvent): string {
	return `${event.season.seasonNumber === 0 ? 'Спецэпизод' : `Сезон ${event.season.seasonNumber}`} · серия ${event.episode.episodeNumber}: ${event.episode.title}`;
}

function dateLabel(createdAt: string): string {
	return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(createdAt));
}

onMounted(async () => {
	try {
		events.value = await misskeyApiZalip<ReleaseEvent[]>('zalip/releases/subscribed', { limit: 50 });
	} finally {
		pending.value = false;
	}
});

definePage(() => ({ title: 'Подписки', icon: 'ti ti-bell' }));
</script>

<style lang="scss" module>
.page { padding: 24px var(--MI-margin) 52px; }
.heading { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--MI_THEME-accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; }
.heading h1 { margin: 0; font-size: 2rem; }
.heading p:not(.eyebrow) { margin: 8px 0 0; color: var(--MI_THEME-fgTransparentWeak); }
.library, .start { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); font-weight: 700; text-decoration: none; }
.empty { display: grid; justify-items: center; gap: 10px; padding: 52px 22px; border: 1px dashed var(--MI_THEME-divider); border-radius: 20px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; }
.empty i { color: var(--MI_THEME-accent); font-size: 2rem; }
.empty strong { color: var(--MI_THEME-fg); }
.start { margin-top: 8px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.list { display: grid; gap: 10px; }
.event { display: grid; grid-template-columns: 62px minmax(0, 1fr); overflow: hidden; min-height: 86px; border-radius: 16px; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); text-decoration: none; }
.event img { width: 62px; height: 86px; object-fit: cover; background: var(--MI_THEME-panelHighlight); }
.event > div { display: grid; align-content: center; gap: 4px; padding: 12px; }
.event p, .event h2, .event span { margin: 0; }
.event p { color: var(--MI_THEME-fgTransparentWeak); font-size: 0.78rem; }
.event h2 { font-size: 0.95rem; line-height: 1.35; }
.event span { color: var(--MI_THEME-fgTransparentWeak); font-size: 0.75rem; }
@media (max-width: 600px) { .page { padding-top: 12px; } .heading { align-items: start; flex-direction: column; } }
</style>
