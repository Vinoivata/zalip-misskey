<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 960px;">
		<main :class="$style.page">
			<header v-if="!props.slug" :class="$style.heading">
				<div><p :class="$style.eyebrow">{{ i18n.ts.zalip._importer.catalogueEyebrow }}</p><h1>{{ taxonomyTypeLabel(currentType) }}</h1><p>{{ i18n.ts.zalip._importer.directoryDescription }}</p></div>
				<MkA to="/catalog" :class="$style.button"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.backWorks }}</MkA>
			</header>
			<nav v-else :class="$style.breadcrumb" :aria-label="i18n.ts.zalip._importer.catalogueDirectories"><MkA :to="`/zalip/taxonomy?type=${currentType}`"><i class="ti ti-arrow-left" aria-hidden="true"></i>{{ taxonomyTypeLabel(currentType) }}</MkA><span v-if="entry" aria-hidden="true">/</span><span v-if="entry">{{ entry.name }}</span></nav>
			<template v-if="!props.slug">
				<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._importer.catalogueDirectories"><MkA v-for="type in taxonomyTypes" :key="type" :to="`/zalip/taxonomy?type=${type}`" :class="{ [$style.active]: currentType === type }" :aria-current="currentType === type ? 'page' : undefined">{{ taxonomyTypeLabel(type) }}</MkA></nav>
				<form :class="$style.search" @submit.prevent="applySearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model.trim="queryInput" type="search" maxlength="200" :aria-label="i18n.ts.zalip._importer.directorySearch" :placeholder="i18n.ts.zalip._importer.directorySearchPlaceholder"><button type="submit" class="_button" :class="$style.button">{{ i18n.ts.zalip._importer.find }}</button></form>
			</template>
			<div v-if="loading && !entries.length && !entry" :class="$style.empty"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.loading }}</div>
			<div v-else-if="loadError && !entry && !entries.length" :class="$style.empty" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i><strong>{{ loadError }}</strong><button type="button" class="_button" :class="$style.button" @click="load(false)">{{ i18n.ts.zalip._importer.retry }}</button></div>
			<template v-else-if="entry">
				<section :class="$style.profile" :aria-labelledby="`taxonomy-${entry.id}-name`">
					<div :class="[$style.profileArtwork, { [$style.portrait]: currentType === 'person', [$style.logo]: currentType === 'studio' }]">
						<img v-if="imageUrl(entry.imageUrl)" :src="imageUrl(entry.imageUrl)!" :alt="entry.name" :width="currentType === 'person' ? 400 : 640" :height="currentType === 'person' ? 600 : currentType === 'studio' ? 640 : 360" decoding="async" @error="markBrokenImage(entry.imageUrl)">
						<i v-else :class="typeIcon" aria-hidden="true"></i>
					</div>
					<div :class="$style.profileInformation">
						<p :class="$style.entityType">{{ taxonomyProfileLabel(entry.type) }}</p>
						<h1 :id="`taxonomy-${entry.id}-name`">{{ entry.name }}</h1>
						<section v-if="biography" :class="$style.overview"><h2>{{ i18n.ts.zalip._taxonomy.overview }}</h2><p :class="$style.description">{{ biography }}</p></section>
						<dl v-if="facts.length" :class="$style.facts"><div v-for="fact in facts" :key="fact.key"><dt>{{ taxonomyFactLabel(fact.key) }}</dt><dd><a v-if="fact.href" :href="fact.href" target="_blank" rel="noopener noreferrer">{{ fact.value }}<i class="ti ti-external-link" aria-hidden="true"></i></a><template v-else>{{ fact.value }}</template></dd></div></dl>
					</div>
				</section>
				<section :class="$style.filmography" :aria-labelledby="`taxonomy-${entry.id}-works`">
					<h2 :id="`taxonomy-${entry.id}-works`">{{ currentType === 'person' ? i18n.ts.zalip._importer.filmography : currentType === 'studio' ? i18n.ts.zalip._importer.studioWorks : i18n.ts.zalip._importer.works }}</h2>
					<p v-if="!workCards.length" :class="$style.empty">{{ i18n.ts.zalip._importer.noPublishedWorks }}</p>
					<div v-else :class="$style.works"><MkA v-for="work in workCards" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.work"><div :class="$style.poster"><img v-if="imageUrl(work.posterPath)" :src="imageUrl(work.posterPath)!" alt="" width="300" height="450" loading="lazy" decoding="async" @error="markBrokenImage(work.posterPath)"><i v-else class="ti ti-movie" aria-hidden="true"></i></div><h3>{{ work.title }}</h3><p>{{ [work.releaseYear, kindLabel(work.kind)].filter(Boolean).join(' · ') }}</p><p v-if="work.credits.length" :class="$style.role">{{ taxonomyCreditCaption(work.credits) }}</p></MkA></div>
				</section>
			</template>
			<template v-else-if="!props.slug">
				<div v-if="entries.length" :class="[$style.entries, { [$style.peopleDirectory]: currentType === 'person' }]"><MkA v-for="item in entries" :key="item.id" :to="`/zalip/taxonomy/${item.type}/${item.slug}`" :class="$style.entry"><div :class="[$style.entryArtwork, { [$style.portrait]: currentType === 'person', [$style.logo]: currentType === 'studio' }]"><img v-if="imageUrl(item.imageUrl)" :src="imageUrl(item.imageUrl)!" alt="" :width="currentType === 'person' ? 300 : 480" :height="currentType === 'person' ? 450 : currentType === 'studio' ? 480 : 270" loading="lazy" decoding="async" @error="markBrokenImage(item.imageUrl)"><i v-else :class="typeIcon" aria-hidden="true"></i></div><div :class="$style.entryInformation"><h2>{{ item.name }}</h2><p v-if="item.description">{{ item.description }}</p><p v-else :class="$style.entryType">{{ taxonomyProfileLabel(item.type) }}</p></div></MkA></div>
				<p v-else :class="$style.empty">{{ i18n.ts.zalip._importer.directoryNoResults }}</p>
				<button v-if="hasMore" type="button" class="_button" :class="[$style.button, $style.more]" :disabled="loading" @click="load(true)">{{ loading ? i18n.ts.zalip._importer.loading : i18n.ts.zalip._importer.showMore }}</button>
			</template>
			<p v-else :class="$style.empty">{{ i18n.ts.zalip._importer.entryNotFound }}</p>
			<p v-if="loadError && (entry || entries.length)" :class="$style.loadError" role="alert">{{ loadError }} <button type="button" class="_textButton" :disabled="loading" @click="load(retryAppend)">{{ i18n.ts.zalip._importer.retry }}</button></p>
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
import { taxonomyCreditCaption, taxonomyGroupWorks, taxonomyProfileLabel, taxonomyTypeIcon } from '@/utility/zalip-taxonomy.js';

