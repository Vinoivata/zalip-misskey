<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal ref="modal" :preferType="mobile ? 'drawer' : 'dialog'" :zPriority="'high'" @click="dismiss" @closed="emit('closed')" @esc="dismiss">
	<section :class="$style.root" :style="{ '--rating-color': ratingColor }" role="dialog" aria-modal="true" :aria-labelledby="titleId">
		<div :class="$style.handle" aria-hidden="true"></div>
		<header :class="$style.header">
			<h2 :id="titleId">{{ ratingDialogTitle }}</h2>
			<button type="button" class="_button" :class="$style.close" :disabled="saving" :aria-label="i18n.ts.close" @click="dismiss"><i class="ti ti-x"></i></button>
		</header>
		<div v-if="title" :class="$style.workHeader"><div :class="$style.poster"><img v-if="posterUrl" :src="posterUrl" alt=""><i v-else class="ti ti-movie" aria-hidden="true"></i><span v-if="communityRating != null">{{ communityRating.toFixed(1) }}</span></div><div><h3>{{ title }}</h3><p v-if="subtitle">{{ subtitle }}</p></div></div>

		<div :class="$style.score" aria-live="polite" aria-atomic="true">
			<strong :class="$style.number">{{ displayedRating }}</strong>
			<p v-if="ratingDescription" :class="$style.description">{{ ratingDescription }}</p>
			<span v-else :class="$style.descriptionPlaceholder" aria-hidden="true"></span>
		</div>

		<div :class="$style.stars" role="group" :aria-label="i18n.ts.zalip.ratingTitle" @mouseleave="previewRating = null">
			<button
				v-for="rating in ratings"
				:key="rating"
				type="button"
				class="_button"
				:class="[$style.star, { [$style.starSelected]: rating <= displayedRating }]"
				:aria-pressed="selectedRating === rating"
				:disabled="saving"
				:aria-label="i18n.tsx.zalip.ratingValue({ rating: rating.toString() })"
				@click="selectRating(rating)"
				@focus="previewRating = rating"
				@blur="previewRating = null"
				@mouseenter="previewRating = rating"
			>
				<i class="ti ti-star-filled" aria-hidden="true"></i>
			</button>
		</div>

		<footer :class="$style.actions">
			<button type="button" class="_button" :class="$style.later" :disabled="saving" @click="later">{{ ratingLater }}</button>
			<button type="button" class="_button" :class="$style.submit" :disabled="selectedRating === 0 || saving" @click="save"><i v-if="saving" class="ti ti-loader-2 ti-spin"></i>{{ ratingSubmit }}</button>
		</footer>
		<p v-if="error" :class="$style.error" role="alert">{{ error }}</p>
	</section>
</MkModal>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, useId, useTemplateRef, watch } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	initialRating?: number;
	saving?: boolean;
	error?: string | null;
	title?: string;
	subtitle?: string;
	posterUrl?: string;
	communityRating?: number | null;
}>(), {
	initialRating: 0,
	saving: false,
	error: null,
});

