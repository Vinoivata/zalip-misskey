<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" :preferType="mobile ? 'drawer' : 'dialog'" :zPriority="'high'" @click="dismiss" @closed="emit('closed')" @esc="dismiss">
	<section :class="$style.root" :style="{ '--rating-color': ratingColor }" role="dialog" aria-modal="true" :aria-labelledby="titleId">
		<header :class="$style.header">
			<h2 :id="titleId">{{ i18n.ts.zalip.ratingDialogTitle }}</h2>
			<button type="button" class="_button" :class="$style.close" :disabled="saving" :aria-label="i18n.ts.close" @click="dismiss"><i class="ti ti-x" aria-hidden="true"></i></button>
		</header>
		<div v-if="title" :class="$style.workHeader">
			<div :class="$style.poster"><img v-if="posterUrl" :src="posterUrl" alt=""><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
			<h3>{{ title }}</h3><p v-if="subtitle">{{ subtitle }}</p>
		</div>
		<div :class="$style.picker">
			<div :class="$style.selection" aria-hidden="true"></div>
			<div ref="rail" :class="[$style.rail, { [$style.dragging]: dragging, [$style.locked]: saving }]" role="radiogroup" :aria-label="i18n.ts.zalip.ratingTitle" :aria-describedby="hintId" @scroll="onScroll" @keydown="onKeydown" @pointerdown="startDrag" @pointermove="moveDrag" @pointerup="endDrag" @pointercancel="endDrag" @lostpointercapture="endDrag">
				<button v-for="rating in ratings" :key="rating" type="button" role="radio" class="_button" :class="$style.number" :aria-checked="selectedRating === rating" :tabindex="selectedRating === rating ? 0 : -1" :disabled="saving" :aria-label="i18n.tsx.zalip.ratingValue({ rating: rating.toString() })" @click="selectRating(rating)">{{ rating }}</button>
			</div>
		</div>
		<p :id="hintId" :class="$style.hint">{{ i18n.ts.zalip.ratingSwipeHint }}</p>
		<div :class="$style.actions"><button type="button" class="_button" :class="$style.submit" :disabled="saving" @click="save"><i v-if="saving" class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.ratingSubmit }}</button></div>
		<p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
		<section :class="$style.related" :aria-labelledby="relatedId" :aria-busy="relatedPending">
			<h3 :id="relatedId" aria-live="polite">{{ i18n.tsx.zalip.ratingYourTitles({ rating: selectedRating }) }}</h3>
			<p v-if="relatedPending" :class="$style.empty">{{ i18n.ts.zalip.libraryLoading }}</p>
			<div v-else-if="relatedError" :class="$style.empty"><p role="alert">{{ i18n.ts.zalip.libraryLoadFailed }}</p><button type="button" class="_button" :class="$style.retry" :disabled="saving" @click="emit('retry')">{{ i18n.ts.retry }}</button></div>
			<div v-else-if="similarWorks.length" :class="$style.relatedRail">
				<figure v-for="entry in similarWorks" :key="entry.work.id" :class="$style.relatedCard">
					<div :class="$style.relatedPoster"><img v-if="entry.work.posterPath" :src="`https://image.tmdb.org/t/p/w342${entry.work.posterPath}`" alt="" loading="lazy"><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
					<figcaption>{{ entry.work.title }}</figcaption>
				</figure>
			</div>
			<p v-else :class="$style.empty">{{ i18n.ts.zalip.ratingNoSimilarTitles }}</p>
		</section>
	</section>
</MkModal>
</template>

<script lang="ts">
export type RatedLibraryEntry = {
	personalRating: number | null;
	work: { id: string; title: string; posterPath: string | null };
};
</script>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	initialRating?: number;
	saving?: boolean;
	error?: string | null;
	title?: string;
	subtitle?: string;
	posterUrl?: string;
	workId?: string;
	ratedWorks?: RatedLibraryEntry[];
	relatedPending?: boolean;
	relatedError?: boolean;
}>(), { initialRating: 0, saving: false, error: null, ratedWorks: () => [], relatedPending: false, relatedError: false });
const emit = defineEmits<{
	(ev: 'save', rating: number): void;
	(ev: 'closed'): void;
	(ev: 'retry'): void;
}>();

