<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="[$style.root, { [$style.compact]: compact }]" :aria-label="i18n.ts.zalip._chatUi.conversations">
	<header :class="$style.header">
		<div :class="$style.primary" role="group" :aria-label="i18n.ts.zalip._chatUi.conversations">
			<button type="button" class="_button" :class="{ [$style.primaryActive]: filter !== 'groups' }" :aria-pressed="filter !== 'groups'" @click="selectPrimary('all')">{{ i18n.ts.zalip.messages }}</button>
			<button type="button" class="_button" :class="{ [$style.primaryActive]: filter === 'groups' }" :aria-pressed="filter === 'groups'" @click="selectPrimary('groups')">{{ i18n.ts.zalip._chatUi.rooms }}</button>
		</div>
		<button type="button" class="_button" :class="$style.icon" :disabled="me.policies.chatAvailability !== 'available'" :aria-label="i18n.ts.zalip.chatIndividual" :title="i18n.ts.zalip.chatIndividual" @click="newDirectChat"><i class="ti ti-edit" aria-hidden="true"></i></button>
		<button type="button" class="_button" :class="$style.icon" :disabled="me.policies.chatAvailability !== 'available'" :aria-label="i18n.ts.zalip.chatCreateRoom" :title="i18n.ts.zalip.chatCreateRoom" @click="newRoom"><i class="ti ti-users-plus" aria-hidden="true"></i></button>
	</header>
	<template v-if="utilityTab === 'home'">
		<label :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" type="search" maxlength="80" :placeholder="i18n.ts.zalip._chatUi.searchPeople" :aria-label="i18n.ts.zalip._chatUi.searchPeople"></label>
		<div :class="$style.filters" role="group" :aria-label="i18n.ts.filter"><button v-for="item in filters" :key="item.value" type="button" class="_button" :class="{ [$style.active]: filter === item.value }" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.label }}</button></div>
	</template>
	<p v-if="actionError" role="alert" :class="$style.error">{{ actionError }}</p>
	<div :class="$style.list">
		<slot>
			<MkPullToRefresh :refresher="() => load(false)">
				<div v-for="item in items" :key="item.key" :class="[$style.row, { [$style.selected]: item.key === selectedKey, [$style.unread]: item.unread }]">
					<button type="button" class="_button" :class="$style.conversation" :aria-current="item.key === selectedKey ? 'true' : undefined" @click="select(item)"><MkAvatar v-if="item.user || item.room?.owner" :user="(item.user || item.room?.owner)!" :class="$style.avatar"/><div v-else :class="$style.roomAvatar"><i class="ti ti-users-group"></i></div><span :class="$style.preview"><span :class="$style.title"><strong>{{ title(item) }}</strong><i v-if="item.preferences.isPinned" class="ti ti-pin" :title="i18n.ts.zalip._chatUi.pinned"></i><i v-if="item.preferences.isMuted" class="ti ti-bell-off" :title="i18n.ts.mute"></i><time v-if="item.lastMessage" :datetime="item.lastMessage.createdAt" :title="timeTitle(item.lastMessage.createdAt)">{{ timeLabel(item.lastMessage.createdAt) }}</time></span><span :class="$style.snippet">{{ item.lastMessage?.text || (item.lastMessage?.file ? i18n.ts.zalip._chatUi.attachment : i18n.ts.zalip._chatUi.empty) }}</span></span><span v-if="item.unread" :class="$style.dot" :aria-label="i18n.ts.unread"></span></button>
					<button type="button" class="_button" :class="$style.menu" :aria-label="`${i18n.ts.more}: ${title(item)}`" :disabled="mutating.has(item.key)" @click="preferences(item, $event)"><i class="ti ti-dots-vertical"></i></button>
				</div>
				<div v-if="error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._chatUi.loadError }}</p><button type="button" class="_button" :class="$style.retry" @click="load(false)">{{ i18n.ts.retry }}</button></div>
				<p v-else-if="!pending && !items.length" :class="$style.state">{{ query.trim() ? i18n.ts.zalip._chatUi.noMatches : i18n.ts.zalip._chatUi.noConversations }}</p>
				<div v-if="pending" :class="$style.state" role="status" :aria-label="i18n.ts.loading"><MkLoading/></div>
				<button v-if="cursor && !pending" type="button" class="_button" :class="$style.retry" @click="load(true)">{{ i18n.ts.loadMore }}</button>
			</MkPullToRefresh>
		</slot>
	</div>
	<nav v-if="!compact" :class="$style.utilities" :aria-label="i18n.ts.zalip._chatUi.conversations">
		<button v-for="item in utilities" :key="item.value" type="button" class="_button" :class="{ [$style.utilityActive]: utilityTab === item.value }" :aria-current="utilityTab === item.value ? 'page' : undefined" @click="emit('utility', item.value)"><i :class="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span></button>
	</nav>
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

