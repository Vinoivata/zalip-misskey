<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<component :is="pullToRefresh && prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="refresh" :class="$style.root">
	<div :class="$style.controls"><label :class="$style.check"><input v-model="hideSpoilers" type="checkbox"> {{ i18n.ts.zalip._reviews.hideSpoilers }}</label><button type="button" class="_button" :class="$style.refresh" :disabled="pager.state.pending" :aria-label="i18n.ts.reload" @click="refresh"><i class="ti ti-refresh" aria-hidden="true"></i></button></div>
	<p v-if="actionError" role="alert" :class="[$style.state, $style.error]">{{ actionError }}</p>
	<div :class="$style.items">
		<template v-for="item in pager.state.items" :key="`${generation}:${item.key}`">
			<MkNote v-if="item.type === 'comment'" :class="$style.note" :note="item.note" :withHardMute="true" :hideNestedPreviews="true"/>
			<MkZalipReviewCard v-else :review="item.review" :work="item.work" :viewerId="$i?.id" :revealed="revealed.has(item.key)" :pending="pending.has(item.key)" @reveal="reveal(item.key)" @vote="vote(item, $event)" @menu="openMenu(item, $event)"/>
		</template>
	</div>
	<div v-if="pager.state.pending" role="status" :class="$style.state" :aria-label="i18n.ts.loading"><MkLoading/></div>
	<div v-if="pager.state.error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._socialFeed.loadError }}</p><button type="button" class="_button" :class="$style.action" @click="pager.load">{{ i18n.ts.retry }}</button></div>
	<p v-else-if="pager.state.loaded && !pager.state.items.length && !pager.state.pending && !pager.state.hasMore" :class="$style.state">{{ section === 'essays' ? i18n.ts.zalip._socialFeed.emptyEssays : i18n.ts.zalip._socialFeed.emptyDiscussions }}</p>
	<button v-if="pager.state.hasMore && !pager.state.pending && !pager.state.error" type="button" class="_button" :class="$style.more" @click="pager.load">{{ i18n.ts.loadMore }}</button>
</component>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, provide, ref, watch } from 'vue';
import { url } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import type { ZalipReview, ZalipReviewSentiment } from '@/utility/zalip-reviews.js';
import type { ZalipSocialFeedItem, ZalipSocialFeedResponse, ZalipSocialFeedSection } from '@/components/zalip-social-feed.js';
import MkNote from '@/components/MkNote.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import MkZalipReviewCard from '@/components/MkZalipReviewCard.vue';
import { createZalipSocialFeedPager } from '@/components/zalip-social-feed.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { zalipWorkRoute } from '@/utility/zalip-work-route.js';
import { prefer } from '@/preferences.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

type ReviewItem = Exclude<ZalipSocialFeedItem, { type: 'comment' }>;
type EditDraft = Pick<ZalipReview, 'body' | 'title' | 'sentiment' | 'isSpoiler'>;
const props = withDefaults(defineProps<{ section: ZalipSocialFeedSection; pullToRefresh?: boolean; withSensitive?: boolean }>(), { pullToRefresh: true, withSensitive: false });
provide('inTimeline', true);
provide('tl_withSensitive', computed(() => props.withSensitive));
const pager = createZalipSocialFeedPager({ accountId: () => $i?.id ?? null, fetchPage: request => misskeyApiZalip<ZalipSocialFeedResponse>('zalip/feed/list', request) });
const hideSpoilers = ref(true);
const actionError = ref('');
const revealed = ref(new Set<string>());
const pending = ref(new Set<string>());
const editDrafts = new Map<string, EditDraft>();
// MkNote intentionally captures its initial packed snapshot. A refreshed/account-
// switched page must mount fresh native cards, not reuse another viewer's state.
const generation = ref(0);
let contextEpoch = 0;
let deactivated = false;

function clearActions(): void {
	contextEpoch++;
	generation.value++;
	actionError.value = '';
	revealed.value = new Set();
	pending.value = new Set();
	editDrafts.clear();
}

