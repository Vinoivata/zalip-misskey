<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<PageWithHeader hideHeader>
	<div :class="[layout.workspace, $style.workspace]">
		<aside :class="layout.sidebar">
			<MkZalipChatSidebar :utilityTab="tab" @select="select" @utility="tab = $event">
				<template v-if="tab !== 'home'" #default>
					<div :class="$style.roomList">
						<XSearch v-if="tab === 'search'"/>
						<XInvitations v-else-if="tab === 'invitations'"/>
						<template v-else><h3>{{ i18n.ts.zalip.chatJoinedRooms }}</h3><XJoiningRooms/><h3>{{ i18n.ts.zalip.chatOwnedRooms }}</h3><XOwnedRooms/></template>
					</div>
				</template>
			</MkZalipChatSidebar>
		</aside>
		<div :class="$style.empty"><i class="ti ti-messages" aria-hidden="true"></i><h1>{{ i18n.ts.zalip._chatUi.chooseConversation }}</h1><p>{{ i18n.ts.zalip._chatUi.chooseConversationHint }}</p></div>
	</div>
</PageWithHeader>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import XInvitations from './home.invitations.vue';
import XJoiningRooms from './home.joiningRooms.vue';
import XOwnedRooms from './home.ownedRooms.vue';
import XSearch from './room.search.vue';
import layout from './layout.module.scss';
import type { ChatConversationTarget } from '@/utility/zalip-chat-types.js';
import MkZalipChatSidebar from '@/components/MkZalipChatSidebar.vue';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
const tab = ref<'home' | 'search' | 'invitations' | 'rooms'>('home');
const router = useRouter();

watch(router.currentRef, () => {
	const value = new URL(router.getCurrentFullPath(), 'https://zalip.invalid').searchParams.get('view');
	tab.value = value === 'search' || value === 'invitations' || value === 'rooms' ? value : 'home';
}, { immediate: true });

function select(target: ChatConversationTarget): void { if (target.userId) router.push('/chat/user/:userId', { params: { userId: target.userId } }); else if (target.roomId) router.push('/chat/room/:roomId', { params: { roomId: target.roomId } }); }

definePage(() => ({ title: i18n.ts.zalip.messages, icon: 'ti ti-messages' }));
</script>
<style lang="scss" module>
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; color: var(--zalip-social-muted); > i { font-size: 56px; color: var(--zalip-social-subtle); } h1 { margin: 0; font-size: 20px; color: var(--zalip-social-fg); } p { margin: 0; font-size: 14px; } }
.roomList { padding: 16px; h3 { margin-block: 4px 16px; font-size: 15px; color: var(--zalip-social-fg); } }
@media (max-width: 1099px) { .workspace { height: calc(100dvh - 165px - env(safe-area-inset-bottom, 0px)); } }
@media (max-width: 900px) { .empty { display: none; } }
</style>
