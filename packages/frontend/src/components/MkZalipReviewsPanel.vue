<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root" :aria-label="i18n.ts.zalip._reviews.title">
	<header :class="$style.header">
		<div><p :class="$style.eyebrow">{{ workTitle }}</p><h2>{{ i18n.ts.zalip._reviews.title }}</h2></div>
		<button v-if="$i" type="button" class="_button _buttonPrimary" :class="$style.write" :disabled="!pager.state.loaded || pager.state.pending || saving" @click="openEditor()"><i class="ti ti-pencil"></i> {{ pager.state.myReview ? i18n.ts.zalip._reviews.editOwn : i18n.ts.zalip._reviews.write }}</button>
	</header>
	<div v-if="pager.state.summary" :class="$style.summary">
		<div :class="$style.score"><strong>{{ pager.state.summary.averageRating?.toFixed(1) ?? '—' }}</strong><span>{{ i18n.ts.zalip._reviews.average }}</span><small>{{ i18n.ts.zalip._reviews.ratings }}: {{ pager.state.summary.ratingCount }}</small></div>
		<div :class="$style.histogram" role="img" :aria-label="histogramLabel">
			<div v-for="row in histogram" :key="row.rating" :class="$style.histogramRow"><span>{{ row.rating }}</span><span :class="$style.barTrack"><span :class="$style.bar" :style="{ width: `${row.width}%` }"></span></span><span>{{ row.count }}</span></div>
		</div>
		<div :class="$style.sentimentSummary"><strong>{{ i18n.ts.zalip._reviews.count }}: {{ pager.state.summary.reviewCount }}</strong><span :class="$style.positive">{{ i18n.ts.zalip._reviews.positive }} · {{ pager.state.summary.positiveCount }}</span><span>{{ i18n.ts.zalip._reviews.neutral }} · {{ pager.state.summary.neutralCount }}</span><span :class="$style.negative">{{ i18n.ts.zalip._reviews.negative }} · {{ pager.state.summary.negativeCount }}</span></div>
	</div>
	<div :class="$style.filters">
		<div :class="$style.formats" :aria-label="i18n.ts.zalip._reviews.format">
			<button v-for="item in formats" :key="item.value" type="button" class="_button" :class="{ [$style.active]: format === item.value }" :aria-pressed="format === item.value" @click="format = item.value">{{ item.label }}</button>
		</div>
		<div :class="$style.filterRow">
			<select v-model="sentiment" :class="$style.select" :aria-label="i18n.ts.zalip._reviews.opinion"><option value="all">{{ i18n.ts.zalip._reviews.all }}</option><option v-for="item in sentiments" :key="item.value" :value="item.value">{{ item.label }}</option></select>
			<select v-model="sort" :class="$style.select" :aria-label="i18n.ts.sort"><option value="newest">{{ i18n.ts.zalip._reviews.newest }}</option><option value="helpful">{{ i18n.ts.zalip._reviews.helpful }}</option></select>
			<label :class="$style.check"><input v-model="hideSpoilers" type="checkbox"> {{ i18n.ts.zalip._reviews.hideSpoilers }}</label>
		</div>
	</div>
	<div v-if="!$i" :class="$style.signIn"><p>{{ i18n.ts.zalip._reviews.signIn }}</p><button type="button" class="_button" :class="$style.action" @click="signIn">{{ i18n.ts.login }}</button></div>
	<form v-if="editorOpen && $i" :class="$style.editor" @submit.prevent="submit">
		<p :class="$style.caption">{{ i18n.ts.zalip._reviews.onePerWork }}</p>
		<div :class="$style.editorRow">
			<label>{{ i18n.ts.zalip._reviews.format }}<select v-model="draft.format" :class="$style.select" :disabled="saving"><option value="review">{{ i18n.ts.zalip._reviews.reviews }}</option><option value="essay">{{ i18n.ts.zalip._reviews.essays }}</option></select></label>
			<label>{{ i18n.ts.zalip._reviews.opinion }}<select v-model="draft.sentiment" :class="$style.select" :disabled="saving"><option v-for="item in sentiments" :key="item.value" :value="item.value">{{ item.label }}</option></select></label>
			<label>{{ i18n.ts.zalip._reviews.ratingLabel }}<select v-model="draft.rating" :class="$style.select" :disabled="saving" @change="ratingDirty = true"><option :value="null">{{ i18n.ts.zalip._reviews.noRating }}</option><option v-for="value in 10" :key="value" :value="value">{{ value }}</option></select></label>
		</div>
		<label v-if="draft.format === 'essay'" :class="$style.field">{{ i18n.ts.zalip._reviews.titleLabel }}<input v-model="draft.title" :class="$style.input" type="text" maxlength="200" :disabled="saving" required></label>
		<label :class="$style.field">{{ i18n.ts.zalip._reviews.bodyLabel }}<textarea ref="bodyInput" v-model="draft.body" :class="$style.input" rows="7" maxlength="12000" :disabled="saving" required></textarea></label>
		<div :class="$style.editorFooter"><label :class="$style.check"><input v-model="draft.isSpoiler" type="checkbox" :disabled="saving"> {{ i18n.ts.zalip._reviews.spoiler }}</label><small :class="$style.caption">{{ draft.body.trim().length }} / 12000</small></div>
		<p v-if="formError" role="alert" :class="$style.error">{{ formError }}</p>
		<div :class="$style.editorActions"><button type="button" class="_button" :class="$style.action" :disabled="saving" @click="closeEditor">{{ i18n.ts.cancel }}</button><button type="submit" class="_button _buttonPrimary" :class="$style.action" :disabled="saving"><i v-if="saving" class="ti ti-loader-2 ti-spin"></i> {{ pager.state.myReview ? i18n.ts.zalip._reviews.save : i18n.ts.zalip._reviews.submit }}</button></div>
	</form>
	<p v-if="actionError" role="alert" :class="[$style.state, $style.error]">{{ actionError }}</p>
	<div v-if="pager.state.items.length" :class="$style.items">
		<article v-for="review in pager.state.items" :id="`review-${review.id}`" :key="review.id" :class="$style.review">
			<MkAvatar :user="review.user" :class="$style.avatar" link/>
			<div :class="$style.reviewMain">
				<header :class="$style.reviewHeader"><div :class="$style.author"><MkA :to="userPage(review.user)"><b>{{ review.user.name || review.user.username }}</b></MkA><MkTime :time="review.createdAt"/><span v-if="review.rating != null" :class="$style.rating"><i class="ti ti-star"></i> {{ review.rating }}</span></div><button v-if="$i" type="button" class="_button" :class="$style.menu" :aria-label="i18n.ts.more" @click="openMenu(review, $event)"><i class="ti ti-dots"></i></button></header>
				<span :class="[$style.sentiment, $style[review.sentiment]]">{{ sentimentLabel(review.sentiment) }}</span>
				<template v-if="!review.isSpoiler || revealed.has(review.id)"><h3 v-if="review.title" :class="$style.reviewTitle">{{ review.title }}</h3><p :class="$style.body" class="_selectable">{{ review.body }}</p></template>
				<button v-else type="button" class="_button" :class="$style.spoiler" @click="reveal(review.id)"><i class="ti ti-eye-off"></i><span>{{ i18n.ts.zalip._reviews.spoiler }}</span><b>{{ i18n.ts.zalip._reviews.showSpoiler }}</b></button>
				<footer :class="$style.votes"><button type="button" class="_button" :class="[$style.vote, { [$style.active]: review.myVote === 'helpful' }]" :disabled="review.user.id === $i?.id || votePending.has(review.id)" :aria-pressed="review.myVote === 'helpful'" :aria-label="i18n.ts.zalip._reviews.useful" @click="vote(review, 'helpful')"><i class="ti ti-thumb-up"></i> {{ review.helpfulCount }}</button><button type="button" class="_button" :class="[$style.vote, { [$style.active]: review.myVote === 'unhelpful' }]" :disabled="review.user.id === $i?.id || votePending.has(review.id)" :aria-pressed="review.myVote === 'unhelpful'" :aria-label="i18n.ts.zalip._reviews.notUseful" @click="vote(review, 'unhelpful')"><i class="ti ti-thumb-down"></i> {{ review.unhelpfulCount }}</button></footer>
			</div>
		</article>
	</div>
	<div v-if="pager.state.error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip._reviews.loadError }}</p><button type="button" class="_button" :class="$style.action" @click="pager.load">{{ i18n.ts.retry }}</button></div>
	<div v-else-if="pager.state.loaded && !pager.state.items.length && !pager.state.pending" :class="$style.state"><p>{{ filtered ? i18n.ts.zalip._reviews.filteredEmpty : i18n.ts.zalip._reviews.empty }}</p><button v-if="filtered" type="button" class="_button" :class="$style.action" @click="resetFilters">{{ i18n.ts.zalip._reviews.resetFilters }}</button></div>
	<div v-if="pager.state.pending" :class="$style.state" role="status" :aria-label="i18n.ts.loading"><MkLoading/></div>
	<button v-if="pager.state.hasMore && !pager.state.pending" type="button" class="_button" :class="[$style.more, $style.action]" @click="pager.load">{{ i18n.ts.zalip._reviews.more }}</button>