async function refresh(): Promise<void> {
	clearActions();
	pager.reset(props.section, hideSpoilers.value);
	if (deactivated) { pager.dispose(); return; }
	await pager.load();
}

defineExpose({ refresh });

function reveal(key: string): void { revealed.value = new Set([...revealed.value, key]); }

function begin(key: string): void { pending.value = new Set([...pending.value, key]); }

function finish(key: string): void { const next = new Set(pending.value); next.delete(key); pending.value = next; }

function context(item: ReviewItem) {
	const epoch = contextEpoch;
	const account = $i?.id;
	const same = () => epoch === contextEpoch && account != null && account === $i?.id;
	const current = () => same() && pager.state.items.some(value => value.type !== 'comment' && value.key === item.key && value.work.id === item.work.id && value.review.user.id === item.review.user.id && value.review.format === item.review.format);
	return { account, same, current };
}

function matches(item: ReviewItem, review: ZalipReview): boolean {
	return review.id === item.id && review.workId === item.work.id && review.format === item.type && review.user.id === item.review.user.id;
}

async function vote(item: ReviewItem, value: 'helpful' | 'unhelpful'): Promise<void> {
	if (!$i) { await pleaseLogin(); return; }
	if (item.review.user.id === $i.id || pending.value.has(item.key)) return;
	const guard = context(item);
	if (!guard.current()) return;
	begin(item.key); actionError.value = '';
	try {
		const result = await misskeyApiZalip<ZalipReview>('zalip/reviews/vote', { reviewId: item.id, value: item.review.myVote === value ? null : value });
		if (!guard.current()) return;
		if (!matches(item, result)) throw new Error('Unexpected review response');
		pager.replaceReview(result);
	} catch { if (guard.current()) actionError.value = i18n.ts.zalip._reviews.voteError; } finally { if (guard.same()) finish(item.key); }
}

async function edit(item: ReviewItem): Promise<void> {
	const guard = context(item);
	if (!guard.current() || item.review.user.id !== guard.account || !item.review.canEdit || pending.value.has(item.key)) return;
	begin(item.key); actionError.value = '';
	const draft = editDrafts.get(item.key) ?? item.review;
	try {
		const { canceled, result } = await os.form(i18n.ts.edit, {
			title: { type: 'string', label: i18n.ts.zalip._reviews.titleLabel, default: draft.title ?? '', required: item.type === 'essay', hidden: item.type !== 'essay' },
			body: { type: 'string', label: i18n.ts.zalip._reviews.bodyLabel, default: draft.body, multiline: true, required: true },
			sentiment: { type: 'enum', label: i18n.ts.zalip._reviews.opinion, default: draft.sentiment, enum: [{ value: 'positive', label: i18n.ts.zalip._reviews.positive }, { value: 'neutral', label: i18n.ts.zalip._reviews.neutral }, { value: 'negative', label: i18n.ts.zalip._reviews.negative }] },
			isSpoiler: { type: 'boolean', label: i18n.ts.zalip._reviews.spoiler, default: draft.isSpoiler },
		});
		if (!guard.current()) return;
		if (canceled) { editDrafts.delete(item.key); return; }
		const next: EditDraft = { title: String(result.title).trim(), body: String(result.body).trim(), sentiment: String(result.sentiment) as ZalipReviewSentiment, isSpoiler: result.isSpoiler };
		editDrafts.set(item.key, next);
		if (Array.from(next.body).length < 20 || Array.from(next.body).length > 12000) { actionError.value = i18n.ts.zalip._reviews.bodyInvalid; return; }
		if (item.type === 'essay' && (!next.title || Array.from(next.title).length > 200)) { actionError.value = i18n.ts.zalip._reviews.essayTitleInvalid; return; }
		if (!['positive', 'neutral', 'negative'].includes(next.sentiment)) return;
		if (!guard.current()) return;
		// Text editing does not submit rating. Both independent formats keep the
		// author's latest native score, including a quick rating changed elsewhere.
		const saved = await misskeyApiZalip<ZalipReview>('zalip/reviews/upsert', { workId: item.work.id, format: item.type, title: item.type === 'essay' ? next.title : null, body: next.body, sentiment: next.sentiment, isSpoiler: next.isSpoiler });
		if (!guard.current()) return;
		if (!matches(item, saved)) throw new Error('Unexpected review response');
		editDrafts.delete(item.key);
		if (hideSpoilers.value && saved.isSpoiler) pager.removeReview(saved.id);
		else pager.replaceReview(saved);
	} catch { if (guard.current()) actionError.value = i18n.ts.zalip._reviews.saveError; } finally { if (guard.same()) finish(item.key); }
}

