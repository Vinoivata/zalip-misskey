<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<span ref="rootEl" :class="$style.root" aria-hidden="true" data-zalip-reaction-float>
	<span v-for="(reaction, index) in flight" :key="`${revision}:${index}`" :class="$style.emoji" :style="{ '--float-delay': `${index * 32}ms`, '--float-duration': `${2000 + index % 4 * 150}ms`, '--float-size': `${14 + index % 4 * 2}px`, '--float-drift': `${(index % 3 - 1) * 22}px`, '--float-origin': `${index % 3 * 13}px` }">
		<MkReactionIcon :reaction="reaction" :emojiUrl="reactionEmojis[reaction.substring(1, reaction.length - 1)]"/>
	</span>
</span>
</template>

<script lang="ts" setup>
import { onActivated, onBeforeUnmount, onDeactivated, ref, useTemplateRef, watch } from 'vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import { prefer } from '@/preferences.js';

const props = withDefaults(defineProps<{
	noteId: string;
	target: HTMLElement | null | undefined;
	reactions: Record<string, number>;
	reactionEmojis: Record<string, string>;
	myReaction?: string | null;
	enabled?: boolean;
}>(), { enabled: true, myReaction: null });

const flight = ref<string[]>([]);
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const active = ref(true);
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = ref(reduced.matches);
let observer: IntersectionObserver | undefined;
let timer: number | undefined;
let generation = 0;
let revision = 0;
let visible = false;
let alive = true;
let lastPlayed = -Infinity;

function clearFlight(): void {
	if (timer !== undefined) window.clearTimeout(timer);
	timer = undefined;
	flight.value = [];
}

function eligible(): boolean {
	return alive && active.value && props.enabled && props.myReaction != null && prefer.s.animation && !reducedMotion.value && window.document.visibilityState === 'visible';
}

function play(): void {
	if (!eligible() || props.myReaction == null || Date.now() - lastPlayed < 4000) return;
	const reaction = props.myReaction;
	const count = props.reactions[reaction];
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return;
	// Animate the viewer's selected reaction, never unrelated votes on every post.
	// The finite burst remains bounded even when a post has millions of reactions.
	const next = Array.from({ length: Math.min(count, 31) }, () => reaction);
	clearFlight();
	lastPlayed = Date.now();
	revision++;
	flight.value = next;
	timer = window.setTimeout(clearFlight, 3600);
}

function observe(): void {
	const epoch = ++generation;
	observer?.disconnect();
	observer = undefined;
	visible = false;
	clearFlight();
	// Watch the actual flight area, not the top of a potentially very long post.
	const element = rootEl.value;
	if (!props.target || !element || !eligible() || typeof IntersectionObserver === 'undefined') return;
	const height = element.getBoundingClientRect().height;
	const threshold = height > 0 ? Math.min(0.5, 80 / height) : 0.1;
	observer = new IntersectionObserver(entries => {
		if (epoch !== generation || !eligible()) return;
		const entry = entries.find(item => item.target === element);
		if (!entry) return;
		const entering = entry.isIntersecting && entry.intersectionRatio >= threshold;
		if (!entering) clearFlight();
		if (entering && !visible) play();
		visible = entering;
	}, { rootMargin: '0px', threshold });
	observer.observe(element);
}

function motionChanged(): void { reducedMotion.value = reduced.matches; }

watch(() => [props.noteId, props.myReaction], () => { lastPlayed = -Infinity; }, { flush: 'sync' });
watch([rootEl, () => props.target, () => props.noteId, () => props.myReaction, () => props.enabled, () => prefer.s.animation, active, reducedMotion], observe, { immediate: true, flush: 'post' });
watch([() => props.myReaction, () => props.myReaction == null ? 0 : props.reactions[props.myReaction]], ([reaction], [previousReaction]) => {
	// A changed selection is owned by the fresh observer; only a late count
	// for the same selection may start a burst without a new intersection.
	if (reaction === previousReaction && visible && !flight.value.length) play();
}, { flush: 'post' });

reduced.addEventListener('change', motionChanged);
window.document.addEventListener('visibilitychange', observe);
onActivated(() => { active.value = true; });
onDeactivated(() => { active.value = false; observe(); });
onBeforeUnmount(() => {
	alive = false;
	generation++;
	observer?.disconnect();
	clearFlight();
	reduced.removeEventListener('change', motionChanged);
	window.document.removeEventListener('visibilitychange', observe);
});
</script>

<style lang="scss" module>
.root { position: absolute; z-index: 2; inset-inline-end: 18px; bottom: 34px; width: 90px; height: 190px; overflow: clip; pointer-events: none; user-select: none; }
.emoji { position: absolute; bottom: 0; inset-inline-end: var(--float-origin); display: block; width: var(--float-size); height: var(--float-size); font-size: var(--float-size); line-height: 1; opacity: 0; animation: floatReaction var(--float-duration) ease-out var(--float-delay) both; > * { width: 100%; height: 100%; object-fit: contain; } }
@keyframes floatReaction {
	0% { opacity: 0; transform: translate(0, 12px) scale(.7) rotate(-8deg); }
	15% { opacity: .9; }
	65% { opacity: .8; }
	100% { opacity: 0; transform: translate(var(--float-drift), -155px) scale(1.15) rotate(10deg); }
}
@media (prefers-reduced-motion: reduce) { .root { display: none; } .emoji { animation: none; } }
</style>
