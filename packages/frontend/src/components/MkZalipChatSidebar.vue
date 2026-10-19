<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="[$style.root, { [$style.compact]: compact }]" :aria-label="i18n.ts.zalip._chatUi.conversations">
	<header :class="$style.header"><h2>{{ i18n.ts.zalip.messages }}</h2><button type="button" class="_button" :class="$style.icon" :disabled="me.policies.chatAvailability !== 'available'" :aria-label="i18n.ts.zalip._chatUi.newChat" @click="newChat"><i class="ti ti-edit"></i></button></header>
	<label :class="$style.search"><i class="ti ti-search"></i><input v-model="query" type="search" maxlength="80" :placeholder="i18n.ts.zalip._chatUi.searchPeople" :aria-label="i18n.ts.zalip._chatUi.searchPeople"></label>
	<div :class="$style.filters" :aria-label="i18n.ts.filter"><button v-for="item in filters" :key="item.value" type="button" class="_button" :class="{ [$style.active]: filter === item.value }" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.label }}</button></div>
	<p v-if="actionError" role="alert" :class="$style.error">{{ actionError }}</p>
	<div :class="$style.list">
		<MkPullToRefresh :refresher="() => load(false)">
			<div v-for="item in items" :key="item.key" :class="[$style.row, { [$style.selected]: item.key === selectedKey, [$style.unread]: item.unread }]">
				<button type="button" class="_button" :class="$style.conversation" :aria-current="item.key === selectedKey ? 'true' : undefined" @click="select(item)"><MkAvatar v-if="item.user || item.room?.owner" :user="(item.user || item.room?.owner)!" :class="$style.avatar"/><div v-else :class="$style.roomAvatar"><i class="ti ti-users-group"></i></div><span :class="$style.preview"><span :class="$style.title"><strong>{{ title(item) }}</strong><i v-if="item.preferences.isPinned" class="ti ti-pin" :title="i18n.ts.zalip._chatUi.pinned"></i><i v-if="item.preferences.isMuted" class="ti ti-bell-off" :title="i18n.ts.mute"></i><MkTime v-if="item.lastMessage" :time="item.lastMessage.createdAt"/></span><span :class="$style.snippet">{{ item.lastMessage?.text || (item.lastMessage?.file ? i18n.ts.zalip._chatUi.attachment : i18n.ts.zalip._chatUi.empty) }}</span></span><span v-if="item.unread" :class="$style.dot" :aria-label="i18n.ts.unread"></span></button>
				<button type="button" class="_button" :class="$style.menu" :aria-label="`${i18n.ts.more}: ${title(item)}`" :disabled="mutating.has(item.key)" @click="preferences(item, $event)"><i class="ti ti-dots-vertical"></i></button>
			</div>
			<div v-if="error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._chatUi.loadError }}</p><button type="button" class="_button" :class="$style.retry" @click="load(false)">{{ i18n.ts.retry }}</button></div>
			<p v-else-if="!pending && !items.length" :class="$style.state">{{ query.trim() ? i18n.ts.zalip._chatUi.noMatches : i18n.ts.zalip._chatUi.noConversations }}</p>
			<div v-if="pending" :class="$style.state" role="status" :aria-label="i18n.ts.loading"><MkLoading/></div>
			<button v-if="cursor && !pending" type="button" class="_button" :class="$style.retry" @click="load(true)">{{ i18n.ts.loadMore }}</button>
		</MkPullToRefresh>
	</div>
</section>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { ChatConversation, ChatConversationPreferences, ChatConversationsResponse } from '@/utility/zalip-chat-types.js';
import { chatConversationEvents } from '@/utility/zalip-chat-types.js';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi, misskeyApiZalip } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import * as os from '@/os.js';

