<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.isMe]: isMe }]">
	<MkAvatar v-if="message.toRoomId && !isMe" :user="message.fromUser" :class="$style.groupAvatar" :preview="false"/>
	<div :class="[$style.body, message.file != null ? $style.fullWidth : null]" @contextmenu.stop="onContextmenu">
		<div v-if="!isMe && (message.toRoomId || isSearchResult) && message.fromUser != null" :class="$style.header"><MkUserName :user="message.fromUser"/></div>
		<div :class="$style.fukidashi">
			<div v-if="message.forwardedFromUser" :class="$style.forwarded"><i class="ti ti-arrow-forward-up"></i> {{ i18n.ts.zalip._chatUi.forwarded }} · {{ message.forwardedFromUser.name || message.forwardedFromUser.username }}</div>
			<MkA v-if="message.reply" :to="`/chat/messages/${message.reply.id}`" :class="$style.replyPreview"><strong>{{ message.reply.fromUser.name || message.reply.fromUser.username }}</strong><span>{{ message.reply.text || message.reply.fileName || i18n.ts.zalip._chatUi.attachment }}</span></MkA>
			<Mfm
				v-if="message.text"
				ref="text"
				class="_selectable"
				:text="message.text"
				:i="$i"
				:nyaize="'respect'"
				:enableEmojiMenu="true"
				:enableEmojiMenuReaction="true"
			/>
			<MkMediaList v-if="message.file" :mediaList="[message.file]"/>
			<div :class="$style.footer">
				<time :class="$style.time" :datetime="message.createdAt" :title="absoluteTime">{{ clockTime }}</time>
				<span v-if="message.updatedAt" :class="$style.time">{{ i18n.ts.zalip._chatUi.edited }}</span>
				<span v-if="isMe && !isSearchResult" :class="[$style.receipt, { [$style.read]: isReadByRecipient }]" :aria-label="isReadByRecipient ? i18n.ts.zalip._chatUi.read : i18n.ts.zalip._chatUi.sent" :title="isReadByRecipient ? i18n.ts.zalip._chatUi.read : i18n.ts.zalip._chatUi.sent"><i :class="isReadByRecipient ? 'ti ti-checks' : 'ti ti-check'"></i></span>
				<MkA v-if="isSearchResult && 'toRoom' in message && message.toRoom != null" :to="`/chat/room/${message.toRoomId}`">{{ message.toRoom.name }}</MkA>
				<MkA v-if="isSearchResult && 'toUser' in message && message.toUser != null && isMe" :to="`/chat/user/${message.toUserId}`">@{{ message.toUser.username }}</MkA>
			</div>
		</div>
		<button type="button" class="_button" :class="$style.menuButton" :aria-label="i18n.ts.more" @click="showMenu"><i class="ti ti-dots"></i></button>
		<MkUrlPreview v-for="url in urls" :key="url" :url="url" style="margin: 8px 0;"/>
		<TransitionGroup
			:enterActiveClass="prefer.s.animation ? $style.transition_reaction_enterActive : ''"
			:leaveActiveClass="prefer.s.animation ? $style.transition_reaction_leaveActive : ''"
			:enterFromClass="prefer.s.animation ? $style.transition_reaction_enterFrom : ''"
			:leaveToClass="prefer.s.animation ? $style.transition_reaction_leaveTo : ''"
			:moveClass="prefer.s.animation ? $style.transition_reaction_move : ''"
			tag="div" :class="$style.reactions"
		>
			<button v-for="record in message.reactions" :key="record.reaction + record.user.id" type="button" class="_button" :class="[$style.reaction, record.user.id === $i.id ? $style.reactionMy : null]" :aria-label="`${record.user.name || record.user.username}: ${record.reaction}`" :aria-pressed="record.user.id === $i.id" @click="onReactionClick(record)">
				<MkReactionIcon
					:withTooltip="true"
					:reaction="record.reaction.replace(/^:(\w+):$/, ':$1@.:')"
					:noStyle="true"
					:class="$style.reactionIcon"
				/>
			</button>
		</TransitionGroup>
		<p v-if="actionError" role="alert" :class="$style.error">{{ actionError }}</p>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, provide, ref } from 'vue';
import * as mfm from 'mfm-js';
import { url } from '@@/js/config.js';
import { isLink } from '@@/js/is-link.js';
import type { MenuItem } from '@/types/menu.js';
import type { ChatUiMessage } from '@/utility/zalip-chat-types.js';
import { extractUrlFromMfm } from '@/utility/extract-url-from-mfm.js';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import { ensureSignin } from '@/i.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import MkMediaList from '@/components/MkMediaList.vue';
import { reactionPicker } from '@/utility/reaction-picker.js';
import * as sound from '@/utility/sound.js';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { prefer } from '@/preferences.js';
import { DI } from '@/di.js';
import { getHTMLElementOrNull } from '@/utility/get-dom-node-or-null.js';