const props = withDefaults(defineProps<{ type?: string; slug?: string; query?: string }>(), { type: 'person', slug: '', query: '' });
const router = useRouter();
const currentType = computed<TaxonomyType>(() => taxonomyTypes.includes(props.type as TaxonomyType) ? props.type as TaxonomyType : 'person');
const typeIcon = computed(() => taxonomyTypeIcon(currentType.value));
const queryInput = ref(props.query);
const entries = ref<TaxonomyEntry[]>([]);
const entry = ref<TaxonomyEntry | null>(null);
const works = ref<TaxonomyWork[]>([]);
const workCards = computed(() => taxonomyGroupWorks(works.value));
const worksCursor = ref<string | null>(null);
const loading = ref(false);
const loadError = ref('');
const hasMore = ref(false);
const directoryOffset = ref(0);
const retryAppend = ref(false);
const brokenImages = ref(new Set<string>());
const facts = computed(() => taxonomyFacts(entry.value?.data));
const biography = computed(() => currentType.value === 'person' && Object.hasOwn(entry.value?.data ?? {}, 'biography') ? typeof entry.value?.data?.biography === 'string' ? entry.value.data.biography.trim() : '' : entry.value?.description ?? '');
let requestRevision = 0;
const PAGE_SIZE = 50;

function kindLabel(kind: string): string { return ({ movie: i18n.ts.zalip._importer.movie, series: i18n.ts.zalip._importer.series, anime: i18n.ts.zalip._importer.anime, animation: i18n.ts.zalip._importer.animation } as Record<string, string>)[kind] ?? ''; }

function applySearch(): void { router.push('/zalip/taxonomy', { query: { type: currentType.value, q: queryInput.value || undefined } }); }

