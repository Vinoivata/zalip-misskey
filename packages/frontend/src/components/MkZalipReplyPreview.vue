<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="target" :class="[$style.root, { [$style.empty]: !reply }]" data-zalip-post-interactive>
	<template v-if="reply">
		<MkAvatar :class="$style.avatar" :user="reply.user" :decorations="[]" link preview/>
		<MkA :class="[$style.bubble, { [$style.withTip]: tipOffset !== null }]" :style="tipOffset !== null ? { '--reply-tip-offset': `${tipOffset}px` } : undefined" data-zalip-reply-bubble :to="notePage(reply)" :aria-label="`${i18n.tsx.noteOf({ user: reply.user.name || reply.user.username })}: ${summary}`">
			<MkAvatar :class="$style.bubbleAvatar" :user="reply.user" :decorations="[]" aria-hidden="true"/>
			<Mfm :class="$style.text" :text="summary" :plain="true" :author="reply.user" :nyaize="'respect'" :emojiUrls="reply.emojis"/>
		</MkA>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import { useMediaActivation } from '@/composables/use-media-activation.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { notePage } from '@/filters/note.js';
import { checkWordMute } from '@/utility/check-word-mute.js';
import { getNoteSummary } from '@/utility/get-note-summary.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { replyPreviewCache } from '@/utility/zalip-reply-preview.js';

const props = defineProps<{ noteId: string; replyCount: number; replyAnchor?: HTMLElement | null }>();
const emit = defineEmits<{ (ev: 'visible', visible: boolean): void }>();
const target = useTemplateRef<HTMLElement>('target');
const active = useMediaActivation(target);
const reply = shallowRef<Misskey.entities.Note | null>(null);
const tipOffset = ref<number | null>(null);
const summary = computed(() => {
	const characters = Array.from(getNoteSummary(reply.value, { showReply: false, showRenote: false }));
	return characters.slice(0, 180).join('') + (characters.length > 180 ? '…' : '');
});
let request = 0;
let geometry = 0;
let alive = true;
let resizeObserver: ResizeObserver | undefined;
let geometryCleanup: (() => void) | undefined;

function resetTip(): void {
	geometry++;
	resizeObserver?.disconnect();
	resizeObserver = undefined;
	geometryCleanup?.();
	geometryCleanup = undefined;
	tipOffset.value = null;
}

watch([reply, () => props.replyAnchor, () => props.noteId, () => $i?.id], async () => {
	resetTip();
	const epoch = geometry;
	const currentReply = reply.value;
	const anchor = props.replyAnchor;
	const accountId = $i?.id ?? null;
	const noteId = props.noteId;
	if (!currentReply || !anchor) return;
	await nextTick();
	const element = target.value;
	const bubble = element?.querySelector<HTMLElement>('[data-zalip-reply-bubble]');
	const current = () => alive && epoch === geometry && reply.value === currentReply && props.noteId === noteId && props.replyAnchor === anchor && ($i?.id ?? null) === accountId;
	if (!current() || !element || !bubble || !anchor.isConnected) return;
	const update = (): void => {
		if (!current()) return;
		if (!element.isConnected || !bubble.isConnected || !anchor.isConnected) { tipOffset.value = null; return; }
		const icon = anchor.querySelector('svg') ?? anchor;
		const bounds = bubble.getBoundingClientRect();
		const iconBounds = icon.getBoundingClientRect();
		if (bounds.width < 24 || iconBounds.width <= 0) { tipOffset.value = null; return; }
		const center = iconBounds.left + iconBounds.width / 2 - bounds.left;
		tipOffset.value = Math.min(bounds.width - 12, Math.max(12, center));
	};
	if (typeof ResizeObserver !== 'undefined') {
		resizeObserver = new ResizeObserver(update);
		const observed = new Set<Element>([element, bubble, anchor]);
		if (anchor.parentElement) observed.add(anchor.parentElement);
		if (anchor.previousElementSibling) observed.add(anchor.previousElementSibling);
		for (const node of observed) resizeObserver.observe(node);
	}
	window.addEventListener('resize', update, { passive: true });
	window.document.fonts?.addEventListener('loadingdone', update);
	geometryCleanup = () => { window.removeEventListener('resize', update); window.document.fonts?.removeEventListener('loadingdone', update); };
	update();
}, { immediate: true, flush: 'post' });

watch([active, () => props.noteId, () => props.replyCount, () => $i?.id], async ([visible, noteId, replyCount]) => {
	const epoch = ++request;
	reply.value = null;
	if (!visible || replyCount < 1) return;
	const accountId = $i?.id ?? null;
	const credential = $i?.token ?? null;
	const result = await replyPreviewCache.load(accountId, noteId, () => misskeyApi('notes/replies', { noteId, limit: 1 }, credential));
	if (epoch !== request || ($i?.id ?? null) !== accountId || !result) return;
	if ($i && (checkWordMute(result, $i, $i.mutedWords) || checkWordMute(result, $i, $i.hardMutedWords))) return;
	reply.value = result;
}, { immediate: true });

watch(reply, value => emit('visible', value !== null), { immediate: true });
onBeforeUnmount(() => { alive = false; request++; resetTip(); emit('visible', false); });
</script>

<style lang="scss" module>
.root { display: flex; align-items: flex-end; gap: 16px; margin: 8px 0 0 -40px; min-width: 0; }
.empty { height: 1px; margin-top: 0; }
.avatar { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 50%; }
.bubble { position: relative; display: inline-flex; align-items: center; gap: 8px; flex: 0 1 auto; box-sizing: border-box; width: max-content; max-width: calc(100% - 40px); min-width: min(112px, calc(100% - 40px)); padding: 8px; border-radius: 12px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); }
.bubble.withTip::after { content: ''; position: absolute; bottom: -4px; left: var(--reply-tip-offset); width: 8px; height: 8px; background: inherit; transform: translateX(-50%) rotate(45deg); border-radius: 1px; pointer-events: none; }
.bubble:hover { text-decoration: none; background: var(--MI_THEME-buttonHoverBg); }
.bubble:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.bubbleAvatar { flex: 0 0 20px; width: 20px; height: 20px; border-radius: 50%; }
.text { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; line-height: 1.45; }
</style>
