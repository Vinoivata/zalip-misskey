<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root" @dragover.prevent="onDragover" @drop.prevent.stop="onDrop">
	<div v-if="editingMessage || replyTo" :class="$style.context"><i :class="editingMessage ? 'ti ti-pencil' : 'ti ti-corner-up-left'"></i><div><strong>{{ editingMessage ? i18n.ts.zalip._chatUi.editing : i18n.ts.zalip._chatUi.replyTo }}</strong><span>{{ (editingMessage || replyTo)?.text || i18n.ts.zalip._chatUi.attachment }}</span></div><button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.cancel" :disabled="sending" @click="cancelContext"><i class="ti ti-x"></i></button></div>
	<div v-if="file && !editingMessage" :class="$style.attachment"><i class="ti ti-paperclip"></i><span>{{ file.name }}</span><button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.remove" :disabled="sending" @click="file = null"><i class="ti ti-x"></i></button></div>
	<p v-if="file || editingMessage?.file" :class="$style.hint">{{ i18n.ts.zalip._chatUi.privateFilesHint }}</p>
	<div v-if="recording" :class="$style.recording" role="status"><i class="ti ti-microphone"></i>{{ i18n.ts.zalip._chatUi.recording }}<button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.zalip._chatUi.cancelRecording" @click="cancelRecording"><i class="ti ti-x"></i></button><button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.zalip._chatUi.stopRecording" @click="stopRecording"><i class="ti ti-player-stop"></i></button></div>
	<div :class="$style.capsule">
		<button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.attachFile" :disabled="!allowed || busy || !!editingMessage" @click="chooseFile"><i class="ti ti-plus"></i></button>
		<textarea ref="textareaEl" v-model="text" :class="$style.textarea" :aria-label="i18n.ts.inputMessageHere" :placeholder="i18n.ts.inputMessageHere" :disabled="!allowed || sending || recording" :readonly="pickerOpen" maxlength="4000" rows="1" @keydown="onKeydown" @paste="onPaste" @input="emit('typing', text.length > 0)"></textarea>
		<button type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.emoji" :disabled="!allowed || busy" @click="insertEmoji"><i class="ti ti-mood-smile"></i></button>
		<button v-if="voiceSupported && !text.trim() && !file && !editingMessage && !sending && !uploading" type="button" class="_button" :class="$style.button" :aria-label="i18n.ts.zalip._chatUi.recordVoice" :disabled="!allowed || busy" @click="recordVoice"><i :class="voicePending ? 'ti ti-loader-2 ti-spin' : 'ti ti-microphone'"></i></button>
		<button v-else type="button" class="_button" :class="[$style.button, $style.send]" :disabled="!canSend" :aria-label="editingMessage ? i18n.ts.save : i18n.ts.send" @click="send"><i :class="sending || uploading ? 'ti ti-loader-2 ti-spin' : editingMessage ? 'ti ti-check' : 'ti ti-arrow-up'"></i></button>
	</div>
	<small v-if="Array.from(text).length >= 1800" :class="[$style.counter, { [$style.overLimit]: Array.from(text).length > 2000 }]">{{ Array.from(text).length }} / 2000</small>
	<p v-if="error" :class="$style.error" role="alert">{{ error }}</p><p v-if="!allowed" :class="$style.hint">{{ i18n.ts.zalip._chatUi.readOnly }}</p>
</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ChatUiMessage } from '@/utility/zalip-chat-types.js';
import { chatDraftKey, readChatDrafts } from '@/utility/zalip-chat-types.js';
import { selectFile } from '@/utility/drive.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { miLocalStorage } from '@/local-storage.js';
import { ensureSignin } from '@/i.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import { getDragData } from '@/drag-and-drop.js';
import * as os from '@/os.js';

const props = withDefaults(defineProps<{ user?: Misskey.entities.UserDetailed | null; room?: Misskey.entities.ChatRoom | null; active?: boolean; replyTo?: ChatUiMessage | null; editingMessage?: ChatUiMessage | null }>(), { active: true });
const emit = defineEmits<{ (ev: 'sent', message: Misskey.entities.ChatMessageLite): void; (ev: 'cancelReply'): void; (ev: 'cancelEdit'): void; (ev: 'typing', typing: boolean): void }>();
const me = ensureSignin();
const textareaEl = useTemplateRef('textareaEl');
const text = ref(''); const file = ref<Misskey.entities.DriveFile | null>(null);
const sending = ref(false); const uploading = ref(false); const pickerOpen = ref(false); const recording = ref(false); const voicePending = ref(false); const error = ref('');
const allowed = computed(() => props.active && me.policies.chatAvailability === 'available' && (!!props.room || (!!props.user && props.user.host == null && props.user.canChat)));
const busy = computed(() => sending.value || uploading.value || recording.value || voicePending.value);
const canSend = computed(() => allowed.value && !busy.value && (text.value.trim().length > 0 || file.value != null || props.editingMessage?.file != null) && Array.from(text.value).length <= 2000);
const voiceSupported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
let epoch = 0; let alive = true; let restoring = false; let draftVersion = 0; let voiceGeneration = 0;
let autocomplete: Autocomplete | null = null;
let recorder: MediaRecorder | null = null; let microphone: MediaStream | null = null;
let recordingTimer: number | null = null;

