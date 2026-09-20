<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModalWindow ref="dialog" :width="860" :height="650" @click="dismissDialog" @close="dismissDialog" @esc="dismissDialog" @closed="emit('closed')">
	<template #header><i class="ti ti-sparkles"></i> {{ i18n.ts.zalip.searchTitle }}</template>

	<div :class="$style.root">
		<div :class="$style.intro">
			<p :class="$style.eyebrow">{{ i18n.ts.zalip.searchEyebrow }}</p>
			<h1>{{ i18n.ts.zalip.searchHeading }}</h1>
			<p>{{ i18n.ts.zalip.searchDescription }}</p>
		</div>

		<label :class="$style.searchField">
			<i class="ti ti-search"></i>
			<input ref="searchInput" v-model="query" type="search" :placeholder="i18n.ts.zalip.searchPlaceholder" autocomplete="off" :aria-label="i18n.ts.zalip.searchPlaceholder">
			<button v-if="query" type="button" class="_button" :aria-label="i18n.ts.zalip.searchClear" @click="query = ''"><i class="ti ti-x"></i></button>
		</label>

		<div :class="$style.tabs" role="tablist" :aria-label="i18n.ts.zalip.searchSections">
			<button v-for="tab in tabs" :key="tab.id" type="button" class="_button" :class="[$style.tab, { [$style.tabActive]: activeTab === tab.id }]" role="tab" :aria-selected="activeTab === tab.id" @click="activeTab = tab.id">
				<i :class="tab.icon"></i><span>{{ tab.label }}</span>
			</button>
		</div>

		<div :class="$style.content" aria-live="polite">
			<div v-if="query.trim().length < 2" :class="$style.discovery">
				<div :class="$style.discoveryMark"><i class="ti ti-sparkles"></i></div>
				<div>
					<h2>{{ i18n.ts.zalip.searchStartTitle }}</h2>
					<p>{{ i18n.ts.zalip.searchStartDescription }}</p>
				</div>
				<div :class="$style.discoveryTabs">
					<button v-for="tab in quickTabs" :key="tab.id" type="button" class="_button" :class="$style.discoveryTab" @click="activeTab = tab.id">
						<i :class="tab.icon"></i>{{ tab.label }}
					</button>
				</div>
			</div>

			<div v-else-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin"></i>{{ i18n.ts.zalip.searchLoading }}</div>
			<div v-else-if="searchFailed" :class="$style.state"><i class="ti ti-wifi-off"></i>{{ i18n.ts.zalip.searchUnavailable }}</div>
			<div v-else-if="visibleResults.length === 0" :class="$style.state"><i class="ti ti-search-off"></i>{{ i18n.ts.zalip.searchNoResults }}</div>

			<div v-else-if="isCatalogueTab" :class="$style.results" role="list">
				<MkA v-for="work in visibleWorks" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.workResult" role="listitem" @click="dismissDialog">
					<div :class="$style.poster">
						<img v-if="work.posterPath" :src="posterUrl(work.posterPath)" alt="" loading="lazy">
						<i v-else class="ti ti-movie"></i>
					</div>
					<div :class="$style.resultBody">
						<div :class="$style.resultMeta"><span :class="[$style.kind, $style[`kind${work.kind}`]]">{{ kindLabel(work.kind) }}</span><span v-if="work.releaseYear">{{ work.releaseYear }}</span></div>
						<strong>{{ work.title }}</strong>
						<span v-if="work.originalTitle" :class="$style.originalTitle">{{ work.originalTitle }}</span>
						<span v-if="work.genres.length" :class="$style.resultDetail">{{ work.genres.slice(0, 3).join(' · ') }}</span>
					</div>
					<i :class="$style.openIcon" class="ti ti-arrow-up-right"></i>
				</MkA>
			</div>

			<div v-else-if="activeTab === 'note'" :class="$style.results" role="list">
				<MkA v-for="note in notes" :key="note.id" :to="`/notes/${note.id}`" :class="$style.noteResult" role="listitem" @click="dismissDialog">
					<MkAvatar :user="note.user" :class="$style.avatar"/>
					<div :class="$style.resultBody">
						<div :class="$style.author"><strong>{{ note.user.name ?? note.user.username }}</strong><span>{{ acct(note.user) }}</span><time :datetime="note.createdAt">{{ formatDate(note.createdAt) }}</time></div>
						<p>{{ note.cw ?? note.text ?? i18n.ts.zalip.searchPostWithoutText }}</p>
					</div>
					<i :class="$style.openIcon" class="ti ti-arrow-up-right"></i>
				</MkA>
			</div>

			<div v-else :class="$style.results" role="list">
				<MkA v-for="user in users" :key="user.id" :to="userPath(user)" :class="$style.userResult" role="listitem" @click="dismissDialog">
					<MkAvatar :user="user" :class="$style.avatar"/>
					<div :class="$style.resultBody">
						<strong>{{ user.name ?? user.username }}</strong>
						<span :class="$style.resultDetail">{{ acct(user) }}</span>
					</div>
					<i :class="$style.openIcon" class="ti ti-arrow-up-right"></i>
				</MkA>
			</div>
		</div>

		<div :class="$style.hint"><i class="ti ti-keyboard"></i><span>{{ i18n.ts.zalip.searchCloseHint }}</span></div>
	</div>
