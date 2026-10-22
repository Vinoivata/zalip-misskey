<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<article :class="$style.root">
	<MkA :to="'/channels/' + channel.id" :class="$style.link" @click="updateLastReadedAt">
		<div :class="$style.banner"><img v-if="channel.bannerUrl && !failedBanner" :src="channel.bannerUrl" alt="" width="600" height="220" loading="lazy" decoding="async" @error="failedBanner = true"><i v-else class="ti ti-users" aria-hidden="true"></i><span v-if="unread" :class="$style.unread" :aria-label="i18n.ts.unread"></span></div>
		<div :class="$style.body"><h2>{{ channel.name }}</h2><p>{{ channel.description || i18n.ts.zalip._communities.publicNotice }}</p><span v-if="channel.isArchived" :class="$style.label">{{ i18n.ts.thisChannelArchived }}</span><span v-if="channel.isSensitive" :class="$style.label">{{ i18n.ts.sensitive }}</span></div>
	</MkA>
	<footer :class="$style.footer"><div :class="$style.stats"><span>{{ i18n.tsx.zalip._communities.authorsCount({ n: channel.usersCount }) }}</span><span>{{ i18n.tsx.zalip._communities.notesCount({ n: channel.notesCount }) }}</span></div><MkChannelFollowButton :channel="channel" full/></footer>
</article>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import MkChannelFollowButton from '@/components/MkChannelFollowButton.vue';
import { i18n } from '@/i18n.js';
import { miLocalStorage } from '@/local-storage.js';

const props = defineProps<{ channel: Misskey.entities.Channel }>();
const failedBanner = ref(false);
const lastReadedAt = ref<number | null>(null);
watch(() => props.channel.id, () => { failedBanner.value = false; lastReadedAt.value = miLocalStorage.getItemAsJson(`channelLastReadedAt:${props.channel.id}`) ?? null; }, { immediate: true });
const unread = computed(() => props.channel.lastNotedAt && (props.channel.isFavorited || props.channel.isFollowing) && (!lastReadedAt.value || Date.parse(props.channel.lastNotedAt) > lastReadedAt.value));

function updateLastReadedAt(): void { lastReadedAt.value = props.channel.lastNotedAt ? Date.parse(props.channel.lastNotedAt) : Date.now(); }
</script>

<style lang="scss" module>
.root { min-width: 0; overflow: hidden; border: 1px solid var(--MI_THEME-divider); border-radius: 20px; background: var(--MI_THEME-panel); }
.link { display: block; color: inherit; text-decoration: none; &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -3px; } }
.banner { position: relative; display: grid; place-items: center; height: 120px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-accent); > img { display: block; width: 100%; height: 100%; object-fit: cover; } > i { font-size: 36px; } }
.unread { position: absolute; inset-inline-end: 12px; top: 12px; width: 10px; height: 10px; border: 3px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-accent); }
.body { padding: 16px; h2 { margin: 0; font-size: 17px; overflow-wrap: anywhere; } p { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 40px; margin: 8px 0 0; font-size: 13px; line-height: 20px; color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; } }
.label { display: inline-block; margin-top: 10px; margin-inline-end: 6px; padding: 4px 8px; border-radius: 999px; font-size: 11px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fgTransparentWeak); }
.footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px 16px; }
.stats { display: flex; flex-direction: column; gap: 4px; color: var(--MI_THEME-fgTransparentWeak); font-size: 11px; }
@media (prefers-reduced-motion: no-preference) { .root { transition: border-color .15s ease; &:hover { border-color: var(--MI_THEME-accent); } } }
</style>
