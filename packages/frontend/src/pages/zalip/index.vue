<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div>
		<div :class="$style.page">
			<section
				:class="$style.onboarding"
				aria-roledescription="carousel"
				:aria-label="i18n.ts.zalip.onboardingLabel"
				@mouseenter="pauseOnboardingForHover"
				@mouseleave="resumeOnboardingAfterHover"
				@focusin="pauseOnboardingForFocus"
				@focusout="resumeOnboardingAfterFocus"
			>
				<div ref="heroRail" :class="$style.heroRail" @scroll.passive="updateOnboardingPosition" @pointerdown="beginOnboardingSwipe" @pointermove="heroDrag.onPointerMove" @pointerup="heroDrag.onPointerUp" @pointercancel="heroDrag.onPointerCancel" @click.capture="heroDrag.onClickCapture">
					<article v-for="(slide, index) in onboardingSlides" :key="`${slide.to}-${index}`" :class="[$style.onboardingCard, { [$style.onboardingCardActive]: index === activeOnboardingIndex }]" role="group" aria-roledescription="slide" :aria-label="i18n.tsx.zalip.onboardingSlideCounter({ current: (index + 1).toString(), total: onboardingSlides.length.toString() })">
						<picture :class="$style.onboardingBackdrop">
							<source v-if="slide.posterPath" media="(max-width: 767px)" :srcset="tmdbImage(slide.posterPath)">
							<img :src="slide.backdropPath ? tmdbBackdrop(slide.backdropPath) : slide.posterPath ? tmdbImage(slide.posterPath) : slide.image" alt="" draggable="false" :loading="index <= 1 ? 'eager' : 'lazy'">
						</picture>
						<div :class="$style.onboardingShade"></div>
						<p :class="$style.onboardingEyebrow">{{ slide.eyebrow }}</p>
						<div :class="$style.onboardingCopy">
							<img v-if="slide.logoPath" :class="$style.onboardingLogo" :src="tmdbLogo(slide.logoPath)" :alt="slide.title" draggable="false">
							<h2 v-else>{{ slide.title }}</h2>
							<div v-if="slide.kind" :class="$style.onboardingMeta">
								<span>{{ kindLabel(slide.kind) }}</span><span v-if="slide.releaseYear">{{ slide.releaseYear }}</span>
								<span v-if="slide.communityRating != null" :class="$style.onboardingRating" :aria-label="i18n.tsx.zalip.communityRating({ rating: formatCommunityRating(slide.communityRating) })">★ {{ formatCommunityRating(slide.communityRating) }}</span>
							</div>
							<p v-if="slide.description" :class="$style.onboardingDescription">{{ slide.description }}</p>
							<MkA :to="slide.to" :class="$style.onboardingAction">{{ slide.action }}</MkA>
						</div>
					</article>
				</div>
				<div :class="$style.onboardingControls">
					<div :class="$style.onboardingDots" role="group" :aria-label="i18n.ts.zalip.onboardingDots">
						<button v-for="(_slide, index) in onboardingSlides" :key="index" type="button" class="_button" :class="{ [$style.onboardingDotActive]: index === activeOnboardingIndex }" :aria-label="i18n.tsx.zalip.onboardingDot({ number: (index + 1).toString() })" :aria-current="index === activeOnboardingIndex ? 'true' : undefined" @click="selectOnboarding(index)"></button>
					</div>
					<button type="button" class="_button" :class="$style.onboardingPlayback" :aria-label="onboardingPaused ? i18n.ts.zalip.onboardingResume : i18n.ts.zalip.onboardingPause" :aria-pressed="onboardingPaused" @click="toggleOnboardingAutoplay"><MkZalipIcon :name="onboardingPaused ? 'play' : 'pause'"/></button>
				</div>
			</section>

			<section v-if="showcaseItems.length" :class="$style.releases">
				<div :class="$style.sectionHeader">
					<div><p :class="$style.eyebrow">{{ showcaseEyebrow }}</p><h2>{{ showcaseTitle }}</h2></div>
					<div :class="$style.releaseControls">
						<span :class="$style.count">{{ showcaseItems.length }} {{ isEpisodeShowcase ? i18n.ts.zalip.updatesLabel : i18n.ts.zalip.titlesLabel }}</span>
					</div>
				</div>
				<div :class="$style.releaseRail" role="list" :aria-label="showcaseTitle" @pointerdown="releaseDrag.onPointerDown" @pointermove="releaseDrag.onPointerMove" @pointerup="releaseDrag.onPointerUp" @pointercancel="releaseDrag.onPointerCancel" @click.capture="releaseDrag.onClickCapture">
					<div v-for="item in showcaseItems" :key="item.id" :class="$style.releaseListItem" role="listitem">
						<MkA :to="`/zalip/${item.work.slug}`" :class="$style.releaseCard">
							<div :class="$style.releasePoster">
								<img v-if="item.work.posterPath" :src="tmdbImage(item.work.posterPath)" :alt="item.work.title" loading="lazy">
								<i v-else class="ti ti-movie"></i>
								<span :class="$style.releaseBadge"><i :class="isEpisodeShowcase ? 'ti ti-player-play-filled' : 'ti ti-sparkles'"></i><span :class="$style.releaseBadgeText">{{ item.badge }}</span></span>
							</div>
							<div :class="$style.releaseBody"><strong>{{ item.work.title }}</strong><span>{{ item.subtitle }}</span></div>
						</MkA>
					</div>
				</div>
			</section>
		</div>
		<MkZalipFeed/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