</section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, useTemplateRef, watch } from 'vue';
import { url } from '@@/js/config.js';
import type { MenuItem } from '@/types/menu.js';
import type { ZalipReview, ZalipReviewFilters, ZalipReviewFormat, ZalipReviewSentiment, ZalipReviewVote, ZalipReviewsResponse } from '@/utility/zalip-reviews.js';
import MkAvatar from '@/components/global/MkAvatar.vue';
import { createZalipReviewsPager } from '@/utility/zalip-reviews.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { userPage } from '@/filters/user.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';

const props = defineProps<{ workId: string; workTitle?: string; personalRating?: number | null }>();
const emit = defineEmits<{ (ev: 'ratingChanged', rating: number | null): void }>();
const pager = createZalipReviewsPager({ accountId: () => $i?.id ?? null, fetchPage: params => misskeyApiZalip<ZalipReviewsResponse>('zalip/reviews/list', params) });
const format = ref<'all' | ZalipReviewFormat>('all');
const sentiment = ref<'all' | ZalipReviewSentiment>('all');
const sort = ref<'newest' | 'helpful'>('newest');
const hideSpoilers = ref(false);
const formats = computed(() => [{ value: 'all' as const, label: i18n.ts.zalip._reviews.all }, { value: 'review' as const, label: i18n.ts.zalip._reviews.reviews }, { value: 'essay' as const, label: i18n.ts.zalip._reviews.essays }]);
const sentiments = computed(() => [{ value: 'positive' as const, label: i18n.ts.zalip._reviews.positive }, { value: 'neutral' as const, label: i18n.ts.zalip._reviews.neutral }, { value: 'negative' as const, label: i18n.ts.zalip._reviews.negative }]);
const filtered = computed(() => format.value !== 'all' || sentiment.value !== 'all' || hideSpoilers.value);
const histogram = computed(() => {
	const counts = pager.state.summary?.histogram ?? [];
	const maximum = Math.max(1, ...counts);
	return Array.from({ length: 10 }, (_, index) => ({ rating: 10 - index, count: counts[9 - index] ?? 0, width: ((counts[9 - index] ?? 0) / maximum) * 100 }));
});
const histogramLabel = computed(() => `${i18n.ts.zalip._reviews.distribution}: ${histogram.value.map(row => `${row.rating}: ${row.count}`).join(', ')}`);
const revealed = ref(new Set<string>());
const votePending = ref(new Set<string>());
const editorOpen = ref(false);
const saving = ref(false);
const ratingDirty = ref(false);
const actionError = ref('');
const formError = ref('');
const draft = reactive({ format: 'review' as ZalipReviewFormat, title: '', body: '', isSpoiler: false, sentiment: 'neutral' as ZalipReviewSentiment, rating: null as number | null });
const bodyInput = useTemplateRef('bodyInput');
let contextEpoch = 0;
let deleting = false;