function imageUrl(value: string | null): string | null {
	const url = importerImageUrl(value);
	return url && !brokenImages.value.has(url) ? url : null;
}

function markBrokenImage(value: string | null): void {
	const url = importerImageUrl(value);
	if (url) brokenImages.value = new Set([...brokenImages.value, url]);
}

async function load(append: boolean): Promise<void> {
	if (append && loading.value) return;
	if (append && props.slug && !worksCursor.value) return;
	const revision = ++requestRevision;
	loading.value = true;
	loadError.value = '';
	retryAppend.value = append;
	try {
		if (props.slug) {
			const result = await misskeyApiZalip<{ entry: TaxonomyEntry; works: TaxonomyWork[]; nextCursor: string | null }>('zalip/taxonomy/show', { type: currentType.value, slug: props.slug, limit: PAGE_SIZE, ...(append && worksCursor.value ? { cursor: worksCursor.value } : {}) });
			if (revision !== requestRevision) return;
			entry.value = result.entry;
			works.value = append ? taxonomyAppendWorks(works.value, result.works) : result.works;
			worksCursor.value = result.nextCursor ?? null;
		} else {
			const offset = append ? directoryOffset.value : 0;
			const result = await misskeyApiZalip<{ entries: TaxonomyEntry[] }>('zalip/taxonomy/list', { type: currentType.value, query: props.query, limit: PAGE_SIZE, offset });
			if (revision !== requestRevision) return;
			entries.value = append ? [...entries.value, ...result.entries.filter(item => !entries.value.some(existing => existing.id === item.id))] : result.entries;
			directoryOffset.value = offset + result.entries.length;
			hasMore.value = result.entries.length === PAGE_SIZE;
		}
	} catch {
		if (revision === requestRevision) loadError.value = props.slug ? i18n.ts.zalip._importer.entryLoadFailed : i18n.ts.zalip._importer.directoryLoadFailed;
	} finally { if (revision === requestRevision) loading.value = false; }
}

watch(() => [props.type, props.slug, props.query], () => { entry.value = null; entries.value = []; works.value = []; worksCursor.value = null; hasMore.value = false; directoryOffset.value = 0; brokenImages.value = new Set(); queryInput.value = props.query; void load(false); });
onMounted(() => void load(false));
definePage(() => ({ title: entry.value?.name ?? taxonomyTypeLabel(currentType.value), icon: typeIcon.value }));
</script>

