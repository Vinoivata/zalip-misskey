<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div>
		<MkZalipSectionHeader v-model:tab="tab" :title="i18n.ts.zalip.messages" :tabs="headerTabs"/>
		<div :class="$style.body">
			<XHome v-if="tab === 'home'"/>
			<XInvitations v-else-if="tab === 'invitations'"/>
			<XJoiningRooms v-else-if="tab === 'joiningRooms'"/>
			<XOwnedRooms v-else-if="tab === 'ownedRooms'"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue';
import XHome from './home.home.vue';
import XInvitations from './home.invitations.vue';
import XJoiningRooms from './home.joiningRooms.vue';
import XOwnedRooms from './home.ownedRooms.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkZalipSectionHeader from '@/components/MkZalipSectionHeader.vue';

const tab = ref('home');

const headerTabs = computed(() => [{
	key: 'home',
	title: i18n.ts.zalip.chatConversations,
	icon: 'ti ti-home',
}, {
	key: 'invitations',
	title: i18n.ts.zalip.chatInvitations,
	icon: 'ti ti-ticket',
}, {
	key: 'joiningRooms',
	title: i18n.ts.zalip.chatJoinedRooms,
	icon: 'ti ti-users-group',
}, {
	key: 'ownedRooms',
	title: i18n.ts.zalip.chatOwnedRooms,
	icon: 'ti ti-settings',
}]);

definePage(() => ({
	title: i18n.ts.zalip.messages,
	icon: 'ti ti-messages',
}));
</script>

<style lang="scss" module>
.body { padding: 24px; }
@media (max-width: 600px) { .body { padding: 16px; } }
</style>
