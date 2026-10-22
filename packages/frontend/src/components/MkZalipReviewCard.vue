<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article :id="`review-${review.id}`" :class="$style.root" :data-review-format="review.format">
	<MkAvatar :user="review.user" :class="$style.avatar" link/>
	<div :class="$style.main">
		<header :class="$style.header">
			<div :class="$style.author"><MkA :to="userPage(review.user)"><b>{{ review.user.name || review.user.username }}</b></MkA><MkTime :time="review.createdAt"/><span v-if="review.rating != null" :class="$style.rating"><i class="ti ti-star" aria-hidden="true"></i> {{ review.rating }}</span></div>
			<button v-if="viewerId" type="button" class="_button" :class="$style.menu" :disabled="disabled" :aria-label="i18n.ts.more" @click="emit('menu', $event)"><i class="ti ti-dots" aria-hidden="true"></i></button>
		</header>
		<MkA v-if="work" :to="zalipWorkRoute(work.slug)" :class="$style.work"><i class="ti ti-movie" aria-hidden="true"></i><span>{{ work.title }}<small v-if="work.releaseYear != null"> · {{ work.releaseYear }}</small></span></MkA>
		<div :class="$style.labels"><span>{{ review.format === 'essay' ? i18n.ts.zalip._reviews.essays : i18n.ts.zalip._reviews.reviews }}</span><span :class="$style[review.sentiment]">{{ sentimentLabel }}</span></div>
		<template v-if="!review.isSpoiler || revealed">
			<h3 v-if="review.title" :class="$style.title">{{ review.title }}</h3>
			<p :class="[$style.body, { [$style.collapsed]: longBody && !expanded }]" class="_selectable">{{ review.body }}</p>
			<button v-if="longBody" type="button" class="_button" :class="$style.toggle" :aria-expanded="expanded" @click="expanded = !expanded">{{ expanded ? i18n.ts.showLess : i18n.ts.showMore }}</button>
		</template>
		<button v-else type="button" class="_button" :class="$style.spoiler" @click="emit('reveal')"><i class="ti ti-eye-off" aria-hidden="true"></i><span>{{ i18n.ts.zalip._reviews.spoiler }}</span><b>{{ i18n.ts.zalip._reviews.showSpoiler }}</b></button>
		<footer :class="$style.votes">
			<button type="button" class="_button" :class="[$style.vote, { [$style.active]: review.myVote === 'helpful' }]" :disabled="disabled || review.user.id === viewerId || pending" :aria-pressed="review.myVote === 'helpful'" :aria-label="i18n.ts.zalip._reviews.useful" @click="emit('vote', 'helpful')"><i class="ti ti-thumb-up" aria-hidden="true"></i> {{ review.helpfulCount }}</button>
			<button type="button" class="_button" :class="[$style.vote, { [$style.active]: review.myVote === 'unhelpful' }]" :disabled="disabled || review.user.id === viewerId || pending" :aria-pressed="review.myVote === 'unhelpful'" :aria-label="i18n.ts.zalip._reviews.notUseful" @click="emit('vote', 'unhelpful')"><i class="ti ti-thumb-down" aria-hidden="true"></i> {{ review.unhelpfulCount }}</button>
		</footer>
	</div>
</article>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ZalipReview } from '@/utility/zalip-reviews.js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { zalipWorkRoute } from '@/utility/zalip-work-route.js';

const props = withDefaults(defineProps<{
	review: ZalipReview;
	viewerId?: string | null;
	revealed?: boolean;
	pending?: boolean;
	disabled?: boolean;
	work?: { slug: string; title: string; releaseYear: number | null };
}>(), { viewerId: null, revealed: false, pending: false, disabled: false, work: undefined });
const emit = defineEmits<{
	(ev: 'vote', value: 'helpful' | 'unhelpful'): void;
	(ev: 'menu', event: MouseEvent): void;
	(ev: 'reveal'): void;
}>();
const expanded = ref(false);
const longBody = computed(() => props.review.body.length > 800);
// Resolve leaf strings so the production locale inliner never inserts a group object into this arrow expression.
const sentimentLabel = computed(() => props.review.sentiment === 'positive' ? i18n.ts.zalip._reviews.positive : props.review.sentiment === 'negative' ? i18n.ts.zalip._reviews.negative : i18n.ts.zalip._reviews.neutral);
watch(() => [props.review.id, props.review.workId, props.review.body, props.review.isSpoiler, props.viewerId], () => { expanded.value = false; });
</script>

<style lang="scss" module>
.root { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 16px 16px 10px; box-sizing: border-box; border-bottom: 1px solid var(--MI_THEME-divider); scroll-margin-top: 90px; container-type: inline-size; &:last-child { border-bottom: 0; } }
.avatar { flex: 0 0 40px; width: 40px; height: 40px; }
.main { flex: 1; min-width: 0; }
.header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.author { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 0.88em; a { overflow-wrap: anywhere; } :global(time) { font-size: 0.88em; color: var(--MI_THEME-fgTransparentWeak); } }
.rating { display: inline-flex; align-items: center; gap: 4px; color: var(--MI_THEME-accent); font-weight: 700; }
.menu { flex: 0 0 44px; display: grid; place-items: center; width: 44px; height: 44px; margin-top: -10px; margin-right: -8px; font-size: 22px; }
.work { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 4px 0 8px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.82em; > span { min-width: 0; overflow-wrap: anywhere; } small { font-size: inherit; } }
.labels { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.73em; }
.positive { color: var(--MI_THEME-success); }
.negative { color: var(--MI_THEME-error); }
.title { margin: 14px 0 8px; font-size: 1.08em; overflow-wrap: anywhere; }
.body { margin: 12px 0 4px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; font-size: 0.94em; }
.collapsed { display: -webkit-box; -webkit-line-clamp: 6; line-clamp: 6; -webkit-box-orient: vertical; overflow: hidden; }
.toggle { min-height: 44px; color: var(--MI_THEME-accent); font-size: 0.85em; }
.spoiler { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; min-height: 88px; width: 100%; box-sizing: border-box; padding: 16px; margin: 12px 0; border: 1px dashed var(--MI_THEME-divider); border-radius: var(--MI-radius); color: var(--MI_THEME-fgTransparentWeak); background: var(--MI_THEME-buttonBg); b { flex: 1 1 100%; color: var(--MI_THEME-fg); font-size: 0.85em; } }
.votes { display: flex; gap: 8px; margin-top: 8px; }
.vote { display: inline-flex; align-items: center; gap: 6px; justify-content: center; min-width: 52px; min-height: 44px; padding: 8px 10px; border-radius: 999px; color: var(--MI_THEME-fgTransparentWeak); i { font-size: 18px; } }
.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.root button:focus-visible, .root a:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.root button:disabled { opacity: 0.5; cursor: not-allowed; }
@media (max-width: 600px) { .root { gap: 8px; padding: 14px 12px 8px; } }
</style>
