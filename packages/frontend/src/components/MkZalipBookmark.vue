<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button ref="target" type="button" class="_button" :class="[$style.root, { [$style.saved]: saved }]" :aria-label="saved ? i18n.ts.unfavorite : i18n.ts.favorite" :aria-pressed="saved" :aria-busy="busy" :disabled="mock || busy" @focus="load" @click="toggle">
	<MkZalipIcon name="bookmark" :filled="saved"/>
</button>
</template>

<script lang="ts" setup>
import { computed, inject, onActivated, onBeforeUnmount, onDeactivated, ref, useTemplateRef, watch } from 'vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { DI } from '@/di.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { changeNoteBookmark, noteBookmarkActor, noteBookmarkState } from '@/utility/zalip-note-bookmarks.js';
import { sameNoteStateActor } from '@/utility/zalip-note-state.js';
import * as os from '@/os.js';

const props = withDefaults(defineProps<{ noteId: string; mock?: boolean }>(), { mock: false });
const injectedMock = inject(DI.mock, false);
const mock = computed(() => props.mock || injectedMock);
const target = useTemplateRef<HTMLButtonElement>('target');
const active = ref(true);
const state = computed(() => mock.value ? undefined : noteBookmarkState.peek(props.noteId));
const saved = computed(() => state.value?.state?.isFavorited ?? false);
const busy = computed(() => state.value?.changing ?? false);
let observer: IntersectionObserver | undefined;
let generation = 0;
let alive = true;

function valid(): boolean { return alive && active.value && !mock.value && !!$i && window.document.visibilityState === 'visible'; }

function load(): void { if (valid()) void noteBookmarkState.load(props.noteId); }

function stop(): void { generation++; observer?.disconnect(); observer = undefined; }

function observe(): void {
	stop();
	const element = target.value;
	if (!element || !valid() || typeof IntersectionObserver === 'undefined') return;
	const epoch = generation;
	observer = new IntersectionObserver(entries => {
		if (epoch !== generation || !valid()) return;
		if (entries.some(entry => entry.target === element && entry.isIntersecting && entry.intersectionRatio > 0)) load();
	}, { rootMargin: '0px', threshold: 0.01 });
	observer.observe(element);
}

watch([target, () => props.noteId, () => $i?.id, () => $i?.token, mock, active], observe, { immediate: true, flush: 'post' });
window.document.addEventListener('visibilitychange', observe);
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; stop(); });
onBeforeUnmount(() => { alive = false; stop(); window.document.removeEventListener('visibilitychange', observe); });

async function toggle(): Promise<void> {
	if (mock.value || busy.value) return;
	const actor = noteBookmarkActor();
	if (!actor) { await pleaseLogin(); return; }
	const noteId = props.noteId;
	const current = (): boolean => valid() && props.noteId === noteId && sameNoteStateActor(actor, noteBookmarkActor());
	try {
		const result = await changeNoteBookmark(noteId, undefined, current);
		if (result === 'unavailable' && current()) await os.alert({ type: 'error', text: i18n.ts.cannotLoad });
	} catch {
		if (current()) await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	}
}
</script>

<style lang="scss" module>
.root { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 40px; color: var(--zalip-social-muted); > svg { width: 21px; height: 21px; } }
.saved { color: var(--MI_THEME-warn); }
</style>
