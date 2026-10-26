<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="$style.root">
	<div :class="$style.heading">
		<div :class="$style.poster" aria-hidden="true">
			<img v-if="poster" :src="poster" alt="" width="80" height="120" loading="lazy" decoding="async" @error="images.failed">
			<i v-else class="ti ti-movie" aria-hidden="true"></i>
		</div>
		<MkA :class="$style.title" :to="zalipWorkRoute(notification.workSlug)">{{ notification.workTitle }}</MkA>
	</div>
	<div :class="$style.event">
		<p :class="$style.eventCaption"><span :class="$style.eventDot" aria-hidden="true"></span>{{ eventCaption }}</p>
		<ul :class="$style.events">
			<li v-for="event in visibleEvents" :key="event.id">
				<MkA :class="$style.release" :to="event.route" :aria-label="event.accessibleLabel" :data-notification-id="event.id" :data-scroll-anchor="event.id === notification.id ? undefined : event.id">
					<span :class="$style.eventContent">
						<span :class="$style.episode">{{ event.target ?? i18n.ts.zalip.watchTitle }}</span>
						<span v-if="event.title" :class="$style.episodeTitle">{{ event.title }}</span>
					</span>
					<MkTime v-if="withTime" :class="$style.date" :time="event.createdAt"/>
					<i class="ti ti-chevron-right" :class="$style.eventArrow" aria-hidden="true"></i>
				</MkA>
			</li>
		</ul>
		<details v-if="remainingEvents.length" :class="$style.more">
			<summary><span>{{ i18n.ts.showMore }} ({{ remainingEvents.length }})</span><i class="ti ti-chevron-down" aria-hidden="true"></i></summary>
			<ul :class="$style.events">
				<li v-for="event in remainingEvents" :key="event.id">
					<MkA :class="$style.release" :to="event.route" :aria-label="event.accessibleLabel" :data-notification-id="event.id" :data-scroll-anchor="event.id === notification.id ? undefined : event.id">
						<span :class="$style.eventContent">
							<span :class="$style.episode">{{ event.target ?? i18n.ts.zalip.watchTitle }}</span>
							<span v-if="event.title" :class="$style.episodeTitle">{{ event.title }}</span>
						</span>
						<MkTime v-if="withTime" :class="$style.date" :time="event.createdAt"/>
						<i class="ti ti-chevron-right" :class="$style.eventArrow" aria-hidden="true"></i>
					</MkA>
				</li>
			</ul>
		</details>
	</div>
	<MkA v-if="history" :class="$style.resume" :to="historyRoute" :aria-label="history.completed ? `${i18n.ts.zalip._progress.lastPlayedAction}: ${notification.workTitle}` : i18n.tsx.zalip._progress.continueTitle({ title: notification.workTitle })">
		<i class="ti ti-player-play" :class="$style.resumeIcon" aria-hidden="true"></i>
		<span :class="$style.resumeContent">
			<span :class="$style.continue">{{ history.completed ? i18n.ts.zalip._progress.lastPlayedAction : i18n.ts.zalip._progress.resume }}</span>
			<span :class="$style.resumeLabel">{{ resumeLabel }}</span>
		</span>
		<i class="ti ti-chevron-right" :class="$style.resumeArrow" aria-hidden="true"></i>
	</MkA>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUpdate, onUpdated, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import { useZalipReleaseProgress } from '@/composables/use-zalip-release-progress.js';
import { useZalipImages } from '@/utility/zalip-image.js';
import { watchTimeLabel } from '@/utility/zalip-watch-progress.js';
import { zalipWatchRoute, zalipWorkRoute } from '@/utility/zalip-work-route.js';
import { i18n } from '@/i18n.js';