const emit = defineEmits<{
	(ev: 'save', rating: number): void;
	(ev: 'later'): void;
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const mobileQuery = window.matchMedia('(max-width: 600px)');
const mobile = ref(mobileQuery.matches);

function updateMobile(): void { mobile.value = mobileQuery.matches; }

mobileQuery.addEventListener('change', updateMobile);
onBeforeUnmount(() => mobileQuery.removeEventListener('change', updateMobile));
const titleId = useId();
const ratings = Array.from({ length: 10 }, (_, index) => index + 1);
const selectedRating = ref(0);
const previewRating = ref<number | null>(null);
const displayedRating = computed(() => previewRating.value ?? selectedRating.value);
const ratingDialogTitle = i18n.ts.zalip.ratingDialogTitle;
const ratingLater = i18n.ts.zalip.ratingLater;
const ratingSubmit = i18n.ts.zalip.ratingSubmit;
const ratingDescriptions: Record<number, string> = {
	0: '',
	1: i18n.ts.zalip.ratingAwful,
	2: i18n.ts.zalip.ratingBad,
	3: i18n.ts.zalip.ratingTerrible,
	4: i18n.ts.zalip.ratingWeak,
	5: i18n.ts.zalip.ratingTolerable,
	6: i18n.ts.zalip.ratingNotBad,
	7: i18n.ts.zalip.ratingGood,
	8: i18n.ts.zalip.ratingVeryGood,
	9: i18n.ts.zalip.ratingExcellent,
	10: i18n.ts.zalip.ratingMasterpiece,
};
const ratingDescription = computed(() => ratingDescriptions[displayedRating.value] ?? '');
const ratingColor = computed(() => {
	if (displayedRating.value <= 0) return 'var(--MI_THEME-fgTransparentWeak)';
	if (displayedRating.value <= 3) return 'var(--MI_THEME-error)';
	if (displayedRating.value <= 6) return 'var(--MI_THEME-fg)';
	return 'var(--MI_THEME-success)';
});

watch(() => props.initialRating, (rating) => {
	selectedRating.value = Number.isFinite(rating) ? Math.min(10, Math.max(0, Math.round(rating))) : 0;
}, { immediate: true });

function selectRating(rating: number): void {
	if (props.saving) return;
	selectedRating.value = rating;
	previewRating.value = null;
}

function dismiss(): void {
	if (props.saving) return;
	modal.value?.close();
}

function later(): void {
	emit('later');
	dismiss();
}

function save(): void {
	if (selectedRating.value === 0 || props.saving) return;
	emit('save', selectedRating.value);
}
</script>

<style lang="scss" module>
.root {
	width: min(600px, calc(100vw - 32px));
	max-width: 100%;
	margin: auto;
	box-sizing: border-box;
	padding: 24px;
	border-radius: 24px;
	background: var(--MI_THEME-panel);
	max-height: calc(100dvh - 24px);
	overflow-y: auto;
	box-shadow: 0 24px 70px var(--MI_THEME-shadow);
}

.handle { display: none; width: 36px; height: 4px; margin: -10px auto 18px; border-radius: 99px; background: var(--MI_THEME-fgTransparentWeak); }
.workHeader { display: grid; grid-template-columns: 64px minmax(0, 1fr); align-items: center; gap: 16px; margin-top: 18px; padding-bottom: 18px; border-bottom: 1px solid var(--MI_THEME-divider); }
.workHeader h3 { margin: 0 0 5px; font-size: 20px; line-height: 1.2; }
.workHeader p { margin: 0; font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); }
.poster { position: relative; display: grid; place-items: center; width: 64px; aspect-ratio: 2 / 3; background: var(--MI_THEME-panelHighlight); }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster span { position: absolute; top: 4px; left: 4px; padding: 3px 5px; border-radius: 4px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 11px; font-weight: 700; }

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 18px;
}

.header h2 {
	margin: 0;
	font-size: 1.2rem;
	letter-spacing: -0.02em;
}

.close {
	display: grid;
	flex: 0 0 auto;
	place-items: center;
	width: 34px;
	height: 34px;
	border-radius: 50%;
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
	font-size: 1.5rem;
}

.score {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 154px;
	padding-block: 12px;
	color: var(--rating-color);
	text-align: center;
}

.number {
	font-size: clamp(3.1rem, 8vw, 4.25rem);
	font-variant-numeric: tabular-nums;
	letter-spacing: -0.08em;
	line-height: 1;
}

.description, .descriptionPlaceholder {
	min-height: 1.45em;
	margin: 18px 0 0;
	font-size: clamp(1.2rem, 3vw, 1.65rem);
	font-weight: 800;
	letter-spacing: -0.025em;
}

.stars {
	display: grid;
	grid-template-columns: repeat(10, minmax(0, 1fr));
	gap: 0;
	margin: 0 0 24px;
}

.star {
	display: grid;
	place-items: center;
	min-width: 0;
	min-height: 44px;
	padding: 2px 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: clamp(18px, 5.7vw, 36px);
	line-height: 1;
	transition: color 0.15s ease, transform 0.15s ease;
}

.star i {
	display: block;
}
.star i::before, .close i::before { font-size: 1em; }

.star:hover, .star:focus-visible {
	transform: translateY(-3px) scale(1.08);
}

.star:focus-visible {
	border-radius: 8px;
	outline: 2px solid var(--MI_THEME-accent);
	outline-offset: 2px;
}

.starSelected {
	color: var(--rating-color);
}

.actions {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 7px;
}

.actions button {
	min-height: 54px;
	border-radius: 16px;
	font-size: 1rem;
	font-weight: 750;
}

.later {
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
}

.submit {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.submit:disabled {
	background: color-mix(in srgb, var(--MI_THEME-accent) 42%, var(--MI_THEME-panelHighlight));
	color: var(--MI_THEME-fgTransparentWeak);
	cursor: default;
}

.error { color: var(--MI_THEME-error); margin: 14px 0 0; text-align: center; }

@media (max-width: 600px) {
	.root { width: 100%; padding: 24px 20px max(20px, env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; }
	.handle { display: block; }
	.score { min-height: 142px; }
	.actions button { min-height: 52px; border-radius: 15px; font-size: 0.93rem; }
}

</style>
