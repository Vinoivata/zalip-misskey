<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader v-model:tab="tab" :actions="headerActions" :tabs="headerTabs" :swipable="true">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<div v-if="loadError" :class="$style.loadState"><p role="alert">{{ i18n.ts.zalip._communities.loadError }}</p><button type="button" class="_textButton" @click="loadChannel">{{ i18n.ts.retry }}</button></div>
		<p v-else-if="!channel" :class="$style.loadState" role="status">{{ i18n.ts.loading }}</p>
		<header v-if="channel" :class="$style.communityHeader">
			<MkA to="/channels" :class="$style.directoryLink"><i class="ti ti-arrow-left" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.title }}</MkA>
			<h1>{{ channel.name }}</h1><p>{{ i18n.ts.zalip._communities.publicNotice }}</p>
			<div :class="$style.communityActions"><XChannelFollowButton :key="channel.id" :channel="channel" full @changed="channel.isFollowing = $event"/><button type="button" class="_button" :class="$style.writePost" :disabled="channel.isArchived" @click="openPostForm"><i class="ti ti-pencil" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.post }}</button><button v-if="$i" type="button" class="_button" :class="$style.favoriteButton" :disabled="favoriteBusy" :aria-busy="favoriteBusy" :aria-label="favorited ? i18n.ts.unfavorite : i18n.ts.favorite" :aria-pressed="favorited" @click="favorited ? unfavorite() : favorite()"><i class="ti ti-star" aria-hidden="true"></i></button></div>
		</header>
		<div v-if="channel && tab === 'overview'" class="_gaps">
			<div class="_panel" :class="$style.bannerContainer">
				<div :style="{ backgroundImage: channel.bannerUrl ? `url(${channel.bannerUrl})` : undefined }" :class="$style.banner">
					<div :class="$style.bannerStatus">
						<div><i class="ti ti-users ti-fw" aria-hidden="true"></i> {{ i18n.tsx.zalip._communities.authorsCount({ n: channel.usersCount }) }}</div>
						<div><i class="ti ti-pencil ti-fw" aria-hidden="true"></i> {{ i18n.tsx.zalip._communities.notesCount({ n: channel.notesCount }) }}</div>
						<div v-if="$i != null && channel != null && $i.id === channel.userId" style="color: var(--MI_THEME-warn)"><i class="ti ti-user-star ti-fw"></i><span style="margin-left: 4px;">{{ i18n.ts.youAreAdmin }}</span></div>
					</div>
					<div v-if="channel.isSensitive" :class="$style.sensitiveIndicator">{{ i18n.ts.sensitive }}</div>
					<div :class="$style.bannerFade"></div>
				</div>
				<div v-if="channel.description" :class="$style.description">
					<Mfm :text="channel.description" :isNote="false"/>
				</div>
			</div>

			<MkFoldableSection>
				<template #header><i class="ti ti-pin ti-fw" style="margin-right: 0.5em;"></i>{{ i18n.ts.pinnedNotes }}</template>
				<div v-if="channel.pinnedNotes && channel.pinnedNotes.length > 0" class="_gaps">
					<MkNote v-for="note in channel.pinnedNotes" :key="note.id" class="_panel" :note="note"/>
				</div>
			</MkFoldableSection>
		</div>
		<div v-if="channel && tab === 'timeline'" class="_gaps">
			<MkInfo v-if="channel.isArchived" warn>{{ i18n.ts.thisChannelArchived }}</MkInfo>

			<!-- スマホ・タブレットの場合、キーボードが表示されると投稿が見づらくなるので、デスクトップ場合のみ自動でフォーカスを当てる -->
			<MkPostForm v-if="$i && !channel.isArchived && prefer.r.showFixedPostFormInChannel.value" :key="channel.id" :channel="channel" class="post-form _panel" fixed :autofocus="deviceKind === 'desktop'"/>

			<MkStreamingNotesTimeline :key="channelId" src="channel" :channel="channelId" :zalipFlat="true"/>
		</div>
		<div v-else-if="tab === 'featured'">
			<MkNotesTimeline :paginator="featuredPaginator"/>
		</div>
		<div v-else-if="tab === 'search'">
			<div v-if="notesSearchAvailable" class="_gaps">
				<div>
					<MkInput v-model="searchQuery" @enter="search()">
						<template #prefix><i class="ti ti-search"></i></template>
					</MkInput>
					<MkButton primary rounded style="margin-top: 8px;" @click="search()">{{ i18n.ts.search }}</MkButton>
				</div>
				<MkNotesTimeline v-if="searchPaginator" :key="searchKey" :paginator="searchPaginator"/>
			</div>
			<div v-else>
				<MkInfo warn>{{ i18n.ts.notesSearchNotAvailable }}</MkInfo>
			</div>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, watch, ref, markRaw, shallowRef } from 'vue';