type ReleaseNotification = Extract<Misskey.entities.Notification, { type: 'zalipEpisodeReleased' | 'zalipAllohaAvailable' }> & {
	posterPath?: string | null;
	posterThumbnailUrl?: string | null;
};
const props = withDefaults(defineProps<{
	notification: ReleaseNotification;
	notifications?: readonly ReleaseNotification[];
	withProgress?: boolean;
	withTime?: boolean;
}>(), { withProgress: true, withTime: true });
const rootEl = useTemplateRef('rootEl');
let focusedEvent: { id: string; element: HTMLElement } | null = null;
onBeforeUpdate(() => {
	const element = window.document.activeElement;
	const id = element instanceof HTMLElement ? element.dataset.notificationId : null;
	focusedEvent = id && rootEl.value?.contains(element) ? { id, element: element as HTMLElement } : null;
});
onUpdated(() => {
	const focused = focusedEvent;
	focusedEvent = null;
	// An incoming release can move the focused third link into the native fold.
	// Restore only that lost focus, never override another control's new focus.
	if (!focused || window.document.activeElement !== window.document.body) return;
	const target = Array.from(rootEl.value?.querySelectorAll<HTMLAnchorElement>('[data-notification-id]') ?? []).find(element => element.dataset.notificationId === focused.id);
	if (!target || target === focused.element) return;
	const details = target.closest('details');
	if (details) details.open = true;
	target.focus({ preventScroll: true });
});
const progress = useZalipReleaseProgress(() => props.notification.workId, () => props.withProgress);
const history = progress.item;
const images = useZalipImages();
// The native packer checks current publication visibility. A cached history
// poster must not bypass that check when a work has since been withdrawn.
const poster = computed(() => images.poster(props.notification, 'w185'));

function episodeLabel(season: number, episode: number): string {
	return `${i18n.tsx.zalip.releaseSeason({ number: String(season) })} · ${i18n.tsx.zalip.releaseEpisode({ number: String(episode) })}`;
}

function hasNumericCoordinates(notification: ReleaseNotification): notification is ReleaseNotification & { seasonNumber: number; episodeNumber: number } {
	return typeof notification.seasonNumber === 'number' && Number.isSafeInteger(notification.seasonNumber) && notification.seasonNumber >= 0
		&& typeof notification.episodeNumber === 'number' && Number.isSafeInteger(notification.episodeNumber) && notification.episodeNumber >= 0;
}