function filters(): ZalipReviewFilters {
	return { ...(format.value !== 'all' ? { format: format.value } : {}), ...(sentiment.value !== 'all' ? { sentiment: sentiment.value } : {}), sort: sort.value, hideSpoilers: hideSpoilers.value };
}

function reload(): void {
	actionError.value = '';
	pager.reset(props.workId, filters());
	void pager.load();
}

function resetFilters(): void {
	format.value = 'all'; sentiment.value = 'all'; hideSpoilers.value = false;
}

function sentimentLabel(value: ZalipReviewSentiment): string {
	return sentiments.value.find(item => item.value === value)?.label ?? '';
}

function reveal(id: string): void { revealed.value = new Set([...revealed.value, id]); }

function openEditor(): void {
	if (!$i || saving.value || !pager.state.loaded) return;
	const own = pager.state.myReview;
	Object.assign(draft, { format: own?.format ?? (format.value === 'essay' ? 'essay' : 'review'), title: own?.title ?? '', body: own?.body ?? '', isSpoiler: own?.isSpoiler ?? false, sentiment: own?.sentiment ?? 'neutral', rating: props.personalRating !== undefined ? props.personalRating : own?.rating ?? null });
	formError.value = '';
	ratingDirty.value = false;
	editorOpen.value = true;
	void nextTick(() => bodyInput.value?.focus());
}

