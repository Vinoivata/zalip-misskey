<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<template v-if="$i">
		<MkAvatar :class="$style.avatar" :user="$i"/>
		<form :class="$style.form" @submit.prevent="submit">
			<div v-if="isReply" :class="$style.replying">
				<span>Ответ для <MkUserName :user="replyTo.user"/></span>
				<button type="button" class="_button" :class="$style.cancelReply" aria-label="Отменить ответ" @click="emit('cancelReply')"><i class="ti ti-x"></i></button>
			</div>
			<textarea
				ref="textareaEl"
				v-model="text"
				:class="$style.textarea"
				:maxlength="maxLength"
				:disabled="posting"
				:placeholder="placeholder"
				rows="1"
				@keydown="onKeydown"
			></textarea>
			<div :class="$style.actions">
				<span :class="[$style.counter, { [$style.counterWarn]: text.length > maxLength - 100 }]">{{ text.length }}/{{ maxLength }}</span>
				<button type="submit" class="_button" :class="$style.submit" :disabled="!canSubmit">
					<i v-if="posting" class="ti ti-loader-2 ti-spin"></i>
					<span>{{ posting ? 'Отправляем…' : isReply ? 'Ответить' : 'Комментировать' }}</span>
				</button>
			</div>
			<p v-if="error" :class="$style.error">{{ error }}</p>
		</form>
	</template>
	<button v-else type="button" class="_button" :class="$style.signIn" @click="signIn"><i class="ti ti-login"></i> Войдите, чтобы оставить комментарий</button>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import { $i, incNotesCount } from '@/i.js';
import { instance } from '@/instance.js';
import { globalEvents } from '@/events.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';

const props = defineProps<{
	rootNote: Misskey.entities.Note;
	replyTo: Misskey.entities.Note;
}>();

const emit = defineEmits<{
	(ev: 'posted', note: Misskey.entities.Note): void;
	(ev: 'cancelReply'): void;
}>();

const textareaEl = useTemplateRef('textareaEl');
const text = ref('');
const posting = ref(false);
const error = ref<string | null>(null);
const maxLength = computed(() => instance?.maxNoteTextLength ?? 1000);
const isReply = computed(() => props.replyTo.id !== props.rootNote.id);
const placeholder = computed(() => isReply.value ? `Ответ для ${props.replyTo.user.name ?? props.replyTo.user.username}…` : 'Напишите комментарий…');
const canSubmit = computed(() => text.value.trim().length > 0 && text.value.length <= maxLength.value && !posting.value);

watch(() => props.replyTo.id, () => {
	error.value = null;
	nextTick(() => textareaEl.value?.focus());
});

function onKeydown(ev: KeyboardEvent): void {
	if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter' && canSubmit.value) {
		ev.preventDefault();
		void submit();
	}
}

async function signIn(): Promise<void> {
	await pleaseLogin({ path: window.location.pathname + window.location.search });
}

async function submit(): Promise<void> {
	if (!canSubmit.value || $i == null) return;

	posting.value = true;
	error.value = null;
	try {
		const visibility = props.rootNote.visibility;
		const result = await misskeyApi('notes/create', {
			text: text.value.trim(),
			replyId: props.replyTo.id,
			visibility,
			localOnly: props.rootNote.localOnly,
		});
		text.value = '';
		globalEvents.emit('notePosted', result.createdNote);
		incNotesCount();
		emit('posted', result.createdNote);
	} catch {
		error.value = 'Не удалось отправить комментарий. Попробуйте ещё раз.';
	} finally {
		posting.value = false;
	}
}
</script>

<style lang="scss" module>
.root {
	display: flex;
	gap: 10px;
	margin: 18px 32px 24px;
	padding: 12px;
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.72);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 14px;
}

.avatar {
	flex: 0 0 auto;
	width: 36px;
	height: 36px;
	border-radius: 50%;
}

.form {
	min-width: 0;
	flex: 1;
}

.replying {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 0 0 5px;
	font-size: 0.83em;
	color: var(--MI_THEME-accent);
}

.cancelReply {
	padding: 2px 4px;
	color: inherit;
}

.textarea {
	display: block;
	width: 100%;
	min-height: 44px;
	max-height: 180px;
	padding: 10px 0 4px;
	resize: vertical;
	box-sizing: border-box;
	font: inherit;
	line-height: 1.45;
	color: var(--MI_THEME-fg);
	background: transparent;
	border: 0;
	outline: none;
}

.actions {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 12px;
}

.counter {
	font-size: 0.75em;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.55);
}

.counterWarn {
	color: var(--MI_THEME-warn);
}

.submit, .signIn {
	padding: 7px 12px;
	border-radius: 9px;
	font-weight: 700;
	color: var(--MI_THEME-accentedFg);
	background: var(--MI_THEME-accent);
}

.submit:disabled {
	opacity: 0.5;
	cursor: default;
}

.signIn {
	width: 100%;
	color: var(--MI_THEME-fg);
	background: transparent;
}

.error {
	margin: 8px 0 0;
	font-size: 0.83em;
	color: var(--MI_THEME-error);
}

@container (max-width: 450px) {
	.root {
		margin: 14px 16px 20px;
	}
}
</style>