defineProps<{ selectedKey?: string; compact?: boolean }>();
const emit = defineEmits<{ (ev: 'select', target: { userId?: string; roomId?: string; title?: string }): void }>();
const me = ensureSignin();
const filter = ref<'all' | 'unread' | 'people' | 'groups' | 'archived'>('all'); const query = ref('');
const filters = computed(() => [{ value: 'all' as const, label: i18n.ts.zalip._chatUi.all }, { value: 'unread' as const, label: i18n.ts.zalip._chatUi.unread }, { value: 'people' as const, label: i18n.ts.zalip._chatUi.people }, { value: 'groups' as const, label: i18n.ts.zalip._chatUi.rooms }, { value: 'archived' as const, label: i18n.ts.zalip._chatUi.archived }]);
const items = ref<ChatConversation[]>([]); const cursor = ref<string | null>(null); const pending = ref(false); const error = ref(false); const actionError = ref(''); const mutating = ref(new Set<string>());
let epoch = 0; let alive = true; let active = true; let timer: number | null = null;
const connection = useStream().useChannel('main');

function title(item: ChatConversation): string { return item.user?.name || item.user?.username || item.room?.name || i18n.ts.zalip.messages; }

function target(item: ChatConversation): { userId?: string; roomId?: string } { return item.kind === 'user' ? { userId: item.user!.id } : { roomId: item.room!.id }; }

function select(item: ChatConversation): void { emit('select', { ...target(item), title: title(item) }); }

async function load(append = false): Promise<void> {
	if (append && (pending.value || !cursor.value)) return;
	const request = ++epoch; const account = me.id;
	pending.value = true; error.value = false;
	try {
		const result = await misskeyApiZalip<ChatConversationsResponse>('zalip/chat/conversations', { filter: filter.value, query: query.value.trim(), limit: 30, ...(append && cursor.value ? { cursor: cursor.value } : {}) });
		if (!alive || request !== epoch || account !== me.id) return;
		items.value = append ? [...items.value, ...result.items.filter(item => !items.value.some(old => old.key === item.key))] : result.items;
		cursor.value = result.nextCursor;
	} catch { if (alive && request === epoch && account === me.id) error.value = true; } finally { if (alive && request === epoch && account === me.id) pending.value = false; }
}

function refresh(): void { if (active && !window.document.hidden) void load(false); }

function debounce(): void { epoch++; cursor.value = null; items.value = []; pending.value = true; error.value = false; actionError.value = ''; mutating.value = new Set(); if (timer) window.clearTimeout(timer); timer = window.setTimeout(() => { timer = null; void load(false); }, 250); }

async function update(item: ChatConversation, patch: Partial<ChatConversationPreferences>): Promise<void> {
	if (mutating.value.has(item.key)) return;
	const account = me.id; mutating.value = new Set([...mutating.value, item.key]); actionError.value = '';
	try { await misskeyApiZalip('zalip/chat/preferences/update', { ...target(item), ...patch }); if (alive && account === me.id) { chatConversationEvents.emit('changed'); } } catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (alive && account === me.id) { const next = new Set(mutating.value); next.delete(item.key); mutating.value = next; } }
}

function preferences(item: ChatConversation, event: MouseEvent): void {
	const account = me.id;
	const apply = (patch: Partial<ChatConversationPreferences>) => { if (alive && account === me.id) void update(item, patch); };
	void os.popupMenu([{ text: item.preferences.isPinned ? i18n.ts.zalip._chatUi.unpin : i18n.ts.zalip._chatUi.pin, icon: 'ti ti-pin', action: () => apply({ isPinned: !item.preferences.isPinned }) }, { text: item.preferences.isArchived ? i18n.ts.zalip._chatUi.unarchive : i18n.ts.zalip._chatUi.archive, icon: 'ti ti-archive', action: () => apply({ isArchived: !item.preferences.isArchived }) }, { text: item.preferences.isMuted ? i18n.ts.zalip._chatUi.unmuteConversation : i18n.ts.zalip._chatUi.muteConversation, icon: 'ti ti-bell-off', action: () => apply({ isMuted: !item.preferences.isMuted }) }, ...(item.lastMessage && item.unread ? [{ text: i18n.ts.zalip._chatUi.markRead, icon: 'ti ti-checks', action: async () => { if (!alive || account !== me.id) return; try { await misskeyApi('chat/messages/read', { ...target(item), messageId: item.lastMessage!.id }); if (alive && account === me.id) chatConversationEvents.emit('changed'); } catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; } } }] : []), ...(item.preferences.pinnedMessageId ? [{ text: i18n.ts.zalip._chatUi.unpin, icon: 'ti ti-pinned-off', action: () => apply({ pinnedMessageId: null }) }] : [])], event.currentTarget as HTMLElement);
}