</MkModalWindow>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import type { ZalipSearchTab } from '@/utility/zalip-search.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi, misskeyApiZalip } from '@/utility/misskey-api.js';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';

type ZalipWork = {
	id: string;
	slug: string;
	title: string;
	originalTitle: string | null;
	kind: WorkKind;
	releaseYear: number | null;
	genres: string[];
	posterPath: string | null;
};

type SearchTab = {
	id: ZalipSearchTab;
	label: string;
	icon: string;
};

const props = withDefaults(defineProps<{
	initialTab?: ZalipSearchTab;
	initialQuery?: string;
}>(), {
	initialTab: 'catalogue',
	initialQuery: '',
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const dialog = useTemplateRef('dialog');
const searchInput = useTemplateRef('searchInput');
const query = ref('');
const activeTab = ref<ZalipSearchTab>('catalogue');
const works = ref<ZalipWork[]>([]);
const notes = ref<Misskey.entities.Note[]>([]);
const users = ref<Misskey.entities.User[]>([]);
const pending = ref(false);
const searchFailed = ref(false);
let searchTimer: number | null = null;
let requestId = 0;

const tabs = computed<SearchTab[]>(() => [
	{ id: 'catalogue', label: i18n.ts.zalip.searchCatalogue, icon: 'ti ti-layout-grid' },
	{ id: 'movie', label: i18n.ts.zalip.searchMovies, icon: 'ti ti-movie' },
	{ id: 'series', label: i18n.ts.zalip.searchSeries, icon: 'ti ti-device-tv' },
	{ id: 'anime', label: i18n.ts.zalip.searchAnime, icon: 'ti ti-sparkles' },
	{ id: 'animation', label: i18n.ts.zalip.searchAnimation, icon: 'ti ti-mood-smile' },
	{ id: 'note', label: i18n.ts.zalip.searchPosts, icon: 'ti ti-message-circle' },
	{ id: 'user', label: i18n.ts.zalip.searchProfiles, icon: 'ti ti-users' },
]);

const quickTabs = computed(() => tabs.value.filter((tab) => ['catalogue', 'note', 'user'].includes(tab.id)));
const isCatalogueTab = computed(() => ['catalogue', 'movie', 'series', 'anime', 'animation'].includes(activeTab.value));
const visibleWorks = computed(() => {
	if (activeTab.value === 'catalogue') return works.value;
	return works.value.filter((work) => work.kind === activeTab.value);
});
const visibleResults = computed(() => {
	if (isCatalogueTab.value) return visibleWorks.value;
	return activeTab.value === 'note' ? notes.value : users.value;
});

function dismissDialog(): void {
	dialog.value?.close();
}

function posterUrl(path: string): string {
	return `https://image.tmdb.org/t/p/w185${path}`;
}

function kindLabel(kind: WorkKind): string {
	return ({
		movie: i18n.ts.zalip.searchMovies,
		series: i18n.ts.zalip.searchSeries,
		anime: i18n.ts.zalip.searchAnime,
		animation: i18n.ts.zalip.searchAnimation,
	})[kind];
}

function acct(user: Pick<Misskey.entities.User, 'username' | 'host'>): string {
	return `@${user.username}${user.host ? `@${user.host}` : ''}`;
}

function userPath(user: Pick<Misskey.entities.User, 'username' | 'host'>): string {
	return `/${acct(user)}`;
}

function formatDate(value: string): string {
	return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(value));
}

async function search(term: string, tab: ZalipSearchTab): Promise<void> {
	const currentRequestId = ++requestId;
	pending.value = true;
	searchFailed.value = false;

	try {
		if (['catalogue', 'movie', 'series', 'anime', 'animation'].includes(tab)) {
			const kind = tab === 'catalogue' ? undefined : tab;
			const found = await misskeyApiZalip<ZalipWork[]>('zalip/works/search', { query: term, limit: 30, ...(kind ? { kind } : {}) });
			if (currentRequestId === requestId) works.value = found;
		} else if (tab === 'note') {
			const found = await misskeyApi('notes/search', { query: term, limit: 20, host: '.' });
			if (currentRequestId === requestId) notes.value = found;
		} else {
			const found = await misskeyApi('users/search', { query: term, limit: 20, origin: 'local' });
			if (currentRequestId === requestId) users.value = found;
		}
	} catch {
		if (currentRequestId === requestId) searchFailed.value = true;
	} finally {
		if (currentRequestId === requestId) pending.value = false;
	}
}

watch([query, activeTab], ([value, tab]) => {
	if (searchTimer != null) window.clearTimeout(searchTimer);
	const term = value.trim();
	if (term.length < 2) {
		requestId++;
		pending.value = false;
		searchFailed.value = false;
		works.value = [];
		notes.value = [];
		users.value = [];
		return;
	}

	pending.value = true;
	searchTimer = window.setTimeout(() => void search(term, tab), 220);
}, { immediate: true });

onMounted(() => {
	activeTab.value = props.initialTab;
	query.value = props.initialQuery;
	nextTick(() => searchInput.value?.focus());
});

onBeforeUnmount(() => {
	if (searchTimer != null) window.clearTimeout(searchTimer);
});
</script>

<style lang="scss" module>
.root {
	--search-accent: var(--MI_THEME-accent);

	display: flex;
	min-height: 100%;
	flex-direction: column;
	background:
		radial-gradient(circle at 88% -20%, color-mix(in srgb, var(--search-accent) 26%, transparent), transparent 42%),
		linear-gradient(145deg, var(--MI_THEME-bg), var(--MI_THEME-panel));
}

.intro {
	padding: 24px var(--root-margin) 16px;

	.eyebrow {
		margin: 0 0 5px;
		color: var(--search-accent);
		font-size: 0.68rem;
		font-weight: 850;
		letter-spacing: 0.13em;
	}

	h1 {
		margin: 0;
		font-size: 1.45rem;
		line-height: 1.15;
	}

	p:not(.eyebrow) {
		margin: 7px 0 0;
		color: var(--MI_THEME-fgTransparent);
		font-size: 0.88rem;
	}
}

.searchField {
	display: flex;
	align-items: center;
	gap: 10px;
	margin: 0 var(--root-margin);
	padding: 0 14px;
	border: 1px solid color-mix(in srgb, var(--search-accent) 42%, var(--MI_THEME-divider));
	border-radius: 16px;
	background: color-mix(in srgb, var(--MI_THEME-panelHighlight) 80%, var(--MI_THEME-bg));
	box-shadow: 0 10px 28px color-mix(in srgb, var(--search-accent) 13%, transparent);
	color: var(--search-accent);

	&:focus-within {
		border-color: var(--search-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--search-accent) 22%, transparent), 0 12px 32px color-mix(in srgb, var(--search-accent) 16%, transparent);
	}

	input {
		width: 100%;
		padding: 14px 0;
		border: 0;
		outline: 0;
		background: transparent;
		color: var(--MI_THEME-fg);
		font: inherit;
		font-size: 1rem;

		&::placeholder {
			color: var(--MI_THEME-fgTransparent);
		}
	}

	button {
		display: grid;
		width: 28px;
		height: 28px;
		place-items: center;
		border-radius: 8px;
		color: var(--MI_THEME-fgTransparent);

		&:hover {
			background: var(--MI_THEME-accentedBg);
			color: var(--search-accent);
		}
	}
}

