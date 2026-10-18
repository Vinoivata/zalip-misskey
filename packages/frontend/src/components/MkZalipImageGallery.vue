<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="items.length" :class="$style.root">
	<div ref="viewport" :class="$style.viewport" role="group" :aria-label="label ?? i18n.ts.images" :aria-busy="opening" @scroll.passive="onGalleryScroll" @keydown="onGalleryKeydown">
		<button
			v-for="(image, index) in items"
			:key="image.url"
			type="button"
			class="_button"
			:class="$style.slide"
			data-carousel-item
			:data-preview-index="index"
			:aria-label="`${image.alt || label || i18n.ts.image} (${index + 1} / ${items.length})`"
			@click.stop="openGallery(index)"
		>
			<img
				v-if="!prefer.s.dataSaver.media && previewIndexes.has(index) && preview(image)"
				:src="preview(image) ?? undefined"
				:alt="image.alt"
				:class="$style.image"
				:width="image.width ?? 1280"
				:height="image.height ?? 720"
				loading="lazy"
				decoding="async"
				@error="onImageError"
			>
			<span v-else :class="$style.placeholder"><i class="ti ti-photo" aria-hidden="true"></i><span>{{ i18n.ts.clickToShow }}</span></span>
		</button>
	</div>
	<template v-if="items.length > 1">
		<button type="button" class="_button" :class="[$style.control, $style.previous]" :aria-label="i18n.ts.zalip._importer.previous" :disabled="previousDisabled" @click.stop="moveBy(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
		<span :class="$style.counter" aria-live="polite" aria-atomic="true">{{ activeIndex + 1 }} / {{ items.length }}</span>
		<button type="button" class="_button" :class="[$style.control, $style.next]" :aria-label="i18n.ts.next" :disabled="nextDisabled" @click.stop="moveBy(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
	</template>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import type { Content } from '@/components/MkLightbox.item.vue';
import type { NormalizedZalipGalleryImage, ZalipGalleryImage } from '@/utility/zalip-image-gallery.js';
import { normalizeZalipGallery } from '@/utility/zalip-image-gallery.js';
import { useMediaCarousel } from '@/composables/use-media-carousel.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import * as os from '@/os.js';

const props = defineProps<{
	images: readonly ZalipGalleryImage[];
	label?: string;
}>();

const viewport = useTemplateRef('viewport');
const items = computed(() => normalizeZalipGallery(props.images));
const count = computed(() => items.value.length);
const enabled = computed(() => count.value > 1);
const broken = ref<ReadonlySet<string>>(new Set());
const identity = computed(() => JSON.stringify(items.value.map(image => image.url)));
const previewIdentity = computed(() => JSON.stringify(items.value.map(image => [image.url, image.thumbnailUrl])));
const previewIndexes = ref<ReadonlySet<number>>(new Set([0, 1, 2]));
const opening = ref(false);
const { activeIndex, keyboardIndex, previousDisabled, nextDisabled, onScroll, moveBy, onKeydown } = useMediaCarousel(viewport, count, enabled, () => prefer.s.animation, () => identity.value);
type Viewer = { closed: boolean; disposed: boolean; dispose?: () => void };
let viewer: Viewer | null = null;
let previewObserver: IntersectionObserver | undefined;
let observation = 0;
let alive = true;

function isCurrentViewer(current: Viewer): boolean { return alive && !current.closed && viewer === current; }

function disposeViewer(current: Viewer): void {
	current.closed = true;
	if (current.dispose && !current.disposed) { current.disposed = true; current.dispose(); }
	if (viewer === current) { viewer = null; opening.value = false; }
}

function updateFallbackPreviews(): void {
	if (typeof IntersectionObserver !== 'undefined' || !viewport.value) return;
	const bounds = viewport.value.getBoundingClientRect();
	const slides = Array.from(viewport.value.querySelectorAll<HTMLElement>('[data-carousel-item]'));
	if (bounds.right > bounds.left && slides.some(slide => slide.getBoundingClientRect().width > 0)) {
		previewIndexes.value = new Set(slides.flatMap((slide, index) => {
			const rect = slide.getBoundingClientRect();
			return rect.right >= bounds.left - rect.width && rect.left <= bounds.right + rect.width ? [index] : [];
		}));
	} else {
		previewIndexes.value = new Set([activeIndex.value - 1, activeIndex.value, activeIndex.value + 1, ...(activeIndex.value === 0 ? [2] : [])].filter(index => index >= 0 && index < count.value));
	}
}

async function observePreviews(): Promise<void> {
	const epoch = ++observation;
	previewObserver?.disconnect(); previewObserver = undefined;
	previewIndexes.value = new Set([0, 1, 2].filter(index => index < count.value));
	await nextTick();
	const element = viewport.value;
	if (!alive || epoch !== observation || !element) return;
	if (typeof IntersectionObserver === 'undefined') { updateFallbackPreviews(); return; }
	const nearby = new Map<number, boolean>();
	previewObserver = new IntersectionObserver(entries => {
		if (!alive || epoch !== observation || viewport.value !== element) return;
		for (const entry of entries) {
			const index = Number((entry.target as HTMLElement).dataset.previewIndex);
			if (Number.isInteger(index) && index >= 0 && index < count.value) nearby.set(index, entry.isIntersecting);
		}
		previewIndexes.value = new Set([...nearby].filter(([, visible]) => visible).map(([index]) => index));
	}, { root: element, rootMargin: '0px 220px', threshold: 0 });
	for (const slide of element.querySelectorAll<HTMLElement>('[data-carousel-item]')) previewObserver.observe(slide);
}

