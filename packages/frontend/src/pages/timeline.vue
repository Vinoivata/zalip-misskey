<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1360px;">
		<main :class="$style.feedShell">
			<section :class="$style.feedColumn" aria-label="Лента">
				<header :class="$style.feedHead">
					<div :class="$style.modeRail" role="tablist" aria-label="Режим ленты">
						<button v-for="mode in feedModes" :key="mode.key" type="button" class="_button" :class="[$style.mode, { [$style.modeActive]: src === mode.key }]" role="tab" :aria-selected="src === mode.key" @click="src = mode.key">
							<i :class="mode.icon"></i><span>{{ mode.title }}</span>
						</button>
					</div>
					<div :class="$style.headActions">
						<button type="button" class="_button" :class="$style.headAction" :aria-label="i18n.ts.zalip.feedSearch" @click="openSearch"><i class="ti ti-search"></i></button>
						<button type="button" class="_button" :class="$style.headAction" :aria-label="i18n.ts.zalip.feedSettings" @click="openFeedSettings"><i class="ti ti-adjustments-horizontal"></i></button>
					</div>
				</header>

				<div :class="$style.storyRail" aria-label="Быстрые действия">
					<button type="button" class="_button" :class="$style.createStory" @click="writePost">
						<span :class="$style.createStoryCircle"><i class="ti ti-plus"></i></span>
						<span>{{ i18n.ts.zalip.feedQuickPost }}</span>
					</button>
				</div>

				<section :class="$style.composer" aria-label="Новая запись">
					<button type="button" class="_button" :class="$style.composerInput" @click="writePost">
						<MkAvatar v-if="$i" :user="$i" :class="$style.composeAvatar"/>
						<span v-else :class="$style.composerAnonymous"><i class="ti ti-user"></i></span>
						<span>{{ i18n.ts.zalip.feedComposePlaceholder }}</span>
					</button>
					<button type="button" class="_button" :class="$style.publish" @click="writePost">{{ i18n.ts.zalip.feedPublish }}</button>
				</section>

				<MkStreamingNotesTimeline
					ref="tlComponent"
					:key="src + withRenotes + withReplies + onlyFiles + withSensitive"
					:class="$style.tl"
					:src="(src.split(':')[0] as (BasicTimelineType | 'list'))"
					:list="src.split(':')[1]"
					:withRenotes="withRenotes"
					:withReplies="withReplies"
					:withSensitive="withSensitive"
					:onlyFiles="onlyFiles"
					:sound="true"
					:zalipFlat="true"
				/>
			</section>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, useTemplateRef, ref, onMounted, onActivated } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { BasicTimelineType } from '@/timelines.js';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { definePage } from '@/page.js';
import { deepMerge } from '@/utility/merge.js';
import { availableBasicTimelines, isAvailableBasicTimeline, isBasicTimeline, basicTimelineIconClass } from '@/timelines.js';
import { prefer } from '@/preferences.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { openZalipSearch } from '@/utility/zalip-search.js';

const tlComponent = useTemplateRef('tlComponent');

type TimelinePageSrc = BasicTimelineType | `list:${string}`;

const srcWhenNotSignin = ref<'local' | 'global'>(isAvailableBasicTimeline('local') ? 'local' : 'global');
const src = computed<TimelinePageSrc>({
	get: () => ($i ? store.r.tl.value.src : srcWhenNotSignin.value),
	set: (x) => saveSrc(x),
});
const withRenotes = computed<boolean>({
	get: () => store.r.tl.value.filter.withRenotes,
	set: (x) => saveTlFilter('withRenotes', x),
});

// Zalip keeps replies in their discussion threads. A renote is still a normal feed entry,
// but an ordinary reply must never turn the main timeline into a comments list.
const withReplies = false;
const onlyFiles = computed<boolean>({
	get: () => store.r.tl.value.filter.onlyFiles,
	set: (x) => saveTlFilter('onlyFiles', x),
});

const withSensitive = computed<boolean>({
	get: () => store.r.tl.value.filter.withSensitive,
	set: (x) => saveTlFilter('withSensitive', x),
});

const feedModes = computed(() => availableBasicTimelines().map(timeline => ({
	key: timeline,
	icon: basicTimelineIconClass(timeline),
	title: ({
		local: i18n.ts.zalip.feedForYou,
		home: i18n.ts.zalip.followingFeed,
		social: i18n.ts.zalip.feedFriends,
		global: i18n.ts.zalip.feedAll,
	})[timeline],
})));

function saveSrc(newSrc: TimelinePageSrc): void {
	const out = deepMerge({ src: newSrc }, store.s.tl);

	if (newSrc.startsWith('userList:')) {
		const id = newSrc.substring('userList:'.length);
		out.userList = prefer.r.pinnedUserLists.value.find(l => l.id === id) ?? null;
	}

	store.set('tl', out);
	if (['local', 'global'].includes(newSrc)) {
		srcWhenNotSignin.value = newSrc as 'local' | 'global';
	}
}

function saveTlFilter(key: keyof typeof store.s.tl.filter, newValue: boolean) {
	if (key !== 'withReplies' || $i) {
		const out = deepMerge({ filter: { [key]: newValue } }, store.s.tl);
		store.set('tl', out);
	}
}

async function writePost(): Promise<void> {
	if (!await pleaseLogin()) return;
	void os.post();
}

function openSearch(): void {
	openZalipSearch();
}