.tabs {
	display: flex;
	gap: 7px;
	padding: 14px var(--root-margin) 12px;
	overflow-x: auto;
	border-bottom: 1px solid var(--MI_THEME-divider);
	scrollbar-width: none;

	&::-webkit-scrollbar {
		display: none;
	}
}

.tab {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	flex: 0 0 auto;
	padding: 8px 11px;
	border: 1px solid transparent;
	border-radius: 999px;
	color: var(--MI_THEME-fgTransparent);
	font-size: 0.84rem;
	font-weight: 700;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
		color: var(--MI_THEME-fg);
	}
}

.tabActive {
	border-color: color-mix(in srgb, var(--search-accent) 72%, var(--MI_THEME-divider));
	background: color-mix(in srgb, var(--search-accent) 17%, var(--MI_THEME-panel));
	color: var(--search-accent);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--search-accent) 12%, transparent);
}

.content {
	min-height: 0;
	flex: 1;
	overflow: auto;
}

.state,
.discovery {
	display: flex;
	min-height: 250px;
	align-items: center;
	justify-content: center;
	gap: 10px;
	padding: 28px var(--root-margin);
	color: var(--MI_THEME-fgTransparent);
	text-align: center;
}

.discovery {
	flex-direction: column;
	gap: 14px;

	h2,
	p {
		margin: 0;
	}

	h2 {
		color: var(--MI_THEME-fg);
		font-size: 1.05rem;
	}

	p {
		margin-top: 6px;
		max-width: 390px;
		font-size: 0.88rem;
		line-height: 1.45;
	}
}