function closeEditor(): void {
	if (saving.value) return;
	editorOpen.value = false;
	formError.value = '';
}

async function submit(): Promise<void> {
	if (!$i || saving.value || deleting || !editorOpen.value) return;
	const body = draft.body.trim();
	const title = draft.title.trim();
	if (body.length < 20 || body.length > 12000) { formError.value = i18n.ts.zalip._reviews.bodyInvalid; return; }
	if (draft.format === 'essay' && (!title || title.length > 200)) { formError.value = i18n.ts.zalip._reviews.essayTitleInvalid; return; }
	const epoch = contextEpoch;
	const account = $i.id;
	const workId = props.workId;
	const current = () => epoch === contextEpoch && account === $i?.id && workId === props.workId;
	saving.value = true;
	formError.value = '';
	try {
		const saved = await misskeyApiZalip<ZalipReview>('zalip/reviews/upsert', { workId, format: draft.format, title: draft.format === 'essay' ? title : null, body, isSpoiler: draft.isSpoiler, sentiment: draft.sentiment, ...(ratingDirty.value ? { rating: draft.rating } : {}) });
		if (!current()) return;
		editorOpen.value = false;
		emit('ratingChanged', saved.rating);
		reload();
	} catch {
		if (current()) formError.value = i18n.ts.zalip._reviews.saveError;
	} finally {
		if (current()) saving.value = false;
	}
}

async function signIn(): Promise<void> { await pleaseLogin({ path: window.location.pathname + window.location.search }); }

async function vote(review: ZalipReview, value: Exclude<ZalipReviewVote, null>): Promise<void> {
	if (!$i) { await signIn(); return; }
	if (review.user.id === $i.id || votePending.value.has(review.id)) return;
	const epoch = contextEpoch;
	const account = $i.id;
	const current = () => epoch === contextEpoch && account === $i?.id && review.workId === props.workId;
	votePending.value = new Set([...votePending.value, review.id]);
	actionError.value = '';
	try {
		const updated = await misskeyApiZalip<ZalipReview>('zalip/reviews/vote', { reviewId: review.id, value: review.myVote === value ? null : value });
		if (current()) pager.replace(updated);
	} catch {
		if (current()) actionError.value = i18n.ts.zalip._reviews.voteError;
	} finally {
		if (current()) { const pending = new Set(votePending.value); pending.delete(review.id); votePending.value = pending; }
	}
}

async function remove(review: ZalipReview): Promise<void> {
	if (!$i || !review.canDelete || deleting || saving.value) return;
	const epoch = contextEpoch;
	const account = $i.id;
	const current = () => epoch === contextEpoch && account === $i?.id && review.workId === props.workId;
	deleting = true;
	try {
		const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts.zalip._reviews.deleteConfirm });
		if (canceled || !current()) return;
		await misskeyApiZalip<void>('zalip/reviews/delete', { reviewId: review.id });
		if (!current()) return;
		if (review.user.id === account) editorOpen.value = false;
		reload();
	} catch {
		if (current()) actionError.value = i18n.ts.zalip._reviews.deleteError;
	} finally {
		if (current()) deleting = false;
	}
}