import * as Misskey from 'misskey-js';
import { url } from '@@/js/config.js';
import { useInterval } from '@@/js/use-interval.js';
import type { PageHeaderItem } from '@/types/page-header.js';
import MkPostForm from '@/components/MkPostForm.vue';
import MkStreamingNotesTimeline from '@/components/MkStreamingNotesTimeline.vue';
import XChannelFollowButton from '@/components/MkChannelFollowButton.vue';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { $i, iAmModerator } from '@/i.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { deviceKind } from '@/utility/device-kind.js';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import { favoritedChannelsCache } from '@/cache.js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import { prefer } from '@/preferences.js';
import MkNote from '@/components/MkNote.vue';
import MkInfo from '@/components/MkInfo.vue';
import MkFoldableSection from '@/components/MkFoldableSection.vue';
import { isSupportShare } from '@/utility/navigator.js';
import { copyToClipboard } from '@/utility/copy-to-clipboard.js';
import { notesSearchAvailable } from '@/utility/check-permissions.js';
import { miLocalStorage } from '@/local-storage.js';
import { useRouter } from '@/router.js';
import { Paginator } from '@/utility/paginator.js';
import { pleaseLogin } from '@/utility/please-login.js';

const router = useRouter();

const props = defineProps<{
	channelId: string;
}>();

const tab = ref('overview');

const channel = ref<Misskey.entities.Channel | null>(null);
const loadError = ref(false);
let loadRequest = 0;
let alive = true;
const favorited = ref(false);
const favoriteBusy = ref(false);
let favoriteRequest = 0;
const searchQuery = ref('');
const searchPaginator = shallowRef();
const searchKey = ref('');
const featuredPaginator = markRaw(new Paginator('notes/featured', {
	limit: 10,
	computedParams: computed(() => ({
		channelId: props.channelId,
	})),
}));

useInterval(() => {
	if (channel.value == null) return;
	miLocalStorage.setItemAsJson(`channelLastReadedAt:${channel.value.id}`, Date.now());
}, 3000, {
	immediate: true,
	afterMounted: true,
});

async function loadChannel(): Promise<void> {
	const request = ++loadRequest;
	const channelId = props.channelId;
	const account = $i?.id;
	const token = $i?.token ?? null;
	const current = () => alive && request === loadRequest && props.channelId === channelId && $i?.id === account && ($i?.token ?? null) === token;
	channel.value = null; loadError.value = false; favorited.value = false; favoriteBusy.value = false; favoriteRequest++; searchPaginator.value = undefined;
	try {
		const _channel = await misskeyApi('channels/show', { channelId }, token);
		if (!current()) return;

		favorited.value = _channel.isFavorited ?? false;
		if (favorited.value || _channel.isFollowing) {
			tab.value = 'timeline';
		}

		if ((favorited.value || _channel.isFollowing) && _channel.lastNotedAt) {
			const lastReadedAt: number = miLocalStorage.getItemAsJson(`channelLastReadedAt:${_channel.id}`) ?? 0;
			const lastNotedAt = Date.parse(_channel.lastNotedAt);

			if (lastNotedAt > lastReadedAt) {
				miLocalStorage.setItemAsJson(`channelLastReadedAt:${_channel.id}`, lastNotedAt);
			}
		}

		channel.value = _channel;
	} catch { if (current()) loadError.value = true; }
}