<style lang="scss" module>
.page { min-width: 0; padding: 24px var(--MI-margin) 64px; }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.heading h1 { margin: 0; font-size: 1.8rem; }
.heading p { color: var(--MI_THEME-fgTransparentWeak); font-size: .9rem; line-height: 1.6; }
.breadcrumb { display: flex; align-items: center; gap: 10px; min-width: 0; margin-bottom: 24px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.breadcrumb a { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; color: var(--MI_THEME-accent); text-decoration: none; }
.breadcrumb > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--MI_THEME-accent) !important; font-size: .72rem !important; font-weight: 700; letter-spacing: .1em; }
.button { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 9px 14px; box-sizing: border-box; border-radius: 999px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font-size: .85rem; font-weight: 700; text-decoration: none; flex-shrink: 0; }
.page button:focus-visible, .page a:focus-visible, .page input:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.tabs { display: flex; gap: 6px; padding: 5px; margin-bottom: 18px; border-radius: 999px; background: var(--MI_THEME-panel); overflow-x: auto; }
.tabs a { flex: 1; padding: 11px 14px; border-radius: 999px; text-align: center; white-space: nowrap; text-decoration: none; font-size: .9rem; }
.tabs .active { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 700; }
.search { display: flex; align-items: center; gap: 10px; padding: 8px 10px 8px 16px; margin-bottom: 24px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; background: var(--MI_THEME-panel); }
.search > i { color: var(--MI_THEME-fgTransparentWeak); }
.search input { flex: 1; min-width: 0; width: 100%; padding: 6px; border: 0; background: transparent; color: var(--MI_THEME-fg); font: inherit; font-size: 15px; }
.entries { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px 16px; }
.peopleDirectory { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.entry { min-width: 0; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); overflow: clip; text-decoration: none; color: var(--MI_THEME-fg); transition: border-color .15s; }
.entry:hover { border-color: var(--MI_THEME-accent); }
.entryInformation { padding: 12px; }
.entry h2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 0; font-size: 1rem; line-height: 1.4; overflow-wrap: anywhere; }
.entry p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 6px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: .8rem; line-height: 1.5; }
.entry .entryType { color: var(--MI_THEME-accent); }
.entryArtwork, .profileArtwork { display: grid; place-items: center; aspect-ratio: 16 / 9; min-width: 0; background: var(--MI_THEME-panelHighlight); overflow: clip; }
.entryArtwork img, .profileArtwork img { display: block; width: 100%; height: 100%; object-fit: cover; }
.entryArtwork i, .profileArtwork i { color: var(--MI_THEME-accent); font-size: 48px; }
.portrait { aspect-ratio: 2 / 3; }
.logo { aspect-ratio: 1; }
.logo img { box-sizing: border-box; padding: 24px; object-fit: contain; }
.profile { display: grid; grid-template-columns: 220px minmax(0, 1fr); align-items: start; gap: 28px; padding: 24px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
.profileArtwork { border-radius: var(--MI-radius); }
.profileInformation { min-width: 0; }
.profileInformation h1 { margin: 8px 0 24px; font-size: clamp(24px, 4vw, 34px); line-height: 1.2; overflow-wrap: anywhere; }
.entityType { display: inline-flex; margin: 0; padding: 5px 9px; border-radius: 999px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-size: 12px; font-weight: 600; }
.overview h2 { margin: 0 0 10px; font-size: 17px; }
.facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 24px; margin: 24px 0 0; padding-top: 20px; border-top: 1px solid var(--MI_THEME-divider); }
.facts > div { min-width: 0; }
.facts dt { margin-bottom: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: .8rem; }
.facts dd { margin: 0; font-size: .9rem; line-height: 1.5; overflow-wrap: anywhere; user-select: text; }
.facts a { color: var(--MI_THEME-accent); }
.facts i { margin-left: 5px; }
.description { margin: 0; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
.filmography { margin-top: 32px; }
.filmography > h2 { margin: 0 0 20px; font-size: 21px; }
.works { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 18px 14px; }
.work { min-width: 0; text-decoration: none; }
.poster { display: grid; place-items: center; aspect-ratio: 2 / 3; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); overflow: clip; }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster i { font-size: 2.5rem; color: var(--MI_THEME-fgTransparentWeak); }
.work h3 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; margin: 9px 0 4px; font-size: .95rem; line-height: 1.4; }
.work p { margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: .78rem; line-height: 1.5; }
.work .role { margin-top: 4px; color: var(--MI_THEME-accent); overflow-wrap: anywhere; }
.empty { display: grid; justify-items: center; gap: 12px; padding: 50px 20px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; }
.empty > i { font-size: 2rem; color: var(--MI_THEME-accent); }
.more { margin: 24px auto 0; display: flex; width: fit-content; }
.loadError { margin-top: 20px; color: var(--MI_THEME-error); font-size: .85rem; line-height: 1.6; }
@media (max-width: 650px) {
	.page { padding-top: 12px; }
	.heading { align-items: start; }
	.heading h1 { font-size: 1.4rem; }
	.heading .button { padding: 9px; font-size: .75rem; }
	.breadcrumb { margin-bottom: 16px; }
	.entries { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px 10px; }
	.peopleDirectory { grid-template-columns: repeat(3, minmax(0, 1fr)); }
	.entryInformation { padding: 10px; }
	.entry h2 { font-size: .85rem; }
	.entry p { font-size: .75rem; }
	.profile { grid-template-columns: 1fr; gap: 20px; padding: 18px; }
	.profileArtwork { width: min(320px, 100%); justify-self: center; }
	.profileArtwork.portrait { width: min(180px, 65%); }
	.profileArtwork.logo { width: min(200px, 70%); }
	.profileInformation h1 { margin-bottom: 20px; }
	.description { font-size: .9rem; }
	.facts { gap: 14px; }
	.works { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px 10px; }
	.tabs a { font-size: .82rem; }
}
@media (max-width: 360px) { .peopleDirectory { grid-template-columns: repeat(2, minmax(0, 1fr)); } .facts { grid-template-columns: 1fr; } }
</style>
