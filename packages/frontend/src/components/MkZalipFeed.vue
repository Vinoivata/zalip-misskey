<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<main v-if="feedModes.length" :class="$style.feedShell">
	<section :class="$style.feedColumn" :aria-label="i18n.ts.timeline">
		<header :class="$style.feedHead">
			<div :class="$style.modeRail" role="tablist" :aria-label="i18n.ts.timeline">
				<button v-for="mode in feedModes.filter(mode => mode.key !== 'global')" :key="mode.key" type="button" class="_button" :class="[$style.mode, { [$style.modeActive]: src === mode.key }]" role="tab" :aria-selected="src === mode.key" @click="src = mode.key">
					<MkZalipIcon :name="mode.icon"/><span>{{ mode.title }}</span>
				</button>
				<MkA to="/channels" :class="$style.mode"><span aria-hidden="true">#</span><span>{{ i18n.ts.zalip.feedInterests }}</span></MkA>
				<button v-for="mode in feedModes.filter(mode => mode.key === 'global')" :key="mode.key" type="button" class="_button" :class="[$style.mode, { [$style.modeActive]: src === mode.key }]" role="tab" :aria-selected="src === mode.key" @click="src = mode.key"><MkZalipIcon :name="mode.icon"/><span>{{ mode.title }}</span></button>
				<MkA v-if="$i" to="/my/favorites" :class="$style.mode"><MkZalipIcon name="bookmark"/><span>{{ i18n.ts.favorites }}</span></MkA>
				<button type="button" class="_button" :class="$style.mode" :aria-label="i18n.ts.zalip.feedSettings" @click="openFeedSettings"><MkZalipIcon name="settings"/></button>
			</div>
		</header>

		<section :class="$style.composer" :aria-label="i18n.ts.zalip.feedQuickPost">
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
</template>

<script lang="ts" setup>
import { computed, useTemplateRef, ref, onMounted, onActivated } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { BasicTimelineType } from '@/timelines.js';
import type { ZalipIconName } from '@/components/MkZalipIcon.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { deepMerge } from '@/utility/merge.js';
import { availableBasicTimelines, isAvailableBasicTimeline, isBasicTimeline } from '@/timelines.js';
import { prefer } from '@/preferences.js';
import { pleaseLogin } from '@/utility/please-login.js';

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

const feedModes = computed(() => (['local', 'home', 'social', 'global'] as const).filter(timeline => availableBasicTimelines().includes(timeline)).map(timeline => ({
	key: timeline,
	icon: ({ local: 'sparkles', home: 'person', social: 'users', global: 'movie' } as Record<BasicTimelineType, ZalipIconName>)[timeline],
	title: ({
		local: i18n.ts.zalip.feedForYou,
		home: i18n.ts.zalip.feedFollowing,
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
		const fallback = availableBasicTimelines()[0];
		if (fallback) src.value = fallback;
	}
}

onMounted(() => {
	switchTlIfNeeded();
});
onActivated(() => {
	switchTlIfNeeded();
});

</script>

<style lang="scss" module>
.feedShell { padding-bottom: 24px; }
.feedColumn { width: 100%; max-width: 780px; margin: 0 auto; min-width: 0; }
.feedHead {
	position: sticky;
	top: var(--zalip-chrome-top, 0px);
	z-index: 100;
	height: 60px;
	display: flex;
	align-items: center;
	box-sizing: border-box;
	border-bottom: 1px solid var(--zalip-social-border);
	background: color-mix(in srgb, var(--zalip-social-panel) 85%, transparent);
	-webkit-backdrop-filter: blur(10px);
	backdrop-filter: blur(10px);
	transition: top .3s cubic-bezier(.25, .46, .45, .94);
}
.modeRail { display: flex; align-items: center; gap: 4px; width: 100%; min-width: 0; padding: 0 8px; overflow-x: auto; scrollbar-width: none; }
.modeRail::-webkit-scrollbar { display: none; }
.mode { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; height: 32px; padding: 0 10px; border-radius: 99px; color: var(--zalip-social-muted); font-size: 13px; font-weight: 500; white-space: nowrap; text-decoration: none; > svg { width: 16px; height: 16px; } }
.modeActive { color: var(--zalip-social-fg); background: var(--zalip-accent-soft); box-shadow: inset 0 0 0 1px var(--zalip-accent-border); font-weight: 700; }
.mode:hover { background: var(--zalip-social-hover); }
.composer { display: flex; align-items: center; gap: 12px; height: 82px; padding: 16px 24px; box-sizing: border-box; border-bottom: 1px solid var(--zalip-social-border); }
.composerInput { display: flex; align-items: center; gap: 14px; min-width: 0; flex: 1; text-align: left; color: var(--zalip-social-muted); font-size: 16px; }
.composeAvatar, .composerAnonymous { flex: 0 0 40px; width: 40px; height: 40px; }
.composerAnonymous { display: grid; place-items: center; border-radius: 50%; background: var(--zalip-social-hover); }
.publish { flex: 0 0 auto; min-height: 34px; padding: 0 16px; border-radius: 99px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 14px; font-weight: 600; }
.tl { background: var(--zalip-social-panel); }
@media (max-width: 1099px) { .feedHead { height: 48px; } }
@media (max-width: 600px) { .composer { display: none; } }
@media (prefers-reduced-motion: reduce) { .feedHead { transition: none; } }
</style>