const $i = ensureSignin();

const props = defineProps<{
	message: ChatUiMessage;
	isSearchResult?: boolean;
	isReadByRecipient?: boolean;
}>();
const emit = defineEmits<{ (ev: 'reply', message: ChatUiMessage): void; (ev: 'edit', message: ChatUiMessage): void; (ev: 'forward', message: ChatUiMessage): void; (ev: 'pin', message: ChatUiMessage): void }>();
const actionError = ref('');
const deleting = ref(false);
const reacting = ref(false);
let alive = true;
onBeforeUnmount(() => { alive = false; });

const isMe = computed(() => props.message.fromUserId === $i.id);
const urls = computed(() => props.message.text ? extractUrlFromMfm(mfm.parse(props.message.text)) : []);
const messageDate = computed(() => new Date(props.message.createdAt));
const validDate = computed(() => !Number.isNaN(messageDate.value.getTime()));
const clockTime = computed(() => validDate.value ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(messageDate.value) : i18n.ts._ago.invalid);
const absoluteTime = computed(() => validDate.value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(messageDate.value) : i18n.ts._ago.invalid);

provide(DI.mfmEmojiReactCallback, (reaction) => {
	void changeReaction(reaction);
});

async function changeReaction(reaction: string, remove = false): Promise<void> {
	if (!alive || reacting.value || $i.policies.chatAvailability !== 'available') return;
	const account = $i.id; const messageId = props.message.id; reacting.value = true; actionError.value = '';
	try { await misskeyApi(remove ? 'chat/messages/unreact' : 'chat/messages/react', { messageId, reaction }); if (alive && account === $i.id && !remove) sound.playMisskeySfx('reaction'); } catch { if (alive && account === $i.id && props.message.id === messageId) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (alive && account === $i.id && props.message.id === messageId) reacting.value = false; }
}

function react(ev: PointerEvent) {
	if ($i.policies.chatAvailability !== 'available') return;

	const targetEl = getHTMLElementOrNull(ev.currentTarget ?? ev.target);
	if (!targetEl) return;

	const account = $i.id; const messageId = props.message.id;
	reactionPicker.show(targetEl, null, reaction => { if (alive && account === $i.id && messageId === props.message.id) void changeReaction(reaction); });
}

function onReactionClick(record: ChatUiMessage['reactions'][number]) {
	if ($i.policies.chatAvailability !== 'available') return;

	if (record.user.id === $i.id) {
		void changeReaction(record.reaction, true);
	} else {
		if (!props.message.reactions.some(r => r.user.id === $i.id && r.reaction === record.reaction)) {
			void changeReaction(record.reaction);
		}
	}
}

function onContextmenu(ev: PointerEvent) {
	if (ev.target && isLink(ev.target as HTMLElement)) return;
	if (window.getSelection()?.toString() !== '') return;

	showMenu(ev, true);
}

function showMenu(ev: PointerEvent, contextmenu = false) {
	const account = $i.id; const messageId = props.message.id;
	const valid = () => alive && account === $i.id && messageId === props.message.id;
	const menu: MenuItem[] = [];
	if (!props.isSearchResult && $i.policies.chatAvailability === 'available') {
		menu.push({ text: i18n.ts.reply, icon: 'ti ti-corner-up-left', action: () => { if (valid()) emit('reply', props.message); } });
		if (isMe.value) menu.push({ text: i18n.ts.edit, icon: 'ti ti-pencil', action: () => { if (valid()) emit('edit', props.message); } });
		menu.push({ text: i18n.ts.zalip._chatUi.forward, icon: 'ti ti-arrow-forward-up', action: () => { if (valid()) emit('forward', props.message); } });
		menu.push({ text: i18n.ts.zalip._chatUi.pinMessageForMe, icon: 'ti ti-pin', action: () => { if (valid()) emit('pin', props.message); } });
	}

	if (!isMe.value && $i.policies.chatAvailability === 'available') {
		menu.push({
			text: i18n.ts.reaction,
			icon: 'ti ti-mood-plus',
			action: (ev) => {
				if (valid()) react(ev);
			},
		});

		menu.push({
			type: 'divider',
		});
	}

	menu.push({
		text: i18n.ts.copyContent,
		icon: 'ti ti-copy',
		action: () => {
			if (valid()) copyToClipboard(props.message.text ?? '');
		},
	});

	menu.push({
		type: 'divider',
	});

	if (isMe.value && $i.policies.chatAvailability === 'available') {
		menu.push({
			text: i18n.ts.delete,
			icon: 'ti ti-trash',
			danger: true,
			action: async () => {
				if (deleting.value || !valid()) return;
				deleting.value = true;
				try { const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts.zalip._chatUi.deleteConfirm }); if (!canceled && valid()) await misskeyApi('chat/messages/delete', { messageId }); } catch { if (valid()) actionError.value = i18n.ts.zalip._chatUi.actionError; } finally { if (valid()) deleting.value = false; }
			},
		});
	}

	if (!isMe.value && props.message.fromUser != null) {
		menu.push({
			text: i18n.ts.reportAbuse,
			icon: 'ti ti-exclamation-circle',
			action: async () => {
				if (!valid()) return;
				const localUrl = `${url}/chat/messages/${props.message.id}`;
				const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkAbuseReportWindow.vue').then(x => x.default), {
					user: props.message.fromUser!,
					initialComment: `${localUrl}\n-----\n`,
				}, {
					closed: () => dispose(),
				});
			},
		});
	}

	if (contextmenu) {
		os.contextMenu(menu, ev);
	} else {
		os.popupMenu(menu, ev.currentTarget ?? ev.target);
	}
}
</script>

