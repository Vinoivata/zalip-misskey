<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="history.length > 0" :class="$style.list">
	<MkA
		v-for="item in history"
		:key="item.id"
		:class="[$style.message, { [$style.isMe]: item.isMe, [$style.isRead]: item.message.isRead }]"
		:to="item.message.toRoomId ? `/chat/room/${item.message.toRoomId}` : `/chat/user/${item.other!.id}`"
	>
		<MkAvatar v-if="item.message.toRoomId" :class="$style.messageAvatar" :user="item.message.fromUser" :preview="false"/>
		<MkAvatar v-else-if="item.other" :class="$style.messageAvatar" :user="item.other" :preview="false"/>
		<div :class="$style.messageBody">
			<header v-if="item.message.toRoom" :class="$style.messageHeader">
				<span :class="$style.messageHeaderName"><i class="ti ti-users"></i> {{ item.message.toRoom.name }}</span>
				<MkTime :time="item.message.createdAt" :class="$style.messageHeaderTime"/>
			</header>
			<header v-else :class="$style.messageHeader">
				<MkUserName :class="$style.messageHeaderName" :user="item.other!"/>
				<MkAcct :class="$style.messageHeaderUsername" :user="item.other!"/>
				<MkTime :time="item.message.createdAt" :class="$style.messageHeaderTime"/>
			</header>
			<div :class="$style.messageBodyText"><span v-if="item.isMe" :class="$style.youSaid">{{ i18n.ts.you }}:</span>{{ item.message.text }}</div>
		</div>
	</MkA>
</div>
<MkError v-if="loadError" @retry="fetchHistory"/>
<MkResult v-else-if="!initializing && history.length == 0" type="empty" :text="i18n.ts._chat.noHistory"/>
<MkLoading v-if="initializing"/>
</template>

<script lang="ts" setup>
import { onActivated, onDeactivated, onMounted, ref } from 'vue';
import * as Misskey from 'misskey-js';
import { useInterval } from '@@/js/use-interval.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import { ensureSignin } from '@/i.js';

const $i = ensureSignin();

const history = ref<{
	id: string;
	message: Misskey.entities.ChatMessage;
	other: Misskey.entities.ChatMessage['fromUser'] | Misskey.entities.ChatMessage['toUser'] | null;
	isMe: boolean;
}[]>([]);

const initializing = ref(true);
const fetching = ref(false);
const loadError = ref(false);

async function fetchHistory() {
	if (fetching.value) return;

	fetching.value = true;
	loadError.value = false;
	try {
		const [userMessages, roomMessages] = await Promise.all([
			misskeyApi('chat/history', { room: false }),
			misskeyApi('chat/history', { room: true }),
		]);

		history.value = [...userMessages, ...roomMessages]
			.toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
			.map(m => ({
				id: m.id,
				message: m,
				other: (!('room' in m) || m.room == null) ? (m.fromUserId === $i.id ? m.toUser : m.fromUser) : null,
				isMe: m.fromUserId === $i.id,
			}));
	} catch {
		loadError.value = true;
	} finally {
		fetching.value = false;
		initializing.value = false;
	}
}

let isActivated = true;

onActivated(() => {
	isActivated = true;
});

onDeactivated(() => {
	isActivated = false;
});

useInterval(() => {
	// TODO: DOM的にバックグラウンドになっていないかどうかも考慮する
	if (isActivated) {
		fetchHistory();
	}
}, 1000 * 10, {
	immediate: false,
	afterMounted: true,
});

onActivated(() => {
	fetchHistory();
});

onMounted(() => {
	fetchHistory();
});

defineExpose({ refresh: fetchHistory });
</script>

<style lang="scss" module>
.list { margin-inline: -24px; container-type: inline-size; }
.message { position: relative; display: flex; align-items: center; gap: 14px; padding: 20px 24px; border-bottom: 1px solid var(--zalip-social-border); background: var(--zalip-social-panel); text-decoration: none; &:hover { background: var(--zalip-accent-wash); } &:not(.isMe):not(.isRead) { background: var(--zalip-accent-soft); &::before { content: ''; position: absolute; top: 25px; right: 12px; width: 6px; height: 6px; border-radius: 50%; background: var(--MI_THEME-accent); } } }
.messageAvatar { width: 46px; height: 46px; flex: 0 0 46px; }
.messageBody { flex: 1; min-width: 0; }
.messageHeader { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; white-space: nowrap; min-width: 0; }
.messageHeaderName { overflow: hidden; text-overflow: ellipsis; font-size: 15px; font-weight: 650; color: var(--zalip-social-fg); }
.messageHeaderUsername { display: none; }
.messageHeaderTime { flex: 0 0 auto; margin-left: auto; color: var(--zalip-social-muted); font-size: 12px; }
.messageBodyText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 1.5; color: var(--zalip-social-muted); }
.youSaid { margin-right: 5px; }
@media (max-width: 600px) { .list { margin-inline: -16px; } .message { padding: 18px 16px; gap: 12px; } }
</style>