function openFeedSettings(event: PointerEvent): void {
	const menuItems: MenuItem[] = [{
		type: 'switch',
		icon: 'ti ti-repeat',
		text: i18n.ts.showRenotes,
		ref: withRenotes,
	}, {
		type: 'switch',
		icon: 'ti ti-eye-exclamation',
		text: i18n.ts.withSensitive,
		ref: withSensitive,
	}, {
		type: 'switch',
		icon: 'ti ti-photo',
		text: i18n.ts.fileAttachedOnly,
		ref: onlyFiles,
	}, {
		type: 'divider',
	}, {
		type: 'link',
		icon: 'ti ti-list',
		text: i18n.ts.lists,
		to: '/my/lists',
	}, {
		type: 'link',
		icon: 'ti ti-antenna',
		text: i18n.ts.antennas,
		to: '/my/antennas',
	}, {
		type: 'link',
		icon: 'ti ti-device-tv',
		text: i18n.ts.channel,
		to: '/channels',
	}, {
		type: 'divider',
	}, {
		icon: 'ti ti-refresh',
		text: i18n.ts.reload,
		action: () => tlComponent.value?.reloadTimeline(),
	}];

	os.popupMenu(menuItems, event.currentTarget ?? event.target, { align: 'right', width: 272 });
}

function switchTlIfNeeded() {
	if (isBasicTimeline(src.value) && !isAvailableBasicTimeline(src.value)) {
		src.value = availableBasicTimelines()[0];
	}
}

onMounted(() => {
	switchTlIfNeeded();
});
onActivated(() => {
	switchTlIfNeeded();
});

definePage(() => ({
	title: i18n.ts.timeline,
	icon: isBasicTimeline(src.value) ? basicTimelineIconClass(src.value) : 'ti ti-home',
}));
</script>

<style lang="scss" module>
.feedShell {
	padding: 0 var(--MI-margin) 68px;
}

.feedColumn {
	width: min(100%, 700px);
	margin: 0 auto;
}

.feedHead {
	position: sticky;
	top: var(--MI-stickyTop, 0px);
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	min-height: 58px;
	padding: 8px 0;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: color-mix(in srgb, var(--MI_THEME-bg) 84%, transparent);
	backdrop-filter: blur(20px) saturate(1.1);
}

.modeRail {
	display: flex;
	align-items: center;
	gap: 3px;
	min-width: 0;
	overflow-x: auto;
	scrollbar-width: none;
}

.modeRail::-webkit-scrollbar { display: none; }

.mode {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	flex: 0 0 auto;
	min-height: 40px;
	padding: 0 11px;
	border-radius: 999px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.87rem;
	font-weight: 800;
	white-space: nowrap;
	transition: background 0.16s ease, color 0.16s ease, transform 0.16s ease;
}

.mode i { font-size: 1.05rem; }

.mode:hover { color: var(--MI_THEME-fg); background: color-mix(in srgb, var(--MI_THEME-fg) 7%, transparent); }
.mode:active { transform: scale(0.96); }

.modeActive {
	background: color-mix(in srgb, var(--MI_THEME-fg) 12%, transparent);
	color: var(--MI_THEME-fg);
	box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--MI_THEME-fg) 5%, transparent);
}

.headActions { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; }

.headAction {
	display: grid;
	place-items: center;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 1.16rem;
}

.headAction:hover { color: var(--MI_THEME-fg); background: color-mix(in srgb, var(--MI_THEME-fg) 8%, transparent); }

.storyRail {
	display: flex;
	align-items: center;
	min-height: 166px;
	padding: 18px 26px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	box-sizing: border-box;
}

.createStory {
	display: grid;
	justify-items: center;
	gap: 7px;
	flex: 0 0 86px;
	padding: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.67rem;
	font-weight: 700;
	line-height: 1.15;
}

.createStoryCircle {
	display: grid;
	place-items: center;
	width: 78px;
	height: 78px;
	border: 1px dashed color-mix(in srgb, var(--MI_THEME-fg) 22%, transparent);
	border-radius: 50%;
	background: color-mix(in srgb, var(--MI_THEME-bg) 36%, transparent);
	font-size: 1.5rem;
	transition: border-color .16s ease, background .16s ease, transform .16s ease;
}

.createStory:hover .createStoryCircle { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); transform: translateY(-2px); }

.composer {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 82px;
	padding: 14px 26px;
	border-bottom: 1px solid var(--MI_THEME-divider);
}

.composerInput {
	display: flex;
	align-items: center;
	gap: 12px;
	min-width: 0;
	flex: 1;
	padding: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: .95rem;
	text-align: left;
}

.composeAvatar, .composerAnonymous {
	display: grid;
	place-items: center;
	flex: 0 0 42px;
	width: 42px;
	height: 42px;
	border-radius: 50%;
}

.composerAnonymous { background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fgTransparentWeak); font-size: 1.25rem; }

.composerInput:hover { color: var(--MI_THEME-fg); }

.publish {
	flex: 0 0 auto;
	min-width: 88px;
	min-height: 40px;
	padding: 0 16px;
	border-radius: 999px;
	background: var(--MI_THEME-fg);
	color: var(--MI_THEME-bg);
	font-size: .85rem;
	font-weight: 850;
	transition: transform .16s ease, background .16s ease;
}

.publish:hover { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.publish:active { transform: scale(.96); }

.tl {
	padding-top: 10px;
	background: transparent;
}

@media (max-width: 1099px) {
	.feedColumn { width: min(100%, 700px); }
}

@media (max-width: 767px) {
	.feedShell { padding: 0 0 92px; }
	.feedColumn { width: 100%; }
	.feedHead { min-height: 58px; padding: 7px 10px 7px 12px; }
	.mode { min-height: 38px; padding: 0 10px; font-size: .79rem; }
	.mode i { font-size: .98rem; }
	.headAction { width: 36px; height: 36px; font-size: 1.08rem; }
	.storyRail, .composer { display: none; }
	.tl { padding-top: 0; }
}
</style>