import MkZalipFeed from '@/components/MkZalipFeed.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';

type ZalipWork = {
	id: string;
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	logoPath: string | null;
	trailerYoutubeKey: string | null;
	genres: string[];
	communityRating: number | null;
	ratingCount: number;
};

type ZalipReleaseEvent = {
	id: string;
	createdAt: string;
	work: ZalipWork;
	season: { seasonNumber: number; title: string };
	episode: { episodeNumber: number; title: string };
};

type ZalipShowcaseItem = {
	id: string;
	work: ZalipWork;
	badge: string;
	subtitle: string;
};

type ZalipHeroSlide = {
	title: string;
	eyebrow: string;
	action: string;
	to: string;
	icon: string;
	description?: string | null;
	image?: string;
	posterPath?: string | null;
	backdropPath?: string | null;
	logoPath?: string | null;
	kind?: WorkKind;
	releaseYear?: number | null;
	genres?: string[];
	originalTitle?: string | null;
	communityRating?: number | null;
};

type WorkKind = ZalipWork['kind'];

const onboardingFallbackSlides: ZalipHeroSlide[] = [
	{
		title: i18n.ts.zalip.onboardingLibraryTitle,
		image: '/vite/zalip/onboarding/1.webp',
		icon: 'ti ti-bookmark',
		eyebrow: i18n.ts.zalip.onboardingLabel,
		description: i18n.ts.zalip.heroFallbackDescription,
		to: '/library',
		action: i18n.ts.zalip.onboardingLibraryAction,
	},
	{
		title: i18n.ts.zalip.onboardingFriendsTitle,
		image: '/vite/zalip/onboarding/2.webp',
		icon: 'ti ti-users',
		eyebrow: i18n.ts.zalip.onboardingLabel,
		description: i18n.ts.zalip.heroFallbackDescription,
		to: '/timeline',
		action: i18n.ts.zalip.onboardingFriendsAction,
	},
	{
		title: i18n.ts.zalip.onboardingPostsTitle,
		image: '/vite/zalip/onboarding/3.webp',
		icon: 'ti ti-pencil-plus',
		eyebrow: i18n.ts.zalip.onboardingLabel,
		description: i18n.ts.zalip.heroFallbackDescription,
		to: '/timeline',
		action: i18n.ts.zalip.onboardingPostsAction,
	},
	{
		title: i18n.ts.zalip.onboardingDiscussionsTitle,
		image: '/vite/zalip/onboarding/4.webp',
		icon: 'ti ti-messages',
		eyebrow: i18n.ts.zalip.onboardingLabel,
		description: i18n.ts.zalip.heroFallbackDescription,
		to: '/timeline',
		action: i18n.ts.zalip.onboardingDiscussionsAction,
	},
	{
		title: i18n.ts.zalip.onboardingDiscoverTitle,
		image: '/vite/zalip/onboarding/5.webp',
		icon: 'ti ti-search',
		eyebrow: i18n.ts.zalip.onboardingLabel,
		description: i18n.ts.zalip.heroFallbackDescription,
		to: '/catalog',
		action: i18n.ts.zalip.onboardingDiscoverAction,
	},
] as const;

