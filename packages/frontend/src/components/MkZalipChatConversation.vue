<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section ref="root" :class="[$style.root, { [$style.compact]: compact }]" :aria-label="metadata?.title || i18n.ts.zalip.messages">
	<header v-if="!compact" :class="$style.header">
		<button type="button" class="_button" :class="[$style.icon, $style.back]" :aria-label="i18n.ts.zalip._chatUi.back" @click="emit('close')"><i class="ti ti-arrow-left"></i></button>
		<button type="button" class="_button" :class="$style.identity" :aria-label="i18n.ts.zalip._chatUi.conversationDetails" :aria-expanded="detailsVisible" @click="detailsVisible = !detailsVisible">
			<MkAvatar v-if="user" :user="user" :class="$style.avatar" :link="false"/><span v-else :class="[$style.avatar, $style.roomAvatar]"><i class="ti ti-users-group"></i></span>
			<span :class="$style.identityText"><strong>{{ metadata?.title || i18n.ts.zalip.messages }}</strong><span v-if="someoneTyping" role="status" :class="$style.typingSubtitle">{{ i18n.ts.zalip._chatUi.typing }}</span><span v-else>{{ user ? `@${user.username}` : i18n.ts.zalip._chatUi.roomInfo }}</span></span>
		</button>
		<button type="button" class="_button" :class="[$style.icon, { [$style.selected]: tab === 'search' }]" :aria-label="i18n.ts.zalip._chatUi.searchInConversation" :aria-pressed="tab === 'search'" @click="tab = tab === 'search' ? 'chat' : 'search'; detailsVisible = false"><i class="ti ti-search"></i></button>
		<button type="button" class="_button" :class="[$style.icon, $style.detailsShortcut, { [$style.selected]: detailsVisible }]" :aria-label="i18n.ts.zalip._chatUi.conversationDetails" :aria-expanded="detailsVisible" @click="detailsVisible = !detailsVisible"><i class="ti ti-info-circle"></i></button>
		<button type="button" class="_button" :class="$style.icon" :aria-label="i18n.ts.more" @click="menu"><i class="ti ti-dots"></i></button>
	</header>
	<div v-if="error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._chatUi.loadError }}</p><button type="button" class="_button" :class="$style.retry" @click="initialize">{{ i18n.ts.retry }}</button></div>
	<div v-else-if="loading" :class="$style.state" role="status" :aria-label="i18n.ts.loading"><MkLoading/></div>
	<template v-else-if="initialized">
		<div :class="$style.content">
			<div v-show="!detailsVisible || splitDetails" :class="$style.main">
				<div v-if="pinned" :class="$style.pinned"><i class="ti ti-pin"></i><MkA :to="`/chat/messages/${pinned.id}`"><strong>{{ i18n.ts.zalip._chatUi.pinMessageForMe }}</strong><span>{{ pinned.text || pinned.file?.name || i18n.ts.zalip._chatUi.attachment }}</span></MkA><button type="button" class="_button" :class="$style.icon" :aria-label="i18n.ts.zalip._chatUi.unpin" @click="unpin"><i class="ti ti-x"></i></button></div>
				<div v-if="tab !== 'chat'" :class="$style.detail"><button type="button" class="_button" :class="$style.retry" @click="tab = 'chat'"><i class="ti ti-arrow-left"></i> {{ i18n.ts.zalip.messages }}</button><XSearch v-if="tab === 'search'" :userId="userId" :roomId="roomId"/><XMembers v-else-if="tab === 'members' && room" :room="room" @inviteUser="inviteUser"/><XInfo v-else-if="tab === 'info' && room" :room="room" @updated="updatedRoom"/></div>
				<div v-show="timelineVisible" ref="viewport" :class="$style.timeline" tabindex="0" @scroll.passive="onScroll">
					<div :class="$style.timelineContent">
						<button v-if="hasMore" type="button" class="_button" :class="$style.retry" :disabled="morePending" @click="fetchMore">{{ i18n.ts.loadMore }}</button><p v-if="moreError" role="alert" :class="$style.error">{{ i18n.ts.zalip._chatUi.loadError }}</p>
						<p v-if="!messages.length" :class="$style.state">{{ i18n.ts.zalip._chatUi.empty }}</p>
						<template v-for="(message, index) in messages" :key="message.id"><div v-if="isNewDay(message, messages[index - 1])" :class="$style.date"><span>{{ dayLabel(message.createdAt) }}</span></div><div :data-chat-message-id="message.id" :class="$style.message"><XMessage :message="message" :isReadByRecipient="isRead(message)" @reply="replyTo = $event; editing = null" @edit="editing = $event; replyTo = null" @forward="forward" @pin="pin"/></div></template>
					</div>
				</div>
				<div v-show="timelineVisible" :class="$style.composer"><button v-if="newMessages" type="button" class="_button" :class="$style.newMessages" @click="toBottom">{{ i18n.ts.zalip._chatUi.newMessages }} <i class="ti ti-arrow-down"></i></button><p v-if="compact && someoneTyping" :class="$style.typing" role="status">{{ i18n.ts.zalip._chatUi.typing }}</p><XForm :user="user" :room="room" :active="effectiveActive && timelineVisible" :replyTo="replyTo" :editingMessage="editing" @sent="sent" @typing="sendTyping" @cancelReply="replyTo = null" @cancelEdit="editing = null"/></div>
			</div>
			<aside v-if="detailsVisible" :class="[$style.details, { [$style.splitDetails]: splitDetails }]" :aria-label="i18n.ts.zalip._chatUi.conversationDetails">
				<header :class="$style.detailsHeader"><strong>{{ i18n.ts.zalip._chatUi.conversationDetails }}</strong><button type="button" class="_button" :class="$style.icon" :aria-label="i18n.ts.close" @click="detailsVisible = false"><i class="ti ti-x"></i></button></header>
				<div :class="$style.profile"><MkAvatar v-if="user" :user="user" :class="$style.profileAvatar" link/><span v-else :class="[$style.profileAvatar, $style.roomAvatar]"><i class="ti ti-users-group"></i></span><strong>{{ metadata?.title }}</strong><span v-if="user">@{{ user.username }}</span><p v-if="user?.description || room?.description" :class="['_selectable', $style.description]">{{ user?.description || room?.description }}</p><MkA v-if="user" :to="userPage(user)" :class="$style.profileLink">{{ i18n.ts.zalip._chatUi.openProfile }}</MkA></div>
				<div v-if="room" :class="$style.groupActions"><button type="button" class="_button" @click="tab = 'members'; detailsVisible = false"><i class="ti ti-users"></i>{{ i18n.ts.zalip._chatUi.members }}</button><button type="button" class="_button" @click="tab = 'info'; detailsVisible = false"><i class="ti ti-info-circle"></i>{{ i18n.ts.zalip._chatUi.roomInfo }}</button></div>
				<section :class="$style.attachments"><h3>{{ i18n.ts.zalip._chatUi.loadedAttachments }}</h3><p :class="$style.attachmentHint">{{ i18n.ts.zalip._chatUi.loadedAttachmentsHint }}</p><template v-if="loadedMedia.length"><h4>{{ i18n.ts.zalip._chatUi.media }}</h4><MkMediaList :mediaList="loadedMedia"/></template><template v-if="loadedFiles.length"><h4>{{ i18n.ts.zalip._chatUi.files }}</h4><MkMediaBanner v-for="file in loadedFiles" :key="file.id" :media="file"/></template><p v-if="!loadedMedia.length && !loadedFiles.length" :class="$style.attachmentHint">{{ i18n.ts.zalip._chatUi.noLoadedAttachments }}</p></section>
			</aside>
		</div>
	</template>
	<p v-if="actionError" role="alert" :class="$style.actionError">{{ actionError }}</p>
