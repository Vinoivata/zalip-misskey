<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1180px;">
		<div :class="$style.page">
			<section
				:class="$style.onboarding"
				aria-roledescription="carousel"
				:aria-label="i18n.ts.zalip.onboardingLabel"
				@mouseenter="pauseOnboardingForHover"
				@mouseleave="resumeOnboardingAfterHover"
				@focusin="pauseOnboardingForFocus"
				@focusout="resumeOnboardingAfterFocus"
				@pointerdown="beginOnboardingSwipe"
				@pointermove="moveOnboardingSwipe"
				@pointerup="endOnboardingSwipe"
				@pointercancel="cancelOnboardingSwipe"
			>
				<div :class="$style.onboardingSlide" role="group" aria-roledescription="slide" :aria-label="i18n.tsx.zalip.onboardingSlideCounter({ current: (activeOnboardingIndex + 1).toString(), total: onboardingSlides.length.toString() })" :aria-live="onboardingPaused ? 'polite' : 'off'">
					<div :class="$style.onboardingCopy">
						<p :class="$style.onboardingEyebrow"><i :class="activeOnboarding.icon"></i> {{ i18n.ts.zalip.onboardingLabel }}</p>
						<h1>{{ activeOnboarding.title }}</h1>
						<MkA :to="activeOnboarding.to" :class="$style.onboardingAction">{{ activeOnboarding.action }}</MkA>
					</div>
					<div :class="$style.onboardingArtwork">
						<img :key="activeOnboarding.image" :src="activeOnboarding.image" alt="" draggable="false">
					</div>
				</div>
				<button type="button" class="_button" :class="$style.onboardingPlayback" :aria-label="onboardingPaused ? i18n.ts.zalip.onboardingResume : i18n.ts.zalip.onboardingPause" :aria-pressed="onboardingPaused" @click="toggleOnboardingAutoplay"><i :class="onboardingPaused ? 'ti ti-player-play-filled' : 'ti ti-player-pause-filled'"></i></button>
				<div :class="$style.onboardingDots" role="group" :aria-label="i18n.ts.zalip.onboardingDots">
					<button v-for="(_slide, index) in onboardingSlides" :key="index" type="button" class="_button" :class="{ [$style.onboardingDotActive]: index === activeOnboardingIndex }" :aria-label="i18n.tsx.zalip.onboardingDot({ number: (index + 1).toString() })" :aria-current="index === activeOnboardingIndex ? 'true' : undefined" @click="selectOnboarding(index)"></button>
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

			<section v-if="homeTimeline" :class="$style.feed">
				<div :class="$style.feedTabs" role="group" :aria-label="i18n.ts.timeline">
					<button v-if="publicTimeline" type="button" class="_button" :class="{ [$style.feedTabActive]: !followingFeed }" :aria-pressed="!followingFeed" @click="followingFeed = false">{{ i18n.ts.zalip.communityFeed }}</button>
					<button v-if="$i" type="button" class="_button" :class="{ [$style.feedTabActive]: homeTimeline === 'home' }" :aria-pressed="homeTimeline === 'home'" @click="followingFeed = true">{{ i18n.ts.zalip.followingFeed }}</button>
				</div>
				<button type="button" class="_button" :class="$style.compose" @click="writePost"><i class="ti ti-pencil-plus"></i>{{ i18n.ts.zalip.writePost }}</button>
				<MkStreamingNotesTimeline :key="homeTimeline" :src="homeTimeline" :withReplies="false" :withRenotes="true"/>
			</section>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import { $i } from '@/i.js';
import { isAvailableBasicTimeline } from '@/timelines.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';

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
	trailerYoutubeKey: string | null;
	genres: string[];
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

type WorkKind = ZalipWork['kind'];

