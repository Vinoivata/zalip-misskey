<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="[$style.root, { [$style.compact]: compact }]" :aria-label="i18n.ts.zalip._chatUi.conversations">
	<header v-if="utilityTab === 'home'" :class="$style.header">
		<div :class="$style.primary" role="group" :aria-label="i18n.ts.zalip._chatUi.conversations">
			<button type="button" class="_button" :class="{ [$style.primaryActive]: filter !== 'groups' }" :aria-pressed="filter !== 'groups'" @click="selectPrimary('messages')">{{ i18n.ts.zalip.messages }}</button>
			<button type="button" class="_button" :class="{ [$style.primaryActive]: filter === 'groups' }" :aria-pressed="filter === 'groups'" @click="selectPrimary('groups')">{{ i18n.ts.zalip._chatUi.rooms }}</button>
		</div>
		<button type="button" class="_button" :class="$style.icon" :disabled="me.policies.chatAvailability !== 'available'" :aria-label="i18n.ts.zalip.chatIndividual" :title="i18n.ts.zalip.chatIndividual" @click="newDirectChat"><i class="ti ti-edit" aria-hidden="true"></i></button>
		<button v-if="!compact || me.policies.chatAvailability === 'available'" type="button" class="_button" :class="$style.icon" :aria-label="i18n.ts.more" aria-haspopup="menu" @click="openMore"><i class="ti ti-dots" aria-hidden="true"></i></button>
	</header>
	<template v-if="utilityTab === 'home'">
		<label :class="$style.search"><i class="ti ti-search" aria-hidden="true"></i><input v-model="query" type="search" maxlength="80" :placeholder="i18n.ts.zalip._chatUi.searchPeople" :aria-label="i18n.ts.zalip._chatUi.searchPeople"></label>
		<div v-if="filter !== 'groups'" :class="$style.filters" role="group" :aria-label="i18n.ts.filter"><button v-for="item in filters" :key="item.value" type="button" class="_button" :class="{ [$style.active]: filter === item.value }" :aria-pressed="filter === item.value" @click="filter = item.value">{{ item.label }}</button></div>
	</template>
	<div v-else :class="$style.utilityHeading"><button type="button" class="_button" :class="$style.icon" :aria-label="i18n.ts.zalip._chatUi.back" @click="emit('utility', 'home')"><i class="ti ti-arrow-left" aria-hidden="true"></i></button><strong>{{ utilityTitle }}</strong></div>
	<p v-if="actionError" role="alert" :class="$style.error">{{ actionError }}</p>
	<div ref="list" :class="$style.list" @scroll.passive="rememberScroll">
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
</section>
</template>

<script lang="ts">
import type { ChatConversation } from '@/utility/zalip-chat-types.js';

type ListFilter = 'all' | 'unread' | 'people' | 'groups' | 'archived';
type MessageFilter = Exclude<ListFilter, 'groups'>;
type ListSession = { accountId: string; filter: ListFilter; messageFilter: MessageFilter; query: string; items: ChatConversation[]; cursor: string | null; pages: number; scrollTop: number };
// Memory only: keep the current account's full-page list, never private history in storage.
let listSession: ListSession | null = null;

function getListSession(accountId: string): ListSession | null { if (listSession?.accountId !== accountId) listSession = null; return listSession; }
</script>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { ChatConversationPreferences, ChatConversationsResponse } from '@/utility/zalip-chat-types.js';
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
const initial = !props.compact ? getListSession(me.id) : null;
const filter = ref<ListFilter>(initial?.filter ?? 'all'); const messageFilter = ref<MessageFilter>(initial?.messageFilter ?? 'all'); const query = ref(initial?.query ?? '');
const filters = computed(() => [{ value: 'all' as const, label: i18n.ts.zalip._chatUi.all }, { value: 'unread' as const, label: i18n.ts.zalip._chatUi.unread }, { value: 'people' as const, label: i18n.ts.zalip._chatUi.people }, { value: 'archived' as const, label: i18n.ts.zalip._chatUi.archived }]);
const utilityTitle = computed(() => props.utilityTab === 'search' ? i18n.ts.search : props.utilityTab === 'invitations' ? i18n.ts.zalip.chatInvitations : i18n.ts.zalip._chatUi.manageGroups);
const items = ref<ChatConversation[]>(initial?.items ?? []); const cursor = ref<string | null>(initial?.cursor ?? null); const pages = ref(initial?.pages ?? 1); const pending = ref(false); const error = ref(false); const actionError = ref(''); const mutating = ref(new Set<string>());
const list = useTemplateRef('list');
let scrollTop = initial?.scrollTop ?? 0; let accountId = me.id; let restoring = false;
let epoch = 0; let alive = true; let active = true; let timer: number | null = null; let refreshTimer: number | null = null; let refreshQueued = false;
const connection = useStream().useChannel('main');
const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const dateFormatter = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function title(item: ChatConversation): string { return item.user?.name || item.user?.username || item.room?.name || i18n.ts.zalip.messages; }

