<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template>
<PageWithHeader hideHeader><div :class="[layout.workspace, $style.workspace]"><aside :class="[layout.sidebar, $style.sidebar]"><MkZalipChatSidebar :selectedKey="userId ? `user:${userId}` : `room:${roomId}`" @select="select" @utility="openUtility"/></aside><MkZalipChatConversation :key="userId || roomId" :userId="userId" :roomId="roomId" @loaded="metadata = $event" @close="router.push('/chat')"/></div></PageWithHeader>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import layout from './layout.module.scss';
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

function openUtility(tab: 'home' | 'search' | 'invitations' | 'rooms'): void { router.pushByPath(tab === 'home' ? '/chat' : `/chat?view=${tab}`); }

definePage(() => ({ title: metadata.value?.title ?? i18n.ts.zalip.messages, icon: 'ti ti-messages' }));
</script>
<style lang="scss" module>
@media (max-width: 1099px) { .workspace { height: calc(100dvh - 53px); } }
@media (max-width: 900px) { .sidebar { display: none; } }
</style>
