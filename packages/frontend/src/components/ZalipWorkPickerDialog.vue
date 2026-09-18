<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow
	ref="dialog"
	:width="560"
	:height="620"
	@click="cancel"
	@close="cancel"
	@closed="emit('closed')"
>
	<template #header><i class="ti ti-movie"></i> Прикрепить тайтл</template>
	<div :class="$style.root">
		<label :class="$style.search">
			<i class="ti ti-search"></i>
			<input ref="input" v-model="query" class="_input" type="search" maxlength="100" placeholder="Название фильма, сериала или аниме" aria-label="Поиск тайтла">
			<button v-if="query" type="button" class="_button" aria-label="Очистить поиск" @click="query = ''"><i class="ti ti-x"></i></button>
		</label>

		<div v-if="query.trim().length < 2" :class="$style.empty">
			<i class="ti ti-sparkles"></i>
			<span>Введите минимум две буквы, чтобы найти тайтл в каталоге Zalip.</span>
		</div>
		<div v-else-if="pending" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Ищем тайтлы…</div>
		<div v-else-if="results.length === 0" :class="$style.empty">
			<i class="ti ti-movie-off"></i>
			<span>В опубликованном каталоге ничего не найдено.</span>
		</div>
		<div v-else :class="$style.results">
			<button v-for="work in results" :key="work.id" type="button" class="_button" :class="$style.result" @click="select(work)">
				<div :class="$style.poster">
					<img v-if="work.posterPath" :src="posterUrl(work.posterPath)" alt="" loading="lazy">
					<i v-else class="ti ti-movie"></i>
				</div>
				<div :class="$style.body">
					<p>{{ kindLabel(work.kind) }}<span v-if="work.releaseYear != null"> · {{ work.releaseYear }}</span></p>
					<strong>{{ work.title }}</strong>
					<span v-if="work.originalTitle">{{ work.originalTitle }}</span>
					<small v-if="work.genres.length">{{ work.genres.slice(0, 3).join(' · ') }}</small>
				</div>
				<i :class="$style.selectIcon" class="ti ti-plus"></i>
			</button>
		</div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import MkModalWindow from '@/components/MkModalWindow.vue';
import type { ZalipWorkShare } from '@/types/post-form.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type SearchResult = ZalipWorkShare & {
	originalTitle: string | null;
};

const props = withDefaults(defineProps<{
	initialQuery?: string;
}>(), {
	initialQuery: '',
});

const emit = defineEmits<{
	(ev: 'selected', work: ZalipWorkShare): void;
	(ev: 'cancel'): void;
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');
const input = useTemplateRef('input');
const query = ref(props.initialQuery);
const results = ref<SearchResult[]>([]);
const pending = ref(false);
let searchTimer: number | null = null;
let requestId = 0;

function kindLabel(kind: ZalipWorkShare['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

function posterUrl(path: string): string {
	return `https://image.tmdb.org/t/p/w185${path}`;
}

async function search(term: string): Promise<void> {
	const currentRequestId = ++requestId;
	pending.value = true;
	try {
		const found = await misskeyApiZalip<SearchResult[]>('zalip/works/search', { query: term, limit: 20 });
		if (currentRequestId === requestId) results.value = found;
	} catch {
		if (currentRequestId === requestId) results.value = [];
	} finally {
		if (currentRequestId === requestId) pending.value = false;
	}
}

watch(query, (value) => {
	if (searchTimer != null) window.clearTimeout(searchTimer);
	const term = value.trim();
	if (term.length < 2) {
		requestId++;
		results.value = [];
		pending.value = false;
		return;
	}
	pending.value = true;
	searchTimer = window.setTimeout(() => void search(term), 220);
}, { immediate: true });

function select(work: ZalipWorkShare): void {
	emit('selected', work);
	dialog.value?.close();
}

function cancel(): void {
	emit('cancel');
	dialog.value?.close();
}

onMounted(() => {
	nextTick(() => input.value?.focus());
});

onBeforeUnmount(() => {
	if (searchTimer != null) window.clearTimeout(searchTimer);
});
</script>

<style lang="scss" module>
.root {
	display: flex;
	min-height: 100%;
	flex-direction: column;
}

.search {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 16px var(--root-margin) 10px;
	padding: 0 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 14px;
	color: var(--MI_THEME-fgTransparent);

	&:focus-within {
		border-color: var(--MI_THEME-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--MI_THEME-accent) 17%, transparent);
	}

	input {
		width: 100%;
		padding: 11px 0;
		border: none;
		background: transparent;
		color: var(--MI_THEME-fg);
		font: inherit;

		&:focus {
			outline: none;
		}
	}

	button {
		padding: 5px;
		border-radius: 8px;
	}
}

.empty {
	display: flex;
	min-height: 190px;
	align-items: center;
	justify-content: center;
	gap: 9px;
	padding: 24px;
	color: var(--MI_THEME-fgTransparent);
	text-align: center;
}

.results {
	display: flex;
	flex-direction: column;
	gap: 4px;
	padding: 0 10px 16px;
}

.result {
	display: grid;
	grid-template-columns: 48px minmax(0, 1fr) auto;
	gap: 12px;
	align-items: center;
	padding: 8px;
	border-radius: 13px;
	text-align: left;

	&:hover,
	&:focus-visible {
		background: color-mix(in srgb, var(--MI_THEME-accent) 12%, transparent);
	}
}

.poster {
	display: grid;
	width: 48px;
	height: 66px;
	place-items: center;
	overflow: hidden;
	border-radius: 8px;
	background: color-mix(in srgb, var(--MI_THEME-accent) 18%, var(--MI_THEME-panel));
	color: var(--MI_THEME-accent);

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
}

.body {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 3px;

	p,
	strong,
	span,
	small {
		min-width: 0;
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	p,
	small {
		color: var(--MI_THEME-fgTransparent);
		font-size: 0.78em;
	}

	strong {
		font-size: 0.95em;
	}

	span {
		color: var(--MI_THEME-fgTransparentWeak);
		font-size: 0.8em;
	}
}

.selectIcon {
	padding: 8px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-accent) 44%, var(--MI_THEME-divider));
	border-radius: 999px;
	color: var(--MI_THEME-accent);
}
</style>