function timeLabel(createdAt: string): string { const date = new Date(createdAt); return Number.isNaN(date.getTime()) ? i18n.ts._ago.invalid : date.toDateString() === new Date().toDateString() ? clockFormatter.format(date) : dateFormatter.format(date); }

function timeTitle(createdAt: string): string { const date = new Date(createdAt); return Number.isNaN(date.getTime()) ? i18n.ts._ago.invalid : fullDateFormatter.format(date); }

function target(item: ChatConversation): { userId?: string; roomId?: string } { return item.kind === 'user' ? { userId: item.user!.id } : { roomId: item.room!.id }; }

function saveSession(): void { if (!props.compact && active && accountId === me.id) listSession = { accountId, filter: filter.value, messageFilter: messageFilter.value, query: query.value, items: [...items.value], cursor: cursor.value, pages: pages.value, scrollTop }; }

function rememberScroll(): void { if (props.utilityTab === 'home') { scrollTop = list.value?.scrollTop ?? 0; saveSession(); } }

function restoreScroll(): void { void nextTick(() => { if (list.value && props.utilityTab === 'home') list.value.scrollTop = scrollTop; }); }

function select(item: ChatConversation): void { saveSession(); emit('select', { ...target(item), title: title(item) }); }

function selectPrimary(value: 'messages' | 'groups'): void { filter.value = value === 'groups' ? 'groups' : messageFilter.value; if (props.utilityTab !== 'home') emit('utility', 'home'); }

function openMore(event: MouseEvent): void {
	const account = me.id; const valid = () => alive && account === me.id;
	const entries: MenuItem[] = [];
	if (me.policies.chatAvailability === 'available') entries.push({ text: i18n.ts.zalip.chatCreateRoom, icon: 'ti ti-users-plus', action: () => { if (valid()) void newRoom(); } });
	if (!props.compact) entries.push(...([{ value: 'search', text: i18n.ts.search, icon: 'ti ti-search' }, { value: 'invitations', text: i18n.ts.zalip.chatInvitations, icon: 'ti ti-ticket' }, { value: 'rooms', text: i18n.ts.zalip._chatUi.manageGroups, icon: 'ti ti-users-group' }] as const).map(item => ({ text: item.text, icon: item.icon, action: () => { if (valid()) emit('utility', item.value); } })));
	void os.popupMenu(entries, event.currentTarget as HTMLElement);
}

async function load(append = false): Promise<void> {
	if (append && (pending.value || !cursor.value)) return;
	const request = ++epoch; const account = me.id; const pageCount = append ? 1 : pages.value;
	pending.value = true; error.value = false;
	try {
		const rows: ChatConversation[] = []; let nextCursor = append ? cursor.value : null; let fetched = 0;
		for (let page = 0; page < pageCount; page++) {
			const result = await misskeyApiZalip<ChatConversationsResponse>('zalip/chat/conversations', { filter: filter.value, query: query.value.trim(), limit: 30, ...(nextCursor ? { cursor: nextCursor } : {}) });
			if (!alive || !active || request !== epoch || account !== me.id) return;
			rows.push(...result.items); nextCursor = result.nextCursor; fetched++;
			if (!nextCursor) break;
		}
		items.value = Array.from(new Map((append ? [...items.value, ...rows] : rows).map(item => [item.key, item])).values());
		cursor.value = nextCursor; pages.value = append ? pages.value + 1 : fetched;
		saveSession(); restoreScroll();
	} catch { if (alive && request === epoch && account === me.id) error.value = true; } finally { if (alive && request === epoch && account === me.id) { pending.value = false; if (refreshQueued) { refreshQueued = false; refresh(); } } }
}

function refresh(): void {
	if (!active || window.document.hidden || props.utilityTab !== 'home') return;
	if (pending.value || timer) { refreshQueued = true; return; }
	if (!refreshTimer) refreshTimer = window.setTimeout(() => { refreshTimer = null; if (active && !window.document.hidden) void load(false); }, 120);
}

function clearTimers(): void { if (timer) window.clearTimeout(timer); if (refreshTimer) window.clearTimeout(refreshTimer); timer = null; refreshTimer = null; refreshQueued = false; }

function debounce(): void { epoch++; clearTimers(); cursor.value = null; items.value = []; pages.value = 1; scrollTop = 0; pending.value = true; error.value = false; actionError.value = ''; saveSession(); restoreScroll(); timer = window.setTimeout(() => { timer = null; if (active) void load(false); else pending.value = false; }, 250); }

async function update(item: ChatConversation, patch: Partial<ChatConversationPreferences>): Promise<void> {
	if (mutating.value.has(item.key)) return;
	const account = me.id; mutating.value = new Set([...mutating.value, item.key]); actionError.value = '';
	try {
		const preferences = await misskeyApiZalip<ChatConversationPreferences>('zalip/chat/preferences/update', { ...target(item), ...patch });
		if (!alive || account !== me.id) return;
		// A slower list request must not overwrite the newly confirmed preference.
		epoch++; pending.value = false;
		items.value = items.value.map(row => row.key === item.key ? { ...row, preferences } : row).filter(row => filter.value === 'archived' ? row.preferences.isArchived : !row.preferences.isArchived);
		saveSession(); chatConversationEvents.emit('changed');
	} catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (alive && account === me.id) { const next = new Set(mutating.value); next.delete(item.key); mutating.value = next; } }
}