function key(): string { return chatDraftKey(me.id, { userId: props.user?.id, roomId: props.room?.id }); }

function current(request: number, account: string): boolean { return alive && request === epoch && account === me.id; }

function saveDraft(): void {
	if (restoring || props.editingMessage || (!props.user && !props.room)) return;
	try { const drafts = readChatDrafts(miLocalStorage.getItem('chatMessageDrafts')); if (text.value || file.value) drafts[key()] = { text: text.value, file: file.value }; else delete drafts[key()]; miLocalStorage.setItem('chatMessageDrafts', JSON.stringify(Object.fromEntries(Object.entries(drafts).slice(-100)))); } catch { /* A full or disabled device store must not prevent sending. */ }
}

function restore(): void { restoring = true; try { const draft = readChatDrafts(miLocalStorage.getItem('chatMessageDrafts'))[key()]; text.value = draft?.text ?? ''; file.value = draft?.file ?? null; } catch { text.value = ''; file.value = null; } finally { restoring = false; } }

watch([text, file], () => { draftVersion++; saveDraft(); }, { flush: 'sync' });
watch(() => [props.user?.id, props.room?.id, me.id], () => { epoch++; cancelRecording(); sending.value = false; uploading.value = false; error.value = ''; restore(); }, { immediate: true });
watch(() => props.editingMessage?.id, () => { error.value = ''; if (props.editingMessage) text.value = props.editingMessage.text ?? ''; else restore(); void nextTick(() => textareaEl.value?.focus()); });
watch(() => props.active, active => { if (!active) { cancelRecording(); emit('typing', false); } });
watch(textareaEl, element => { autocomplete?.detach(); autocomplete = element ? new Autocomplete(element, text) : null; void nextTick(resizeTextarea); });
watch(text, () => { void nextTick(resizeTextarea); });

function resizeTextarea(): void { const element = textareaEl.value; if (!element) return; element.style.height = 'auto'; element.style.height = `${Math.min(Math.max(element.scrollHeight, 44), 144)}px`; }

function cancelContext(): void { if (props.editingMessage) emit('cancelEdit'); else emit('cancelReply'); }

function onKeydown(event: KeyboardEvent): void {
	if (event.isComposing || event.key === 'Process' || event.keyCode === 229 || event.key !== 'Enter') return;
	const submit = prefer.s['chat.sendOnEnter'] ? !(event.ctrlKey || event.metaKey || event.shiftKey) : event.ctrlKey || event.metaKey;
	if (submit) { event.preventDefault(); void send(); }
}

async function send(): Promise<void> {
	if (!canSend.value || sending.value) return;
	const request = epoch; const account = me.id;
	const version = draftVersion;
	const snapshot = { text: text.value || null, fileId: file.value?.id, ...(props.replyTo ? { replyId: props.replyTo.id } : {}) };
	sending.value = true; error.value = ''; emit('typing', false);
	try {
		const message = props.editingMessage ? await misskeyApi('chat/messages/edit', { messageId: props.editingMessage.id, text: snapshot.text })
			: props.user ? await misskeyApi('chat/messages/create-to-user', { toUserId: props.user.id, ...snapshot })
			: await misskeyApi('chat/messages/create-to-room', { toRoomId: props.room!.id, ...snapshot });
		if (!current(request, account)) return;
		if (version === draftVersion) { if (props.editingMessage) emit('cancelEdit'); else { text.value = ''; file.value = null; saveDraft(); emit('cancelReply'); } }
		emit('sent', message);
	} catch { if (current(request, account)) error.value = i18n.ts.zalip._chatUi.sendError; } finally { if (current(request, account)) sending.value = false; }
}

async function upload(files: File[]): Promise<void> {
	if (!allowed.value || busy.value || props.editingMessage) return;
	if (files.length !== 1) { error.value = i18n.ts.onlyOneFileCanBeAttached; return; }
	const request = epoch; const account = me.id; uploading.value = true; error.value = '';
	try { const result = await os.launchUploader(files, { multiple: false }); if (current(request, account)) file.value = result[0] ?? null; } catch { if (current(request, account)) error.value = i18n.ts.zalip._chatUi.uploadError; } finally { if (current(request, account)) uploading.value = false; }
}

function onPaste(event: ClipboardEvent): void { const files = Array.from(event.clipboardData?.files ?? []); if (files.length) { event.preventDefault(); void upload(files); } }

function onDragover(event: DragEvent): void { if (event.dataTransfer && allowed.value && !busy.value) event.dataTransfer.dropEffect = 'copy'; }

function onDrop(event: DragEvent): void { if (!allowed.value || busy.value || props.editingMessage || !event.dataTransfer) return; const files = Array.from(event.dataTransfer.files); if (files.length) { void upload(files); return; } const selected = getDragData(event, 'driveFiles'); if (selected?.length) file.value = selected[0]; }

