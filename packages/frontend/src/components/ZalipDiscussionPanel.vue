<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root">
	<header :class="$style.header">
		<div>
			<p :class="$style.eyebrow"><i class="ti ti-messages"></i> Обсуждение</p>
			<h2>{{ heading }}</h2>
		</div>
		<MkA :class="$style.threadLink" :to="`/notes/${noteId}/replies`"><span>Вся ветка</span><i class="ti ti-arrow-up-right"></i></MkA>
	</header>

	<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin"></i> Загружаем комментарии…</div>
	<div v-else-if="error" :class="$style.state"><i class="ti ti-message-off"></i> {{ error }}</div>
	<template v-else-if="rootNote">
		<div v-if="comments.length" :class="$style.comments">
			<MkNoteSub v-for="comment in comments" :key="comment.id" :note="comment" :detail="true" @reply="replyTo = $event"/>
		</div>
		<p v-else :class="$style.empty">Пока нет комментариев. Начните обсуждение первым.</p>
		<ZalipCommentForm v-if="replyTo != null" :rootNote="rootNote" :replyTo="replyTo" @posted="commentPosted" @cancelReply="replyTo = rootNote"/>
	</template>
</section>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkNoteSub from '@/components/MkNoteSub.vue';
import ZalipCommentForm from '@/components/ZalipCommentForm.vue';
import { misskeyApi } from '@/utility/misskey-api.js';

const props = defineProps<{
	noteId: string;
	heading: string;
}>();

const pending = ref(true);
const error = ref<string | null>(null);
const rootNote = ref<Misskey.entities.Note | null>(null);
const comments = ref<Misskey.entities.Note[]>([]);
const replyTo = ref<Misskey.entities.Note | null>(null);
let requestId = 0;

async function load(): Promise<void> {
	const currentRequestId = ++requestId;
	pending.value = true;
	error.value = null;
	try {
		const [note, children] = await Promise.all([
			misskeyApi('notes/show', { noteId: props.noteId }),
			misskeyApi('notes/children', { noteId: props.noteId, limit: 100 }),
		]);
		if (currentRequestId !== requestId) return;
		rootNote.value = note;
		comments.value = children;
		replyTo.value = note;
	} catch {
		if (currentRequestId !== requestId) return;
		rootNote.value = null;
		comments.value = [];
		replyTo.value = null;
		error.value = 'Не удалось загрузить комментарии. Обновите страницу и попробуйте снова.';
	} finally {
		if (currentRequestId === requestId) pending.value = false;
	}
}

async function commentPosted(): Promise<void> {
	await load();
}

watch(() => props.noteId, () => {
	void load();
}, { immediate: true });
</script>

<style lang="scss" module>
.root {
	margin-top: 28px;
	overflow: clip;
	background: color(from var(--MI_THEME-panel) srgb r g b / 0.72);
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 16px;
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