<style lang="scss" module>
.transition_reaction_move,
.transition_reaction_enterActive,
.transition_reaction_leaveActive {
	transition: opacity 0.2s cubic-bezier(0,.5,.5,1), transform 0.2s cubic-bezier(0,.5,.5,1) !important;
}
.transition_reaction_enterFrom,
.transition_reaction_leaveTo {
	opacity: 0;
	transform: scale(0.7);
}
.transition_reaction_leaveActive {
	position: absolute;
}

.root {
	position: relative;
	display: flex;
	align-items: flex-end;
	gap: 8px;
	min-width: 0;
	padding-inline: 32px;

	&.isMe {
		justify-content: flex-end;
	}
}
.groupAvatar { flex: 0 0 28px; width: 28px; height: 28px; }

.body {
	position: relative;
	min-width: 0;
	max-width: min(78%, 660px);

	&.fullWidth {
		width: 100%;
	}
}

@container (max-width: 450px) {
	.root { padding-inline: 24px; }
	.body { max-width: 88%; }
}

.header {
	margin: 0 10px 5px;
	font-size: 12px;
	color: var(--MI_THEME-fgTransparentWeak);
}

.fukidashi {
	display: flow-root;
	text-align: left;
	padding: 10px 14px 7px;
	border-radius: 20px;
	background: var(--zalip-social-raised, var(--MI_THEME-panelHighlight));
	color: var(--zalip-social-fg, var(--MI_THEME-fg));
	font-size: 15px;
	line-height: 1.45;
	overflow-wrap: anywhere;
}
.isMe .fukidashi { background: var(--zalip-accent-soft, var(--MI_THEME-accentedBg)); }

.content {
	overflow: clip;
	overflow-wrap: break-word;
	word-break: break-word;
}

.footer {
	float: inline-end;
	display: inline-flex;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 5px;
	margin: 5px 0 0 12px;
	font-size: 11px;
	line-height: 15px;
	align-items: center;
}
.menuButton { position: absolute; top: 50%; right: -30px; transform: translateY(-50%); width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; font-size: 16px; color: var(--MI_THEME-fgTransparentWeak); &::before { content: ''; position: absolute; inset: -9px; } &:hover, &:focus-visible { color: var(--MI_THEME-fg); background: var(--MI_THEME-buttonHoverBg); } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } }
.isMe .menuButton { right: auto; left: -30px; }
.receipt { display: inline-flex; align-items: center; font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); &.read { color: var(--MI_THEME-accent); } }
.forwarded { font-size: 12px; color: var(--MI_THEME-accent); margin-bottom: 8px; }
.replyPreview { display: grid; gap: 4px; padding: 8px 10px; margin-bottom: 8px; border-inline-start: 3px solid var(--MI_THEME-accent); border-radius: 8px; background: var(--MI_THEME-accentedBg); font-size: 12px; > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.error { color: var(--MI_THEME-error); font-size: 12px; }

.time {
	color: var(--MI_THEME-fgTransparentWeak);
}

.reactions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin: 5px 4px 0;

	&:empty {
		display: none;
	}
}

.reaction {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	padding: 4px 8px;
	min-height: 32px;
	min-width: 36px;
	box-sizing: border-box;
	background: var(--MI_THEME-panel);
	&::before { content: ''; position: absolute; inset: -6px -4px; }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }

	&.reactionMy {
		border-color: var(--MI_THEME-accent);
	}
}

.reactionIcon {
	width: 20px;
	height: 20px;
}

@media (hover: hover) and (pointer: fine) { .menuButton { opacity: 0; } .root:hover .menuButton, .root:focus-within .menuButton { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .root :global(*) { transition: none !important; } }
</style>