const onboardingSlides = [
	{
		title: i18n.ts.zalip.onboardingLibraryTitle,
		image: '/vite/zalip/onboarding/1.webp',
		icon: 'ti ti-bookmark',
		to: '/library',
		action: i18n.ts.zalip.onboardingLibraryAction,
	},
	{
		title: i18n.ts.zalip.onboardingFriendsTitle,
		image: '/vite/zalip/onboarding/2.webp',
		icon: 'ti ti-users',
		to: '/timeline',
		action: i18n.ts.zalip.onboardingFriendsAction,
	},
	{
		title: i18n.ts.zalip.onboardingPostsTitle,
		image: '/vite/zalip/onboarding/3.webp',
		icon: 'ti ti-pencil-plus',
		to: '/timeline',
		action: i18n.ts.zalip.onboardingPostsAction,
	},
	{
		title: i18n.ts.zalip.onboardingDiscussionsTitle,
		image: '/vite/zalip/onboarding/4.webp',
		icon: 'ti ti-messages',
		to: '/timeline',
		action: i18n.ts.zalip.onboardingDiscussionsAction,
	},
	{
		title: i18n.ts.zalip.onboardingDiscoverTitle,
		image: '/vite/zalip/onboarding/5.webp',
		icon: 'ti ti-search',
		to: '/catalog',
		action: i18n.ts.zalip.onboardingDiscoverAction,
	},
] as const;

const works = ref<ZalipWork[]>([]);
const releaseEvents = ref<ZalipReleaseEvent[]>([]);
const releaseEventsLoaded = ref(false);
const activeOnboardingIndex = ref(0);
const onboardingPaused = ref(false);
const activeOnboarding = computed(() => onboardingSlides[activeOnboardingIndex.value]!);
const releaseDrag = useZalipHorizontalDrag();
const followingFeed = ref(false);
const publicTimeline = computed(() => isAvailableBasicTimeline('local') ? 'local' : isAvailableBasicTimeline('global') ? 'global' : null);
const homeTimeline = computed(() => $i && (followingFeed.value || !publicTimeline.value) ? 'home' : publicTimeline.value);

async function writePost(): Promise<void> {
	if (!await pleaseLogin()) return;
	void os.post();
}

let onboardingTimer: number | null = null;
let onboardingSwipe: { pointerId: number; startX: number; startY: number } | null = null;
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

function kindLabel(kind: WorkKind): string {
	return ({ movie: i18n.ts.zalip.searchMovies, series: i18n.ts.zalip.searchSeries, anime: i18n.ts.zalip.searchAnime, animation: i18n.ts.zalip.searchAnimation })[kind];
}

function releaseLabel(release: ZalipReleaseEvent): string {
	const season = release.season.seasonNumber === 0 ? 'Спецэпизод' : `Сезон ${release.season.seasonNumber}`;
	return `${season} · серия ${release.episode.episodeNumber}`;
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

function selectOnboarding(index: number): void {
	activeOnboardingIndex.value = index;
	startOnboardingAutoplay();
}

function showOnboarding(step: number): void {
	activeOnboardingIndex.value = (activeOnboardingIndex.value + step + onboardingSlides.length) % onboardingSlides.length;
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
	if (event.button !== 0 || (event.target instanceof Element && event.target.closest('a, button'))) return;
	onboardingSwipe = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY };
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	stopOnboardingAutoplay();
}

function moveOnboardingSwipe(event: PointerEvent): void {
	if (onboardingSwipe == null || onboardingSwipe.pointerId !== event.pointerId) return;
	const deltaX = Math.abs(event.clientX - onboardingSwipe.startX);
	const deltaY = Math.abs(event.clientY - onboardingSwipe.startY);
	if (deltaX > 8 && deltaX > deltaY) event.preventDefault();
}

function endOnboardingSwipe(event: PointerEvent): void {
	if (onboardingSwipe == null || onboardingSwipe.pointerId !== event.pointerId) return;
	const deltaX = event.clientX - onboardingSwipe.startX;
	const deltaY = event.clientY - onboardingSwipe.startY;
	if (Math.abs(deltaX) > 48 && Math.abs(deltaX) > Math.abs(deltaY)) showOnboarding(deltaX < 0 ? 1 : -1);
	onboardingSwipe = null;
	startOnboardingAutoplay();
}

function cancelOnboardingSwipe(): void {
	onboardingSwipe = null;
	startOnboardingAutoplay();
}

onMounted(() => {
	void loadHome();
	startOnboardingAutoplay();
});

onBeforeUnmount(stopOnboardingAutoplay);

