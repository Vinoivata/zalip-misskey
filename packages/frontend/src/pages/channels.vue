<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<main :class="$style.root">
		<header :class="$style.header">
			<div><h1><i class="ti ti-users" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.title }}</h1><p>{{ i18n.ts.zalip._communities.description }}</p></div>
			<MkA v-if="$i?.policies.canCreateChannel" to="/channels/new" :class="$style.create"><i class="ti ti-plus" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.create }}</MkA>
		</header>
		<p v-if="$i && !$i.policies.canCreateChannel" :class="$style.notice">{{ i18n.ts.zalip._communities.createUnavailable }}</p>
		<form :class="$style.search" @submit.prevent="search">
			<label :class="$style.searchInput"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" type="search" maxlength="256" :aria-label="i18n.ts.zalip._communities.searchPlaceholder" :placeholder="i18n.ts.zalip._communities.searchPlaceholder"></label>
			<button type="submit" class="_button" :class="$style.searchButton">{{ i18n.ts.search }}</button>
		</form>
		<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._communities.title">
			<button v-for="item in tabs" :key="item.key" type="button" class="_button" :class="{ [$style.active]: mode === item.key }" :aria-pressed="mode === item.key" @click="switchMode(item.key)"><i :class="item.icon" aria-hidden="true"></i> {{ item.label }}</button>
		</nav>
		<section :class="$style.results" :aria-label="i18n.ts.zalip._communities.title" :aria-busy="directory.state.pending">
			<div :class="$style.grid"><MkChannelPreview v-for="community in directory.state.items" :key="community.id" :channel="community"/></div>
			<div v-if="directory.state.error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._communities.loadError }}</p><button type="button" class="_textButton" @click="directory.load">{{ i18n.ts.retry }}</button></div>
			<div v-else-if="directory.state.loaded && !directory.state.items.length" :class="$style.state"><i class="ti ti-users" aria-hidden="true"></i><p>{{ i18n.ts.zalip._communities.noResults }}</p><MkA v-if="$i?.policies.canCreateChannel" to="/channels/new" :class="$style.create">{{ i18n.ts.zalip._communities.create }}</MkA></div>
			<p v-if="directory.state.pending" :class="$style.state" role="status">{{ i18n.ts.loading }}</p>
			<button v-else-if="directory.state.hasMore && !directory.state.error" type="button" class="_button" :class="$style.more" @click="directory.load">{{ i18n.ts.loadMore }}</button>
		</section>
	</main>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onActivated, onBeforeUnmount, ref, watch } from 'vue';
import type { CommunityDirectoryMode } from '@/utility/zalip-communities.js';
import MkChannelPreview from '@/components/MkChannelPreview.vue';
import { createCommunityDirectory } from '@/utility/zalip-communities.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';

const props = defineProps<{ query?: string; type?: 'nameAndDescription' | 'nameOnly' }>();
const query = ref(props.query ?? '');
const submittedQuery = ref(props.query ?? '');
const mode = ref<CommunityDirectoryMode>('discover');
const directory = createCommunityDirectory({ accountId: () => $i?.id ?? null, token: () => $i?.token ?? null, fetchPage: (endpoint, params, token) => misskeyApi(endpoint, params, token) });
const tabs = computed(() => [
	{ key: 'discover' as const, icon: 'ti ti-compass', label: i18n.ts.zalip._communities.discover },
	...($i ? [
		{ key: 'following' as const, icon: 'ti ti-user-check', label: i18n.ts.zalip._communities.following },
		{ key: 'owned' as const, icon: 'ti ti-users', label: i18n.ts.zalip._communities.owned },
		{ key: 'favorites' as const, icon: 'ti ti-star', label: i18n.ts.favorites },
	] : []),
]);
let activated = false;

function reload(): void { directory.reset(mode.value, submittedQuery.value); void directory.load(); }

function switchMode(value: CommunityDirectoryMode): void { if (value !== 'discover' && !$i) return; mode.value = value; reload(); }

function search(): void { mode.value = 'discover'; submittedQuery.value = query.value.trim(); reload(); }

watch(() => [$i?.id, $i?.token], () => { if (!$i) mode.value = 'discover'; reload(); }, { immediate: true });
watch(() => props.query, value => { query.value = value ?? ''; submittedQuery.value = value ?? ''; mode.value = 'discover'; reload(); });
onActivated(() => { if (activated) reload(); activated = true; });
onBeforeUnmount(directory.dispose);
definePage(() => ({ title: i18n.ts.zalip._communities.title, icon: 'ti ti-users' }));
</script>

<style lang="scss" module>
.root { width: 100%; max-width: 1080px; margin: 0 auto; padding: 24px; box-sizing: border-box; }
.header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 20px; h1 { margin: 0; font-size: 26px; } p { max-width: 620px; margin: 10px 0 0; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.5; font-size: 14px; } }
.create { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 14px; font-weight: 700; text-decoration: none; }
.notice { padding: 12px 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.search { display: flex; gap: 8px; padding: 6px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; background: var(--MI_THEME-panel); &:focus-within { border-color: var(--MI_THEME-focus); } }
.searchInput { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding-inline-start: 14px; input { flex: 1; width: 100%; min-width: 0; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--MI_THEME-fg); font: inherit; &:focus { outline: none; } } }
.searchButton { min-height: 44px; padding: 0 18px; border-radius: 999px; background: var(--MI_THEME-buttonBg); font-weight: 700; }
.tabs { display: flex; gap: 6px; overflow-x: auto; margin: 18px 0 24px; padding-bottom: 4px; button { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; min-height: 44px; padding: 0 14px; border-radius: 999px; color: var(--MI_THEME-fgTransparentWeak); } }
.tabs .active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); font-weight: 700; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr)); gap: 18px; }
.state { padding: 40px 16px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); > i { font-size: 36px; } .create { margin-top: 12px; } }
.more { display: block; min-height: 44px; margin: 24px auto 0; padding: 0 24px; border-radius: 999px; background: var(--MI_THEME-buttonBg); }
.root button:focus-visible, .create:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
@media (max-width: 600px) { .root { padding: 20px 16px; } .header { align-items: stretch; flex-direction: column; gap: 16px; h1 { font-size: 23px; } } .tabs { margin-bottom: 16px; } }
</style>
