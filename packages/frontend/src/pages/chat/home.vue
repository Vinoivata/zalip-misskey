<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<PageWithHeader hideHeader><div :class="$style.workspace"><aside :class="$style.sidebar"><div :class="$style.roomTabs"><button type="button" class="_button" :class="$style.tab" :aria-pressed="tab === 'home'" @click="tab = 'home'"><i class="ti ti-messages"></i>{{ i18n.ts.zalip._chatUi.conversations }}</button><button type="button" class="_button" :class="$style.tab" :aria-pressed="tab === 'search'" @click="tab = 'search'"><i class="ti ti-search"></i>{{ i18n.ts.search }}</button><button type="button" class="_button" :class="$style.tab" :aria-pressed="tab === 'invitations'" @click="tab = 'invitations'"><i class="ti ti-ticket"></i>{{ i18n.ts.zalip.chatInvitations }}</button><button type="button" class="_button" :class="$style.tab" :aria-pressed="tab === 'rooms'" @click="tab = 'rooms'"><i class="ti ti-users-group"></i>{{ i18n.ts.zalip._chatUi.rooms }}</button></div><MkZalipChatSidebar v-if="tab === 'home'" @select="select"/><div v-else :class="$style.roomList"><XSearch v-if="tab === 'search'"/><XInvitations v-else-if="tab === 'invitations'"/><template v-else><h3>{{ i18n.ts.zalip.chatJoinedRooms }}</h3><XJoiningRooms/><h3>{{ i18n.ts.zalip.chatOwnedRooms }}</h3><XOwnedRooms/></template></div></aside><div :class="$style.empty"><i class="ti ti-messages"></i><h1>{{ i18n.ts.zalip._chatUi.chooseConversation }}</h1><p>{{ i18n.ts.zalip._chatUi.chooseConversationHint }}</p></div></div></PageWithHeader>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import XInvitations from './home.invitations.vue';
import XJoiningRooms from './home.joiningRooms.vue';
import XOwnedRooms from './home.ownedRooms.vue';
import XSearch from './room.search.vue';
import type { ChatConversationTarget } from '@/utility/zalip-chat-types.js';
import MkZalipChatSidebar from '@/components/MkZalipChatSidebar.vue';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
const tab = ref('home');
const router = useRouter();

function select(target: ChatConversationTarget): void { if (target.userId) router.push('/chat/user/:userId', { params: { userId: target.userId } }); else if (target.roomId) router.push('/chat/room/:roomId', { params: { roomId: target.roomId } }); }

definePage(() => ({ title: i18n.ts.zalip.messages, icon: 'ti ti-messages' }));
</script>
<style lang="scss" module>
.workspace { display: grid; grid-template-columns: minmax(280px, 34%) minmax(0, 1fr); height: calc(100dvh - 68px); min-width: 0; overflow: hidden; background: var(--MI_THEME-panel); }
.sidebar { display: flex; flex-direction: column; min-width: 0; min-height: 0; border-right: 1px solid var(--MI_THEME-divider); }
.roomTabs { display: flex; flex: 0 0 auto; gap: 4px; overflow-x: auto; padding: 8px; border-bottom: 1px solid var(--MI_THEME-divider); }
.tab { display: flex; gap: 6px; align-items: center; min-height: 44px; padding: 8px 10px; border-radius: 99px; white-space: nowrap; font-size: 12px; &[aria-pressed=true] { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); } }
.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); > i { font-size: 64px; color: var(--MI_THEME-accent); } h1 { margin: 0; font-size: 20px; color: var(--MI_THEME-fg); } p { margin: 0; font-size: 14px; } }
.roomList { min-height: 0; overflow-y: auto; padding: 16px; }
@media (max-width: 1099px) { .workspace { height: calc(100dvh - 165px - env(safe-area-inset-bottom, 0px)); } }
@media (max-width: 900px) { .workspace { grid-template-columns: minmax(0, 1fr); } .empty { display: none; } .sidebar { border: 0; } }
</style>