const props = withDefaults(defineProps<{ selectedKey?: string; compact?: boolean; utilityTab?: 'home' | 'search' | 'invitations' | 'rooms' }>(), { selectedKey: undefined, compact: false, utilityTab: 'home' });
const emit = defineEmits<{ (ev: 'select', target: { userId?: string; roomId?: string; title?: string }): void; (ev: 'utility', tab: 'home' | 'search' | 'invitations' | 'rooms'): void }>();
const me = ensureSignin();
const filter = ref<'all' | 'unread' | 'people' | 'groups' | 'archived'>('all'); const query = ref('');
const filters = computed(() => [{ value: 'all' as const, label: i18n.ts.zalip._chatUi.all }, { value: 'unread' as const, label: i18n.ts.zalip._chatUi.unread }, { value: 'people' as const, label: i18n.ts.zalip._chatUi.people }, { value: 'archived' as const, label: i18n.ts.zalip._chatUi.archived }]);
const utilities = computed(() => [{ value: 'home' as const, label: i18n.ts.zalip._chatUi.conversations, icon: 'ti ti-messages' }, { value: 'search' as const, label: i18n.ts.search, icon: 'ti ti-search' }, { value: 'invitations' as const, label: i18n.ts.zalip.chatInvitations, icon: 'ti ti-ticket' }, { value: 'rooms' as const, label: i18n.ts.zalip._chatUi.rooms, icon: 'ti ti-users-group' }]);
const items = ref<ChatConversation[]>([]); const cursor = ref<string | null>(null); const pending = ref(false); const error = ref(false); const actionError = ref(''); const mutating = ref(new Set<string>());
let epoch = 0; let alive = true; let active = true; let timer: number | null = null;
const connection = useStream().useChannel('main');
const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function title(item: ChatConversation): string { return item.user?.name || item.user?.username || item.room?.name || i18n.ts.zalip.messages; }

function timeLabel(createdAt: string): string { const date = new Date(createdAt); return Number.isNaN(date.getTime()) ? i18n.ts._ago.invalid : date.toDateString() === new Date().toDateString() ? clockFormatter.format(date) : dateFormatter.format(date); }

function timeTitle(createdAt: string): string { const date = new Date(createdAt); return Number.isNaN(date.getTime()) ? i18n.ts._ago.invalid : fullDateFormatter.format(date); }

function target(item: ChatConversation): { userId?: string; roomId?: string } { return item.kind === 'user' ? { userId: item.user!.id } : { roomId: item.room!.id }; }

function select(item: ChatConversation): void { emit('select', { ...target(item), title: title(item) }); }

function selectPrimary(value: 'all' | 'groups'): void { filter.value = value; if (props.utilityTab !== 'home') emit('utility', 'home'); }

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

async function newDirectChat(): Promise<void> {
	if (me.policies.chatAvailability !== 'available') return;
	const account = me.id;
	try { const peer = await os.selectUser({ localOnly: true, includeSelf: false }); if (alive && account === me.id) emit('select', { userId: peer.id, title: peer.name || peer.username }); } catch { /* Selection canceled. */ }
}

async function newRoom(): Promise<void> {
	if (me.policies.chatAvailability !== 'available') return;
	const account = me.id;
	try { const result = await os.inputText({ title: i18n.ts.name, minLength: 1 }); if (result.canceled || !alive || account !== me.id) return; const room = await misskeyApi('chat/rooms/create', { name: result.result }); if (alive && account === me.id) { emit('select', { roomId: room.id, title: room.name }); chatConversationEvents.emit('changed'); } } catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; }
}

watch([filter, query, () => me.id], debounce);
connection.on('newChatMessage', refresh); connection.on('readAllChatMessages', refresh); connection.on('chatUnreadState', refresh); chatConversationEvents.on('changed', refresh); window.document.addEventListener('visibilitychange', refresh);
onActivated(() => { active = true; refresh(); }); onDeactivated(() => { active = false; });
void load(false);
onBeforeUnmount(() => { alive = false; epoch++; connection.dispose(); chatConversationEvents.off('changed', refresh); window.document.removeEventListener('visibilitychange', refresh); if (timer) window.clearTimeout(timer); });
defineExpose({ refresh: () => load(false) });
</script>

