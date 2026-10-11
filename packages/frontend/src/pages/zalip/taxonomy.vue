<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1000px;">
		<main :class="$style.page">
			<header :class="$style.heading"><div><p :class="$style.eyebrow"><i :class="typeIcon" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.catalogueEyebrow }}</p><h1>{{ entry?.name ?? taxonomyTypeLabel(currentType) }}</h1><p v-if="!props.slug">{{ i18n.ts.zalip._importer.directoryDescription }}</p></div><MkA :to="props.slug ? `/zalip/taxonomy?type=${currentType}` : '/catalog'" :class="$style.button"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ props.slug ? i18n.ts.zalip._importer.backDirectory : i18n.ts.zalip._importer.backWorks }}</MkA></header>
			<template v-if="!props.slug">
				<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._importer.catalogueDirectories"><MkA v-for="type in taxonomyTypes" :key="type" :to="`/zalip/taxonomy?type=${type}`" :class="{ [$style.active]: currentType === type }" :aria-current="currentType === type ? 'page' : undefined">{{ taxonomyTypeLabel(type) }}</MkA></nav>
				<form :class="$style.search" @submit.prevent="applySearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model.trim="queryInput" type="search" maxlength="200" :aria-label="i18n.ts.zalip._importer.directorySearch" :placeholder="i18n.ts.zalip._importer.directorySearchPlaceholder"><button type="submit" class="_button" :class="$style.button">{{ i18n.ts.zalip._importer.find }}</button></form>
			</template>
			<div v-if="loading && !entries.length && !entry" :class="$style.empty"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.loading }}</div>
			<div v-else-if="loadError && !entry && !entries.length" :class="$style.empty" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><strong>{{ loadError }}</strong><button type="button" class="_button" :class="$style.button" @click="load(false)">{{ i18n.ts.zalip._importer.retry }}</button></div>
			<template v-else-if="entry">
				<section :class="$style.hero"><div v-if="importerImageUrl(entry.imageUrl)" :class="[$style.entityArtwork, { [$style.portrait]: currentType === 'person' }]"><img :src="importerImageUrl(entry.imageUrl)!" :alt="entry.name"></div><div :class="$style.heroInformation"><dl v-if="facts.length" :class="$style.facts"><div v-for="fact in facts" :key="fact.key"><dt>{{ taxonomyFactLabel(fact.key) }}</dt><dd><a v-if="fact.href" :href="fact.href" target="_blank" rel="noopener noreferrer">{{ fact.value }}<i class="ti ti-external-link" aria-hidden="true"></i></a><template v-else>{{ fact.value }}</template></dd></div></dl><p v-if="biography" :class="$style.description">{{ biography }}</p><p v-else :class="$style.muted">{{ i18n.tsx.zalip._importer.catalogueEntity({ type: taxonomyTypeLabel(entry.type) }) }}</p></div></section>
				<section><h2>{{ currentType === 'person' ? i18n.ts.zalip._importer.filmography : currentType === 'studio' ? i18n.ts.zalip._importer.studioWorks : i18n.ts.zalip._importer.works }}</h2><p v-if="!works.length" :class="$style.empty">{{ i18n.ts.zalip._importer.noPublishedWorks }}</p><div v-else :class="$style.works"><MkA v-for="work in works" :key="`${work.id}:${work.role ?? ''}`" :to="`/zalip/${work.slug}`" :class="$style.work"><div :class="$style.poster"><img v-if="importerImageUrl(work.posterPath)" :src="importerImageUrl(work.posterPath)!" alt="" loading="lazy"><i v-else class="ti ti-movie" aria-hidden="true"></i></div><div><h3>{{ work.title }}</h3><p>{{ [work.releaseYear, kindLabel(work.kind)].filter(Boolean).join(' · ') }}</p><p v-if="work.role || work.character" :class="$style.role">{{ [work.role, work.character].filter(Boolean).join(' · ') }}</p></div></MkA></div></section>
			</template>
			<template v-else-if="!props.slug"><div v-if="entries.length" :class="$style.entries"><MkA v-for="item in entries" :key="item.id" :to="`/zalip/taxonomy/${item.type}/${item.slug}`" :class="$style.entry"><div :class="$style.entryArtwork"><img v-if="importerImageUrl(item.imageUrl)" :src="importerImageUrl(item.imageUrl)!" alt="" loading="lazy"><i v-else :class="typeIcon" aria-hidden="true"></i></div><div><h2>{{ item.name }}</h2><p v-if="item.description">{{ item.description }}</p></div><i class="ti ti-chevron-right" aria-hidden="true"></i></MkA></div><p v-else :class="$style.empty">{{ i18n.ts.zalip._importer.directoryNoResults }}</p><button v-if="hasMore" type="button" class="_button" :class="[$style.button, $style.more]" :disabled="loading" @click="load(true)">{{ loading ? i18n.ts.zalip._importer.loading : i18n.ts.zalip._importer.showMore }}</button></template>
			<p v-else :class="$style.empty">{{ i18n.ts.zalip._importer.entryNotFound }}</p>
			<p v-if="loadError && (entry || entries.length)" :class="$style.loadError" role="alert">{{ loadError }} <button type="button" class="_textButton" :disabled="loading" @click="load(true)">{{ i18n.ts.zalip._importer.retry }}</button></p>
			<button v-if="entry && worksCursor" type="button" class="_button" :class="[$style.button, $style.more]" :disabled="loading" @click="load(true)">{{ loading ? i18n.ts.zalip._importer.loading : i18n.ts.zalip._importer.showMore }}</button>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from 'vue';
