<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XBanner v-for="media in mediaList.filter(media => !previewable(media))" :key="media.id" :media="media"/>
	<div v-if="previewableMedia.length > 0" :class="$style.container">
		<div
			ref="gallery"
			:class="[
				$style.medias,
				...(carousel ? [$style.carousel] : prefer.s.showMediaListByGridInWideArea ? [$style.gridInWideArea] : []),
				carousel ? null : count === 1 ? [$style.n1, {
					[$style.n116_9]: prefer.s.mediaListWithOneImageAppearance === '16_9',
					[$style.n11_1]: prefer.s.mediaListWithOneImageAppearance === '1_1',
					[$style.n12_3]: prefer.s.mediaListWithOneImageAppearance === '2_3',
				}] : count === 2 ? $style.n2 : count === 3 ? $style.n3 : count === 4 ? $style.n4 : $style.nMany,
			]"
			:role="carousel ? 'group' : undefined"
			:aria-label="carousel ? i18n.ts.images : undefined"
			:aria-busy="opening"
			:tabindex="carousel ? 0 : undefined"
			@scroll.passive="onScroll"
			@keydown="onCarouselKeydown"
		>
			<template v-for="(media, index) in previewableMedia">
				<XVideo
					v-if="media.type.startsWith('video')"
					:key="`video:${media.id}`"
					:class="$style.media"
					:style="carousel ? { '--media-ratio': mediaRatio(media) } : undefined"
					:tabindex="carousel ? -1 : undefined"
					:role="carousel ? 'group' : undefined"
					:aria-label="carousel ? `${media.comment || media.name} (${index + 1} / ${count})` : undefined"
					data-carousel-item
					:video="media"
					@mediaClick="onMediaClick(media)"
				/>
				<XImage
					v-else-if="media.type.startsWith('image')"
					:key="`image:${media.id}`"
					:marker="`${markerId}:${media.id}`"
					:disableImageLink="true"
					:class="$style.media"
					:style="carousel ? { '--media-ratio': mediaRatio(media) } : undefined"
					:tabindex="carousel ? -1 : undefined"
					:role="carousel ? 'group' : undefined"
					:aria-label="carousel ? `${media.comment || media.name} (${index + 1} / ${count})` : undefined"
					data-carousel-item
					:image="media"
					:raw="raw"
					@mediaClick="onMediaClick(media)"
				/>
			</template>
		</div>
		<div v-if="carousel" :class="$style.carouselControls">
			<button type="button" class="_button" :class="[$style.carouselButton, $style.carouselPrevious]" :aria-label="i18n.ts.zalip._importer.previous" :disabled="previousDisabled" @click.stop="moveBy(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
			<span :class="$style.carouselCounter" aria-live="polite" aria-atomic="true">{{ activeIndex + 1 }} / {{ count }}</span>
			<button type="button" class="_button" :class="[$style.carouselButton, $style.carouselNext]" :aria-label="i18n.ts.next" :disabled="nextDisabled" @click.stop="moveBy(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import * as Misskey from 'misskey-js';
import { FILE_TYPE_BROWSERSAFE } from '@@/js/const.js';
import type { Content } from '@/components/MkLightbox.item.vue';
import XBanner from '@/components/MkMediaBanner.vue';
import XImage from '@/components/MkMediaImage.vue';
import XVideo from '@/components/MkMediaVideo.vue';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { genId } from '@/utility/id.js';
import { i18n } from '@/i18n.js';
import { useMediaCarousel } from '@/composables/use-media-carousel.js';
import { canRevealFile } from '@/utility/sensitive-file.js';

const props = defineProps<{
	mediaList: Misskey.entities.DriveFile[];
	raw?: boolean;
	layout?: 'grid' | 'carousel';
}>();

const gallery = useTemplateRef('gallery');
const previewableMedia = computed(() => props.mediaList.filter(media => previewable(media)));
const count = computed(() => previewableMedia.value.length);
const carousel = computed(() => props.layout === 'carousel' && count.value > 1);
const { activeIndex, keyboardIndex, previousDisabled, nextDisabled, onScroll, moveBy, onKeydown } = useMediaCarousel(gallery, count, carousel, () => prefer.s.animation, () => previewableMedia.value.map(media => media.id).join(','));
const markerId = genId();
const viewerIdentity = computed(() => JSON.stringify(previewableMedia.value.map(media => [media.id, media.url, media.thumbnailUrl])));
const opening = ref(false);
type Viewer = { closed: boolean; disposed: boolean; dispose?: () => void };
let viewer: Viewer | null = null;
let alive = true;

