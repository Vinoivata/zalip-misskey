<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div :class="$style.page">
		<Transition :name="prefer.s.animation ? 'fade' : ''" mode="out-in">
			<div v-if="note">
				<div v-if="showNext" class="_margin">
					<MkNotesTimeline direction="up" :withControl="false" :pullToRefresh="false" class="" :paginator="showNext === 'channel' ? nextChannelPaginator : nextUserPaginator" :noGap="true" :forceDisableInfiniteScroll="true" />
				</div>

				<div :class="$style.thread">
					<div v-if="!showNext && initialTab !== 'replies'" class="_buttons" :class="$style.loadNext">
						<MkButton v-if="note.channelId" rounded :class="$style.loadButton" @click="showNext = 'channel'"><i class="ti ti-chevron-up"></i> <i class="ti ti-device-tv"></i></MkButton>
						<MkButton rounded :class="$style.loadButton" @click="showNext = 'user'"><i class="ti ti-chevron-up"></i> <i class="ti ti-user"></i></MkButton>
					</div>
					<div class="_gaps_s">
						<MkNoteDetailed :key="note.id" v-model:note="note" :initialTab="initialTab" :class="$style.note"/>
					</div>
					<div v-if="clips && clips.length > 0" class="_margin">
						<div style="font-weight: bold; padding: 12px;">{{ i18n.ts.clip }}</div>
						<div class="_gaps">
							<MkClipPreview v-for="item in clips" :key="item.id" :clip="item"/>
						</div>
					</div>
					<div v-if="!showPrev && initialTab !== 'replies'" class="_buttons" :class="$style.loadPrev">
						<MkButton v-if="note.channelId" rounded :class="$style.loadButton" @click="showPrev = 'channel'"><i class="ti ti-chevron-down"></i> <i class="ti ti-device-tv"></i></MkButton>
						<MkButton rounded :class="$style.loadButton" @click="showPrev = 'user'"><i class="ti ti-chevron-down"></i> <i class="ti ti-user"></i></MkButton>
					</div>
				</div>

				<div v-if="showPrev" class="_margin">
					<MkNotesTimeline :withControl="false" :pullToRefresh="false" class="" :paginator="showPrev === 'channel' ? prevChannelPaginator : prevUserPaginator" :noGap="true"/>
				</div>
			</div>
			<MkError v-else-if="error" @retry="fetchNote()"/>
			<MkLoading v-else/>
		</Transition>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, watch, ref, markRaw, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';
import { host } from '@@/js/config.js';
import MkNoteDetailed from '@/components/MkNoteDetailed.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import MkButton from '@/components/MkButton.vue';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import { dateString } from '@/filters/date.js';
import MkClipPreview from '@/components/MkClipPreview.vue';
import { prefer } from '@/preferences.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
import { serverContext, assertServerContext } from '@/server-context.js';
import { $i } from '@/i.js';
import { Paginator } from '@/utility/paginator.js';

// contextは非ログイン状態の情報しかないためログイン時は利用できない
const CTX_NOTE = !$i && assertServerContext(serverContext, 'note') ? serverContext.note : null;

const props = defineProps<{
	noteId: string;
	initialTab?: string;
}>();

const note = ref<null | Misskey.entities.Note>(null);
const clips = ref<Misskey.entities.Clip[]>();
const showPrev = ref<'user' | 'channel' | false>(false);
const showNext = ref<'user' | 'channel' | false>(false);
const initialTab = computed<'reactions' | 'replies' | 'renotes' | undefined>(() => {
	if (['reactions', 'replies', 'renotes'].includes(props.initialTab ?? '')) {
		return props.initialTab as 'reactions' | 'replies' | 'renotes';
	}
	return 'replies';
});
const error = ref();
let requestId = 0;
let alive = true;

const prevUserPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	initialId: props.noteId,
	computedParams: computed(() => note.value ? ({
		userId: note.value.userId,
	}) : undefined),
}));

const nextUserPaginator = markRaw(new Paginator('users/notes', {
	limit: 10,
	initialId: props.noteId,
	initialDirection: 'newer',
	computedParams: computed(() => note.value ? ({
		userId: note.value.userId,
	}) : undefined),
}));