.discoveryMark {
	display: grid;
	width: 54px;
	height: 54px;
	place-items: center;
	border: 1px solid color-mix(in srgb, var(--search-accent) 55%, var(--MI_THEME-divider));
	border-radius: 18px;
	background: color-mix(in srgb, var(--search-accent) 20%, var(--MI_THEME-panel));
	box-shadow: 0 10px 24px color-mix(in srgb, var(--search-accent) 18%, transparent);
	color: var(--search-accent);
	font-size: 1.4rem;
}

.discoveryTabs {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 8px;
	margin-top: 4px;
}

.discoveryTab {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	padding: 9px 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 11px;
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fg);
	font-size: 0.82rem;
	font-weight: 700;

	&:hover {
		border-color: var(--search-accent);
		background: var(--MI_THEME-accentedBg);
		color: var(--search-accent);
	}
}

.results {
	display: grid;
	gap: 7px;
	padding: 12px var(--root-margin) 18px;
}

.workResult,
.noteResult,
.userResult {
	display: grid;
	grid-template-columns: auto minmax(0, 1fr) auto;
	gap: 12px;
	align-items: center;
	padding: 9px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 88%, transparent);
	border-radius: 15px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 92%, transparent);
	color: var(--MI_THEME-fg);
	text-decoration: none;
	transition: transform 0.15s ease, border-color 0.15s ease, background 0.15s ease;

	&:hover,
	&:focus-visible {
		border-color: color-mix(in srgb, var(--search-accent) 60%, var(--MI_THEME-divider));
		background: color-mix(in srgb, var(--search-accent) 10%, var(--MI_THEME-panel));
		color: var(--MI_THEME-fg);
		text-decoration: none;
		transform: translateY(-1px);
	}
}

.poster {
	display: grid;
	width: 48px;
	height: 66px;
	place-items: center;
	overflow: hidden;
	border-radius: 10px;
	background: color-mix(in srgb, var(--search-accent) 20%, var(--MI_THEME-panelHighlight));
	color: var(--search-accent);

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
}

.avatar {
	width: 46px;
	height: 46px;
}

.resultBody {
	display: flex;
	min-width: 0;
	flex-direction: column;
	gap: 3px;

	strong,
	span,
	p {
		overflow: hidden;
		margin: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	strong {
		font-size: 0.94rem;
	}
}

.resultMeta,
.author {
	display: flex;
	align-items: center;
	gap: 6px;
	color: var(--MI_THEME-fgTransparent);
	font-size: 0.75rem;

	time {
		margin-left: auto;
	}
}

.kind {
	display: inline-flex;
	width: fit-content;
	padding: 2px 7px;
	border-radius: 999px;
	background: var(--MI_THEME-accentedBg);
	color: var(--search-accent);
	font-weight: 800;
}

.kindmovie { --search-accent: var(--MI_THEME-accent); }
.kindseries { --search-accent: var(--MI_THEME-link); }
.kindanime { --search-accent: var(--MI_THEME-renote); }
.kindanimation { --search-accent: var(--MI_THEME-warn); }

.originalTitle,
.resultDetail {
	color: var(--MI_THEME-fgTransparent);
	font-size: 0.79rem;
}

.noteResult {
	align-items: start;
}

.noteResult .resultBody p {
	color: var(--MI_THEME-fg);
	font-size: 0.85rem;
	line-height: 1.45;
}

.openIcon {
	align-self: center;
	color: var(--MI_THEME-fgTransparent);
}

.hint {
	display: flex;
	justify-content: center;
	gap: 7px;
	padding: 9px var(--root-margin) 13px;
	border-top: 1px solid var(--MI_THEME-divider);
	color: var(--MI_THEME-fgTransparent);
	font-size: 0.72rem;
}

@container (max-width: 530px) {
	.intro {
		padding-top: 18px;
	}

	.intro h1 {
		font-size: 1.2rem;
	}

	.tab span {
		display: none;
	}

	.tab {
		padding: 9px 11px;
		font-size: 1rem;
	}

	.workResult,
	.noteResult,
	.userResult {
		gap: 10px;
	}

	.poster {
		width: 42px;
		height: 58px;
	}

	.openIcon {
		display: none;
	}
}
</style>