function openMenu(review: ZalipReview, event: MouseEvent): void {
	if (!$i) return;
	const epoch = contextEpoch;
	const account = $i.id;
	const current = () => epoch === contextEpoch && account === $i?.id && review.workId === props.workId;
	const menu: MenuItem[] = [];
	if (review.canEdit && review.user.id === account) menu.push({ icon: 'ti ti-pencil', text: i18n.ts.edit, action: () => { if (current()) openEditor(); } });
	if (review.canDelete) menu.push({ icon: 'ti ti-trash', text: i18n.ts.delete, danger: true, action: () => { if (current()) void remove(review); } });
	if (review.user.id !== account) menu.push({ icon: 'ti ti-flag', text: i18n.ts.zalip._reviews.report, action: async () => {
		if (!current()) return;
		try {
			const component = await import('@/components/MkAbuseReportWindow.vue');
			if (!current()) return;
			const { dispose } = os.popup(component.default, { user: review.user, initialComment: `${url}${window.location.pathname}#review-${encodeURIComponent(review.id)}\n-----\n` }, { closed: () => dispose() });
		} catch {
			if (current()) actionError.value = i18n.ts.somethingHappened;
		}
	} });
	void os.popupMenu(menu, event.currentTarget as HTMLElement);
}

watch(() => [props.workId, $i?.id], () => {
	contextEpoch++;
	editorOpen.value = false; saving.value = false; deleting = false; formError.value = ''; actionError.value = '';
	draft.title = ''; draft.body = ''; ratingDirty.value = false;
	revealed.value = new Set(); votePending.value = new Set();
	reload();
}, { immediate: true });
watch([format, sentiment, sort, hideSpoilers], reload);
watch(() => props.personalRating, value => { if (!ratingDirty.value && value !== undefined) draft.rating = value; });
onBeforeUnmount(() => { contextEpoch++; pager.reset('', filters()); });
</script>