const works = ref<ZalipWork[]>([]);
const releaseEvents = ref<ZalipReleaseEvent[]>([]);
const releaseEventsLoaded = ref(false);
const activeOnboardingIndex = ref(1);
const onboardingPaused = ref(false);
const onboardingSlides = computed<ZalipHeroSlide[]>(() => {
	const featured = works.value.filter(work => work.backdropPath || work.posterPath).slice(0, 5);
	if (featured.length === 0) return onboardingFallbackSlides;
	return featured.map(work => ({
		title: work.title,
		eyebrow: i18n.ts.zalip.heroFeatured,
		description: work.description || work.originalTitle || i18n.ts.zalip.heroFallbackDescription,
		action: i18n.ts.zalip.heroDetails,
		to: `/zalip/${work.slug}`,
		icon: kindIcon(work.kind),
		posterPath: work.posterPath,
		backdropPath: work.backdropPath,
		logoPath: work.logoPath,
		kind: work.kind,
		releaseYear: work.releaseYear,
		genres: work.genres,
		originalTitle: work.originalTitle,
		communityRating: work.communityRating,
	}));
});
const heroRail = useTemplateRef('heroRail');
const heroDrag = useZalipHorizontalDrag();
const releaseDrag = useZalipHorizontalDrag();

function formatCommunityRating(rating: number): string {
	return rating.toFixed(1).replace('.', ',');
}

watch(() => onboardingSlides.value.length, (length) => {
	if (activeOnboardingIndex.value >= length) activeOnboardingIndex.value = 0;
});

let onboardingTimer: number | null = null;
let heroResizeObserver: ResizeObserver | null = null;
let onboardingHovered = false;
let onboardingFocused = false;
const isEpisodeShowcase = computed(() => releaseEvents.value.length > 0);
const showcaseItems = computed<ZalipShowcaseItem[]>(() => {
	if (releaseEvents.value.length > 0) return releaseEvents.value.map(release => ({
		id: release.id,
		work: release.work,
		badge: releaseLabel(release),
		subtitle: release.episode.title || i18n.ts.zalip.newEpisode,
	}));

	if (!releaseEventsLoaded.value) return [];
	return works.value.slice(0, 12).map(work => ({
		id: `catalogue-${work.id}`,
		work,
		badge: `${kindLabel(work.kind)}${work.releaseYear == null ? '' : ` · ${work.releaseYear}`}`,
		subtitle: work.originalTitle || i18n.ts.zalip.newCatalogueItem,
	}));
});
const showcaseEyebrow = computed(() => isEpisodeShowcase.value ? i18n.ts.zalip.freshEpisodes : i18n.ts.zalip.newCatalogue);
const showcaseTitle = computed(() => isEpisodeShowcase.value ? i18n.ts.zalip.freshEpisodesTitle : i18n.ts.zalip.newCatalogueTitle);

