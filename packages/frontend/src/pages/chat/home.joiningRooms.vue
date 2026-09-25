<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div v-if="memberships.length > 0" class="_gaps_s">
		<XRoom v-for="membership in memberships" :key="membership.id" :room="membership.room!"/>
	</div>
	<MkError v-if="loadError" @retry="fetchRooms"/>
	<MkResult v-else-if="!fetching && memberships.length == 0" type="empty" :text="i18n.ts.zalip.chatNoRooms"/>
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
const memberships = ref<Misskey.entities.ChatRoomMembership[]>([]);

async function fetchRooms() {
	fetching.value = true;
	loadError.value = false;
	try {
		memberships.value = await misskeyApi('chat/rooms/joining');
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