<style lang="scss" module>
.root { margin-top: 24px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); container-type: inline-size; }
.header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 24px; h2 { margin: 0; font-size: 1.2em; } > div { min-width: 0; } }
.eyebrow { margin: 0 0 6px; font-size: 0.8em; color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; }
.write, .action { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 16px; border-radius: 999px; font-weight: 700; box-sizing: border-box; }
.action:not(:global(._buttonPrimary)) { background: var(--MI_THEME-buttonBg); }
.summary { display: grid; grid-template-columns: 120px minmax(130px, 1fr) minmax(140px, 1fr); align-items: center; gap: 24px; padding: 0 24px 24px; }
.score { display: flex; flex-direction: column; gap: 6px; text-align: center; strong { font-size: 3em; font-weight: 800; color: var(--MI_THEME-accent); line-height: 1; } span, small { color: var(--MI_THEME-fgTransparentWeak); font-size: 0.78em; } }
.histogram { display: flex; flex-direction: column; gap: 3px; }
.histogramRow { display: grid; grid-template-columns: 16px 1fr 24px; align-items: center; gap: 6px; font-size: 0.65em; color: var(--MI_THEME-fgTransparentWeak); > span:last-child { text-align: end; } }
.barTrack { height: 5px; border-radius: 99px; background: var(--MI_THEME-buttonBg); }
.bar { display: block; height: 100%; border-radius: inherit; background: var(--MI_THEME-accent); }
.sentimentSummary { display: flex; flex-direction: column; gap: 8px; font-size: 0.8em; strong { margin-bottom: 2px; } }
.positive { color: var(--MI_THEME-success); }
.negative { color: var(--MI_THEME-error); }
.filters { padding: 0 24px 20px; border-bottom: 1px solid var(--MI_THEME-divider); }
.formats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; button { min-height: 44px; padding: 10px 16px; border-radius: 999px; font-weight: 700; } }
.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.filterRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.select { min-width: 0; max-width: 100%; min-height: 44px; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; padding: 8px 10px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font: inherit; font-size: 0.85em; }
.check { display: inline-flex; gap: 8px; align-items: center; min-height: 44px; font-size: 0.85em; input { accent-color: var(--MI_THEME-accent); width: 18px; height: 18px; margin: 0; } }
.signIn { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 20px 24px; background: var(--MI_THEME-accentedBg); p { flex: 1 1 240px; margin: 0; font-size: 0.85em; } }
.editor { margin: 20px 24px; padding: 20px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.caption { margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.8em; }
.editorRow { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; label { flex: 1 1 120px; display: flex; flex-direction: column; gap: 8px; font-size: 0.85em; } }
.field { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; font-size: 0.85em; }
.input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 44px; padding: 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); font: inherit; line-height: 1.6; resize: vertical; }
.editorFooter, .editorActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 12px; }
.editorActions { justify-content: end; }
.review { display: flex; align-items: flex-start; gap: 12px; padding: 24px; border-bottom: 1px solid var(--MI_THEME-divider); scroll-margin-top: 90px; &:last-child { border-bottom: 0; } }
.avatar { flex: 0 0 40px; width: 40px; height: 40px; }
.reviewMain { flex: 1; min-width: 0; }
.reviewHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.author { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; font-size: 0.85em; a { overflow-wrap: anywhere; } :global(time) { font-size: 0.88em; color: var(--MI_THEME-fgTransparentWeak); } }
.rating { display: inline-flex; align-items: center; gap: 4px; color: var(--MI_THEME-accent); font-weight: 700; }
.menu { flex: 0 0 44px; display: grid; place-items: center; width: 44px; height: 44px; margin-top: -10px; margin-right: -8px; font-size: 22px; }
.sentiment { display: inline-block; margin-top: 6px; font-size: 0.73em; }
.reviewTitle { margin: 14px 0 8px; font-size: 1.08em; overflow-wrap: anywhere; }
.body { margin: 12px 0; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; font-size: 0.94em; }
.spoiler { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; min-height: 88px; width: 100%; box-sizing: border-box; padding: 16px; margin: 12px 0; border: 1px dashed var(--MI_THEME-divider); border-radius: var(--MI-radius); color: var(--MI_THEME-fgTransparentWeak); background: var(--MI_THEME-buttonBg); b { flex: 1 1 100%; color: var(--MI_THEME-fg); font-size: 0.85em; } }
.votes { display: flex; gap: 8px; margin-top: 8px; }
.vote { display: inline-flex; align-items: center; gap: 6px; justify-content: center; min-width: 52px; min-height: 44px; padding: 8px 10px; border-radius: 999px; color: var(--MI_THEME-fgTransparentWeak); i { font-size: 18px; } &.active { color: var(--MI_THEME-accent); } }
.state { padding: 24px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); p { margin: 0 0 14px; } }
.error { color: var(--MI_THEME-error); font-size: 0.85em; }
.more { display: flex; margin: 16px auto 24px; }
.root button:focus-visible, .root select:focus-visible, .root input:focus-visible, .root textarea:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
.root button:disabled { opacity: 0.5; cursor: not-allowed; }
@container (max-width: 600px) { .summary { grid-template-columns: 90px minmax(120px, 1fr); gap: 16px; } .sentimentSummary { grid-column: 1 / -1; flex-direction: row; flex-wrap: wrap; gap: 8px 16px; strong { width: 100%; } } .header, .review { padding: 20px 16px; } .summary { padding: 0 16px 20px; } .filters { padding: 0 16px 16px; } .editor { margin: 16px; padding: 16px; } .signIn { padding: 16px; } }
@container (max-width: 360px) { .review { gap: 8px; } .avatar { flex-basis: 32px; width: 32px; height: 32px; } .filterRow > .select { flex: 1 1 100%; } .editorRow label { flex-basis: 100%; } }
@media (prefers-reduced-motion: reduce) { .root :global(.ti-spin) { animation: none; } }
</style>