function newChat(event: MouseEvent): void {
	if (me.policies.chatAvailability !== 'available') return;
	const account = me.id;
	void os.popupMenu([{ text: i18n.ts.zalip.chatIndividual, icon: 'ti ti-user', action: async () => { if (!alive || account !== me.id) return; try { const peer = await os.selectUser({ localOnly: true, includeSelf: false }); if (alive && account === me.id) emit('select', { userId: peer.id, title: peer.name || peer.username }); } catch { /* Selection canceled. */ } } }, { text: i18n.ts.zalip.chatCreateRoom, icon: 'ti ti-users-plus', action: async () => { if (!alive || account !== me.id) return; const result = await os.inputText({ title: i18n.ts.name, minLength: 1 }); if (result.canceled || !alive || account !== me.id) return; try { const room = await misskeyApi('chat/rooms/create', { name: result.result }); if (alive && account === me.id) { emit('select', { roomId: room.id, title: room.name }); chatConversationEvents.emit('changed'); } } catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; } } }], event.currentTarget as HTMLElement);
}

watch([filter, query, () => me.id], debounce);
connection.on('newChatMessage', refresh); connection.on('readAllChatMessages', refresh); connection.on('chatUnreadState', refresh); chatConversationEvents.on('changed', refresh); window.document.addEventListener('visibilitychange', refresh);
onActivated(() => { active = true; refresh(); }); onDeactivated(() => { active = false; });
void load(false);
onBeforeUnmount(() => { alive = false; epoch++; connection.dispose(); chatConversationEvents.off('changed', refresh); window.document.removeEventListener('visibilitychange', refresh); if (timer) window.clearTimeout(timer); });
defineExpose({ refresh: () => load(false) });
</script>

<style lang="scss" module>
.root { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.header { display: flex; align-items: center; gap: 12px; padding: 12px 16px; h2 { flex: 1; margin: 0; font-size: 20px; } }
.icon, .menu { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; font-size: 21px; &:hover { background: var(--MI_THEME-buttonHoverBg); } }
.search { display: flex; align-items: center; gap: 10px; margin: 0 16px 12px; padding: 0 12px; min-height: 44px; border-radius: 99px; background: var(--MI_THEME-buttonBg); input { border: 0; background: transparent; color: var(--MI_THEME-fg); min-width: 0; width: 100%; padding-block: 12px; font: inherit; font-size: 13px; } &:focus-within { outline: 2px solid var(--MI_THEME-focus); } }
.filters { display: flex; flex: 0 0 auto; gap: 4px; padding: 0 12px 12px; overflow-x: auto; scrollbar-width: none; button { min-height: 44px; padding: 8px 10px; border-radius: 99px; white-space: nowrap; font-size: 12px; } }
.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.row { display: flex; align-items: center; gap: 0; border-bottom: 1px solid var(--MI_THEME-divider); &:hover, &.selected { background: var(--MI_THEME-accentedBg); } }
.conversation { display: flex; align-items: center; flex: 1; min-width: 0; gap: 10px; padding: 16px 0 16px 16px; text-align: start; }
.avatar, .roomAvatar { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; background: var(--MI_THEME-buttonBg); }
.preview { display: grid; gap: 6px; flex: 1; min-width: 0; }
.title { display: flex; align-items: center; gap: 5px; strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; } :global(time) { font-size: 10px; color: var(--MI_THEME-fgTransparentWeak); } > i { font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--MI_THEME-accent); flex: 0 0 7px; }
.unread .title strong { color: var(--MI_THEME-accent); }
.menu { min-height: 44px; font-size: 18px; margin: 0 4px; }
.state { padding: 24px 16px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.retry { display: block; min-height: 44px; margin: 12px auto; padding: 8px 16px; border-radius: 99px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-accent); }
.error { padding: 0 16px; color: var(--MI_THEME-error); font-size: 12px; }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
</style>