watch(() => [props.channelId, $i?.id, $i?.token], loadChannel, { immediate: true });
onBeforeUnmount(() => { alive = false; loadRequest++; });

function edit() {
	router.push('/channels/:channelId/edit', {
		params: {
			channelId: props.channelId,
		},
	});
}

async function openPostForm(): Promise<void> {
	const selected = channel.value;
	if (!selected || selected.isArchived) return;
	if (!await pleaseLogin()) return;
	if (!alive || channel.value?.id !== selected.id) return;
	void os.post({ channel: selected });
}

async function changeFavorite(next: boolean): Promise<void> {
	if (!channel.value || !$i || favoriteBusy.value) return;
	const channelId = channel.value.id;
	const account = $i.id;
	const token = $i.token;
	const request = ++favoriteRequest;
	const loadEpoch = loadRequest;
	const current = () => alive && request === favoriteRequest && loadEpoch === loadRequest && channel.value?.id === channelId && $i?.id === account && $i.token === token;
	favoriteBusy.value = true;
	try {
		if (!next) {
			const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts.unfavoriteConfirm });
			if (canceled || !current()) return;
		}
		if (!current()) return;
		await misskeyApi(next ? 'channels/favorite' : 'channels/unfavorite', { channelId }, token);
		if (!current()) return;
		favorited.value = next;
		favoritedChannelsCache.delete();
	} catch { if (current()) void os.alert({ type: 'error', text: i18n.ts.somethingHappened }); } finally { if (current()) favoriteBusy.value = false; }
}

async function favorite(): Promise<void> { await changeFavorite(true); }

async function unfavorite(): Promise<void> { await changeFavorite(false); }

async function mute() {
	if (!channel.value) return;
	const _channel = channel.value;

	const { canceled, result: period } = await os.select({
		title: i18n.ts.mutePeriod,
		items: [{
			value: 'indefinitely', label: i18n.ts.indefinitely,
		}, {
			value: 'tenMinutes', label: i18n.ts.tenMinutes,
		}, {
			value: 'oneHour', label: i18n.ts.oneHour,
		}, {
			value: 'oneDay', label: i18n.ts.oneDay,
		}, {
			value: 'oneWeek', label: i18n.ts.oneWeek,
		}],
		default: 'indefinitely',
	});
	if (canceled) return;

	const expiresAt = period === 'indefinitely' ? null
		: period === 'tenMinutes' ? Date.now() + (1000 * 60 * 10)
		: period === 'oneHour' ? Date.now() + (1000 * 60 * 60)
		: period === 'oneDay' ? Date.now() + (1000 * 60 * 60 * 24)
		: period === 'oneWeek' ? Date.now() + (1000 * 60 * 60 * 24 * 7)
		: null;

	os.apiWithDialog('channels/mute/create', {
		channelId: _channel.id,
		expiresAt,
	}).then(() => {
		_channel.isMuting = true;
	});
}

async function unmute() {
	if (!channel.value) return;
	const _channel = channel.value;

	os.apiWithDialog('channels/mute/delete', {
		channelId: _channel.id,
	}).then(() => {
		_channel.isMuting = false;
	});
}

async function search() {
	if (!channel.value) return;

	const query = searchQuery.value.toString().trim();

	if (query == null) return;

	searchPaginator.value = markRaw(new Paginator('notes/search', {
		limit: 10,
		params: {
			query: query,
			channelId: channel.value.id,
		},
	}));

	searchKey.value = query;
}