definePage(() => ({
	title: 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.page {
	padding: 24px var(--MI-margin) 52px;
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 7px;
	margin: 0 0 10px;
	font-size: 0.72rem;
	font-weight: 700;
	letter-spacing: 0.1em;
	color: var(--MI_THEME-accent);
}

.onboarding {
	position: relative;
	overflow: hidden;
	min-height: 360px;
	border-radius: var(--zalip-radius-big);
	background: var(--MI_THEME-zalipOnboardingBg, var(--MI_THEME-panel));
	touch-action: pan-y;
}

.onboardingSlide {
	display: grid;
	grid-template-columns: minmax(0, 0.86fr) minmax(0, 1.14fr);
	min-height: 360px;
}

.onboardingCopy {
	position: relative;
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	justify-content: center;
	padding: 44px 22px 50px 36px;
}

.onboardingEyebrow {
	display: flex;
	align-items: center;
	gap: 7px;
	margin: 0 0 12px;
	color: var(--MI_THEME-accent);
	font-size: 0.76rem;
	font-weight: 800;
	letter-spacing: 0.06em;
	text-transform: uppercase;
}

.onboardingCopy h1 {
	max-width: 470px;
	margin: 0;
	font-size: clamp(1.5rem, 3vw, 2.2rem);
	line-height: 1.16;
	letter-spacing: -0.025em;
}

.onboardingAction {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 168px;
	min-height: 46px;
	margin-top: 24px;
	padding: 0 22px;
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-fg);
	color: var(--MI_THEME-bg);
	font-weight: 800;
	text-decoration: none;
}

.onboardingAction:hover,
.onboardingAction:focus-visible {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
	text-decoration: none;
}

.onboardingArtwork {
	display: flex;
	align-items: flex-end;
	justify-content: center;
	min-width: 0;
	padding: 16px 24px 0 0;
}

.onboardingArtwork img {
	display: block;
	width: 100%;
	max-height: 344px;
	object-fit: contain;
	object-position: center bottom;
	user-select: none;
}

.onboardingPlayback {
	position: absolute;
	z-index: 3;
	top: 12px;
	right: 12px;
	display: grid;
	place-items: center;
	width: 34px;
	height: 34px;
	border-radius: 50%;
	background: color-mix(in srgb, var(--MI_THEME-bg) 84%, transparent);
	color: var(--MI_THEME-fg);
}

.onboardingDots {
	position: absolute;
	z-index: 2;
	bottom: 16px;
	left: 36px;
	display: flex;
	align-items: center;
	gap: 0;
}

.onboardingDots button {
	display: grid;
	place-items: center;
	width: 24px;
	height: 24px;
	background: transparent;
}

.onboardingDots button::before {
	width: 7px;
	height: 7px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-fg) 28%, transparent);
	transition: width 0.18s ease, background 0.18s ease;
	content: '';
}

.onboardingDots .onboardingDotActive::before {
	width: 20px;
	background: var(--MI_THEME-accent);
}

.catalogue {
	margin-top: 36px;
}

.releases {
	margin-top: 32px;
}

.sectionHeader {
	display: flex;
	align-items: end;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 16px;
}

.sectionHeader h2 {
	margin: 0;
	font-size: 1.35rem;
}

.count {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.85rem;
}

.releaseControls {
	display: flex;
	align-items: center;
	gap: 7px;
}

.catalogueMeta {
	display: flex;
	align-items: center;
	justify-content: end;
	gap: 10px;
}

.catalogueControls {
	display: flex;
	flex-direction: column;
	align-items: stretch;
	gap: 10px;
	margin: -2px 0 18px;
}

.filterLine {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
}

.kindRail {
	display: flex;
	gap: 7px;
	min-width: 0;
	overflow-x: auto;
	padding: 1px;
	scrollbar-width: none;
}

.kindRail::-webkit-scrollbar {
	display: none;
}

.kindChip {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	flex: 0 0 auto;
	padding: 9px 12px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-accent) 28%, var(--MI_THEME-divider));
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 85%, transparent);
	color: var(--MI_THEME-fg);
	font-size: 0.8rem;
	font-weight: 750;
	text-decoration: none;
}

.kindChip:hover,
.kindChip:focus-visible {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
	text-decoration: none;
}