import type { TaxonomyEntry, TaxonomyType, TaxonomyWork } from '@/utility/zalip-importer.js';
import { i18n } from '@/i18n.js';
import { importerImageUrl, taxonomyAppendWorks, taxonomyFactLabel, taxonomyFacts, taxonomyTypeLabel, taxonomyTypes } from '@/utility/zalip-importer.js';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

const props = withDefaults(defineProps<{ type?: string; slug?: string; query?: string }>(), { type: 'person', slug: '', query: '' });
const router = useRouter();
const currentType = computed<TaxonomyType>(() => taxonomyTypes.includes(props.type as TaxonomyType) ? props.type as TaxonomyType : 'person');
const typeIcon = computed(() => ({ person: 'ti ti-users', studio: 'ti ti-building', genre: 'ti ti-tag', category: 'ti ti-folders', collection: 'ti ti-stack-2' })[currentType.value]);
const queryInput = ref(props.query);
const entries = ref<TaxonomyEntry[]>([]);
const entry = ref<TaxonomyEntry | null>(null);
const works = ref<TaxonomyWork[]>([]);
const worksCursor = ref<string | null>(null);
const loading = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const facts = computed(() => taxonomyFacts(entry.value?.data));
const biography = computed(() => currentType.value === 'person' && Object.hasOwn(entry.value?.data ?? {}, 'biography') ? typeof entry.value?.data?.biography === 'string' ? entry.value.data.biography.trim() : '' : entry.value?.description ?? '');
let requestRevision = 0;
const PAGE_SIZE = 50;

function kindLabel(kind: string): string { return ({ movie: i18n.ts.zalip._importer.movie, series: i18n.ts.zalip._importer.series, anime: i18n.ts.zalip._importer.anime, animation: i18n.ts.zalip._importer.animation } as Record<string, string>)[kind] ?? ''; }

function applySearch(): void { router.push('/zalip/taxonomy', { query: { type: currentType.value, q: queryInput.value || undefined } }); }

async function load(append: boolean): Promise<void> {
	if (append && loading.value) return;
	if (append && props.slug && !worksCursor.value) return;
	const revision = ++requestRevision;
	loading.value = true;
	loadError.value = '';
	try {
		if (props.slug) {
			const result = await misskeyApiZalip<{ entry: TaxonomyEntry; works: TaxonomyWork[]; nextCursor: string | null }>('zalip/taxonomy/show', { type: currentType.value, slug: props.slug, limit: PAGE_SIZE, ...(append && worksCursor.value ? { cursor: worksCursor.value } : {}) });
			if (revision !== requestRevision) return;
			entry.value = result.entry;
			works.value = append ? taxonomyAppendWorks(works.value, result.works) : result.works;
			worksCursor.value = result.nextCursor ?? null;
		} else {
			const result = await misskeyApiZalip<{ entries: TaxonomyEntry[] }>('zalip/taxonomy/list', { type: currentType.value, query: props.query, limit: PAGE_SIZE, offset: append ? entries.value.length : 0 });
			if (revision !== requestRevision) return;
			entries.value = append ? [...entries.value, ...result.entries.filter(item => !entries.value.some(existing => existing.id === item.id))] : result.entries;
			hasMore.value = result.entries.length === PAGE_SIZE;
		}
	} catch {
		if (revision === requestRevision) loadError.value = props.slug ? i18n.ts.zalip._importer.entryLoadFailed : i18n.ts.zalip._importer.directoryLoadFailed;
	} finally { if (revision === requestRevision) loading.value = false; }
}

watch(() => [props.type, props.slug, props.query], () => { entry.value = null; entries.value = []; works.value = []; worksCursor.value = null; hasMore.value = false; queryInput.value = props.query; void load(false); });
onMounted(() => void load(false));
definePage(() => ({ title: entry.value?.name ?? taxonomyTypeLabel(currentType.value), icon: typeIcon.value }));
</script>

