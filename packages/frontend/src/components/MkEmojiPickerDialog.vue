<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	v-slot="{ type, maxHeight }"
	:zPriority="'middle'"
	:preferType="asReactionPicker ? (anchorElement ? 'popup' : 'dialog') : prefer.s.emojiPickerStyle"
	:hasInteractionWithOtherFocusTrappedEls="true"
	:transparentBg="true"
	:manualShowing="manualShowing"
	:anchorElement="anchorElement"
	@click="modal?.close()"
	@esc="modal?.close()"
	@opening="opening"
	@close="emit('close')"
	@closed="emit('closed')"
>
	<div v-if="quickPicker" ref="quick" :class="$style.quick" class="_popup _shadow" role="group" :aria-label="i18n.ts.reaction">
		<button v-for="emoji in quickReactions" :key="emoji" type="button" class="_button" :aria-label="emoji" @click="chosen(emoji)"><MkEmoji :emoji="emoji" :normal="true"/></button>
		<button type="button" class="_button" :aria-label="i18n.ts.more" @click="expandPicker"><i class="ti ti-plus"></i></button>
	</div>
	<MkEmojiPicker
		v-else
		ref="picker"
		class="_popup _shadow"
		:class="{ [$style.drawer]: type === 'drawer' }"
		:showPinned="showPinned"
		:pinnedEmojis="pinnedEmojis"
		:asReactionPicker="asReactionPicker"
		:targetNote="targetNote"
		:asDrawer="type === 'drawer'"
		:max-height="maxHeight"
		@chosen="chosen"
		@esc="modal?.close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import MkEmojiPicker from '@/components/MkEmojiPicker.vue';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	manualShowing?: boolean | null;
	anchorElement?: HTMLElement | null;
	showPinned?: boolean;
	pinnedEmojis?: string[],
	asReactionPicker?: boolean;
	targetNote?: Misskey.entities.Note | null;
	choseAndClose?: boolean;
}>(), {
	manualShowing: null,
	showPinned: true,
	pinnedEmojis: undefined,
	asReactionPicker: false,
	choseAndClose: true,
});

const emit = defineEmits<{
	(ev: 'done', v: string): void;
	(ev: 'close'): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const picker = useTemplateRef('picker');
const quick = useTemplateRef('quick');
const expanded = ref(false);
const quickPicker = computed(() => props.asReactionPicker && !expanded.value);
const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '😡', '🔥'];

async function expandPicker(): Promise<void> {
	expanded.value = true;
	await nextTick();
	picker.value?.focus();
}

function chosen(emoji: string) {
	emit('done', emoji);
	if (props.choseAndClose) {
		modal.value?.close();
	}
}

function opening() {
	if (quickPicker.value) {
		quick.value?.querySelector('button')?.focus();
		return;
	}
	picker.value?.reset();
	picker.value?.focus();

	// 何故かちょっと待たないとフォーカスされない
	window.setTimeout(() => {
		picker.value?.focus();
	}, 10);
}
</script>

<style lang="scss" module>
.quick { display: flex; align-items: center; gap: 2px; padding: 7px; max-width: calc(100vw - 24px); box-sizing: border-box; border: 1px solid var(--MI_THEME-divider); border-radius: 99px; background: var(--zalip-social-panel); }
.quick > button { display: grid; place-items: center; width: 40px; height: 42px; min-width: 0; flex: 1 1 40px; border-radius: 50%; font-size: 28px; transition: transform .15s, background .15s; }
.quick > button:hover, .quick > button:focus-visible { background: var(--MI_THEME-panelHighlight); transform: translateY(-3px); }
.quick > button > i { font-size: 22px; color: var(--MI_THEME-fgTransparentWeak); }
@media (prefers-reduced-motion: reduce) { .quick > button { transition: none; } .quick > button:hover { transform: none; } }
.drawer {
	border-radius: 24px;
	border-bottom-right-radius: 0;
	border-bottom-left-radius: 0;
}
</style>
