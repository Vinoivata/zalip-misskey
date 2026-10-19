<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->
<template><MkZalipChatSidebar ref="sidebar" compact @select="select"/></template>
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import type { ChatConversationTarget } from '@/utility/zalip-chat-types.js';
import MkZalipChatSidebar from '@/components/MkZalipChatSidebar.vue';
import { useRouter } from '@/router.js';
const router = useRouter();
const sidebar = useTemplateRef('sidebar');

function select(target: ChatConversationTarget): void { if (target.userId) router.push('/chat/user/:userId', { params: { userId: target.userId } }); else if (target.roomId) router.push('/chat/room/:roomId', { params: { roomId: target.roomId } }); }

defineExpose({ refresh: () => sidebar.value?.refresh() });
</script>
