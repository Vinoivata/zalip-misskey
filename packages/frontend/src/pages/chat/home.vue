<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :class="$style.refreshArea" :refresher="refresh">
		<MkZalipSectionHeader v-model:tab="tab" :title="i18n.ts.zalip.messages" :tabs="headerTabs"/>
		<div :class="$style.body">
			<XHome v-if="tab === 'home'" ref="activeTab"/>
			<XInvitations v-else-if="tab === 'invitations'" ref="activeTab"/>
			<XJoiningRooms v-else-if="tab === 'joiningRooms'" ref="activeTab"/>
			<XOwnedRooms v-else-if="tab === 'ownedRooms'" ref="activeTab"/>
		</div>
	</component>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, ref, useTemplateRef } from 'vue';
import XHome from './home.home.vue';
import XInvitations from './home.invitations.vue';
import XJoiningRooms from './home.joiningRooms.vue';
import XOwnedRooms from './home.ownedRooms.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import MkZalipSectionHeader from '@/components/MkZalipSectionHeader.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { prefer } from '@/preferences.js';

const tab = ref('home');
const activeTab = useTemplateRef('activeTab');

async function refresh(): Promise<void> {
	await activeTab.value?.refresh();
}

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
.refreshArea { min-height: calc(100dvh - 165px); }
.body { padding: 24px; }
@media (max-width: 600px) { .body { padding: 16px; } }
</style>