const events = computed(() => {
	const head = props.notification;
	const notifications = props.notifications?.filter(item => item.workId === head.workId && item.type === head.type) ?? [head];
	const seen = new Set<string>();
	const unique = (notifications.length > 0 ? notifications : [head]).filter(item => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
	// Only confirmed coordinates are ordered. Movie/unknown-coordinate events
	// keep their received positions, and the native objects/order stay untouched.
	const numbered = unique.filter(hasNumericCoordinates).sort((first, second) => second.seasonNumber - first.seasonNumber || second.episodeNumber - first.episodeNumber);
	let numberedIndex = 0;
	return unique.map(item => hasNumericCoordinates(item) ? numbered[numberedIndex++] ?? item : item).map(notification => {
		const target = notification.seasonNumber != null && notification.episodeNumber != null ? episodeLabel(notification.seasonNumber, notification.episodeNumber) : null;
		const title = notification.type === 'zalipEpisodeReleased' ? notification.episodeTitle : null;
		const label = title && target ? `${target}: ${title}` : target;
		return {
			id: notification.id,
			createdAt: notification.createdAt,
			target,
			title,
			route: zalipWatchRoute(notification.workSlug, notification.seasonNumber, notification.episodeNumber, notification.type === 'zalipAllohaAvailable' ? 'alloha' : null),
			accessibleLabel: `${i18n.ts.zalip.watchTitle}: ${notification.workTitle}${label ? ` · ${label}` : ''}`,
		};
	});
});
const visibleEvents = computed(() => events.value.slice(0, 3));
const remainingEvents = computed(() => events.value.slice(3));
const eventCaption = computed(() => props.notification.type === 'zalipEpisodeReleased' ? events.value.length > 1 ? i18n.ts.zalip.updatesHeading : i18n.ts._notification.zalipEpisodeReleased : i18n.ts.zalip.releaseAvailable);
const historyRoute = computed(() => history.value ? zalipWatchRoute(props.notification.workSlug, history.value.seasonNumber, history.value.episodeNumber, history.value.provider, history.value.translationId) : zalipWorkRoute(props.notification.workSlug));
const resumeLabel = computed(() => {
	const item = history.value;
	if (!item) return '';
	const target = item.seasonNumber != null && item.episodeNumber != null ? episodeLabel(item.seasonNumber, item.episodeNumber) : null;
	const time = item.mode === 'time' && item.positionSeconds != null && Number.isFinite(item.positionSeconds) && item.positionSeconds > 0 ? watchTimeLabel(item.positionSeconds) : null;
	if (item.completed) return i18n.tsx.zalip._progress.lastPlayed({ target: [target, time].filter(Boolean).join(' · ') || props.notification.workTitle });
	if (time && target) return i18n.tsx.zalip._progress.stoppedAt({ target: `${target} · ${time}` });
	if (time) return i18n.tsx.zalip._progress.stoppedAtMovie({ time });
	return target ? `${i18n.ts.zalip._progress.episodeOnly} · ${target}` : i18n.ts.zalip._progress.episodeOnly;
});
</script>

<style lang="scss" module>
.root {
	min-width: 0;
	color: var(--zalip-social-fg);
}

.heading {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
}

.poster {
	flex: 0 0 auto;
	display: grid;
	place-items: center;
	width: 40px;
	aspect-ratio: 2 / 3;
	border-radius: calc(var(--MI-radius) / 2);
	overflow: hidden;
	background: var(--zalip-social-raised);
	color: var(--zalip-social-subtle);

	> img { width: 100%; height: 100%; object-fit: cover; }
	> i { font-size: 22px; }
}

.title {
	min-width: 0;
	font-size: 16px;
	line-height: 1.4;
	font-weight: 600;
	overflow-wrap: anywhere;
}

.date {
	flex: 0 0 auto;
	margin-left: auto;
	color: var(--zalip-social-subtle);
	font-size: 12px;
	line-height: 1.5;
	white-space: nowrap;
}

.event { margin-top: 12px; }
.eventCaption { display: flex; align-items: center; gap: 7px; margin: 0; font-size: 16px; line-height: 1.5; }
.eventDot { flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%; background: var(--MI_THEME-accent); }
.events { margin: 4px 0 0; padding: 0; list-style: none; > li + li { border-top: 1px solid var(--zalip-social-border); } }
.more {
	border-top: 1px solid var(--zalip-social-border);
	> summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; list-style: none; cursor: pointer; }
	> summary::-webkit-details-marker { display: none; }
	> summary:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
	> summary > i { font-size: 16px; }
	> .events { margin-top: 0; }
}
.more[open] > summary > i { transform: rotate(180deg); }

.release {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 44px;
	padding: 6px 0;
	color: var(--zalip-social-fg);
}

.eventContent { display: grid; flex: 1; gap: 3px; min-width: 0; }
.episode { font-size: 14px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.episodeTitle { color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.eventArrow { flex: 0 0 auto; color: var(--zalip-social-subtle); font-size: 16px; }

.resume {
	display: flex;
	align-items: center;
	gap: 12px;
	box-sizing: border-box;
	width: 100%;
	min-height: 52px;
	margin-top: 8px;
	padding: 10px 12px;
	border-radius: calc(var(--MI-radius) * 2 / 3);
	background: var(--zalip-accent-soft);
	color: var(--MI_THEME-accent);
}

.resumeIcon { flex: 0 0 auto; font-size: 20px; }
.resumeContent { display: grid; gap: 2px; min-width: 0; }
.continue { font-size: 14px; line-height: 1.5; font-weight: 600; overflow-wrap: anywhere; }
.resumeLabel { color: var(--zalip-social-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.resumeArrow { flex: 0 0 auto; margin-left: auto; font-size: 16px; }

.title:focus-visible, .release:focus-visible, .resume:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
@media (hover: hover) {
	.title:hover, .release:hover .episode { text-decoration: underline; }
	.resume:hover { background: var(--zalip-accent-border); }
}

@container (max-width: 500px) {
	.heading { gap: 10px; }
	.title { font-size: 15px; }
	.release { gap: 8px; }
}
</style>
