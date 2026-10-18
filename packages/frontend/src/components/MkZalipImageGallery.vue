<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div v-if="items.length" :class="$style.root">
	<div ref="viewport" :class="$style.viewport" role="group" :aria-label="label ?? i18n.ts.images" @scroll.passive="onScroll" @keydown="onGalleryKeydown">
		<button
			v-for="(image, index) in items"
			:key="image.url"
			type="button"
			class="_button"
			:class="$style.slide"
			data-carousel-item
			:aria-label="`${image.alt || label || i18n.ts.image} (${index + 1} / ${items.length})`"
			@click.stop="openGallery(index)"
		>
			<img
				v-if="!prefer.s.dataSaver.media && preview(image)"
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
	<div v-if="items.length > 1" :class="$style.controls">
		<button type="button" class="_button" :class="$style.control" :aria-label="i18n.ts.zalip._importer.previous" :disabled="previousDisabled" @click.stop="moveTo(activeIndex - 1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
		<span :class="$style.counter" aria-live="polite" aria-atomic="true">{{ activeIndex + 1 }} / {{ items.length }}</span>
		<button type="button" class="_button" :class="$style.control" :aria-label="i18n.ts.next" :disabled="nextDisabled" @click.stop="moveTo(activeIndex + 1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref, useTemplateRef } from 'vue';
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
const { activeIndex, previousDisabled, nextDisabled, onScroll, moveTo, onKeydown } = useMediaCarousel(viewport, count, enabled, () => prefer.s.animation);

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
	viewport.value?.querySelectorAll<HTMLButtonElement>('[data-carousel-item]')[activeIndex.value]?.focus({ preventScroll: true });
}

async function openGallery(index: number): Promise<void> {
	const image = items.value.at(index);
	if (!image) return;
	if (prefer.s.imageNewTab) {
		window.open(image.url, '_blank', 'noopener,noreferrer');
		return;
	}
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
	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(module => module.default), { defaultIndex: index, contents }, { closed: () => dispose() });
}

defineExpose({ openGallery });
</script>

<style lang="scss" module>
.root { min-width: 0; }

.viewport {
	display: flex;
	gap: 8px;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scrollbar-width: thin;
	border-radius: var(--MI-radius);
}

.slide {
	flex: 0 0 100%;
	display: grid;
	place-items: center;
	width: 100%;
	min-width: 0;
	aspect-ratio: 16 / 9;
	scroll-snap-align: start;
	overflow: hidden;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-bg);
	cursor: zoom-in;

	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
}

.image { display: block; width: 100%; height: 100%; object-fit: contain; }
.placeholder { display: grid; justify-items: center; gap: 8px; color: var(--MI_THEME-fg); }

.controls { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.counter { min-width: 48px; text-align: center; font-size: .85em; font-variant-numeric: tabular-nums; }
.control {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-buttonBg);
	&:hover:enabled { background: var(--MI_THEME-buttonHoverBg); }
	&:disabled { opacity: .35; }
}
</style>