const headerActions = computed(() => {
	if (channel.value) {
		const headerItems: PageHeaderItem[] = [];

		headerItems.push({
			icon: 'ti ti-link',
			text: i18n.ts.copyUrl,
			handler: async (): Promise<void> => {
				if (!channel.value) {
					console.warn('failed to copy channel URL. channel.value is null.');
					return;
				}
				copyToClipboard(`${url}/channels/${channel.value.id}`);
			},
		});

		if (isSupportShare()) {
			headerItems.push({
				icon: 'ti ti-share',
				text: i18n.ts.share,
				handler: async (): Promise<void> => {
					if (!channel.value) {
						console.warn('failed to share channel. channel.value is null.');
						return;
					}

					navigator.share({
						title: channel.value.name,
						text: channel.value.description ?? undefined,
						url: `${url}/channels/${channel.value.id}`,
					});
				},
			});
		}

		if ($i && !channel.value.isMuting) {
			headerItems.push({
				icon: 'ti ti-volume',
				text: i18n.ts.mute,
				handler: async (): Promise<void> => {
					await mute();
				},
			});
		} else if ($i) {
			headerItems.push({
				icon: 'ti ti-volume-off',
				text: i18n.ts.unmute,
				handler: async (): Promise<void> => {
					await unmute();
				},
			});
		}

		if (($i && $i.id === channel.value.userId) || iAmModerator) {
			headerItems.push({
				icon: 'ti ti-settings',
				text: i18n.ts.edit,
				handler: edit,
			});
		}

		return headerItems.length > 0 ? headerItems : null;
	} else {
		return null;
	}
});

const headerTabs = computed(() => [{
	key: 'overview',
	title: i18n.ts.overview,
	icon: 'ti ti-info-circle',
}, {
	key: 'timeline',
	title: i18n.ts.timeline,
	icon: 'ti ti-home',
}, {
	key: 'featured',
	title: i18n.ts.featured,
	icon: 'ti ti-bolt',
}, {
	key: 'search',
	title: i18n.ts.search,
	icon: 'ti ti-search',
}]);

definePage(() => ({
	title: channel.value ? channel.value.name : i18n.ts.zalip._communities.title,
	icon: 'ti ti-users',
}));
</script>

<style lang="scss" module>
.communityHeader { margin-bottom: 24px; h1 { margin: 16px 0 8px; font-size: 26px; overflow-wrap: anywhere; } > p { color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; line-height: 1.5; } }
.directoryLink { display: inline-flex; align-items: center; gap: 8px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.communityActions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 16px; }
.writePost, .favoriteButton { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 16px; border-radius: 999px; background: var(--MI_THEME-buttonBg); &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } &:disabled { opacity: .5; cursor: not-allowed; } }
.writePost { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 13px; font-weight: 700; }
.favoriteButton[aria-pressed=true] { color: var(--MI_THEME-accent); }
.loadState { padding: 32px 16px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.footer {
	-webkit-backdrop-filter: var(--MI-blur, blur(15px));
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.bannerContainer {
	position: relative;
}

.subscribe {
	position: absolute;
	z-index: 1;
	top: 16px;
	left: 16px;
}

.favorite {
	position: absolute;
	z-index: 1;
	top: 16px;
	right: 16px;
}

.banner {
	position: relative;
	height: 200px;
	background-position: center;
	background-size: cover;
}

.bannerFade {
	position: absolute;
	bottom: 0;
	left: 0;
	width: 100%;
	height: 64px;
	background: linear-gradient(0deg, var(--MI_THEME-panel), color(from var(--MI_THEME-panel) srgb r g b / 0));
}

.bannerStatus {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	right: 16px;
	padding: 8px 12px;
	font-size: 80%;
	background: rgba(0, 0, 0, 0.7);
	border-radius: 6px;
	color: #fff;
}

.description {
	padding: 16px;
}

.sensitiveIndicator {
	position: absolute;
	z-index: 1;
	bottom: 16px;
	left: 16px;
	background: rgba(0, 0, 0, 0.7);
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	font-weight: bold;
	font-size: 1em;
	padding: 4px 7px;
}
</style>