function isCurrentViewer(current: Viewer): boolean { return alive && !current.closed && viewer === current; }

function disposeViewer(current: Viewer): void {
	current.closed = true;
	if (current.dispose && !current.disposed) { current.disposed = true; current.dispose(); }
	if (viewer === current) { viewer = null; opening.value = false; }
}

watch(viewerIdentity, () => { if (viewer) disposeViewer(viewer); }, { flush: 'sync' });
onBeforeUnmount(() => { alive = false; if (viewer) disposeViewer(viewer); });

function mediaRatio(media: Misskey.entities.DriveFile): number {
	const { width, height } = media.properties;
	return typeof width === 'number' && typeof height === 'number' && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
		? Math.min(3, Math.max(.5, width / height))
		: 16 / 9;
}

async function calcAspectRatio() {
	if (!gallery.value) return;
	if (carousel.value) {
		gallery.value.style.aspectRatio = '';
		return;
	}

	const img = props.mediaList[0];

	if (props.mediaList.length !== 1 || !(img.properties.width && img.properties.height)) {
		gallery.value.style.aspectRatio = '';
		return;
	}

	const ratioMax = (ratio: number) => {
		if (img.properties.width == null || img.properties.height == null) return '';
		return `${Math.max(ratio, img.properties.width / img.properties.height).toString()} / 1`;
	};

	switch (prefer.s.mediaListWithOneImageAppearance) {
		case '16_9':
			gallery.value.style.aspectRatio = ratioMax(16 / 9);
			break;
		case '1_1':
			gallery.value.style.aspectRatio = ratioMax(1 / 1);
			break;
		case '2_3':
			gallery.value.style.aspectRatio = ratioMax(2 / 3);
			break;
		default:
			gallery.value.style.aspectRatio = '';
			break;
	}
}

onMounted(() => {
	calcAspectRatio();

	if (gallery.value == null) return; // TSを黙らすため
});

watch([carousel, () => props.mediaList, () => prefer.s.mediaListWithOneImageAppearance], calcAspectRatio, { flush: 'post', deep: true });

function previewable(file: Misskey.entities.DriveFile): boolean {
	if (file.type === 'image/svg+xml') return true; // svgのwebpublic/thumbnailはpngなのでtrue
	// FILE_TYPE_BROWSERSAFEに適合しないものはブラウザで表示するのに不適切
	return (file.type.startsWith('video') || file.type.startsWith('image')) && FILE_TYPE_BROWSERSAFE.includes(file.type);
}

function onMediaClick(file: Misskey.entities.DriveFile) {
	if (prefer.s.imageNewTab) {
		window.open(file.url, '_blank');
		return;
	}
	openGallery(file.id);
}

async function onCarouselKeydown(event: KeyboardEvent): Promise<void> {
	if (!carousel.value) return;
	const target = event.target;
	const slides = Array.from(gallery.value?.querySelectorAll<HTMLElement>('[data-carousel-item]') ?? []);
	const focusedIndex = target instanceof HTMLElement ? slides.indexOf(target) : -1;
	// File menus and video controls keep their own keyboard interactions.
	if (target !== gallery.value && focusedIndex < 0) return;
	if (onKeydown(event)) {
		slides[keyboardIndex.value]?.focus({ preventScroll: true });
		return;
	}
	if (!['Enter', ' '].includes(event.key)) return;
	const file = previewableMedia.value.at(focusedIndex >= 0 ? focusedIndex : activeIndex.value);
	if (file == null) return;
	event.preventDefault();
	event.stopPropagation();
	if (!(await canRevealFile(file))) return;
	if (!alive || !previewableMedia.value.includes(file)) return;
	onMediaClick(file);
}