</section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ChatConversationMetadata, ChatConversationPreferences, ChatUiMessage } from '@/utility/zalip-chat-types.js';
import { chatConversationEvents } from '@/utility/zalip-chat-types.js';
import { hasBlockingChatPopup } from '@/utility/zalip-chat-visibility.js';
import XMessage from '@/pages/chat/XMessage.vue';
import XForm from '@/pages/chat/room.form.vue';
import XSearch from '@/pages/chat/room.search.vue';
import XMembers from '@/pages/chat/room.members.vue';
import XInfo from '@/pages/chat/room.info.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkMediaBanner from '@/components/MkMediaBanner.vue';
import { ensureSignin } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApi, misskeyApiZalip } from '@/utility/misskey-api.js';
import { useStream } from '@/stream.js';
import { userPage } from '@/filters/user.js';
import * as os from '@/os.js';

const props = withDefaults(defineProps<{ userId?: string; roomId?: string; active?: boolean; compact?: boolean }>(), { active: true, compact: false });
const emit = defineEmits<{ (ev: 'loaded', metadata: ChatConversationMetadata): void; (ev: 'close'): void }>();
const me = ensureSignin();
const user = ref<Misskey.entities.UserDetailed | null>(null); const room = ref<Misskey.entities.ChatRoom | null>(null);
const metadata = computed(() => user.value ? { title: user.value.name || user.value.username, user: user.value, room: null } : room.value ? { title: room.value.name, room: room.value, user: null } : null);
const messages = ref<ChatUiMessage[]>([]); const loading = ref(false); const initialized = ref(false); const error = ref(false); const actionError = ref('');
const hasMore = ref(false); const morePending = ref(false); const moreError = ref(false); const tab = ref('chat');
const containerEl = useTemplateRef('root'); const detailsVisible = ref(false); const panelWidth = ref(0);
const splitDetails = computed(() => !props.compact && panelWidth.value >= 680);
const timelineVisible = computed(() => tab.value === 'chat' && (!detailsVisible.value || splitDetails.value));
const loadedAttachments = computed(() => Array.from(new Map(messages.value.flatMap(message => message.file ? [[message.file.id, message.file] as const] : [])).values()));
const loadedMedia = computed(() => loadedAttachments.value.filter(file => /^(image|video|audio)\//u.test(file.type)));
const loadedFiles = computed(() => loadedAttachments.value.filter(file => !/^(image|video|audio)\//u.test(file.type)));
const replyTo = ref<ChatUiMessage | null>(null); const editing = ref<ChatUiMessage | null>(null);
const pinned = ref<ChatUiMessage | null>(null);
let pinRequest = 0; let pinPending = false; let observerGeneration = 0; let resumeGeneration = 0;
const viewport = useTemplateRef('viewport'); const newMessages = ref(false); const pageVisible = ref(!window.document.hidden); const activated = ref(true);
const effectiveActive = computed(() => props.active && pageVisible.value && activated.value && !hasBlockingChatPopup(os.popups.value));
const typingUntil = ref<Record<string, number>>({}); const tick = ref(Date.now()); const readFrontiers = ref<Record<string, string>>({});
const someoneTyping = computed(() => effectiveActive.value && Object.entries(typingUntil.value).some(([id, expiry]) => id !== me.id && expiry > tick.value));
let epoch = 0; let alive = true; let observer: IntersectionObserver | null = null; let lastRead = ''; let readPending = false; let pendingRead = '';
let readTimer: number | null = null; let typingTick: number | null = null; let lastTyping = 0;
let resizeObserver: ResizeObserver | null = null;
let sendVersion = 0;
const recentSends = new Map<string, { version: number; message: ChatUiMessage }>();
let connection: Misskey.IChannelConnection<Misskey.Channels['chatUser']> | Misskey.IChannelConnection<Misskey.Channels['chatRoom']> | null = null;
let resumeMutations: { request: number; account: string; mutations: (() => void)[] } | null = null;

function target(): { userId?: string; roomId?: string } { return props.userId ? { userId: props.userId } : { roomId: props.roomId }; }

function isNewDay(message: ChatUiMessage, previous?: ChatUiMessage): boolean { return !previous || new Date(message.createdAt).toDateString() !== new Date(previous.createdAt).toDateString(); }

function dayLabel(createdAt: string): string { const date = new Date(createdAt); return Number.isNaN(date.getTime()) ? i18n.ts._ago.invalid : date.toDateString() === new Date().toDateString() ? i18n.ts.zalip._chatUi.today : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date); }

function current(request: number, account: string): boolean { return alive && request === epoch && account === me.id; }

function normalize(raw: Misskey.entities.ChatMessageLite | Misskey.entities.ChatMessage | ChatUiMessage): ChatUiMessage {
	return { ...raw, fromUser: raw.fromUser ?? (raw.fromUserId === me.id ? me : user.value!), reactions: raw.reactions.map(record => ({ ...record, user: record.user ?? (record.userId === me.id ? me : record.userId === user.value?.id ? user.value : null) })).filter((record): record is typeof record & { user: Misskey.entities.UserLite } => record.user != null) };
}

function disposeConnection(): void { connection?.send('typing', { typing: false }); connection?.dispose(); connection = null; if (resumeMutations) resumeMutations.mutations.length = 0; resumeMutations = null; morePending.value = false; observerGeneration++; resumeGeneration++; observer?.disconnect(); observer = null; pendingRead = ''; if (readTimer) window.clearTimeout(readTimer); readTimer = null; if (typingTick) window.clearInterval(typingTick); typingTick = null; }

function connect(request: number, account: string): void {
	if (!effectiveActive.value || !current(request, account) || connection) return;
	connection = props.userId ? useStream().useChannel('chatUser', { otherId: props.userId }) : useStream().useChannel('chatRoom', { roomId: props.roomId! });
	const channel = connection;
	const live = () => connection === channel && current(request, account);
	const mutate = (mutation: () => void) => {
		if (!live()) return;
		if (resumeMutations?.request === request && resumeMutations.account === account) resumeMutations.mutations.push(mutation);
		else mutation();
	};
	connection.on('message', raw => mutate(() => { const nearBottom = timelineVisible.value && atBottom(); upsert(normalize(raw)); if (nearBottom) void nextTick(toBottom); else if (raw.fromUserId !== me.id) newMessages.value = true; chatConversationEvents.emit('changed'); }));
	connection.on('updated', raw => mutate(() => { const message = normalize(raw); if (messages.value.some(existing => existing.id === message.id)) upsert(message); if (pinned.value?.id === message.id) pinned.value = message; }));
	connection.on('deleted', id => mutate(() => { messages.value = messages.value.filter(message => message.id !== id); if (replyTo.value?.id === id) replyTo.value = null; if (editing.value?.id === id) editing.value = null; if (pinned.value?.id === id) { pinned.value = null; pinRequest++; } chatConversationEvents.emit('changed'); }));
	connection.on('react', payload => mutate(() => { const message = messages.value.find(item => item.id === payload.messageId); const actor = payload.user ?? (payload.userId === me.id ? me : payload.userId === user.value?.id ? user.value : null); if (message && actor && !message.reactions.some(item => item.user.id === payload.userId && item.reaction === payload.reaction)) message.reactions.push({ reaction: payload.reaction, userId: payload.userId, user: actor }); }));
	connection.on('unreact', payload => mutate(() => { const message = messages.value.find(item => item.id === payload.messageId); if (message) message.reactions = message.reactions.filter(item => item.user.id !== payload.userId || item.reaction !== payload.reaction); }));
	connection.on('read', payload => { if (!live() || payload.userId === me.id) return; if ((readFrontiers.value[payload.userId] ?? '') < payload.messageId) readFrontiers.value = { ...readFrontiers.value, [payload.userId]: payload.messageId }; });
	connection.on('typing', payload => { if (!live() || payload.userId === me.id) return; typingUntil.value = { ...typingUntil.value, [payload.userId]: payload.typing ? Date.now() + 5000 : 0 }; });
	connection.on('unavailable', () => { if (!live()) return; epoch++; disposeConnection(); pinRequest++; pinned.value = null; initialized.value = false; messages.value = []; replyTo.value = null; editing.value = null; user.value = null; room.value = null; loading.value = false; error.value = true; });
	typingTick = window.setInterval(() => { tick.value = Date.now(); }, 1000);
}

async function initialize(): Promise<void> {
	const request = ++epoch; const account = me.id;
	disposeConnection(); messages.value = []; user.value = null; room.value = null; pinned.value = null; pinRequest++; pinPending = false; initialized.value = false; error.value = false; hasMore.value = false; morePending.value = false; moreError.value = false; actionError.value = ''; tab.value = 'chat'; detailsVisible.value = false; replyTo.value = null; editing.value = null; readFrontiers.value = {}; lastRead = ''; pendingRead = ''; readPending = false; sendVersion = 0; recentSends.clear();
	if (!effectiveActive.value || (!!props.userId === !!props.roomId)) { loading.value = false; return; }
	loading.value = true;
	try {
		const [detailResult, rowsResult] = await Promise.allSettled([props.userId ? misskeyApi('users/show', { userId: props.userId }) : misskeyApi('chat/rooms/show', { roomId: props.roomId! }), fetchPage()]);
		if (!current(request, account) || !effectiveActive.value) return;
		if (detailResult.status === 'rejected') throw detailResult.reason;
		const detail = detailResult.value;
		if (props.roomId && 'invitationExists' in detail && detail.invitationExists) {
			const choice = await os.confirm({ type: 'question', title: detail.name ?? '', text: `${i18n.ts.zalip._chatUi.invitationNotice}\n${i18n.ts.zalip._chatUi.acceptInvitation}` });
			if (!current(request, account)) return;
			if (choice.canceled) { emit('close'); return; }
			await misskeyApi('chat/rooms/join', { roomId: props.roomId }); if (current(request, account)) await initialize(); return;
		}
		if (rowsResult.status === 'rejected') throw rowsResult.reason;
		const rows = rowsResult.value;
		if (props.userId) user.value = detail as Misskey.entities.UserDetailed; else room.value = detail as Misskey.entities.ChatRoom;
		messages.value = rows.map(normalize).toSorted((a, b) => a.id.localeCompare(b.id)); hasMore.value = rows.length === 30; initialized.value = true; loading.value = false;
		if (metadata.value) emit('loaded', metadata.value); connect(request, account); void loadPinned(request, account); await nextTick(); toBottom(); observe();
	} catch { if (current(request, account)) error.value = true; } finally { if (current(request, account)) loading.value = false; }
}

function fetchPage(untilId?: string): Promise<Misskey.entities.ChatMessageLite[]> { return props.userId ? misskeyApi('chat/messages/user-timeline', { userId: props.userId, limit: 30, markAsRead: false, ...(untilId ? { untilId } : {}) }) : misskeyApi('chat/messages/room-timeline', { roomId: props.roomId!, limit: 30, markAsRead: false, ...(untilId ? { untilId } : {}) }); }

async function fetchMore(): Promise<void> {
	if (morePending.value || !hasMore.value || !effectiveActive.value || resumeMutations) return;
	const request = epoch; const account = me.id; const generation = resumeGeneration; const height = viewport.value?.scrollHeight ?? 0; const top = viewport.value?.scrollTop ?? 0;
	const valid = () => current(request, account) && effectiveActive.value && generation === resumeGeneration;
	morePending.value = true; moreError.value = false;
	try { const rows = await fetchPage(messages.value[0]?.id); if (!valid()) return; for (const raw of rows) upsert(normalize(raw)); hasMore.value = rows.length === 30; await nextTick(); if (!valid()) return; if (viewport.value) viewport.value.scrollTop = top + viewport.value.scrollHeight - height; observe(); } catch { if (valid()) moreError.value = true; } finally { if (valid()) morePending.value = false; }
}

function upsert(message: ChatUiMessage): void { const index = messages.value.findIndex(item => item.id === message.id); if (index === -1) messages.value.push(message); else messages.value[index] = message; messages.value.sort((a, b) => a.id.localeCompare(b.id)); void nextTick(observe); }

function atBottom(): boolean { const element = viewport.value; return !element || element.scrollHeight - element.scrollTop - element.clientHeight < 100; }

function toBottom(): void { viewport.value?.scrollTo({ top: viewport.value.scrollHeight, behavior: 'instant' }); newMessages.value = false; void nextTick(checkVisible); }

function onScroll(): void { if (atBottom()) newMessages.value = false; checkVisible(); }

function observe(): void {
	observer?.disconnect(); const generation = ++observerGeneration; const request = epoch; const account = me.id; const root = viewport.value;
	if (!effectiveActive.value || !root || !timelineVisible.value) return;
	if (typeof IntersectionObserver !== 'undefined') { observer = new IntersectionObserver(entries => { if (generation !== observerGeneration || !current(request, account) || root !== viewport.value) return; for (const entry of entries) if (entry.isIntersecting && root.contains(entry.target)) queueRead((entry.target as HTMLElement).dataset.chatMessageId ?? ''); }, { root, threshold: 0 }); root.querySelectorAll('[data-chat-message-id]').forEach(element => observer?.observe(element)); }
	checkVisible();
}

function visibleMessage(id: string): boolean {
	if (!effectiveActive.value || !timelineVisible.value || !viewport.value || viewport.value.clientHeight <= 0 || !messages.value.some(message => message.id === id && message.fromUserId !== me.id)) return false;
	const element = Array.from(viewport.value.querySelectorAll<HTMLElement>('[data-chat-message-id]')).find(item => item.dataset.chatMessageId === id);
	if (!element) return false;
	const root = viewport.value.getBoundingClientRect(); const item = element.getBoundingClientRect();
	return root.width > 0 && root.height > 0 && item.width > 0 && item.height > 0 && Math.min(item.bottom, root.bottom, window.innerHeight) - Math.max(item.top, root.top, 0) >= Math.min(item.height, root.height, window.innerHeight) * .5 && item.right > Math.max(root.left, 0) && item.left < Math.min(root.right, window.innerWidth);
}

function checkVisible(): void { if (!effectiveActive.value || !timelineVisible.value || !viewport.value) return; for (const element of viewport.value.querySelectorAll<HTMLElement>('[data-chat-message-id]')) queueRead(element.dataset.chatMessageId ?? ''); }

function queueRead(id: string): void { if (id <= lastRead || !visibleMessage(id)) return; if (id > pendingRead) pendingRead = id; if (!readTimer) readTimer = window.setTimeout(() => { readTimer = null; void markVisibleRead(); }, 120); }

async function markVisibleRead(): Promise<void> {
	if (!effectiveActive.value || !timelineVisible.value || readPending || !pendingRead || pendingRead <= lastRead) return;
	if (!visibleMessage(pendingRead)) { pendingRead = ''; return; }
	const request = epoch; const account = me.id; const messageId = pendingRead; readPending = true;
	try { const result = await misskeyApi('chat/messages/read', { ...target(), messageId }); if (current(request, account) && result.readThroughId) { lastRead = result.readThroughId; chatConversationEvents.emit('changed'); } } catch { /* Never fabricate read receipts when a visibility acknowledgement fails. */ } finally { if (current(request, account)) { readPending = false; if (pendingRead > messageId) void markVisibleRead(); } }
}

function sendTyping(typing: boolean): void { if (!connection || (typing && (!effectiveActive.value || !timelineVisible.value || Date.now() - lastTyping < 1800))) return; lastTyping = Date.now(); connection.send('typing', { typing }); }

function isRead(message: ChatUiMessage): boolean { return message.fromUserId === me.id && Object.entries(readFrontiers.value).some(([id, through]) => id !== me.id && through >= message.id); }

function sent(message: Misskey.entities.ChatMessageLite): void { const normalized = normalize(message); recentSends.set(message.id, { version: ++sendVersion, message: normalized }); const oldest = recentSends.keys().next().value; if (recentSends.size > 100 && oldest) recentSends.delete(oldest); upsert(normalized); void nextTick(toBottom); chatConversationEvents.emit('changed'); }

function updatedRoom(updated: Misskey.entities.ChatRoom): void { if (!room.value || updated.id !== room.value.id) return; room.value = { ...room.value, ...updated }; if (metadata.value) emit('loaded', metadata.value); chatConversationEvents.emit('changed'); }

async function forward(message: ChatUiMessage): Promise<void> { const request = epoch; const account = me.id; actionError.value = ''; try { const recipient = await os.selectUser({ localOnly: true, includeSelf: false }); if (!current(request, account)) return; await misskeyApi('chat/messages/forward', { messageId: message.id, toUserId: recipient.id }); if (current(request, account)) os.toast(i18n.ts.zalip._chatUi.forwardSuccess); chatConversationEvents.emit('changed'); } catch { if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError; } }

async function pin(message: ChatUiMessage): Promise<void> { if (pinPending) return; const request = epoch; const account = me.id; pinPending = true; actionError.value = ''; try { await misskeyApiZalip('zalip/chat/preferences/update', { ...target(), pinnedMessageId: message.id }); if (current(request, account)) { void loadPinned(request, account); chatConversationEvents.emit('changed'); } } catch { if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (current(request, account)) pinPending = false; } }

async function loadPinned(request: number, account: string): Promise<void> {
	const pinEpoch = ++pinRequest;
	try {
		const preference = await misskeyApiZalip<ChatConversationPreferences>('zalip/chat/preferences/show', target());
		if (!current(request, account) || pinEpoch !== pinRequest) return;
		if (!preference.pinnedMessageId) { pinned.value = null; return; }
		const message = await misskeyApi('chat/messages/show', { messageId: preference.pinnedMessageId });
		if (!current(request, account) || pinEpoch !== pinRequest) return;
		const belongs = props.roomId ? message.toRoomId === props.roomId : (message.fromUserId === me.id && message.toUserId === props.userId) || (message.fromUserId === props.userId && message.toUserId === me.id);
		pinned.value = belongs ? normalize(message) : null;
	} catch { if (current(request, account) && pinEpoch === pinRequest) pinned.value = null; }
}

async function unpin(): Promise<void> {
	if (pinPending) return;
	const request = epoch; const account = me.id; pinRequest++; pinPending = true; actionError.value = '';
	try { await misskeyApiZalip('zalip/chat/preferences/update', { ...target(), pinnedMessageId: null }); if (current(request, account)) { pinned.value = null; chatConversationEvents.emit('changed'); } } catch { if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (current(request, account)) pinPending = false; }
}

async function inviteUser(): Promise<void> { if (!room.value || room.value.ownerId !== me.id) return; const request = epoch; const account = me.id; const roomId = room.value.id; try { const recipient = await os.selectUser({ localOnly: true, includeSelf: false }); if (current(request, account)) await os.apiWithDialog('chat/rooms/invitations/create', { roomId, userId: recipient.id }); } catch { if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError; } }

async function leaveRoom(): Promise<void> {
	if (!room.value || room.value.ownerId === me.id) return;
	const request = epoch; const account = me.id; const roomId = room.value.id;
	try { const choice = await os.confirm({ type: 'warning', text: i18n.ts.areYouSure }); if (!choice.canceled && current(request, account)) { await misskeyApi('chat/rooms/leave', { roomId }); if (current(request, account)) { disposeConnection(); initialized.value = false; messages.value = []; pinned.value = null; emit('close'); chatConversationEvents.emit('changed'); } } } catch { if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError; }
}

function menu(event: MouseEvent): void {
	const request = epoch; const account = me.id; const selectTab = (value: string) => { if (current(request, account)) { tab.value = value; detailsVisible.value = false; } };
	void os.popupMenu([...(user.value ? [{ type: 'link' as const, text: i18n.ts.zalip._chatUi.openProfile, icon: 'ti ti-user', to: userPage(user.value) }] : []), { text: i18n.ts.zalip._chatUi.searchInConversation, icon: 'ti ti-search', action: () => selectTab('search') }, ...(room.value ? [{ text: i18n.ts.zalip._chatUi.members, icon: 'ti ti-users', action: () => selectTab('members') }, { text: i18n.ts.zalip._chatUi.roomInfo, icon: 'ti ti-info-circle', action: () => selectTab('info') }, ...(room.value.ownerId === me.id ? [{ text: i18n.ts.zalip._chatUi.inviteParticipant, icon: 'ti ti-user-plus', action: () => { if (current(request, account)) void inviteUser(); } }] : [{ text: i18n.ts.zalip._chatUi.leaveGroup, icon: 'ti ti-logout', action: () => { if (current(request, account)) void leaveRoom(); } }])] : [])], event.currentTarget as HTMLElement);
}

function visibility(): void { pageVisible.value = !window.document.hidden; if (pageVisible.value) void nextTick(observe); }

window.document.addEventListener('visibilitychange', visibility);
watch(() => [props.userId, props.roomId, me.id], () => { void initialize(); }, { immediate: true });

async function resume(): Promise<void> {
	if (loading.value) return;
	if (!initialized.value) { await initialize(); return; }
	const request = epoch; const account = me.id; const generation = ++resumeGeneration; const bottom = atBottom();
	const oldestLoadedId = messages.value[0]?.id; const startedSendVersion = sendVersion;
	const valid = () => current(request, account) && effectiveActive.value && generation === resumeGeneration;
	const buffered = { request, account, mutations: [] as (() => void)[] };
	resumeMutations = buffered;
	const replayMutations = () => {
		if (resumeMutations === buffered) resumeMutations = null;
		for (const mutation of buffered.mutations.splice(0)) { if (!valid()) break; mutation(); }
	};
	let latestSnapshot: Awaited<ReturnType<typeof fetchPage>> | null = null;
	const applySnapshot = (rows: Awaited<ReturnType<typeof fetchPage>>, reconciled: boolean) => {
		const refreshed = new Map<string, ChatUiMessage>(rows.map(row => [row.id, normalize(row)])); const oldest = rows.map(row => row.id).toSorted()[0];
		for (const [id, sent] of recentSends) if (sent.version > startedSendVersion && (reconciled || !oldest || id >= oldest)) refreshed.set(id, sent.message);
		messages.value = Array.from(refreshed.values()).toSorted((a, b) => a.id.localeCompare(b.id));
		if (editing.value && !refreshed.has(editing.value.id)) editing.value = null;
		if (replyTo.value && !refreshed.has(replyTo.value.id)) replyTo.value = null;
	};
	try {
		// Subscribe before fetching so events arriving between history pages survive reconciliation.
		connect(request, account);
		const latest = await fetchPage(); if (!valid()) return;
		latestSnapshot = latest;
		let page = latest; let fetched = latest; let pages = 1;
		let oldestFetchedId = page.map(row => row.id).toSorted()[0];
		while (oldestLoadedId && page.length === 30 && oldestFetchedId && oldestFetchedId > oldestLoadedId && pages < 6) {
			page = await fetchPage(oldestFetchedId); if (!valid()) return; pages++;
			const nextOldestId = page.map(row => row.id).toSorted()[0];
			if (nextOldestId && nextOldestId >= oldestFetchedId) break;
			fetched = [...fetched, ...page]; oldestFetchedId = nextOldestId;
		}
		const reconciled = !oldestLoadedId || page.length < 30 || !!oldestFetchedId && oldestFetchedId <= oldestLoadedId;
		const rows = reconciled ? fetched : latest;
		applySnapshot(rows, reconciled);
		replayMutations();
		hasMore.value = (reconciled ? page : latest).length === 30; moreError.value = false;
		connect(request, account); void loadPinned(request, account); await nextTick(); if (!valid()) return; if (bottom || !reconciled) toBottom(); observe();
	} catch { if (valid()) { if (latestSnapshot) { applySnapshot(latestSnapshot, false); hasMore.value = latestSnapshot.length === 30; } replayMutations(); moreError.value = true; connect(request, account); await nextTick(); if (!valid()) return; if (latestSnapshot) toBottom(); observe(); } } finally { if (resumeMutations === buffered) resumeMutations = null; buffered.mutations.length = 0; }
}

watch(effectiveActive, active => { if (!active) disposeConnection(); else void resume(); });
watch([tab, detailsVisible, splitDetails], () => { sendTyping(false); if (!timelineVisible.value) pendingRead = ''; void nextTick(observe); });
onMounted(() => { if (!containerEl.value) return; panelWidth.value = containerEl.value.clientWidth; if (typeof ResizeObserver !== 'undefined') { resizeObserver = new ResizeObserver(entries => { const width = entries[0]?.contentRect.width; if (width != null) panelWidth.value = width; }); resizeObserver.observe(containerEl.value); } });
onActivated(() => { activated.value = true; }); onDeactivated(() => { activated.value = false; });
onBeforeUnmount(() => { alive = false; epoch++; disposeConnection(); resizeObserver?.disconnect(); window.document.removeEventListener('visibilitychange', visibility); });
defineExpose({ refresh: initialize });
</script>

<style lang="scss" module>
.root { display: flex; flex: 1; flex-direction: column; height: 100%; width: 100%; min-height: 0; min-width: 0; overflow: clip; background: var(--zalip-social-panel, var(--MI_THEME-panel)); color: var(--MI_THEME-fg); container-type: inline-size; }
.header { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; min-height: 70px; padding: 9px 18px; box-sizing: border-box; border-bottom: 1px solid var(--MI_THEME-divider); }
.identity { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; min-height: 44px; text-align: start; border-radius: 12px; }
.identityText { display: grid; gap: 3px; min-width: 0; > strong, > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > strong { font-size: 16px; font-weight: 650; line-height: 21px; } > span { color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; line-height: 17px; } > .typingSubtitle { color: var(--MI_THEME-accent); } }
.avatar { width: 40px; height: 40px; flex: 0 0 40px; }
.roomAvatar { display: grid; place-items: center; border-radius: 50%; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fgTransparentWeak); font-size: 22px; }
.icon { display: grid; place-items: center; width: 44px; height: 44px; flex: 0 0 44px; border-radius: 50%; font-size: 20px; &:hover { background: var(--MI_THEME-buttonHoverBg); } }
.selected { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.back { display: none; }
.content { display: flex; flex: 1; min-width: 0; min-height: 0; }
.main { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.timeline { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 16px 12px 10px; scrollbar-width: thin; }
.timelineContent { display: flex; flex-direction: column; justify-content: flex-end; min-height: 100%; }
.message { flex: 0 0 auto; margin-bottom: 8px; }
.date { display: flex; justify-content: center; flex: 0 0 auto; margin: 16px 0 18px; > span { padding: 4px 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 99px; color: var(--MI_THEME-fgTransparentWeak); font-size: 11px; line-height: 16px; } }
.composer { position: relative; flex: 0 0 auto; padding: 10px 20px max(16px, env(safe-area-inset-bottom, 0px)); }
.state { display: grid; place-content: center; min-height: 180px; padding: 20px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.retry { display: block; min-height: 44px; padding: 8px 18px; margin: 8px auto; border-radius: 99px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-accent); }
.error, .actionError { color: var(--MI_THEME-error); text-align: center; font-size: 12px; }
.detail { flex: 1; min-height: 0; overflow-y: auto; padding: 20px; }
.details { flex: 1; min-width: 0; overflow-y: auto; padding: 4px 20px 24px; box-sizing: border-box; scrollbar-width: thin; }
.splitDetails { flex: 0 0 280px; width: 280px; border-inline-start: 1px solid var(--MI_THEME-divider); }
.detailsHeader { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-height: 48px; > strong { font-size: 13px; } }
.profile { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 24px 0; text-align: center; > strong { max-width: 100%; overflow-wrap: anywhere; font-size: 17px; } > span:not(.profileAvatar) { color: var(--MI_THEME-fgTransparentWeak); font-size: 14px; } }
.profileAvatar { width: 80px; height: 80px; margin-bottom: 8px; font-size: 32px; }
.description { margin: 4px 0; max-width: 100%; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.profileLink { display: grid; place-items: center; min-height: 40px; padding: 0 20px; margin-top: 6px; border-radius: 99px; background: var(--MI_THEME-buttonBg); font-size: 13px; font-weight: 600; }
.groupActions { display: grid; gap: 4px; margin-bottom: 20px; > button { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 10px; text-align: start; border-radius: 12px; font-size: 13px; &:hover { background: var(--MI_THEME-buttonHoverBg); } } }
.attachments { padding-top: 20px; border-top: 1px solid var(--MI_THEME-divider); h3, h4 { margin: 0 0 10px; font-size: 12px; font-weight: 650; letter-spacing: .04em; } h4 { margin-top: 22px; text-transform: uppercase; } }
.attachmentHint { color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; line-height: 1.5; }
.pinned { display: flex; align-items: center; gap: 10px; padding: 4px 12px; border-bottom: 1px solid var(--MI_THEME-divider); background: var(--MI_THEME-accentedBg); > a { display: grid; gap: 3px; flex: 1; min-width: 0; font-size: 12px; > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } } > i { color: var(--MI_THEME-accent); } }
.typing { margin: 0 8px 6px; font-size: 12px; color: var(--MI_THEME-accent); }
.newMessages { position: absolute; top: -44px; left: 50%; transform: translateX(-50%); min-height: 36px; padding: 6px 16px; border-radius: 99px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); white-space: nowrap; }
.compact { .timeline { padding: 8px 0; } .composer { padding: 8px; } }
@media (max-width: 1099px) { .back { display: grid; } .detailsShortcut { display: none; } .header { min-height: 68px; padding: 8px; gap: 0; } .identity { gap: 8px; } .timeline { padding: 10px 0 4px; } .composer { padding: 8px 10px max(12px, env(safe-area-inset-bottom, 0px)); } }
@container (max-width: 450px) { .header > .icon { width: 40px; flex-basis: 40px; } .identityText > strong { font-size: 15px; } .identityText > span { font-size: 12px; } .identity .avatar { width: 34px; height: 34px; flex-basis: 34px; } .header { padding-inline: 4px; } }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
</style>