function tmdbImage(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function tmdbBackdrop(path: string): string {
	return `https://image.tmdb.org/t/p/w1280${path}`;
}

function tmdbLogo(path: string): string {
	return `https://image.tmdb.org/t/p/w500${path}`;
}

function kindLabel(kind: WorkKind): string {
	return ({ movie: i18n.ts.zalip.searchMovies, series: i18n.ts.zalip.searchSeries, anime: i18n.ts.zalip.searchAnime, animation: i18n.ts.zalip.searchAnimation })[kind];
}

function kindIcon(kind: WorkKind): string {
	return ({ movie: 'ti ti-movie', series: 'ti ti-device-tv', anime: 'ti ti-sparkles', animation: 'ti ti-mood-smile' })[kind];
}

function releaseLabel(release: ZalipReleaseEvent): string {
	const season = release.season.seasonNumber === 0 ? i18n.ts.zalip.releaseSpecial : i18n.tsx.zalip.releaseSeason({ number: release.season.seasonNumber.toString() });
	return `${season} · ${i18n.tsx.zalip.releaseEpisode({ number: release.episode.episodeNumber.toString() })}`;
}

async function loadHome(): Promise<void> {
	try {
		works.value = await misskeyApiZalip<ZalipWork[]>('zalip/works/list', {
			limit: 12,
		});
	} catch {
		works.value = [];
	}

	try {
		releaseEvents.value = await misskeyApiZalip<ZalipReleaseEvent[]>('zalip/releases/list', { limit: 12 });
	} catch {
		releaseEvents.value = [];
	} finally {
		releaseEventsLoaded.value = true;
	}
}

function scrollToOnboarding(index: number, animate = true): void {
	const rail = heroRail.value;
	const card = rail?.children.item(index);
	if (!rail || !(card instanceof HTMLElement)) return;
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	rail.scrollTo({ left: card.offsetLeft - (rail.clientWidth - card.offsetWidth) / 2, behavior: animate && !reducedMotion ? 'smooth' : 'instant' });
	activeOnboardingIndex.value = index;
}

function selectOnboarding(index: number): void {
	onboardingPaused.value = true;
	stopOnboardingAutoplay();
	scrollToOnboarding(index);
}

function showOnboarding(step: number): void {
	scrollToOnboarding((activeOnboardingIndex.value + step + onboardingSlides.value.length) % onboardingSlides.value.length);
}

function updateOnboardingPosition(): void {
	const rail = heroRail.value;
	if (!rail) return;
	const center = rail.scrollLeft + rail.clientWidth / 2;
	let nearest = 0;
	let distance = Infinity;
	Array.from(rail.children).forEach((card, index) => {
		if (!(card instanceof HTMLElement)) return;
		const delta = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
		if (delta < distance) { distance = delta; nearest = index; }
	});
	activeOnboardingIndex.value = nearest;
}

function stopOnboardingAutoplay(): void {
	if (onboardingTimer != null) window.clearInterval(onboardingTimer);
	onboardingTimer = null;
}

function startOnboardingAutoplay(): void {
	stopOnboardingAutoplay();
	if (onboardingPaused.value || onboardingHovered || onboardingFocused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	onboardingTimer = window.setInterval(() => showOnboarding(1), 6500);
}

function pauseOnboardingForHover(): void {
	onboardingHovered = true;
	stopOnboardingAutoplay();
}

function resumeOnboardingAfterHover(): void {
	onboardingHovered = false;
	startOnboardingAutoplay();
}

function pauseOnboardingForFocus(): void {
	onboardingFocused = true;
	stopOnboardingAutoplay();
}

function resumeOnboardingAfterFocus(event: FocusEvent): void {
	const section = event.currentTarget;
	if (section instanceof HTMLElement && event.relatedTarget instanceof Node && section.contains(event.relatedTarget)) return;
	onboardingFocused = false;
	startOnboardingAutoplay();
}

function toggleOnboardingAutoplay(): void {
	onboardingPaused.value = !onboardingPaused.value;
	if (onboardingPaused.value) stopOnboardingAutoplay();
	else startOnboardingAutoplay();
}

function beginOnboardingSwipe(event: PointerEvent): void {
	onboardingPaused.value = true;
	stopOnboardingAutoplay();
	heroDrag.onPointerDown(event);
}

watch(onboardingSlides, async () => {
	await nextTick();
	scrollToOnboarding(Math.min(1, onboardingSlides.value.length - 1), false);
});

onMounted(() => {
	void loadHome();
	startOnboardingAutoplay();
	heroResizeObserver = new ResizeObserver(() => scrollToOnboarding(activeOnboardingIndex.value, false));
	if (heroRail.value) heroResizeObserver.observe(heroRail.value);
});

onBeforeUnmount(() => {
	stopOnboardingAutoplay();
	heroResizeObserver?.disconnect();
});

definePage(() => ({
	title: 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.page { min-width: 0; margin: 0 auto; padding: 14px 0 30px; }
.onboarding { container-type: inline-size; min-width: 0; }
.heroRail {
	--hero-width: min(78cqw, 760px);
	position: relative;
	display: flex;
	gap: 16px;
	overflow-x: auto;
	padding: 10px calc((100% - var(--hero-width)) / 2);
	scrollbar-width: none;
	scroll-snap-type: none;
	cursor: grab;
	user-select: none;
	&::-webkit-scrollbar { display: none; }
	&[data-dragging='true'] { cursor: grabbing; }
}
.onboardingCard {
	position: relative;
	flex: 0 0 var(--hero-width);
	width: var(--hero-width);
	height: 350px;
	box-sizing: border-box;
	overflow: hidden;
	border: 1px solid rgb(255 255 255 / 14%);
	border-radius: 16px;
	background: #121415;
	color: #fff;
	transform: scale(.96);
	transition: transform .2s ease;
}
.onboardingCardActive { transform: scale(1); }
.onboardingBackdrop, .onboardingShade { position: absolute; inset: 0; pointer-events: none; }
.onboardingBackdrop img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
.onboardingShade { background: linear-gradient(90deg, rgb(9 12 17 / 86%), rgb(9 12 17 / 45%) 55%, transparent), linear-gradient(0deg, rgb(9 12 17 / 90%), transparent 80%); }
.onboardingEyebrow { position: absolute; top: 20px; left: 24px; margin: 0; color: rgb(255 255 255 / 75%); font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.onboardingCopy { position: absolute; bottom: 24px; left: 24px; width: min(70%, 430px); display: flex; flex-direction: column; align-items: flex-start; gap: 12px; }
.onboardingCopy h2 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 0; max-width: 100%; font-size: clamp(24px, 3cqw, 34px); line-height: 1.1; letter-spacing: -.025em; overflow-wrap: anywhere; }
.onboardingLogo { display: block; max-width: min(280px, 100%); height: 80px; object-fit: contain; object-position: left bottom; filter: brightness(0) invert(1) drop-shadow(0 3px 8px rgb(0 0 0 / 50%)); }
.onboardingMeta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; font-size: 12px; font-weight: 600; color: rgb(255 255 255 / 75%); }
.onboardingRating { color: #ffd268; }
.onboardingDescription { margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; font-size: 14px; line-height: 1.4; color: rgb(255 255 255 / 86%); }
.onboardingAction { display: flex; align-items: center; justify-content: center; min-height: 44px; min-width: 150px; padding: 0 20px; box-sizing: border-box; border-radius: 10px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 14px; font-weight: 700; text-decoration: none; &:hover { opacity: .9; text-decoration: none; } &:focus-visible { outline: 2px solid #fff; outline-offset: 3px; } }
.onboardingControls { display: flex; align-items: center; justify-content: center; gap: 10px; height: 32px; }
.onboardingDots { display: flex; gap: 4px; button { display: grid; place-items: center; width: 24px; height: 30px; &::before { content: ''; width: 14px; height: 4px; border-radius: 2px; background: var(--zalip-social-muted); opacity: .35; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); border-radius: 4px; } } .onboardingDotActive::before { background: var(--MI_THEME-accent); opacity: 1; } }
.onboardingPlayback { display: grid; place-items: center; width: 30px; height: 30px; color: var(--zalip-social-muted); border-radius: 50%; > svg { width: 16px; height: 16px; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); } }
@container (max-width: 700px) {
	.heroRail { --hero-width: min(80cqw, 360px); gap: 12px; }
	.onboardingCard { height: 416px; border-radius: 14px; }
	.onboardingBackdrop img { object-position: center top; }
	.onboardingShade { background: linear-gradient(0deg, #101214 0%, rgb(16 18 20 / 95%) 15%, rgb(16 18 20 / 76%) 35%, rgb(16 18 20 / 6%) 72%); }
	.onboardingEyebrow { top: 14px; left: 14px; font-size: 10px; text-shadow: 0 1px 4px #000; }
	.onboardingCopy { left: 16px; bottom: 16px; width: calc(100% - 32px); align-items: center; gap: 10px; text-align: center; }
	.onboardingCopy h2 { font-size: 23px; }
	.onboardingLogo { height: 70px; max-width: min(230px, 100%); object-position: center bottom; }
	.onboardingMeta { justify-content: center; font-size: 11px; gap: 8px; }
	.onboardingDescription { font-size: 12px; line-height: 1.4; -webkit-line-clamp: 3; }
	.onboardingAction { width: 100%; }
}
@container (max-width: 350px) {
	.onboardingCard { height: 390px; }
	.onboardingCopy h2 { font-size: 21px; }
	.onboardingCopy { left: 12px; width: calc(100% - 24px); }
}
.releases { margin: 22px 0 0; padding: 0 24px; }
.sectionHeader { display: flex; align-items: end; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.sectionHeader h2 { margin: 0; font-size: 1.35rem; }
.eyebrow { margin: 0 0 7px; color: var(--MI_THEME-accent); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.count { color: var(--zalip-social-muted); font-size: 12px; }
.releaseControls { display: flex; align-items: center; }
.releaseRail { display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; padding: 1px; scroll-snap-type: none; scrollbar-width: none; cursor: grab; user-select: none; &::-webkit-scrollbar { display: none; } &[data-dragging='true'] { cursor: grabbing; } }
.releaseListItem { flex: 0 0 158px; }
.releaseCard { display: block; height: 100%; color: var(--MI_THEME-fg); text-decoration: none; &:hover { text-decoration: none; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } }
.releasePoster { position: relative; display: grid; place-items: center; overflow: hidden; aspect-ratio: 2 / 3; border-radius: 12px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-accent); img { width: 100%; height: 100%; object-fit: cover; } }
.releaseBadge { position: absolute; bottom: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; max-width: calc(100% - 16px); overflow: hidden; padding: 4px 7px; border-radius: 99px; background: rgb(0 0 0 / 75%); color: #fff; font-size: 10px; }
.releaseBadgeText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.releaseBody { display: grid; gap: 4px; padding: 8px 2px 2px; strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 14px; line-height: 1.25; } span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--zalip-social-muted); font-size: 11px; } }
@media (max-width: 767px) {
	.page { padding-top: 6px; }
	.releases { padding: 0 16px; }
	.releaseRail { margin-right: -16px; padding-right: 16px; }
	.releaseListItem { flex-basis: 138px; }
	.releaseControls .count { display: none; }
}
@media (prefers-reduced-motion: reduce) { .onboardingCard { transition: none; } }
</style>
