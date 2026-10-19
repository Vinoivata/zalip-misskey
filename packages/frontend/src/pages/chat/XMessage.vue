<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { [$style.isMe]: isMe }]">
	<MkAvatar :class="[$style.avatar, prefer.s.useStickyIcons ? $style.useSticky : null]" :user="message.fromUser!" :link="!isMe" :preview="false"/>
	<div :class="[$style.body, message.file != null ? $style.fullWidth : null]" @contextmenu.stop="onContextmenu">
		<div :class="$style.header"><MkUserName v-if="!isMe && prefer.s['chat.showSenderName'] && message.fromUser != null" :user="message.fromUser"/></div>
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
		</div>
		<MkUrlPreview v-for="url in urls" :key="url" :url="url" style="margin: 8px 0;"/>
		<div :class="$style.footer">
			<button type="button" class="_button" :class="$style.menuButton" :aria-label="i18n.ts.more" @click="showMenu"><i class="ti ti-dots"></i></button>
			<MkTime :class="$style.time" :time="message.createdAt"/>
			<span v-if="message.updatedAt" :class="$style.time">{{ i18n.ts.zalip._chatUi.edited }}</span>
			<span v-if="isMe && !isSearchResult" :class="[$style.receipt, { [$style.read]: isReadByRecipient }]" :aria-label="isReadByRecipient ? i18n.ts.zalip._chatUi.read : i18n.ts.zalip._chatUi.sent" :title="isReadByRecipient ? i18n.ts.zalip._chatUi.read : i18n.ts.zalip._chatUi.sent"><i :class="isReadByRecipient ? 'ti ti-checks' : 'ti ti-check'"></i></span>
			<MkA v-if="isSearchResult && 'toRoom' in message && message.toRoom != null" :to="`/chat/room/${message.toRoomId}`">{{ message.toRoom.name }}</MkA>
			<MkA v-if="isSearchResult && 'toUser' in message && message.toUser != null && isMe" :to="`/chat/user/${message.toUserId}`">@{{ message.toUser.username }}</MkA>
		</div>
		<TransitionGroup
			:enterActiveClass="prefer.s.animation ? $style.transition_reaction_enterActive : ''"
			:leaveActiveClass="prefer.s.animation ? $style.transition_reaction_leaveActive : ''"
			:enterFromClass="prefer.s.animation ? $style.transition_reaction_enterFrom : ''"
			:leaveToClass="prefer.s.animation ? $style.transition_reaction_leaveTo : ''"
			:moveClass="prefer.s.animation ? $style.transition_reaction_move : ''"
			tag="div" :class="$style.reactions"
		>
			<button v-for="record in message.reactions" :key="record.reaction + record.user.id" type="button" class="_button" :class="[$style.reaction, record.user.id === $i.id ? $style.reactionMy : null]" :aria-label="record.reaction" :aria-pressed="record.user.id === $i.id" @click="onReactionClick(record)">
				<MkAvatar :user="record.user" :link="false" :class="$style.reactionAvatar"/>
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

	&.isMe {
		flex-direction: row-reverse;
		text-align: right;

		.footer {
			flex-direction: row-reverse;
		}
	}
}

.avatar {
	display: block;
	width: 50px;
	height: 50px;

	&.useSticky {
		position: sticky;
		top: calc(16px + var(--MI-stickyTop, 0px));
	}
}

@container (max-width: 450px) {
	.root {
		&.isMe {
			.avatar {
				display: none;
			}
		}
	}

	.avatar {
		width: 42px;
		height: 42px;
	}

	.fukidashi {
		font-size: 90%;
	}
}

.body {
	margin: 0 12px;
	min-width: 0;
	max-width: min(78%, 660px);

	&.fullWidth {
		width: 100%;
	}
}

.header {
	min-height: 4px; // fukidashiの位置調整も兼ねるため
	font-size: 80%;
}

.fukidashi {
	text-align: left;
	padding: 12px 16px;
	border: 1px solid var(--zalip-social-border);
	border-radius: 20px 20px 20px 6px;
	background: var(--zalip-social-raised);
	color: var(--zalip-social-fg);
	font-size: 15px;
	line-height: 1.5;
	overflow-wrap: anywhere;
}
.isMe .fukidashi { border-color: var(--zalip-accent-border); border-radius: 20px 20px 6px 20px; background: var(--zalip-accent-soft); }

.content {
	overflow: clip;
	overflow-wrap: break-word;
	word-break: break-word;
}

.footer {
	display: flex;
	flex-direction: row;
	gap: 0.5em;
	margin-top: 4px;
	font-size: 75%;
	align-items: center;
}
.menuButton { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 50%; font-size: 19px; }
.receipt { display: inline-flex; align-items: center; font-size: 15px; color: var(--MI_THEME-fgTransparentWeak); &.read { color: var(--MI_THEME-accent); } }
.forwarded { font-size: 12px; color: var(--MI_THEME-accent); margin-bottom: 8px; }
.replyPreview { display: grid; gap: 4px; padding: 8px 10px; margin-bottom: 8px; border-inline-start: 3px solid var(--MI_THEME-accent); border-radius: 8px; background: var(--MI_THEME-accentedBg); font-size: 12px; > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.error { color: var(--MI_THEME-error); font-size: 12px; }

.time {
	opacity: 0.5;
}

.reactions {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 8px;
	margin-top: 8px;

	&:empty {
		display: none;
	}
}

.reaction {
	display: flex;
	align-items: center;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 999px;
	padding: 8px;
	min-height: 44px;
	box-sizing: border-box;

	&.reactionMy {
		border-color: var(--MI_THEME-accent);
	}
}

.reactionAvatar {
	width: 24px;
	height: 24px;
	margin-right: 8px;
}

.reactionIcon {
	width: 24px;
	height: 24px;
}
</style>
