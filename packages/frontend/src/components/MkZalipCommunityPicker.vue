<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow ref="dialog" :width="560" :height="640" @close="cancel" @click="cancel" @esc="cancel" @closed="emit('closed')">
	<template #header><i class="ti ti-users" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.pick }}</template>
	<div :class="$style.root">
		<button type="button" class="_button" :class="$style.personal" :aria-pressed="currentChannelId == null" @click="select(null)"><i class="ti ti-user" aria-hidden="true"></i><span>{{ i18n.ts.zalip._communities.personal }}<small>{{ i18n.ts.zalip._communities.optional }}</small></span><i v-if="currentChannelId == null" class="ti ti-check" aria-hidden="true"></i></button>
		<form :class="$style.search" @submit.prevent="search">
			<label :class="$style.searchInput"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" type="search" maxlength="256" :aria-label="i18n.ts.zalip._communities.searchPlaceholder" :placeholder="i18n.ts.zalip._communities.searchPlaceholder"></label>
			<button type="submit" class="_button" :class="$style.searchButton" :aria-label="i18n.ts.search"><i class="ti ti-arrow-right" aria-hidden="true"></i></button>
		</form>
		<div :class="$style.tabs" role="group" :aria-label="i18n.ts.zalip._communities.title">
			<button v-if="$i" type="button" class="_button" :class="{ [$style.active]: mode === 'following' }" :aria-pressed="mode === 'following'" @click="switchMode('following')">{{ i18n.ts.zalip._communities.following }}</button>
			<button type="button" class="_button" :class="{ [$style.active]: mode === 'discover' }" :aria-pressed="mode === 'discover'" @click="switchMode('discover')">{{ i18n.ts.zalip._communities.discover }}</button>
		</div>
		<p :class="$style.notice">{{ i18n.ts.zalip._communities.publicNotice }}</p>
		<div :class="$style.results" :aria-busy="directory.state.pending">
			<button v-for="community in directory.state.items" :key="community.id" type="button" class="_button" :class="$style.item" :disabled="community.isArchived" :aria-pressed="currentChannelId === community.id" @click="select(community)">
				<img v-if="community.bannerUrl && !failedBanners.has(community.id)" :class="$style.image" :src="community.bannerUrl" alt="" width="48" height="48" loading="lazy" decoding="async" @error="failedBanners.add(community.id)">
				<span v-else :class="$style.image"><i class="ti ti-users" aria-hidden="true"></i></span>
				<span :class="$style.itemText"><strong>{{ community.name }}</strong><small v-if="community.isArchived">{{ i18n.ts.thisChannelArchived }}</small><small v-else>{{ community.description || i18n.ts.zalip._communities.publicNotice }}</small></span><i v-if="currentChannelId === community.id" class="ti ti-check" aria-hidden="true"></i>
			</button>
		</div>
		<div v-if="directory.state.error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._communities.loadError }}</p><button type="button" class="_textButton" @click="directory.load">{{ i18n.ts.retry }}</button></div>
		<p v-else-if="directory.state.loaded && !directory.state.items.length" :class="$style.state">{{ i18n.ts.zalip._communities.noResults }}</p>
		<p v-if="directory.state.pending" role="status" :class="$style.state">{{ i18n.ts.loading }}</p>
		<button v-else-if="directory.state.hasMore && !directory.state.error" type="button" class="_button" :class="$style.more" @click="directory.load">{{ i18n.ts.loadMore }}</button>
	</div>
</MkModalWindow>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { createCommunityDirectory } from '@/utility/zalip-communities.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';

defineProps<{ currentChannelId?: string | null }>();
const emit = defineEmits<{ (ev: 'selected', channel: Misskey.entities.Channel | null): void; (ev: 'cancel'): void; (ev: 'closed'): void }>();
const dialog = useTemplateRef('dialog');
const query = ref('');
const submittedQuery = ref('');
const mode = ref<'discover' | 'following'>($i ? 'following' : 'discover');
const failedBanners = ref(new Set<string>());
const directory = createCommunityDirectory({ accountId: () => $i?.id ?? null, token: () => $i?.token ?? null, fetchPage: (endpoint, params, token) => misskeyApi(endpoint, params, token) });
let closed = false;

function reload(): void { directory.reset(mode.value, submittedQuery.value); void directory.load(); }

function switchMode(value: 'discover' | 'following'): void { mode.value = value; query.value = ''; submittedQuery.value = ''; reload(); }

function search(): void { mode.value = 'discover'; submittedQuery.value = query.value.trim(); reload(); }

function select(channel: Misskey.entities.Channel | null): void {
	if (closed || channel?.isArchived) return;
	closed = true;
	directory.dispose();
	emit('selected', channel);
	dialog.value?.close();
}

function cancel(): void { if (closed) return; closed = true; directory.dispose(); emit('cancel'); dialog.value?.close(); }

watch(() => [$i?.id, $i?.token], () => { if (!closed) { if (!$i) mode.value = 'discover'; reload(); } }, { immediate: true });
onBeforeUnmount(directory.dispose);
</script>

<style lang="scss" module>
.root { padding: 16px; }
.personal, .item { display: flex; align-items: center; gap: 12px; width: 100%; min-width: 0; box-sizing: border-box; padding: 12px; border-radius: var(--MI-radius); text-align: start; }
.personal { background: var(--MI_THEME-buttonBg); > i { font-size: 22px; } > span { flex: 1; } small { display: block; margin-top: 4px; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.search { display: flex; margin-top: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; &:focus-within { border-color: var(--MI_THEME-focus); } }
.searchInput { display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1; padding-inline-start: 16px; input { width: 100%; min-width: 0; min-height: 44px; border: 0; background: transparent; color: var(--MI_THEME-fg); font: inherit; &:focus { outline: none; } } }
.searchButton { flex: 0 0 44px; min-height: 44px; border-radius: 999px; }
.tabs { display: flex; gap: 8px; margin-top: 16px; button { min-height: 44px; padding: 8px 12px; border-radius: 999px; font-size: 13px; } }
.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.notice { margin: 12px 8px; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }
.item:hover:not(:disabled), .item[aria-pressed=true] { background: var(--MI_THEME-buttonHoverBg); }
.image { display: grid; place-items: center; flex: 0 0 48px; width: 48px; height: 48px; border-radius: var(--MI-radius); object-fit: cover; background: var(--MI_THEME-buttonBg); font-size: 22px; }
.itemText { flex: 1; min-width: 0; strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { margin-top: 5px; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; } }
.state { padding: 16px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.more { display: block; min-height: 44px; margin: 12px auto 0; padding: 8px 20px; border-radius: 999px; background: var(--MI_THEME-buttonBg); }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.root button:disabled { opacity: .5; cursor: not-allowed; }
</style>
