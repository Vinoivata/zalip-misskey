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

				<div :class="$style.discoveryRail" aria-label="Быстрые действия">
					<button type="button" class="_button" :class="$style.createStory" @click="writePost">
						<span :class="$style.createStoryCircle"><i class="ti ti-plus"></i></span>
						<span>{{ i18n.ts.zalip.feedQuickPost }}</span>
					</button>
					<button type="button" class="_button" :class="$style.discoveryChip" @click="openLists"><i class="ti ti-list"></i>{{ i18n.ts.lists }}</button>
					<button type="button" class="_button" :class="$style.discoveryChip" @click="openAntennas"><i class="ti ti-antenna"></i>{{ i18n.ts.antennas }}</button>
					<button type="button" class="_button" :class="$style.discoveryChip" @click="openChannels"><i class="ti ti-device-tv"></i>{{ i18n.ts.channel }}</button>
				</div>

				<section :class="$style.composer" aria-label="Новая запись">
					<button type="button" class="_button" :class="$style.composerInput" @click="writePost">
						<MkAvatar v-if="$i" :user="$i" :class="$style.composeAvatar"/>
						<span v-else :class="$style.composerAnonymous"><i class="ti ti-user"></i></span>
						<span>{{ i18n.ts.zalip.feedComposePlaceholder }}</span>
					</button>
					<button type="button" class="_button" :class="$style.publish" @click="writePost">{{ i18n.ts.zalip.feedPublish }}</button>
				</section>

				<div :class="$style.feedLabel"><i class="ti ti-pin-filled"></i>{{ isBasicTimeline(src) ? (src === 'home' ? i18n.ts.zalip.feedScopeFollowing : i18n.ts.zalip.feedScopeCommunity) : i18n.ts.zalip.feedHeading }}</div>
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
import { antennasCache, userListsCache, favoritedChannelsCache } from '@/cache.js';
import { deepMerge } from '@/utility/merge.js';
import { miLocalStorage } from '@/local-storage.js';
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

async function chooseList(ev: PointerEvent): Promise<void> {
	const lists = await userListsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...lists.map(list => ({
			type: 'link' as const,
			text: list.name,
			to: `/timeline/list/${list.id}`,
		})),
		(lists.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/lists',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseAntenna(ev: PointerEvent): Promise<void> {
	const antennas = await antennasCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...antennas.map(antenna => ({
			type: 'link' as const,
			text: antenna.name,
			indicate: antenna.hasUnreadNote,
			to: `/timeline/antenna/${antenna.id}`,
		})),
		(antennas.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link' as const,
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/my/antennas',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

async function chooseChannel(ev: PointerEvent): Promise<void> {
	const channels = await favoritedChannelsCache.fetch();
	const items: (MenuItem | undefined)[] = [
		...channels.map(channel => {
			const lastReadedAt = miLocalStorage.getItemAsJson(`channelLastReadedAt:${channel.id}`) ?? null;
			const hasUnreadNote = (lastReadedAt && channel.lastNotedAt) ? Date.parse(channel.lastNotedAt) > lastReadedAt : !!(!lastReadedAt && channel.lastNotedAt);

			return {
				type: 'link' as const,
				text: channel.name,
				indicate: hasUnreadNote,
				to: `/channels/${channel.id}`,
			};
		}),
		(channels.length === 0 ? undefined : { type: 'divider' }),
		{
			type: 'link',
			icon: 'ti ti-plus',
			text: i18n.ts.createNew,
			to: '/channels/new',
		},
	];
	os.popupMenu(items.filter(i => i != null), ev.currentTarget ?? ev.target);
}

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

function openLists(event: PointerEvent): void {
	void chooseList(event);
}

function openAntennas(event: PointerEvent): void {
	void chooseAntenna(event);
}

function openChannels(event: PointerEvent): void {
	void chooseChannel(event);
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
	padding: 22px var(--MI-margin) 68px;
}

.feedColumn {
	width: min(100%, 840px);
	margin: 0 auto;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 82%, transparent);
	border-radius: 26px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 94%, transparent);
	overflow: clip;
	box-shadow: 0 20px 54px color-mix(in srgb, var(--MI_THEME-shadow) 12%, transparent);
}

.feedHead {
	position: sticky;
	top: var(--MI-stickyTop, 0px);
	z-index: 20;
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 10px;
	min-height: 68px;
	padding: 9px 14px 8px 18px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: color-mix(in srgb, var(--MI_THEME-panel) 88%, transparent);
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

.discoveryRail {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 118px;
	overflow-x: auto;
	padding: 15px 20px;
	border-bottom: 1px solid var(--MI_THEME-divider);
	scrollbar-width: none;
}

.discoveryRail::-webkit-scrollbar { display: none; }

.createStory {
	display: grid;
	justify-items: center;
	gap: 7px;
	flex: 0 0 74px;
	padding: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.67rem;
	font-weight: 700;
	line-height: 1.15;
}

.createStoryCircle {
	display: grid;
	place-items: center;
	width: 64px;
	height: 64px;
	border: 1px dashed color-mix(in srgb, var(--MI_THEME-fg) 22%, transparent);
	border-radius: 50%;
	background: color-mix(in srgb, var(--MI_THEME-bg) 36%, transparent);
	font-size: 1.5rem;
	transition: border-color .16s ease, background .16s ease, transform .16s ease;
}

.createStory:hover .createStoryCircle { border-color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); transform: translateY(-2px); }

.discoveryChip {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	flex: 0 0 auto;
	padding: 10px 13px;
	border: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 74%, transparent);
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-bg) 32%, transparent);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: .78rem;
	font-weight: 750;
}

.discoveryChip:hover { border-color: color-mix(in srgb, var(--MI_THEME-accent) 46%, var(--MI_THEME-divider)); color: var(--MI_THEME-fg); }
.discoveryChip i { color: var(--MI_THEME-accent); font-size: 1rem; }

.composer {
	display: flex;
	align-items: center;
	gap: 12px;
	min-height: 76px;
	padding: 12px 18px;
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

.feedLabel {
	display: inline-flex;
	align-items: center;
	gap: 7px;
	margin: 16px 18px 10px;
	padding: 7px 11px;
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-fg) 5%, transparent);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: .73rem;
	font-weight: 750;
}

.feedLabel i { font-size: .83rem; }

.tl {
	border-top: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 74%, transparent);
	background: transparent;
}

@media (max-width: 1099px) {
	.feedShell { padding-top: 12px; }
	.feedColumn { width: min(100%, 760px); }
}

@media (max-width: 767px) {
	.feedShell { padding: 0 0 34px; }
	.feedColumn { width: 100%; border-right: 0; border-left: 0; border-radius: 0; box-shadow: none; }
	.feedHead { min-height: 58px; padding: 7px 10px 7px 12px; }
	.mode { min-height: 38px; padding: 0 10px; font-size: .79rem; }
	.mode i { font-size: .98rem; }
	.headAction { width: 36px; height: 36px; font-size: 1.08rem; }
	.discoveryRail { min-height: 103px; padding: 13px 15px; }
	.createStory { flex-basis: 66px; }
	.createStoryCircle { width: 56px; height: 56px; font-size: 1.3rem; }
	.discoveryChip { padding: 9px 11px; }
	.composer { min-height: 70px; padding: 10px 14px; gap: 9px; }
	.composeAvatar, .composerAnonymous { flex-basis: 38px; width: 38px; height: 38px; }
	.publish { min-width: auto; padding: 0 13px; min-height: 38px; }
	.feedLabel { margin: 13px 14px 8px; }
}
</style>