async function chooseFile(event: MouseEvent): Promise<void> {
	if (!allowed.value || busy.value || props.editingMessage) return;
	const request = epoch; const account = me.id;
	try { const selected = await selectFile({ anchorElement: event.currentTarget, multiple: false, label: i18n.ts.selectFile }); if (current(request, account)) file.value = selected; } catch { /* Canceling a picker is not a failed upload. */ }
}

function insertEmoji(event: MouseEvent): void {
	if (!allowed.value || busy.value || !(event.currentTarget instanceof HTMLElement)) return;
	const request = epoch; const account = me.id;
	let position = textareaEl.value?.selectionStart ?? text.value.length; let end = textareaEl.value?.selectionEnd ?? position; pickerOpen.value = true;
	emojiPicker.show(event.currentTarget, emoji => { if (!current(request, account)) return; text.value = text.value.slice(0, position) + emoji + text.value.slice(end); position += emoji.length; end = position; }, () => { pickerOpen.value = false; void nextTick(() => textareaEl.value?.focus()); });
}

function releaseMicrophone(): void { microphone?.getTracks().forEach(track => track.stop()); microphone = null; if (recordingTimer) window.clearTimeout(recordingTimer); recordingTimer = null; }

function cancelRecording(): void { voiceGeneration++; if (recorder?.state === 'recording') recorder.stop(); recorder = null; releaseMicrophone(); recording.value = false; voicePending.value = false; }

function stopRecording(): void { if (recorder?.state === 'recording') recorder.stop(); }

async function recordVoice(): Promise<void> {
	if (!allowed.value || busy.value || !voiceSupported || props.editingMessage) return;
	const request = epoch; const account = me.id;
	const generation = ++voiceGeneration; voicePending.value = true;
	try {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		if (!current(request, account) || !props.active || generation !== voiceGeneration) { stream.getTracks().forEach(track => track.stop()); return; }
		microphone = stream; voicePending.value = false; recording.value = true;
		const capture = new MediaRecorder(stream); recorder = capture; const chunks: Blob[] = [];
		capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
		capture.onstop = () => { stream.getTracks().forEach(track => track.stop()); if (generation !== voiceGeneration) return; releaseMicrophone(); recorder = null; recording.value = false; if (current(request, account) && chunks.length) { const mime = capture.mimeType || 'audio/webm'; void upload([new File(chunks, `voice-${Date.now()}.${mime.includes('mp4') ? 'm4a' : 'webm'}`, { type: mime })]); } };
		capture.onerror = () => { if (generation !== voiceGeneration) return; cancelRecording(); if (current(request, account)) error.value = i18n.ts.zalip._chatUi.recordingError; };
		capture.start(); recordingTimer = window.setTimeout(stopRecording, 120000);
	} catch { if (generation === voiceGeneration) { releaseMicrophone(); recording.value = false; if (current(request, account)) error.value = i18n.ts.zalip._chatUi.recordingError; } } finally { if (generation === voiceGeneration) voicePending.value = false; }
}

onBeforeUnmount(() => { saveDraft(); alive = false; epoch++; cancelRecording(); autocomplete?.detach(); emit('typing', false); });
</script>

<style lang="scss" module>
.root { min-width: 0; }
.capsule { display: flex; align-items: flex-end; gap: 2px; min-height: 50px; padding: 3px; box-sizing: border-box; border: 1px solid var(--MI_THEME-divider); border-radius: 28px; background: var(--MI_THEME-panelHighlight); }
.capsule:focus-within { border-color: var(--MI_THEME-accent); }
.textarea { display: block; flex: 1; min-width: 0; box-sizing: border-box; width: 100%; min-height: 44px; max-height: 144px; resize: none; field-sizing: content; padding: 11px 4px; border: 0; color: var(--MI_THEME-fg); background: transparent; font: inherit; font-size: 15px; line-height: 22px; }
.textarea:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; border-radius: 10px; }
.attachment, .recording, .context { display: flex; align-items: center; gap: 6px; }
.attachment, .context { padding: 6px 10px; margin-bottom: 8px; border-radius: 16px; background: var(--MI_THEME-accentedBg); > span, > div { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.context > div { display: grid; gap: 4px; font-size: 12px; > span { overflow: hidden; text-overflow: ellipsis; } strong { color: var(--MI_THEME-accent); } }
.button { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; font-size: 21px; &:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 2px; } &:disabled { opacity: .45; } }
.send { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.counter { display: block; margin: 5px 12px 0; text-align: end; font-size: 11px; color: var(--MI_THEME-fgTransparentWeak); }
.overLimit { color: var(--MI_THEME-error); }
.error, .hint { margin: 6px 10px; font-size: 12px; color: var(--MI_THEME-error); }
.hint { color: var(--MI_THEME-fgTransparentWeak); }
.recording { padding: 6px; font-size: 13px; color: var(--MI_THEME-error); }
@media (prefers-reduced-motion: reduce) { .root :global(.ti-spin) { animation: none; } }
</style>
