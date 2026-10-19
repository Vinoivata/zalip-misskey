<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<PageWithHeader hideHeader><div :class="$style.workspace"><aside :class="$style.sidebar"><MkZalipChatSidebar :selectedKey="userId ? `user:${userId}` : `room:${roomId}`" @select="select"/></aside><MkZalipChatConversation :key="userId || roomId" :userId="userId" :roomId="roomId" @loaded="metadata = $event" @close="router.push('/chat')"/></div></PageWithHeader>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { ChatConversationMetadata, ChatConversationTarget } from '@/utility/zalip-chat-types.js';
import MkZalipChatConversation from '@/components/MkZalipChatConversation.vue';
import MkZalipChatSidebar from '@/components/MkZalipChatSidebar.vue';
import { useRouter } from '@/router.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
defineProps<{ userId?: string; roomId?: string }>();
const router = useRouter();
const metadata = ref<ChatConversationMetadata | null>(null);

function select(target: ChatConversationTarget): void { if (target.userId) router.push('/chat/user/:userId', { params: { userId: target.userId } }); else if (target.roomId) router.push('/chat/room/:roomId', { params: { roomId: target.roomId } }); }

definePage(() => ({ title: metadata.value?.title ?? i18n.ts.zalip.messages, icon: 'ti ti-messages' }));
</script>
<style lang="scss" module>
.workspace { display: grid; grid-template-columns: minmax(260px, 32%) minmax(0, 1fr); height: calc(100dvh - 68px); min-width: 0; overflow: hidden; }
.sidebar { min-width: 0; min-height: 0; border-right: 1px solid var(--MI_THEME-divider); }
@media (max-width: 1099px) { .workspace { height: calc(100dvh - 53px); } }
@media (max-width: 900px) { .workspace { grid-template-columns: minmax(0, 1fr); } .sidebar { display: none; } }
</style>