async function openGallery(id?: string) {
	if (!alive || viewer) return;
	if (id == null) {
		const firstImage = previewableMedia.value[0];
		if (firstImage == null) return;
		id = firstImage.id;
	}
	const defaultIndex = previewableMedia.value.findIndex(media => media.id === id);
	if (defaultIndex < 0) return;

	const getElementByMarker = (marker: string) => {
		if (gallery.value == null) return null;
		const found = gallery.value.querySelector(`[data-marker="${marker}"]`) as HTMLElement | null;
		if (found == null) return null;
		return markRaw(found);
	};

	const contents = previewableMedia.value.map<Content>(media => ({
		id: media.id,
		type: media.type.startsWith('video') ? 'video' : 'image',
		url: media.url,
		thumbnailUrl: media.thumbnailUrl,
		width: media.properties.width,
		height: media.properties.height,
		filename: media.name,
		file: media,
		sourceElement: getElementByMarker(`${markerId}:${media.id}`),
	}));

	const current: Viewer = { closed: false, disposed: false };
	viewer = current;
	opening.value = true;
	try {
		const popup = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), {
			defaultIndex,
			contents,
		}, {
			closed: () => disposeViewer(current),
		});
		current.dispose = popup.dispose;
		if (!isCurrentViewer(current)) disposeViewer(current);
		else opening.value = false;
	} catch {
		// The native async popup already reports its load failure; allow an explicit retry.
		disposeViewer(current);
	}
}

defineExpose({
	openGallery,
});
</script>

<style lang="scss" module>
.root {
	container-type: inline-size;
}

.container {
	position: relative;
	width: 100%;
}

.medias {
	display: grid;
	grid-gap: 8px;

	height: 100%;
	width: 100%;

	&.n1 {
		grid-template-rows: 1fr;

		// default but fallback (expand)
		min-height: 64px;
		max-height: clamp(
			64px,
			50cqh,
			min(360px, 50vh)
		);

		&.n116_9 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 16 / 9; // fallback
		}

		&.n11_1{
			min-height: initial;
			max-height: initial;
			aspect-ratio: 1 / 1; // fallback
		}

		&.n12_3 {
			min-height: initial;
			max-height: initial;
			aspect-ratio: 2 / 3; // fallback
		}
	}

	&.n2 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr;
	}

	&.n3 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 0.5fr;
		grid-template-rows: 1fr 1fr;

		> .media:nth-child(1) {
			grid-row: 1 / 3;
		}

		> .media:nth-child(3) {
			grid-column: 2 / 3;
			grid-row: 2 / 3;
		}
	}

	&.n4 {
		aspect-ratio: 16/9;
		grid-template-columns: 1fr 1fr;
		grid-template-rows: 1fr 1fr;
	}

	&.nMany {
		grid-template-columns: 1fr 1fr;

		> .media {
			aspect-ratio: 16/9;
		}
	}
}

.media {
	overflow: hidden; // clipにするとバグる
	border-radius: 8px;
	cursor: zoom-in;
}

.medias.carousel {
	--carousel-height: clamp(240px, 55cqw, 320px);
	display: flex;
	align-items: stretch;
	gap: 6px;
	height: var(--carousel-height);
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scrollbar-width: none;
	border-radius: 8px;

	&::-webkit-scrollbar { display: none; }

	> .media {
		flex: 0 0 auto;
		width: min(calc(var(--carousel-height) * var(--media-ratio)), calc(100cqw - 32px));
		height: var(--carousel-height);
		min-width: 0;
		scroll-snap-align: start;

		&:focus-visible {
			outline: 2px solid var(--MI_THEME-focus);
			outline-offset: -2px;
		}
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: 2px;
	}
}

.carouselControls {
	position: absolute;
	inset: 0;
	pointer-events: none;
}

.carouselButton {
	position: absolute;
	top: 50%;
	translate: 0 -50%;
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	pointer-events: auto;

	> i {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--MI_THEME-panel) 90%, transparent);
		color: var(--MI_THEME-fg);
		box-shadow: 0 0 0 1px var(--MI_THEME-divider);
	}

	&:hover:enabled > i { background: var(--MI_THEME-buttonHoverBg); }
	&:disabled { opacity: 0; pointer-events: none; }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
}

.carouselPrevious { inset-inline-start: 4px; }
.carouselNext { inset-inline-end: 4px; }

.carouselCounter {
	position: absolute;
	top: 8px;
	inset-inline-end: 8px;
	padding: 3px 7px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 85%, transparent);
	color: var(--MI_THEME-fg);
	text-align: center;
	font-size: 11px;
	font-variant-numeric: tabular-nums;
}

@container (min-width: 500px) {
	.medias.gridInWideArea {
		display: grid;
		aspect-ratio: auto;
		grid-template-columns: repeat(4, 1fr);
		grid-template-rows: auto;
		grid-gap: 8px;

		> .media {
			aspect-ratio: 1 / 1;
		}
	}
}
</style>
