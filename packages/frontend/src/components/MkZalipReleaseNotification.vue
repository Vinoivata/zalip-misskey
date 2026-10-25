<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<div :class="$style.poster" aria-hidden="true">
		<img v-if="poster" :src="poster" alt="" width="72" height="108" loading="lazy" decoding="async" @error="images.failed">
		<i v-else class="ti ti-movie" aria-hidden="true"></i>
	</div>
	<div :class="$style.content">
		<MkA :class="$style.title" :to="zalipWorkRoute(notification.workSlug)">{{ notification.workTitle }}</MkA>
		<MkA :class="$style.release" :to="eventRoute" :aria-label="eventAccessibleLabel">
			<i class="ti ti-player-play" aria-hidden="true"></i><span>{{ eventLabel }}</span>
		</MkA>
		<div v-if="history" :class="$style.resume">
			<p>{{ resumeLabel }}</p>
			<MkA :class="$style.continue" :to="historyRoute" :aria-label="history.completed ? `${i18n.ts.zalip._progress.lastPlayedAction}: ${notification.workTitle}` : i18n.tsx.zalip._progress.continueTitle({ title: notification.workTitle })">{{ history.completed ? i18n.ts.zalip._progress.lastPlayedAction : i18n.ts.zalip._progress.resume }}<i class="ti ti-chevron-right" aria-hidden="true"></i></MkA>
		</div>
	</div>
</div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
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
const props = withDefaults(defineProps<{ notification: ReleaseNotification; withProgress?: boolean }>(), { withProgress: true });
const progress = useZalipReleaseProgress(() => props.notification.workId, () => props.withProgress);
const history = progress.item;
const images = useZalipImages();
// The native packer checks current publication visibility. A cached history
// poster must not bypass that check when a work has since been withdrawn.
const poster = computed(() => images.poster(props.notification, 'w185'));

function episodeLabel(season: number, episode: number): string {
	return `${i18n.tsx.zalip.releaseSeason({ number: String(season) })} · ${i18n.tsx.zalip.releaseEpisode({ number: String(episode) })}`;
}

const eventRoute = computed(() => zalipWatchRoute(props.notification.workSlug, props.notification.seasonNumber, props.notification.episodeNumber, props.notification.type === 'zalipAllohaAvailable' ? 'alloha' : null));
const eventLabel = computed(() => {
	const notification = props.notification;
	if (notification.seasonNumber == null || notification.episodeNumber == null) return i18n.ts.zalip.watchTitle;
	const target = episodeLabel(notification.seasonNumber, notification.episodeNumber);
	return notification.type === 'zalipEpisodeReleased' && notification.episodeTitle ? `${target}: ${notification.episodeTitle}` : target;
});
const eventAccessibleLabel = computed(() => `${i18n.ts.zalip.watchTitle}: ${props.notification.workTitle}${props.notification.seasonNumber != null && props.notification.episodeNumber != null ? ` · ${eventLabel.value}` : ''}`);
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
.root { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 12px; min-width: 0; color: var(--zalip-social-fg); }
.poster { display: grid; place-items: center; width: 36px; height: 54px; border-radius: 5px; overflow: hidden; background: var(--zalip-social-raised); color: var(--zalip-social-muted); > img { width: 100%; height: 100%; object-fit: cover; } > i { font-size: 18px; } }
.content { display: flex; flex-direction: column; align-items: flex-start; min-width: 0; gap: 5px; }
.title { max-width: 100%; font-size: 14px; line-height: 1.4; font-weight: 600; overflow-wrap: anywhere; }
.release { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; min-height: 28px; color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; > i { flex: 0 0 auto; font-size: 16px; } > span { overflow-wrap: anywhere; } }
.resume { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; max-width: 100%; margin-top: 3px; > p { margin: 0; color: var(--zalip-social-muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; } }
.continue { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 36px; box-sizing: border-box; padding: 6px 11px; border-radius: 999px; background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); font-size: 12px; line-height: 1.4; font-weight: 600; white-space: normal; > i { font-size: 14px; } }
.title:focus-visible, .release:focus-visible, .continue:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.release:hover, .title:hover { color: var(--MI_THEME-accent); }
@media (hover: none), (pointer: coarse) { .release, .continue { min-height: 44px; } }
@container (max-width: 500px) { .title { font-size: 15px; } .root { gap: 10px; } }
</style>
