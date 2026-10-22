<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button type="button" class="_button" :class="[$style.root, { [$style.wait]: wait, [$style.active]: isFollowing, [$style.full]: full }]" :disabled="wait" :aria-busy="wait" :aria-pressed="isFollowing" :aria-label="(isFollowing ? i18n.ts.unfollow : i18n.ts.follow) + ' ' + channel.name" @click="onClick">
	<i :class="wait ? 'ti ti-loader-2' : isFollowing ? 'ti ti-check' : 'ti ti-plus'" aria-hidden="true"></i><span v-if="full">{{ wait ? i18n.ts.processing : isFollowing ? i18n.ts.unfollow : i18n.ts.follow }}</span>
</button>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, ref, watch } from 'vue';
import type * as Misskey from 'misskey-js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { $i } from '@/i.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{ channel: Misskey.entities.Channel; full?: boolean }>(), { full: false });
const emit = defineEmits<{ (ev: 'changed', following: boolean): void }>();
const isFollowing = ref(props.channel.isFollowing ?? false);
const wait = ref(false);
let epoch = 0;
let alive = true;
watch(() => [props.channel.id, props.channel.isFollowing, $i?.id, $i?.token], (value, old) => { epoch++; wait.value = false; isFollowing.value = old && (old[2] !== value[2] || old[3] !== value[3]) ? false : props.channel.isFollowing ?? false; });
onBeforeUnmount(() => { alive = false; epoch++; });

async function onClick(): Promise<void> {
	if (wait.value) return;
	if (!$i) { await pleaseLogin(); return; }
	const request = ++epoch;
	const account = $i.id;
	const token = $i.token;
	const channelId = props.channel.id;
	const next = !isFollowing.value;
	const current = () => alive && request === epoch && $i?.id === account && $i.token === token && props.channel.id === channelId;
	wait.value = true;
	try {
		await misskeyApi(next ? 'channels/follow' : 'channels/unfollow', { channelId }, token);
		if (!current()) return;
		isFollowing.value = next;
		emit('changed', next);
	} catch {
		if (current()) void os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	} finally { if (current()) wait.value = false; }
}
</script>

<style lang="scss" module>
.root { display: inline-flex; align-items: center; justify-content: center; gap: 6px; flex: 0 0 auto; min-width: 44px; min-height: 44px; padding: 0 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; color: var(--MI_THEME-fg); background: var(--MI_THEME-buttonBg); font-size: 13px; font-weight: 700; &.full { padding-inline: 16px; } &.active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); border-color: transparent; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } &:hover:not(:disabled) { border-color: var(--MI_THEME-accent); } &.wait { cursor: wait; opacity: .6; } }
</style>