const prevChannelPaginator = markRaw(new Paginator('channels/timeline', {
	limit: 10,
	initialId: props.noteId,
	computedParams: computed(() => note.value && note.value.channelId != null ? ({
		channelId: note.value.channelId,
	}) : undefined),
}));

const nextChannelPaginator = markRaw(new Paginator('channels/timeline', {
	limit: 10,
	initialId: props.noteId,
	initialDirection: 'newer',
	computedParams: computed(() => note.value && note.value.channelId != null ? ({
		channelId: note.value.channelId,
	}) : undefined),
}));

async function fetchNote(): Promise<void> {
	const request = ++requestId;
	const noteId = props.noteId;
	const account = $i?.id ?? null;
	const token = $i?.token ?? null;
	const current = () => alive && request === requestId && props.noteId === noteId && ($i?.id ?? null) === account && ($i?.token ?? null) === token;
	showPrev.value = false;
	showNext.value = false;
	note.value = null;
	clips.value = undefined;
	error.value = undefined;
	for (const paginator of [prevUserPaginator, nextUserPaginator, prevChannelPaginator, nextChannelPaginator]) paginator.initialId = noteId;
	// Account refresh can replace id and token separately. Do not issue a
	// guest request or reuse anonymous context during that transient state.
	if ($i && (!account || !token)) return;

	try {
		const res = !$i && CTX_NOTE?.id === noteId ? CTX_NOTE : await misskeyApi('notes/show', { noteId }, token);
		if (!current()) return;
		note.value = res;
		const appearNote = getAppearNote(res) ?? res;
		// 古いノートは被クリップ数をカウントしていないので、2023-10-01以前のものは強制的にnotes/clipsを叩く
		if ((appearNote.clippedCount ?? 0) > 0 || new Date(appearNote.createdAt).getTime() < new Date('2023-10-01').getTime()) {
			try {
				const result = await misskeyApi('notes/clips', { noteId: appearNote.id }, token);
				if (current()) clips.value = result;
			} catch { /* Optional clips must not turn a loaded post into an error. */ }
		}
	} catch (err) {
		if (!current()) return;
		const id = err && typeof err === 'object' && 'id' in err ? err.id : null;
		if (id === 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' || id === '145f88d2-b03d-4087-8143-a78928883c4b') {
			void pleaseLogin({
				path: '/',
				message: id === 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' ? i18n.ts.thisContentsAreMarkedAsSigninRequiredByAuthor : i18n.ts.signinOrContinueOnRemote,
				openOnRemote: {
					type: 'lookup',
					url: `https://${host}/notes/${noteId}`,
				},
			}).catch(() => { /* The native sign-in dialog owns its failure state. */ });
		}
		error.value = err;
	}
}

watch(() => [props.noteId, $i?.id, $i?.token], () => { void fetchNote(); }, {
	immediate: true,
	flush: 'sync',
});
onBeforeUnmount(() => { alive = false; requestId++; });

definePage(() => ({
	title: i18n.ts.note,
	...note.value ? {
		subtitle: dateString(note.value.createdAt),
		avatar: note.value.user,
		path: `/notes/${note.value.id}`,
		share: {
			title: i18n.tsx.noteOf({ user: note.value.user.name ?? note.value.user.username }),
			text: note.value.text,
		},
	} : {},
}));
</script>

<style lang="scss" module>
.fade-enter-active,
.fade-leave-active {
	transition: opacity 0.125s ease;
}
.fade-enter-from,
.fade-leave-to {
	opacity: 0;
}

.loadNext,
.loadPrev {
	justify-content: center;
}

.loadNext {
	margin-bottom: var(--MI-margin);
}

.loadPrev {
	margin-top: var(--MI-margin);
}

.loadButton {
	min-width: 0;
}

.note {
	border: 0;
	border-bottom: 1px solid var(--MI_THEME-divider);
	border-radius: 0;
	background: transparent;
}

.thread { min-width: 0; }
.page { width: 100%; max-width: var(--zalip-feed-width); margin-inline: auto; padding-bottom: 120px; box-sizing: border-box; }

@media (max-width: 600px) {
	.thread { margin-inline: 0; }
	.note { border-inline: 0; }
}
</style>