const modal = useTemplateRef('modal');
const rail = useTemplateRef('rail');
const mobileQuery = window.matchMedia('(max-width: 600px)');
const mobile = ref(mobileQuery.matches);
const titleId = useId();
const hintId = useId();
const relatedId = useId();
const ratings = Array.from({ length: 10 }, (_, index) => index + 1);
const selectedRating = ref(7);
const dragging = ref(false);
let drag: { id: number; x: number; scroll: number; moved: boolean } | null = null;
let suppressClickUntil = 0;
let resizeObserver: ResizeObserver | undefined;
const similarWorks = computed(() => props.ratedWorks.filter(entry => entry.work.id !== props.workId && entry.personalRating === selectedRating.value));
const ratingColor = computed(() => selectedRating.value <= 4 ? 'var(--MI_THEME-error)' : selectedRating.value <= 6 ? 'var(--MI_THEME-fgTransparentWeak)' : 'var(--MI_THEME-success)');

function updateMobile(): void { mobile.value = mobileQuery.matches; }

function itemWidth(): number { return (rail.value?.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0; }

function centerSelection(): void {
	if (rail.value) rail.value.scrollLeft = (selectedRating.value - 1) * itemWidth();
}

function onScroll(): void {
	const width = itemWidth();
	if (props.saving || !rail.value || width === 0) return;
	selectedRating.value = Math.max(1, Math.min(10, Math.round(rail.value.scrollLeft / width) + 1));
}

function selectRating(rating: number): void {
	if (props.saving || Date.now() < suppressClickUntil) return;
	selectedRating.value = rating;
	centerSelection();
}

function onKeydown(event: KeyboardEvent): void {
	if (props.saving) return;
	const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
	if (!offset && event.key !== 'Home' && event.key !== 'End') return;
	event.preventDefault();
	selectedRating.value = event.key === 'Home' ? 1 : event.key === 'End' ? 10 : Math.max(1, Math.min(10, selectedRating.value + offset));
	centerSelection();
	(rail.value?.children[selectedRating.value - 1] as HTMLElement | undefined)?.focus({ preventScroll: true });
}

function startDrag(event: PointerEvent): void {
	if (props.saving || event.pointerType !== 'mouse' || event.button !== 0 || !rail.value) return;
	drag = { id: event.pointerId, x: event.clientX, scroll: rail.value.scrollLeft, moved: false };
	dragging.value = true;
}

function moveDrag(event: PointerEvent): void {
	if (!drag || drag.id !== event.pointerId || !rail.value || props.saving) return;
	if ((event.buttons & 1) === 0) { endDrag(); return; }
	const delta = drag.x - event.clientX;
	if (!drag.moved && Math.abs(delta) < 6) return;
	drag.moved = true;
	rail.value.setPointerCapture(event.pointerId);
	rail.value.scrollLeft = drag.scroll + delta;
	onScroll();
}

function endDrag(): void {
	if (!drag) return;
	const id = drag.id;
	const moved = drag.moved;
	drag = null;
	dragging.value = false;
	if (moved) {
		suppressClickUntil = Date.now() + 250;
		void nextTick(centerSelection);
	}
	if (rail.value?.hasPointerCapture(id)) rail.value.releasePointerCapture(id);
}

function dismiss(): void {
	if (!props.saving) modal.value?.close();
}

function save(): void {
	if (props.saving) return;
	endDrag();
	onScroll();
	centerSelection();
	emit('save', selectedRating.value);
}

watch(() => props.initialRating, (rating) => {
	selectedRating.value = Number.isFinite(rating) && rating > 0 ? Math.min(10, Math.max(1, Math.round(rating))) : 7;
	void nextTick(centerSelection);
}, { immediate: true });

onMounted(() => {
	mobileQuery.addEventListener('change', updateMobile);
	window.addEventListener('pointerup', endDrag);
	resizeObserver = new ResizeObserver(centerSelection);
	if (rail.value) resizeObserver.observe(rail.value);
	centerSelection();
});
onBeforeUnmount(() => {
	resizeObserver?.disconnect();
	mobileQuery.removeEventListener('change', updateMobile);
	window.removeEventListener('pointerup', endDrag);
});
</script>

<style lang="scss" module>
.root {
	--MI_THEME-panel: var(--zalip-social-panel);
	--MI_THEME-bg: var(--zalip-social-bg);
	--MI_THEME-panelHighlight: var(--zalip-social-raised);
	--MI_THEME-fg: var(--zalip-social-fg);
	--MI_THEME-fgTransparentWeak: var(--zalip-social-muted);
	margin: auto;
	width: min(580px, calc(100vw - 32px));
	max-width: 100%;
	max-height: calc(100dvh - 64px);
	overflow-y: auto;
	overscroll-behavior: contain;
	box-sizing: border-box;
	border-radius: 24px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	box-shadow: 0 24px 70px var(--MI_THEME-shadow);
	padding-bottom: max(24px, env(safe-area-inset-bottom));
}
.header { position: sticky; top: 0; z-index: 2; display: grid; place-items: center; height: 70px; background: var(--MI_THEME-panel); }
.header h2 { margin: 0; font-size: 19px; font-weight: 750; }
.close { position: absolute; right: 18px; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--MI_THEME-panelHighlight); font-size: 21px; }
.close i::before { font-size: 1em; }
.workHeader { display: grid; justify-items: center; text-align: center; padding: 10px 28px 0; }
.poster { display: grid; place-items: center; width: clamp(125px, 33vw, 160px); aspect-ratio: 2 / 3; background: var(--MI_THEME-panelHighlight); font-size: 40px; overflow: hidden; }
.poster img, .relatedPoster img { display: block; width: 100%; height: 100%; object-fit: cover; }
.workHeader h3 { margin: 18px 0 0; font-size: 19px; line-height: 1.3; }
.workHeader p { margin: 5px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 16px; }
.picker { position: relative; margin-top: 22px; }
.selection { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: 136px; height: 136px; border-radius: 50%; background: var(--MI_THEME-bg); pointer-events: none; }
.rail { position: relative; display: flex; overflow-x: auto; padding-inline: calc(50% - 52px); scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; user-select: none; cursor: grab; }
.rail::-webkit-scrollbar, .relatedRail::-webkit-scrollbar { display: none; }
.rail.dragging { scroll-snap-type: none; cursor: grabbing; }
.rail.locked { overflow-x: hidden; cursor: default; }
.number { flex: 0 0 104px; width: 104px; height: 150px; display: grid; place-items: center; scroll-snap-align: center; font-size: 50px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; transition: color 120ms ease; }
.number[aria-checked=true] { font-size: 76px; color: var(--rating-color); }
.number:focus-visible { outline: 2px solid var(--rating-color); outline-offset: -10px; border-radius: 50%; }
.hint { margin: 8px 16px 20px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }
.actions { display: flex; justify-content: center; padding: 0 24px; }
.submit { min-height: 50px; padding: 12px 28px; border-radius: 99px; background: var(--rating-color); color: var(--MI_THEME-panel); font-size: 16px; font-weight: 750; display: flex; justify-content: center; align-items: center; gap: 8px; }
.submit:disabled { opacity: 0.55; cursor: wait; }
.error { color: var(--MI_THEME-error); margin: 14px 24px 0; text-align: center; }
.related { margin-top: 36px; }
.related h3 { margin: 0 20px 22px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); font-size: 15px; font-weight: 500; }
.relatedRail { display: flex; gap: 16px; overflow-x: auto; overscroll-behavior-x: contain; padding: 0 20px; scrollbar-width: none; }
.relatedCard { flex: 0 0 132px; margin: 0; min-width: 0; }
.relatedPoster { display: grid; place-items: center; aspect-ratio: 2 / 3; background: var(--MI_THEME-panelHighlight); font-size: 28px; overflow: hidden; }
.relatedCard figcaption { margin-top: 8px; font-size: 12px; line-height: 1.35; }
.empty { margin: 0; padding: 0 28px 12px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; font-size: 13px; line-height: 1.5; }
.retry { padding: 8px 18px; border-radius: 99px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); }
@media (max-width: 600px) { .root { width: 100vw; height: 100dvh; max-height: 100dvh; border-radius: 0; } }
@media (prefers-reduced-motion: reduce) { .number { transition: none; } }
</style>