async function markRead(item: ChatConversation): Promise<void> {
	if (mutating.value.has(item.key) || !item.lastMessage) return;
	const account = me.id; mutating.value = new Set([...mutating.value, item.key]); actionError.value = '';
	try {
		await misskeyApi('chat/messages/read', { ...target(item), messageId: item.lastMessage.id });
		if (!alive || account !== me.id) return;
		epoch++; pending.value = false;
		items.value = items.value.map(row => row.key === item.key ? { ...row, unread: false } : row).filter(row => filter.value !== 'unread' || row.unread);
		saveSession(); chatConversationEvents.emit('changed');
	} catch { if (alive && account === me.id) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (alive && account === me.id) { const next = new Set(mutating.value); next.delete(item.key); mutating.value = next; } }
}

function preferences(item: ChatConversation, event: MouseEvent): void {
	const account = me.id;
	const apply = (patch: Partial<ChatConversationPreferences>) => { if (alive && account === me.id) void update(item, patch); };
	void os.popupMenu([{ text: item.preferences.isPinned ? i18n.ts.zalip._chatUi.unpinConversation : i18n.ts.zalip._chatUi.pin, icon: 'ti ti-pin', action: () => apply({ isPinned: !item.preferences.isPinned }) }, { text: item.preferences.isArchived ? i18n.ts.zalip._chatUi.unarchive : i18n.ts.zalip._chatUi.archive, icon: 'ti ti-archive', action: () => apply({ isArchived: !item.preferences.isArchived }) }, { text: item.preferences.isMuted ? i18n.ts.zalip._chatUi.unmuteConversation : i18n.ts.zalip._chatUi.muteConversation, icon: 'ti ti-bell-off', action: () => apply({ isMuted: !item.preferences.isMuted }) }, ...(item.lastMessage && item.unread ? [{ text: i18n.ts.zalip._chatUi.markRead, icon: 'ti ti-checks', action: () => { if (alive && account === me.id) void markRead(item); } }] : []), ...(item.preferences.pinnedMessageId ? [{ text: i18n.ts.zalip._chatUi.unpinMessage, icon: 'ti ti-pinned-off', action: () => apply({ pinnedMessageId: null }) }] : [])], event.currentTarget as HTMLElement);
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

watch([filter, query], () => { if (!restoring) { if (filter.value !== 'groups') messageFilter.value = filter.value; debounce(); } }, { flush: 'sync' });
watch(() => me.id, id => { listSession = null; accountId = id; epoch++; clearTimers(); restoring = true; filter.value = 'all'; messageFilter.value = 'all'; query.value = ''; restoring = false; items.value = []; cursor.value = null; pages.value = 1; scrollTop = 0; mutating.value = new Set(); pending.value = false; actionError.value = ''; error.value = false; restoreScroll(); if (active) void load(false); }, { flush: 'sync' });
watch(() => props.utilityTab, tab => { if (tab === 'home') { restoreScroll(); refresh(); } else if (list.value) list.value.scrollTop = 0; });
connection.on('newChatMessage', refresh); connection.on('readAllChatMessages', refresh); connection.on('chatUnreadState', refresh); chatConversationEvents.on('changed', refresh); window.document.addEventListener('visibilitychange', refresh);
onMounted(restoreScroll);
onActivated(() => { if (active) return; active = true; const saved = !props.compact ? getListSession(me.id) : null; if (saved) { restoring = true; filter.value = saved.filter; messageFilter.value = saved.messageFilter; query.value = saved.query; restoring = false; items.value = saved.items; cursor.value = saved.cursor; pages.value = saved.pages; scrollTop = saved.scrollTop; restoreScroll(); } refresh(); });
onDeactivated(() => { saveSession(); active = false; epoch++; pending.value = false; clearTimers(); });
void load(false);
onBeforeUnmount(() => { saveSession(); alive = false; epoch++; clearTimers(); connection.dispose(); chatConversationEvents.off('changed', refresh); window.document.removeEventListener('visibilitychange', refresh); });
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
.utilityHeading { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; min-height: 68px; padding: 8px 12px; box-sizing: border-box; > strong { font-size: 16px; } }
.state { padding: 24px 16px; text-align: center; color: var(--zalip-social-muted); font-size: 14px; }
.retry { display: block; min-height: 44px; margin: 12px auto; padding: 8px 16px; border-radius: 999px; background: var(--zalip-social-raised); color: var(--MI_THEME-accent); }
.error { padding: 0 16px; color: var(--MI_THEME-error); font-size: 12px; }
.compact { .header { padding: 12px 8px 10px; } .search { margin-inline: 12px; } .filters { padding-inline: 12px; } }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
</style>
