<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div v-if="rooms.length > 0" class="_gaps_s">
		<XRoom v-for="room in rooms" :key="room.id" :room="room"/>
	</div>
	<MkError v-if="loadError" @retry="fetchRooms"/>
	<MkResult v-else-if="!fetching && rooms.length == 0" type="empty" :text="i18n.ts.zalip.chatNoRooms"/>
	<MkLoading v-if="fetching"/>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import XRoom from './XRoom.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';

const fetching = ref(true);
const loadError = ref(false);
const rooms = ref<Misskey.entities.ChatRoom[]>([]);

async function fetchRooms() {
	fetching.value = true;
	loadError.value = false;
	try {
		rooms.value = await misskeyApi('chat/rooms/owned', {});
	} catch {
		loadError.value = true;
	} finally {
		fetching.value = false;
	}
}

onMounted(() => {
	fetchRooms();
});
defineExpose({ refresh: fetchRooms });
</script>

<style lang="scss" module>

</style>
