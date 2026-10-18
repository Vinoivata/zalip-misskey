<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root">
	<header :class="$style.header">
		<div>
			<p :class="$style.eyebrow"><i class="ti ti-messages"></i> {{ i18n.ts.zalip.discussion }}</p>
			<h2>{{ heading }}</h2>
		</div>
		<div :class="$style.controls">
			<select v-model="oldestFirst" :class="$style.sort" :aria-label="i18n.ts.sort"><option :value="false">{{ i18n.ts.zalip.commentsNewest }}</option><option :value="true">{{ i18n.ts.zalip.commentsOldest }}</option></select>
			<MkA :class="$style.threadLink" :to="`/notes/${noteId}/replies`" :aria-label="i18n.ts.continueThread"><i class="ti ti-arrow-up-right"></i></MkA>
		</div>
	</header>

	<div v-if="pending || pager.state.pending" :class="$style.state"><MkLoading/></div>
	<div v-if="error || pager.state.error" :class="$style.state"><span>{{ i18n.ts.zalip.commentsError }}</span><button class="_textButton" type="button" @click="retry">{{ i18n.ts.retry }}</button></div>
	<template v-if="rootNote">
		<div v-if="pager.state.items.length" :class="$style.comments">
			<MkZalipCommentThread v-for="comment in pager.state.items" :key="comment.id" :note="comment" :ancestors="[noteId]" @reply="replyTo = $event"/>
		</div>
		<p v-else-if="!pending && !pager.state.pending && !error && !pager.state.error" :class="$style.empty">{{ i18n.ts.zalip.commentsEmpty }}</p>
		<button v-if="pager.state.hasMore && !pager.state.pending" class="_textButton" type="button" :class="$style.state" @click="pager.load">{{ i18n.ts.loadMore }}</button>
		<ZalipCommentForm v-if="replyTo != null" :rootNote="rootNote" :replyTo="replyTo" @posted="commentPosted" @cancelReply="replyTo = rootNote"/>
	</template>
</section>
</template>

<script lang="ts" setup>
import { ref, watch, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';
import MkZalipCommentThread from '@/components/MkZalipCommentThread.vue';
import ZalipCommentForm from '@/components/ZalipCommentForm.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { createZalipDiscussionPager } from '@/utility/zalip-discussion-pager.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	noteId: string;
	heading: string;
}>();

const pending = ref(true);
const error = ref(false);
const rootNote = ref<Misskey.entities.Note | null>(null);
const replyTo = ref<Misskey.entities.Note | null>(null);
const oldestFirst = ref(false);
const pager = createZalipDiscussionPager({ accountId: () => $i?.id ?? null, fetchPage: params => misskeyApi('notes/replies', params) });
let requestId = 0;

async function load(): Promise<void> {
	const currentRequestId = ++requestId;
	const noteId = props.noteId;
	const account = $i?.id;
	const current = () => currentRequestId === requestId && props.noteId === noteId && account === $i?.id;
	pending.value = true;
	error.value = false;
	rootNote.value = null;
	replyTo.value = null;
	pager.reset(noteId, oldestFirst.value);
	try {
		const [note] = await Promise.all([
			misskeyApi('notes/show', { noteId }),
			pager.load(),
		]);
		if (!current()) return;
		if (note.isHidden || note.deletedAt) throw new Error('Unavailable discussion');
		rootNote.value = note;
		replyTo.value = note;
	} catch {
		if (!current()) return;
		rootNote.value = null;
		pager.reset('');
		replyTo.value = null;
		error.value = true;
	} finally {
		if (current()) pending.value = false;
	}
}

function retry(): void {
	if (rootNote.value) void pager.load();
	else void load();
}

function commentPosted(note: Misskey.entities.Note): void {
	if (!$i || note.userId !== $i.id) return;
	pager.insert(note);
	replyTo.value = rootNote.value;
}

watch(() => [props.noteId, $i?.id], () => {
	void load();
}, { immediate: true });
watch(oldestFirst, () => { pager.reset(props.noteId, oldestFirst.value); void pager.load(); });
onBeforeUnmount(() => { requestId++; pager.reset(''); });
</script>

<style lang="scss" module>
.root {
	margin-top: 28px;
	overflow: clip;
	background: var(--zalip-social-panel);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 12px;
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 16px;
	padding: 20px 28px 16px;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.eyebrow {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 0 4px;
	font-size: 0.78em;
	font-weight: 700;
	color: var(--MI_THEME-accent);
	letter-spacing: 0.03em;
	text-transform: uppercase;
}

.header h2 {
	margin: 0;
	font-size: 1.08em;
}

.controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.sort { max-width: 180px; padding: 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 8px; color: var(--MI_THEME-fgTransparentWeak); background: var(--zalip-social-panel); font: inherit; font-size: 12px; }

.threadLink {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	flex: 0 0 auto;
	padding: 7px 10px;
	font-size: 0.84em;
	font-weight: 700;
	color: var(--MI_THEME-accent);
	border: 1px solid color(from var(--MI_THEME-accent) srgb r g b / 0.35);
	border-radius: 999px;
}

.threadLink:hover {
	background: color(from var(--MI_THEME-accent) srgb r g b / 0.1);
}

.comments {
	padding: 2px 0;
}

.empty, .state {
	margin: 0;
	padding: 26px 28px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.65);
}

.state {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8px;
	min-height: 72px;
	text-align: center;
}

@container (max-width: 450px) {
	.root {
		margin-top: 20px;
		border-radius: 0;
		border-right: 0;
		border-left: 0;
	}

	.header {
		padding: 16px;
	}

	.threadLink span {
		display: none;
	}

	.empty, .state {
		padding: 22px 16px;
	}
}
</style>
