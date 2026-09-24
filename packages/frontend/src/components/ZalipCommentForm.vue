<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<Teleport v-if="active" :to="replySlot ?? 'body'" :disabled="!floating || !replySlot">
	<div :class="[$style.root, { [$style.floating]: floating }]">
		<template v-if="$i">
			<MkAvatar :class="$style.avatar" :user="$i"/>
			<form :class="$style.form" @submit.prevent="submit">
				<div v-if="isReply" :class="$style.replying">
					<span>{{ i18n.tsx.zalip.replyPlaceholder({ name: replyTo.user.name ?? replyTo.user.username }) }}</span>
					<button type="button" class="_button" :aria-label="i18n.ts.cancel" @click="emit('cancelReply')"><i class="ti ti-x"></i></button>
				</div>
				<div :class="$style.inputRow">
					<textarea ref="textareaEl" v-model="text" :class="$style.textarea" :maxlength="maxLength" :disabled="posting" :placeholder="placeholder" :aria-label="placeholder" rows="1" @keydown="onKeydown" @input="resize"></textarea>
					<button type="button" class="_button" :class="$style.attach" :aria-label="i18n.ts.attachFile" :disabled="posting" @click="openFullComposer"><i class="ti ti-photo-plus"></i></button>
					<button type="submit" class="_button" :class="$style.submit" :disabled="!canSubmit" :aria-label="i18n.ts.send">
						<i v-if="posting" class="ti ti-loader-2 ti-spin"></i>
						<i v-else class="ti ti-send"></i>
					</button>
				</div>
				<p v-if="error" :class="$style.error">{{ error }}</p>
			</form>
		</template>
		<button v-else type="button" class="_button" :class="$style.signIn" @click="signIn">{{ i18n.ts.zalip.commentSignIn }}</button>
	</div>
</Teleport>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onDeactivated, onMounted, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import { $i, incNotesCount } from '@/i.js';
import { i18n } from '@/i18n.js';
import { instance } from '@/instance.js';
import { globalEvents, useGlobalEvent } from '@/events.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';

const props = defineProps<{ rootNote: Misskey.entities.Note; replyTo: Misskey.entities.Note; floating?: boolean }>();
const emit = defineEmits<{ (ev: 'posted', note: Misskey.entities.Note): void; (ev: 'cancelReply'): void }>();
const textareaEl = useTemplateRef('textareaEl');
const replySlot = ref<HTMLElement | null>(null);
const active = ref(true);
const text = ref('');
const posting = ref(false);
const error = ref<string | null>(null);
const maxLength = computed(() => instance?.maxNoteTextLength ?? 1000);
const isReply = computed(() => props.replyTo.id !== props.rootNote.id);
const placeholder = computed(() => i18n.tsx.zalip.replyPlaceholder({ name: props.replyTo.user.name ?? props.replyTo.user.username }));
const canSubmit = computed(() => text.value.trim().length > 0 && text.value.length <= maxLength.value && !posting.value);

onMounted(() => { replySlot.value = window.document.getElementById('zalip-reply-slot'); });
onActivated(() => {
	active.value = true;
	nextTick(() => { replySlot.value = window.document.getElementById('zalip-reply-slot'); });
});
onDeactivated(() => {
	active.value = false;
	replySlot.value = null;
});
watch(() => props.replyTo.id, () => {
	error.value = null;
	nextTick(() => textareaEl.value?.focus());
});

function resize(): void {
	if (!textareaEl.value) return;
	textareaEl.value.style.height = 'auto';
	textareaEl.value.style.height = Math.min(128, textareaEl.value.scrollHeight) + 'px';
}

function onKeydown(event: KeyboardEvent): void {
	if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canSubmit.value) {
		event.preventDefault();
		void submit();
	}
}

async function signIn(): Promise<void> {
	await pleaseLogin({ path: window.location.pathname + window.location.search });
}

function openFullComposer(): void {
	void os.post({ reply: props.replyTo, initialText: text.value, initialVisibility: props.rootNote.visibility, initialLocalOnly: props.rootNote.localOnly });
}

useGlobalEvent('notePosted', note => {
	if (!posting.value && note.replyId === props.replyTo.id) {
		text.value = '';
		emit('posted', note);
		nextTick(resize);
	}
});

async function submit(): Promise<void> {
	if (!canSubmit.value || $i == null) return;
	posting.value = true;
	error.value = null;
	try {
		const result = await misskeyApi('notes/create', {
			text: text.value.trim(),
			replyId: props.replyTo.id,
			visibility: props.rootNote.visibility,
			localOnly: props.rootNote.localOnly,
			...(props.rootNote.visibility === 'specified' ? { visibleUserIds: props.rootNote.visibleUserIds } : {}),
		});
		text.value = '';
		nextTick(resize);
		globalEvents.emit('notePosted', result.createdNote);
		incNotesCount();
		emit('posted', result.createdNote);
	} catch {
		error.value = i18n.ts.zalip.commentError;
	} finally {
		posting.value = false;
	}
}
</script>

<style lang="scss" module>
.root { display: flex; align-items: center; gap: 12px; margin: 12px; padding: 12px 16px; min-height: 62px; box-sizing: border-box; border: 1px solid var(--zalip-social-border); border-radius: 28px; background: color-mix(in srgb, var(--zalip-social-panel) 92%, transparent); color: var(--zalip-social-fg); backdrop-filter: blur(18px); box-shadow: 0 2px 16px var(--zalip-glass-shadow); pointer-events: auto; font-family: Inter, Arial, sans-serif; }
.floating { margin: 0; }
.avatar { flex: 0 0 28px; width: 28px; height: 28px; }
.form { flex: 1; min-width: 0; }
.replying { display: flex; justify-content: space-between; gap: 8px; padding-bottom: 6px; color: var(--MI_THEME-accent); font-size: 12px; }
.inputRow { display: flex; gap: 6px; align-items: center; }
.textarea { min-width: 0; flex: 1; width: 100%; padding: 8px 0; min-height: 38px; max-height: 128px; resize: none; box-sizing: border-box; border: 0; background: transparent; color: var(--zalip-social-fg); font: inherit; font-size: 15px; line-height: 1.45; }
.textarea:focus { outline: none; }
.root:focus-within { border-color: var(--MI_THEME-focus); }
.attach, .submit { display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 40px; color: var(--zalip-social-muted); font-size: 22px; }
.submit:not(:disabled) { color: var(--MI_THEME-accent); }
.submit:disabled { opacity: .4; }
.signIn { width: 100%; min-height: 38px; color: var(--zalip-social-muted); }
.error { margin: 6px 0 0; color: var(--MI_THEME-error); font-size: 12px; }
</style>