.kindChipActive {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.sortControl {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	flex: 0 0 auto;
	padding: 10px 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	font-size: 0.82rem;
	font-weight: 700;
}

.sortControl i:last-child {
	font-size: 0.9rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

.genreRail {
	display: flex;
	gap: 7px;
	min-width: 0;
	overflow-x: auto;
	padding: 1px;
	scrollbar-width: none;
}

.genreRail::-webkit-scrollbar {
	display: none;
}

.genreChip {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	flex: 0 0 auto;
	padding: 9px 11px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
	font-weight: 700;
	text-decoration: none;
	transition: border-color 0.2s ease, background 0.2s ease, color 0.2s ease;
}

.genreChip:hover {
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 55%, var(--MI_THEME-divider));
	color: var(--MI_THEME-fg);
	text-decoration: none;
}

.genreChipActive {
	border-color: var(--MI_THEME-accent);
	background: var(--MI_THEME-accentedBg);
	color: var(--MI_THEME-accent);
}

.resetGenre {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	color: var(--MI_THEME-accent);
	font-size: 0.82rem;
	font-weight: 700;
	text-decoration: none;
}

.empty {
	display: grid;
	justify-items: center;
	gap: 10px;
	padding: 48px 20px;
	border: 1px dashed var(--MI_THEME-divider);
	border-radius: 20px;
	text-align: center;
	color: var(--MI_THEME-fgTransparentWeak);
}

.empty i {
	font-size: 2rem;
	color: var(--MI_THEME-accent);
}

.empty strong {
	color: var(--MI_THEME-fg);
}

.grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
	gap: 14px;
}

.releaseRail {
	display: flex;
	user-select: none;
	gap: 12px;
	overflow-x: auto;
	overflow-y: hidden;
	padding: 1px;
	scroll-snap-type: none;
	scrollbar-width: none;
	cursor: grab;
}

.releaseRail::-webkit-scrollbar {
	display: none;
}

.releaseRail[data-dragging='true'] {
	cursor: grabbing;
	user-select: none;
}

.releaseListItem {
	flex: 0 0 clamp(145px, 16.5vw, 184px);
}

.releaseCard {
	display: block;
	height: 100%;
	overflow: hidden;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 78%, transparent);
	border-radius: var(--MI-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
}

.releaseCard:hover {
	transform: translateY(-3px);
	border-color: color-mix(in srgb, var(--MI_THEME-accent) 50%, var(--MI_THEME-divider));
	box-shadow: 0 12px 28px color-mix(in srgb, var(--MI_THEME-shadow) 32%, transparent);
}

.releaseCard:focus-visible {
	outline: 2px solid var(--MI_THEME-accent);
	outline-offset: 3px;
}

.releasePoster {
	position: relative;
	display: grid;
	place-items: center;
	overflow: hidden;
	aspect-ratio: 2 / 3;
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 26%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 2rem;
}

.releasePoster::after {
	position: absolute;
	inset: 40% 0 0;
	background: linear-gradient(transparent, color-mix(in srgb, var(--MI_THEME-bg) 84%, transparent));
	content: '';
	pointer-events: none;
}

:global(html[data-color-scheme='light']) .releasePoster::after {
	display: none;
}

.releasePoster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.releaseBadge {
	position: absolute;
	z-index: 1;
	bottom: 8px;
	left: 8px;
	display: inline-flex;
	align-items: center;
	gap: 4px;
	max-width: calc(100% - 16px);
	overflow: hidden;
	padding: 4px 7px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 82%, transparent);
	backdrop-filter: blur(8px);
	color: var(--MI_THEME-fg);
	font-size: 0.67rem;
	font-weight: 700;
	line-height: 1.2;
}

.releaseBadge i {
	flex: 0 0 auto;
	color: var(--MI_THEME-accent);
	font-size: 0.78rem;
}

:global(html[data-color-scheme='light']) .releaseBadge {
	background: var(--MI_THEME-panel);
	backdrop-filter: none;
}