async function remove(item: ReviewItem): Promise<void> {
	const guard = context(item);
	if (!guard.current() || !item.review.canDelete || pending.value.has(item.key)) return;
	begin(item.key); actionError.value = '';
	try {
		const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts.zalip._reviews.deleteConfirm });
		if (canceled || !guard.current()) return;
		await misskeyApiZalip<void>('zalip/reviews/delete', { reviewId: item.id });
		if (!guard.current()) return;
		editDrafts.delete(item.key);
		pager.removeReview(item.id);
	} catch { if (guard.current()) actionError.value = i18n.ts.zalip._reviews.deleteError; } finally { if (guard.same()) finish(item.key); }
}

function openMenu(item: ReviewItem, event: MouseEvent): void {
	const guard = context(item);
	if (!guard.current() || pending.value.has(item.key)) return;
	const menu: MenuItem[] = [];
	if (item.review.canEdit && item.review.user.id === guard.account) menu.push({ icon: 'ti ti-pencil', text: i18n.ts.edit, action: () => { if (guard.current()) void edit(item); } });
	if (item.review.canDelete) menu.push({ icon: 'ti ti-trash', text: i18n.ts.delete, danger: true, action: () => { if (guard.current()) void remove(item); } });
	if (item.review.user.id !== guard.account) menu.push({ icon: 'ti ti-flag', text: i18n.ts.zalip._reviews.report, action: async () => {
		if (!guard.current()) return;
		try {
			const component = await import('@/components/MkAbuseReportWindow.vue');
			if (!guard.current()) return;
			const { dispose } = os.popup(component.default, { user: item.review.user, initialComment: `${url}${zalipWorkRoute(item.work.slug)}#review-${encodeURIComponent(item.id)}\n-----\n` }, { closed: () => dispose() });
		} catch { if (guard.current()) actionError.value = i18n.ts.somethingHappened; }
	} });
	void os.popupMenu(menu, event.currentTarget as HTMLElement, { width: 300, appearance: 'zalip-note' });
}

watch(() => [props.section, hideSpoilers.value, $i?.id], () => { void refresh(); }, { immediate: true, flush: 'sync' });
onDeactivated(() => { deactivated = true; clearActions(); pager.dispose(); });
onActivated(() => { if (deactivated) { deactivated = false; void refresh(); } });
onBeforeUnmount(() => { clearActions(); pager.dispose(); });
</script>

<style lang="scss" module>
.root { min-width: 0; background: var(--MI_THEME-panel); }
.controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 16px; border-bottom: 1px solid var(--MI_THEME-divider); }
.check { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 0.85em; input { width: 18px; height: 18px; accent-color: var(--MI_THEME-accent); } }
.refresh { display: grid; place-items: center; min-width: 44px; min-height: 44px; }
.items { min-width: 0; }
.note { border-radius: 0; background: transparent; }
.state { margin: 0; padding: 24px 16px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); p { margin: 0 0 12px; } }
.error { color: var(--MI_THEME-error); }
.action { min-height: 44px; padding: 10px 16px; border-radius: 999px; background: var(--MI_THEME-buttonBg); }
.more { display: block; width: 100%; min-height: 52px; padding: 16px; box-sizing: border-box; }
.root button:focus-visible, .root input:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.root button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