<style lang="scss" module>
.root { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; background: var(--zalip-social-panel); color: var(--zalip-social-fg); }
.header { display: flex; align-items: center; gap: 4px; padding: 16px 12px 12px 16px; flex: 0 0 auto; }
.primary { display: flex; flex: 1; min-width: 0; box-sizing: border-box; height: 40px; padding: 4px; margin-inline-end: 4px; border-radius: 999px; background: var(--zalip-social-raised); button { flex: 1; min-width: 0; height: 32px; border-radius: 999px; padding-inline: 10px; font-size: 14px; font-weight: 600; color: var(--zalip-social-muted); } }
.primary .primaryActive { background: var(--zalip-social-hover); color: var(--zalip-social-fg); }
.icon, .menu { display: grid; place-items: center; width: 40px; height: 40px; flex: 0 0 40px; border-radius: 50%; font-size: 20px; color: var(--zalip-social-muted); &:hover:not(:disabled) { background: var(--zalip-social-hover); color: var(--zalip-social-fg); } &:disabled { opacity: .4; } }
.search { display: flex; align-items: center; gap: 10px; margin: 0 16px 12px; padding: 0 14px; height: 40px; flex: 0 0 40px; box-sizing: border-box; border-radius: 999px; background: var(--zalip-social-raised); color: var(--zalip-social-muted); input { border: 0; outline: 0; background: transparent; color: var(--zalip-social-fg); min-width: 0; width: 100%; padding-block: 10px; font: inherit; font-size: 15px; &::placeholder { color: var(--zalip-social-subtle); } } &:focus-within { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } }
.filters { display: flex; flex: 0 0 auto; flex-wrap: wrap; gap: 6px; padding: 0 16px 12px; button { min-height: 32px; padding: 6px 10px; border-radius: 999px; white-space: nowrap; font-size: 13.5px; line-height: 20px; color: var(--zalip-social-muted); &:hover { background: var(--zalip-social-raised); } } }
.filters .active { color: var(--zalip-social-fg); background: var(--zalip-social-raised); }
.list { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.row { display: flex; align-items: center; gap: 0; margin: 2px 8px; border-radius: 16px; &:hover, &.selected { background: var(--zalip-social-raised); } }
.conversation { display: flex; align-items: center; flex: 1; min-width: 0; gap: 12px; padding: 12px 0 12px 12px; text-align: start; }
.avatar, .roomAvatar { display: grid; place-items: center; flex: 0 0 56px; width: 56px; height: 56px; border-radius: 50%; background: var(--zalip-social-raised); }
.roomAvatar { font-size: 24px; color: var(--zalip-social-muted); }
.preview { display: grid; gap: 5px; flex: 1; min-width: 0; }
.title { display: flex; align-items: center; gap: 5px; strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; line-height: 20px; font-weight: 600; } :global(time) { font-size: 12px; color: var(--zalip-social-subtle); white-space: nowrap; } > i { font-size: 12px; color: var(--zalip-social-muted); } }
.snippet { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; line-height: 20px; color: var(--zalip-social-muted); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--MI_THEME-accent); flex: 0 0 7px; margin-inline-start: 6px; }
.unread .title strong { font-weight: 700; }
.menu { min-height: 44px; width: 32px; flex-basis: 32px; font-size: 18px; margin: 0 4px; }
.utilities { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; flex: 0 0 auto; padding: 8px; border-top: 1px solid var(--zalip-social-border); button { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; min-height: 48px; min-width: 0; padding: 4px 2px; border-radius: 12px; color: var(--zalip-social-muted); font-size: 10px; line-height: 14px; > i { font-size: 20px; } > span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &:hover { background: var(--zalip-social-raised); } } }
.utilities .utilityActive { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); }
.state { padding: 24px 16px; text-align: center; color: var(--zalip-social-muted); font-size: 14px; }
.retry { display: block; min-height: 44px; margin: 12px auto; padding: 8px 16px; border-radius: 999px; background: var(--zalip-social-raised); color: var(--MI_THEME-accent); }
.error { padding: 0 16px; color: var(--MI_THEME-error); font-size: 12px; }
.compact { .header { padding: 12px 8px 10px; } .search { margin-inline: 12px; } .filters { padding-inline: 12px; } }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
</style>