<style lang="scss" module>
.page { padding: 24px var(--MI-margin) 64px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.heading h1 { margin: 0; font-size: 1.8rem; }
.heading p { color: var(--MI_THEME-fgTransparentWeak); font-size: .9rem; line-height: 1.6; }
.eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--MI_THEME-accent) !important; font-size: .72rem !important; font-weight: 700; letter-spacing: .1em; }
.button { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 9px 14px; box-sizing: border-box; border-radius: 999px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font-size: .85rem; font-weight: 700; text-decoration: none; flex-shrink: 0; }
.page button:focus-visible, .page a:focus-visible, .page input:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.tabs { display: flex; gap: 6px; padding: 5px; margin-bottom: 18px; border-radius: 999px; background: var(--MI_THEME-panel); overflow-x: auto; }
.tabs a { flex: 1; padding: 11px 14px; border-radius: 999px; text-align: center; white-space: nowrap; text-decoration: none; font-size: .9rem; }
.tabs .active { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 700; }
.search { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 16px; margin-bottom: 24px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; background: var(--MI_THEME-panel); }
.search > i { color: var(--MI_THEME-fgTransparentWeak); }
.search input { flex: 1; min-width: 0; width: 100%; padding: 6px; border: 0; background: transparent; color: var(--MI_THEME-fg); font: inherit; font-size: 15px; }
.entries { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.entry { display: flex; align-items: center; gap: 14px; padding: 16px; min-width: 0; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); text-decoration: none; }
.entry > div:nth-child(2) { flex: 1; min-width: 0; }
.entry h2 { margin: 0; font-size: 1rem; }
.entry p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 6px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: .8rem; line-height: 1.5; }
.entry > i { color: var(--MI_THEME-fgTransparentWeak); }
.entryArtwork { display: grid; place-items: center; width: 60px; height: 60px; flex-shrink: 0; border-radius: var(--MI-radius); background: var(--MI_THEME-bg); overflow: clip; }
.entryArtwork img { width: 100%; height: 100%; object-fit: cover; }
.entryArtwork i { color: var(--MI_THEME-accent); font-size: 1.6rem; }
.hero { display: flex; align-items: start; gap: 24px; padding: 24px; margin-bottom: 32px; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
.heroInformation { flex: 1; min-width: 0; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; margin: 0 0 24px; }
.facts > div { min-width: 0; }
.facts dt { margin-bottom: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: .8rem; }
.facts dd { margin: 0; font-size: .9rem; line-height: 1.5; overflow-wrap: anywhere; user-select: text; }
.facts a { color: var(--MI_THEME-accent); }
.facts i { margin-left: 5px; }
.entityArtwork { width: 220px; max-width: 40%; flex-shrink: 0; }
.entityArtwork img { width: 100%; max-height: 220px; object-fit: contain; border-radius: var(--MI-radius); }
.entityArtwork.portrait { width: 160px; }
.entityArtwork.portrait img { max-height: 240px; object-fit: cover; }
.description { margin: 0; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.muted { color: var(--MI_THEME-fgTransparentWeak); }
.works { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 18px 14px; }
.work { min-width: 0; text-decoration: none; }
.poster { display: grid; place-items: center; aspect-ratio: 2 / 3; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); overflow: clip; }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster i { font-size: 2.5rem; color: var(--MI_THEME-fgTransparentWeak); }
.work h3 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 9px 0 4px; font-size: .95rem; line-height: 1.4; }
.work p { margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: .78rem; line-height: 1.5; }
.work .role { margin-top: 4px; color: var(--MI_THEME-accent); }
.empty { display: grid; justify-items: center; gap: 12px; padding: 50px 20px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; }
.empty > i { font-size: 2rem; color: var(--MI_THEME-accent); }
.more { margin: 24px auto 0; display: flex; width: fit-content; }
.loadError { margin-top: 20px; color: var(--MI_THEME-error); font-size: .85rem; line-height: 1.6; }
@media (max-width: 650px) { .page { padding-top: 12px; } .heading { align-items: start; } .heading h1 { font-size: 1.4rem; } .heading .button { padding: 9px; font-size: .75rem; } .entries { grid-template-columns: 1fr; } .hero { gap: 16px; padding: 16px; } .entityArtwork.portrait { width: 100px; } .description { font-size: .9rem; } .works { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px 10px; } .tabs a { font-size: .82rem; } }
@media (max-width: 650px) { .hero { flex-wrap: wrap; } .heroInformation { flex-basis: 100%; } .facts { gap: 12px; } }
</style>