function onGalleryScroll(): void { onScroll(); updateFallbackPreviews(); }

function preview(image: NormalizedZalipGalleryImage): string | null {
	return [image.thumbnailUrl, image.url].find((url): url is string => url != null && !broken.value.has(url)) ?? null;
}

function onImageError(event: Event): void {
	const image = event.currentTarget;
	if (!(image instanceof HTMLImageElement)) return;
	const url = image.getAttribute('src');
	if (url) broken.value = new Set([...broken.value, url]);
}

function onGalleryKeydown(event: KeyboardEvent): void {
	if (!onKeydown(event)) return;
	viewport.value?.querySelectorAll<HTMLButtonElement>('[data-carousel-item]')[keyboardIndex.value]?.focus({ preventScroll: true });
	updateFallbackPreviews();
}

async function openGallery(index: number): Promise<void> {
	const image = items.value.at(index);
	if (!alive || !image) return;
	if (prefer.s.imageNewTab) {
		window.open(image.url, '_blank', 'noopener,noreferrer');
		return;
	}
	if (viewer) return;
	const current: Viewer = { closed: false, disposed: false };
	viewer = current;
	opening.value = true;
	const slides = viewport.value?.querySelectorAll<HTMLButtonElement>('[data-carousel-item]');
	const contents = items.value.map<Content>((item, position) => {
		const sourceElement = slides?.[position]?.querySelector('img');
		return {
			id: item.url,
			type: 'image',
			url: item.url,
			thumbnailUrl: prefer.s.dataSaver.media ? null : item.thumbnailUrl,
			width: item.width,
			height: item.height,
			filename: item.alt || undefined,
			sourceElement: sourceElement ? markRaw(sourceElement) : null,
		};
	});
	try {
		const popup = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(module => module.default), { defaultIndex: index, contents }, { closed: () => disposeViewer(current) });
		current.dispose = popup.dispose;
		if (!isCurrentViewer(current)) disposeViewer(current);
		else opening.value = false;
	} catch {
		// The native loader owns its error dialog; allow an explicit retry.
		disposeViewer(current);
	}
}

watch([previewIdentity, viewport], observePreviews, { immediate: true, flush: 'post' });
watch(previewIdentity, () => { broken.value = new Set(); }, { flush: 'sync' });
watch(identity, () => { if (viewer) disposeViewer(viewer); }, { flush: 'sync' });
watch(activeIndex, updateFallbackPreviews, { flush: 'post' });
window.addEventListener('resize', updateFallbackPreviews, { passive: true });
onBeforeUnmount(() => { alive = false; observation++; previewObserver?.disconnect(); window.removeEventListener('resize', updateFallbackPreviews); if (viewer) disposeViewer(viewer); });

defineExpose({ openGallery });
</script>

<style lang="scss" module>
.root { position: relative; min-width: 0; container-type: inline-size; }

.viewport {
	display: flex;
	gap: 8px;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x proximity;
	scrollbar-width: none;
}
.viewport::-webkit-scrollbar { display: none; }

.slide {
	flex: 0 0 220px;
	display: grid;
	place-items: center;
	width: 220px;
	height: 124px;
	min-width: 0;
	scroll-snap-align: start;
	overflow: hidden;
	border-radius: 12px;
	background: var(--MI_THEME-panelHighlight);
	cursor: zoom-in;

	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
}

.image { display: block; width: 100%; height: 100%; object-fit: cover; }
.placeholder { display: grid; justify-items: center; gap: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; }

.counter { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.control {
	position: absolute;
	top: 50%;
	transform: translateY(-50%);
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	color: var(--MI_THEME-fg);
	opacity: 0;
	transition: opacity .15s;
	> i { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--MI_THEME-divider); border-radius: 50%; background: var(--MI_THEME-panel); box-shadow: 0 2px 8px color-mix(in srgb, var(--MI_THEME-bg) 30%, transparent); }
	&:hover:enabled > i { background: var(--MI_THEME-buttonHoverBg); }
	&:disabled { visibility: hidden; }
	&:focus-visible { opacity: 1; outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; border-radius: 50%; }
}
.previous { left: 0; }
.next { right: 0; }
.root:hover .control:not(:disabled), .root:focus-within .control:not(:disabled) { opacity: 1; }
@container (max-width: 500px) { .slide { flex-basis: 168px; width: 168px; height: 95px; } .control { display: none; } }
@media (pointer: coarse) { .control { display: none; } }
@media (prefers-reduced-motion: reduce) { .control { transition: none; } }
</style>
