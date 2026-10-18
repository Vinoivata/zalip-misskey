<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XBanner v-for="media in mediaList.filter(media => !previewable(media))" :key="media.id" :media="media"/>
	<div v-if="mediaList.filter(media => previewable(media)).length > 0" :class="$style.container">
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
			:tabindex="carousel ? 0 : undefined"
			@scroll.passive="onScroll"
			@keydown="onCarouselKeydown"
		>
			<template v-for="media in mediaList.filter(media => previewable(media))">
				<XVideo
					v-if="media.type.startsWith('video')"
					:key="`video:${media.id}`"
					:class="$style.media"
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
					data-carousel-item
					:image="media"
					:raw="raw"
					@mediaClick="onMediaClick(media)"
				/>
			</template>
		</div>
		<div v-if="carousel" :class="$style.carouselControls">
			<button type="button" class="_button" :class="$style.carouselButton" :aria-label="i18n.ts.zalip._importer.previous" :disabled="previousDisabled" @click.stop="moveTo(activeIndex - 1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
			<span :class="$style.carouselCounter" aria-live="polite" aria-atomic="true">{{ activeIndex + 1 }} / {{ count }}</span>
			<button type="button" class="_button" :class="$style.carouselButton" :aria-label="i18n.ts.next" :disabled="nextDisabled" @click.stop="moveTo(activeIndex + 1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed, markRaw, onMounted, useTemplateRef, watch } from 'vue';
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
const count = computed(() => props.mediaList.filter(media => previewable(media)).length);
const carousel = computed(() => props.layout === 'carousel' && count.value > 1);
const { activeIndex, previousDisabled, nextDisabled, onScroll, moveTo, onKeydown } = useMediaCarousel(gallery, count, carousel, () => prefer.s.animation);
const markerId = genId();

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
	if (onKeydown(event)) return;
	if (event.target !== gallery.value || !['Enter', ' '].includes(event.key)) return;
	const file = props.mediaList.filter(media => previewable(media)).at(activeIndex.value);
	if (file == null) return;
	event.preventDefault();
	event.stopPropagation();
	if (!(await canRevealFile(file))) return;
	onMediaClick(file);
}

async function openGallery(id?: string) {
	if (id == null) {
		const firstImage = props.mediaList.find(media => previewable(media));
		if (firstImage == null) return;
		id = firstImage.id;
	}

	const getElementByMarker = (marker: string) => {
		if (gallery.value == null) return null;
		const found = gallery.value.querySelector(`[data-marker="${marker}"]`) as HTMLElement | null;
		if (found == null) return null;
		return markRaw(found);
	};

	const contents = props.mediaList.filter(media => previewable(media)).map<Content>(media => ({
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

	const { dispose } = await os.popupAsyncWithDialog(import('@/components/MkLightbox.vue').then(x => x.default), {
		defaultIndex: contents.findIndex(conten => conten.id === id),
		contents: contents,
	}, {
		closed: () => dispose(),
	});
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
	display: flex;
	gap: 8px;
	height: auto;
	aspect-ratio: 16 / 9;
	overflow-x: auto;
	overscroll-behavior-x: contain;
	scroll-snap-type: x mandatory;
	scrollbar-width: thin;
	border-radius: 8px;

	> .media {
		flex: 0 0 100%;
		width: 100%;
		height: 100%;
		min-width: 0;
		scroll-snap-align: start;
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: 2px;
	}
}

.carouselControls {
	display: flex;
	justify-content: flex-end;
	align-items: center;
	gap: 8px;
	margin-top: 4px;
}

.carouselButton {
	display: grid;
	place-items: center;
	width: 44px;
	height: 44px;
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-buttonBg);

	&:hover:enabled { background: var(--MI_THEME-buttonHoverBg); }
	&:disabled { opacity: .35; }
}

.carouselCounter {
	min-width: 48px;
	text-align: center;
	font-size: .85em;
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
