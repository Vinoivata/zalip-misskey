<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model="searchQuery" type="search" :placeholder="i18n.ts.zalip._chatUi.searchMessages" :aria-label="i18n.ts.zalip._chatUi.searchMessages" @keydown.enter.prevent="search"><button type="button" class="_button" :class="$style.submit" :aria-label="i18n.ts.search" :disabled="pending || !searchQuery.trim()" @click="search"><i class="ti ti-arrow-right" aria-hidden="true"></i></button></div>
	<MkLoading v-if="pending"/>
	<div v-if="error"><p role="alert">{{ i18n.ts.zalip._chatUi.loadError }}</p><MkButton @click="search">{{ i18n.ts.retry }}</MkButton></div>

	<MkFoldableSection v-if="searched">
		<template #header>{{ i18n.ts.searchResult }}</template>

		<div v-if="searchResults.length > 0" class="_gaps_s">
			<div v-for="message in searchResults" :key="message.id" :class="$style.searchResultItem">
				<XMessage :message="message" :user="message.fromUser" :isSearchResult="true"/>
			</div>
		</div>
		<MkResult v-else type="notFound"/>
	</MkFoldableSection>
</div>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import XMessage from './XMessage.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { ensureSignin } from '@/i.js';

const props = defineProps<{
	userId?: string;
	roomId?: string;
}>();

const searchQuery = ref('');
const searched = ref(false);
const searchResults = ref<Misskey.entities.ChatMessage[]>([]);
const pending = ref(false);
const error = ref(false);
const me = ensureSignin();
let epoch = 0;

async function search(): Promise<void> {
	if (!searchQuery.value.trim() || pending.value) return;
	const request = ++epoch; const account = me.id; const query = searchQuery.value.trim();
	pending.value = true; error.value = false;
	try { const result = await misskeyApi('chat/messages/search', { query, roomId: props.roomId, userId: props.userId, limit: 50 }); if (request === epoch && account === me.id && query === searchQuery.value.trim()) { searchResults.value = result; searched.value = true; } } catch { if (request === epoch && account === me.id) error.value = true; } finally { if (request === epoch) pending.value = false; }
}

watch(() => [props.userId, props.roomId, me.id], () => { epoch++; searchResults.value = []; searched.value = false; pending.value = false; error.value = false; });
onBeforeUnmount(() => { epoch++; });
</script>

<style lang="scss" module>
.search { display: flex; align-items: center; gap: 10px; padding: 0 3px 0 16px; min-height: 48px; border: 1px solid var(--MI_THEME-divider); border-radius: 99px; background: var(--MI_THEME-buttonBg); input { flex: 1; min-width: 0; padding-block: 12px; font: inherit; background: transparent; border: 0; outline: 0; color: var(--MI_THEME-fg); } &:focus-within { outline: 2px solid var(--MI_THEME-focus); } }
.submit { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; color: var(--MI_THEME-accent); &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } &:disabled { opacity: .4; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); } }
.searchResultItem {
	padding: 12px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 12px;
}
</style>