.releaseBadgeText {
	overflow: hidden;
	min-width: 0;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.releaseBody {
	display: grid;
	gap: 4px;
	padding: 10px 11px 12px;
}

.releaseBody strong,
.releaseBody span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.releaseBody strong {
	font-size: 1rem;
	line-height: 1.25;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
	white-space: normal;
}

.releaseBody span {
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.74rem;
}

.credits {
	margin: 22px 0 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.78rem;
}

.credits a {
	color: var(--MI_THEME-accent);
}

.card {
	overflow: hidden;
	border-radius: var(--zalip-radius-big);
	background: var(--MI_THEME-panel);
	text-decoration: none;
	color: var(--MI_THEME-fg);
	transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
	transform: translateY(-3px);
	box-shadow: 0 12px 30px color-mix(in srgb, var(--MI_THEME-shadow) 38%, transparent);
}

.poster {
	display: grid;
	place-items: center;
	aspect-ratio: 2 / 3;
	background: linear-gradient(145deg, var(--MI_THEME-panelHighlight), color-mix(in srgb, var(--MI_THEME-accent) 26%, var(--MI_THEME-panel)));
	color: var(--MI_THEME-accent);
	font-size: 2.3rem;
}

.poster img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.cardBody {
	padding: 12px;
}

.cardBody p, .cardBody span {
	margin: 0;
	font-size: 0.78rem;
	color: var(--MI_THEME-fgTransparentWeak);
}

.cardBody h3 {
	margin: 5px 0;
	font-size: 0.95rem;
	line-height: 1.25;
}

@media (max-width: 767px) {
	.page {
		padding-top: 12px;
	}

	.onboarding {
		min-height: 540px;
	}

	.onboardingSlide {
		grid-template-columns: 1fr;
		grid-template-rows: auto minmax(270px, 1fr);
		min-height: 540px;
	}

	.onboardingCopy {
		position: static;
		padding: 24px 22px 12px;
	}

	.onboardingCopy h1 {
		font-size: 1.35rem;
		line-height: 1.25;
	}

	.onboardingAction {
		position: absolute;
		right: 18px;
		bottom: 16px;
		left: 18px;
		min-height: 48px;
		margin: 0;
	}

	.onboardingArtwork {
		align-items: center;
		padding: 0 20px 72px;
	}

	.onboardingArtwork img {
		max-height: 310px;
	}

	.onboardingDots {
		bottom: 72px;
		left: 50%;
		transform: translateX(-50%);
	}

	.grid {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}

	.releaseRail {
		gap: 10px;
		margin-right: calc(var(--MI-margin) * -1);
		padding-right: var(--MI-margin);
	}

	.releaseListItem {
		flex-basis: 142px;
	}

	.releaseControls .count {
		display: none;
	}

	.catalogueControls {
		align-items: stretch;
	}

	.filterLine {
		align-items: stretch;
		flex-direction: column;
	}

	.sortControl {
		align-self: flex-start;
	}
}

/* Ongaku-inspired discovery shell, rebuilt with Zalip data and controls. */
.page {
	max-width: 960px;
	margin: 0 auto;
	padding: 22px var(--MI-margin) 64px;
}

.releases {
	margin-top: 30px;
}

.sectionHeader h2 {
	font-size: 1.35rem;
}

.releaseRail {
	gap: 12px;
}

.releaseListItem {
	flex-basis: 158px;
}

.releaseCard {
	border: 0;
	border-radius: var(--zalip-radius);
	background: transparent;
}

.releasePoster {
	border-radius: var(--zalip-radius);
}

.releaseBody {
	padding: 8px 2px 2px;
}

@media (max-width: 767px) {
	.page { padding: 14px var(--MI-margin) 36px; }
	.releaseListItem { flex-basis: 138px; }
}

.feed {
	margin: 32px auto 0;
	max-width: 720px;
	overflow: hidden;
	border-radius: var(--zalip-radius-big);
	background: var(--MI_THEME-panel);
}

.feedTabs { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--MI_THEME-divider); }
.feedTabs button { min-height: 44px; padding: 8px 14px; border-radius: var(--zalip-radius); font-weight: 700; }
.feedTabActive { background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-accent); }
.compose { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 16px 24px; color: var(--MI_THEME-fgTransparentWeak); border-bottom: 1px solid var(--MI_THEME-divider); text-align: left; }
.compose i { font-size: 24px; }
</style>
