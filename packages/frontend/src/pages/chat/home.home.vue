<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<MkButton v-if="$i.policies.chatAvailability === 'available'" primary rounded :class="$style.start" @click="start"><i class="ti ti-plus"></i> {{ i18n.ts.startChat }}</MkButton>

	<MkInfo v-else>{{ $i.policies.chatAvailability === 'readonly' ? i18n.ts.zalip.chatReadOnly : i18n.ts.zalip.chatUnavailable }}</MkInfo>

	<form :class="$style.search" @submit.prevent="search">
		<MkInput
			v-model="searchQuery"
			:placeholder="i18n.ts.zalip.chatSearchMessages"
			type="search"
		>
			<template #prefix><i class="ti ti-search"></i></template>
		</MkInput>

		<button type="submit" class="_button" :class="$style.searchButton" :disabled="!searchQuery.trim() || searching" :aria-label="i18n.ts.search"><MkZalipIcon name="search"/></button>
	</form>

	<MkFoldableSection v-if="searched">
		<template #header>{{ i18n.ts.searchResult }}</template>

		<MkError v-if="searchError" @retry="search"/>
		<MkResult v-else-if="searchResults.length === 0" type="empty" :text="i18n.ts.notFound"/>
		<div v-else class="_gaps_s">
			<div v-for="message in searchResults" :key="message.id" :class="$style.searchResultItem">
				<XMessage :message="message" :isSearchResult="true"/>
			</div>
		</div>
	</MkFoldableSection>

	<MkChatHistories ref="histories"/>
</div>
</template>

<script lang="ts" setup>
import { onActivated, onMounted, ref, useTemplateRef } from 'vue';
import * as Misskey from 'misskey-js';
import XMessage from './XMessage.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { ensureSignin } from '@/i.js';
import { useRouter } from '@/router.js';
import * as os from '@/os.js';
import { refreshCurrentAccount } from '@/accounts.js';
import MkInput from '@/components/MkInput.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkChatHistories from '@/components/MkChatHistories.vue';

const $i = ensureSignin();

const router = useRouter();

const searchQuery = ref('');
const searched = ref(false);
const searching = ref(false);
const searchError = ref(false);
const searchResults = ref<Misskey.entities.ChatMessage[]>([]);
const histories = useTemplateRef('histories');

function start(ev: PointerEvent) {
	os.popupMenu([{
		text: i18n.ts.zalip.chatIndividual,
		caption: i18n.ts.zalip.chatIndividualDescription,
		icon: 'ti ti-user',
		action: () => { startUser(); },
	}, { type: 'divider' }, {
		type: 'parent',
		text: i18n.ts.zalip.chatRoom,
		caption: i18n.ts.zalip.chatRoomDescription,
		icon: 'ti ti-users-group',
		children: [{
			text: i18n.ts.zalip.chatCreateRoom,
			icon: 'ti ti-plus',
			action: () => { createRoom(); },
		}],
	}], ev.currentTarget ?? ev.target);
}

async function startUser() {
	// TODO: localOnly は連合に対応したら消す
	os.selectUser({ localOnly: true }).then(user => {
		router.push('/chat/user/:userId', {
			params: {
				userId: user.id,
			},
		});
	});
}

async function createRoom() {
	const { canceled, result } = await os.inputText({
		title: i18n.ts.name,
		minLength: 1,
	});
	if (canceled) return;

	const room = await misskeyApi('chat/rooms/create', {
		name: result,
	});

	router.push('/chat/room/:roomId', {
		params: {
			roomId: room.id,
		},
	});
}

async function search(): Promise<void> {
	if (!searchQuery.value.trim() || searching.value) return;
	searching.value = true;
	searchError.value = false;
	searched.value = true;
	try {
		searchResults.value = await misskeyApi('chat/messages/search', { query: searchQuery.value.trim() });
	} catch {
		searchError.value = true;
	} finally {
		searching.value = false;
	}
}

async function refresh(): Promise<void> {
	await Promise.all([histories.value?.refresh(), refreshCurrentAccount(), ...(searched.value ? [search()] : [])]);
}

// Opening the conversation list does not mean its messages have been read.
onMounted(() => { void refreshCurrentAccount(); });
onActivated(() => { void refreshCurrentAccount(); });
defineExpose({ refresh });
</script>

<style lang="scss" module>
.start {
	margin: 0 0 0 auto;
}

.search { display: flex; align-items: center; gap: 8px; > div { flex: 1; min-width: 0; } }
.searchButton { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: var(--zalip-social-fg); background: var(--zalip-accent-soft); }
.searchResultItem {
	padding: 12px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 12px;
}
</style>
