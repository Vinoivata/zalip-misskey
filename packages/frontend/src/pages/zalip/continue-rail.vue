<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="$i && (items.length || failed || resetFailed)" :class="$style.section" :aria-label="i18n.ts.zalip.libraryContinue">
	<header :class="$style.heading"><h2>{{ i18n.ts.zalip.libraryContinue }}</h2><button v-if="failed" type="button" class="_button" :disabled="pending" @click="refresh">{{ i18n.ts.retry }}</button></header>
	<p v-if="failed" :class="$style.error" role="status">{{ i18n.ts.zalip._progress.loadFailed }}</p>
	<p v-if="resetFailed" :class="$style.error" role="status">{{ i18n.ts.zalip._progress.resetFailed }}</p>
	<div :class="$style.rail" @pointerdown="drag.onPointerDown" @pointermove="drag.onPointerMove" @pointerup="drag.onPointerUp" @pointercancel="drag.onPointerCancel" @click.capture="drag.onClickCapture">
		<article v-for="item in items" :key="item.workId" :class="$style.card">
			<MkA :to="continueWatchingRoute(item)" :class="$style.link" :aria-label="i18n.tsx.zalip._progress.continueTitle({ title: item.work.title })">
				<div :class="$style.artwork"><img v-if="image(item)" :src="image(item)!" alt="" width="480" height="270" loading="lazy" decoding="async" draggable="false" @error="imageFailed(item)"><i v-else class="ti ti-movie" aria-hidden="true"></i><span :class="$style.play"><i class="ti ti-player-play-filled" aria-hidden="true"></i></span></div>
				<strong>{{ item.work.title }}</strong>
				<span v-if="item.seasonNumber != null && item.episodeNumber != null">{{ i18n.tsx.zalip.releaseSeason({ number: String(item.seasonNumber) }) }} · {{ i18n.tsx.zalip.releaseEpisode({ number: String(item.episodeNumber) }) }}</span>
				<span v-if="watchProgressPercent(item) != null">{{ watchTimeLabel(item.positionSeconds!) }} / {{ watchTimeLabel(item.durationSeconds!) }}</span><span v-else>{{ i18n.ts.zalip._progress.episodeOnly }}</span>
				<progress v-if="watchProgressPercent(item) != null" :value="watchProgressPercent(item)!" max="100" :aria-label="i18n.ts.zalip._progress.watchedProgress"></progress>
			</MkA>
			<button type="button" class="_button" :class="$style.remove" :disabled="removing.length > 0" :aria-label="i18n.tsx.zalip._progress.removeTitle({ title: item.work.title })" @click="remove(item.workId)"><i class="ti ti-x" aria-hidden="true"></i></button>
		</article>
	</div>
</section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import type { ContinueWatchingItem } from '@/utility/zalip-watch-progress.js';
import { continueWatchingRoute, watchProgressPercent, watchTimeLabel } from '@/utility/zalip-watch-progress.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { importerImageUrl } from '@/utility/zalip-importer.js';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
import { useZalipPageReload } from '@/composables/use-zalip-page-reload.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

const items = ref<ContinueWatchingItem[]>([]);
const pending = ref(false);
const failed = ref(false);
const resetFailed = ref(false);
const removing = ref<string[]>([]);
const broken = ref(new Set<string>());
const drag = useZalipHorizontalDrag();
let request = 0;

function image(item: ContinueWatchingItem): string | null {
	return [item.episode?.stillPath, item.work.backdropPath, item.work.posterThumbnailUrl, item.work.posterPath].map(value => importerImageUrl(value ?? null, 'w780')).find(value => value && !broken.value.has(value)) ?? null;
}

function imageFailed(item: ContinueWatchingItem): void { const url = image(item); if (url) broken.value = new Set([...broken.value, url]); }

async function refresh(): Promise<void> {
	if (removing.value.length) return;
	const epoch = ++request;
	const accountId = $i?.id;
	if (!accountId) { items.value = []; failed.value = false; return; }
	pending.value = true;
	try {
		const result = await misskeyApiZalip<{ items: ContinueWatchingItem[]; nextCursor: string | null }>('zalip/progress/continue', { limit: 12 });
		if (epoch !== request || $i?.id !== accountId) return;
		items.value = result.items.filter((item, index, all) => !item.completed && all.findIndex(candidate => candidate.workId === item.workId) === index);
		failed.value = false;
	} catch { if (epoch === request && $i?.id === accountId) failed.value = true; } finally { if (epoch === request) pending.value = false; }
}

async function remove(workId: string): Promise<void> {
	if (removing.value.length) return;
	const accountId = $i?.id;
	const epoch = ++request;
	pending.value = false;
	removing.value = [...removing.value, workId];
	resetFailed.value = false;
	try {
		await misskeyApiZalip('zalip/progress/reset', { workId });
		if (epoch === request && $i?.id === accountId) items.value = items.value.filter(item => item.workId !== workId);
	} catch { if ($i?.id === accountId) resetFailed.value = true; } finally { removing.value = removing.value.filter(id => id !== workId); }
}

useZalipPageReload(refresh);
onBeforeUnmount(() => { request++; });
defineExpose({ refresh });
</script>

<style lang="scss" module>
.section { container-type: inline-size; min-width: 0; margin: 24px 24px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; h2 { margin: 0; font-size: 1.25em; } button { color: var(--MI_THEME-accent); } }
.rail { display: flex; gap: 14px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x mandatory; padding: 2px 2px 12px; }
.card { position: relative; flex: 0 0 clamp(min(220px, 100cqw), 72cqw, 300px); min-width: 0; scroll-snap-align: start; }
.link { display: flex; flex-direction: column; gap: 6px; text-decoration: none; strong { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; } > span { font-size: .82em; color: var(--MI_THEME-fg); opacity: .7; } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; border-radius: var(--MI-radius); } progress { width: 100%; height: 4px; accent-color: var(--MI_THEME-accent); } }
.artwork { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; border-radius: var(--MI-radius); overflow: hidden; background: var(--MI_THEME-panelHighlight); > img { width: 100%; height: 100%; object-fit: cover; } > i { font-size: 2.5em; opacity: .4; } }
.play { position: absolute; display: grid; place-items: center; width: 42px; height: 42px; border-radius: 50%; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.remove { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); > i { font-size: 16px; } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } }
.error { color: var(--MI_THEME-error); font-size: .85em; }
@media (max-width: 767px) { .section { margin-inline: 16px; } }
</style>
