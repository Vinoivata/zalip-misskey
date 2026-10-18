<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button
	v-if="user.id !== $i?.id"
	ref="target"
	type="button"
	class="_button"
	:class="[$style.root, { [$style.selected]: relation?.isFollowing || relation?.hasPendingFollowRequestFromYou }]"
	:disabled="disabled"
	:aria-label="label"
	:title="label"
	:aria-pressed="!!(relation?.isFollowing || relation?.hasPendingFollowRequestFromYou)"
	:aria-busy="busy"
	:data-zalip-follow="user.id"
	data-zalip-post-interactive
	@click.stop="onClick"
>
	<i v-if="busy" class="ti ti-loader" :class="$style.spinner" aria-hidden="true"></i>
	<i v-else-if="relation?.hasPendingFollowRequestFromYou" class="ti ti-hourglass-empty" aria-hidden="true"></i>
	<i v-else-if="relation?.isFollowing" class="ti ti-check" aria-hidden="true"></i>
	<i v-else-if="failed" class="ti ti-refresh" aria-hidden="true"></i>
	<i v-else class="ti ti-user-plus" aria-hidden="true"></i>
	<span>{{ label }}</span>
</button>
</template>

<script lang="ts" setup>
import { computed, inject, onBeforeUnmount, useTemplateRef } from 'vue';
import type * as Misskey from 'misskey-js';
import * as os from '@/os.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { DI } from '@/di.js';
import { prefer } from '@/preferences.js';
import { useZalipFollow } from '@/composables/use-zalip-follow.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { sameFollowActor } from '@/utility/zalip-follow-relations.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { haptic } from '@/utility/haptic.js';
import { claimAchievement } from '@/utility/achievements.js';

const props = withDefaults(defineProps<{ user: Misskey.entities.UserLite; mock?: boolean }>(), { mock: false });
const injectedMock = inject(DI.mock, false);
const mock = computed(() => props.mock || injectedMock);
const target = useTemplateRef<HTMLElement>('target');
const follow = useZalipFollow(target, () => props.user.id, () => !mock.value);
const relation = computed(() => follow.state.value?.relation);
const failed = computed(() => !relation.value && (follow.failed.value || (follow.state.value?.failed ?? false)));
const busy = computed(() => !mock.value && !!$i && (!!follow.state.value?.loading || !!follow.state.value?.changing || (!relation.value && !failed.value)));
const blocked = computed(() => Boolean(relation.value?.isBlocking) || Boolean(relation.value?.isBlocked));
const disabled = computed(() => mock.value || busy.value || !!blocked.value);
const label = computed(() => blocked.value ? i18n.ts.blocked : busy.value ? i18n.ts.processing : failed.value ? i18n.ts.retry : relation.value?.hasPendingFollowRequestFromYou ? i18n.ts.followRequestPending : relation.value?.isFollowing ? i18n.ts.youFollowing : i18n.ts.follow);
let alive = true;
onBeforeUnmount(() => { alive = false; });

async function onClick(): Promise<void> {
	if (mock.value || disabled.value) return;
	const user = props.user;
	const name = user.name?.length ? user.name : user.username;
	const actor = follow.account();
	if (!actor) { await pleaseLogin(); return; }
	const current = (): boolean => alive && follow.valid() && props.user.id === user.id && sameFollowActor(actor, follow.account());
	if (!relation.value || failed.value) { await follow.load(true); return; }
	const unlock = follow.lock();
	if (!unlock) return;
	let error: unknown;
	try {
		await follow.load(true);
		const snapshot = follow.state.value?.relation;
		if (!current() || !snapshot || snapshot.isBlocked || snapshot.isBlocking) return;
		const actionCurrent = (): boolean => current() && relation.value === snapshot;
		if (snapshot.isFollowing) {
			const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx.unfollowConfirm({ name }) });
			if (canceled || !actionCurrent()) return;
			haptic();
			await misskeyApi('following/delete', { userId: user.id }, actor.token);
		} else if (snapshot.hasPendingFollowRequestFromYou) {
			const { canceled } = await os.confirm({ type: 'question', text: i18n.tsx.cancelFollowRequestConfirm({ name }) });
			if (canceled || !actionCurrent()) return;
			haptic();
			await misskeyApi('following/requests/cancel', { userId: user.id }, actor.token);
		} else {
			if (prefer.s.alwaysConfirmFollow) {
				const { canceled } = await os.confirm({ type: 'question', text: i18n.tsx.followConfirm({ name }) });
				if (canceled || !actionCurrent()) return;
			}
			if (!actionCurrent()) return;
			haptic();
			await misskeyApi('following/create', { userId: user.id, withReplies: prefer.s.defaultFollowWithReplies }, actor.token);
			if (current()) {
				claimAchievement('following1');
				for (const count of [10, 50, 100, 300] as const) if (($i?.followingCount ?? 0) >= count) claimAchievement(`following${count}`);
			}
		}
	} catch (caught) { error = caught; } finally {
		if (current()) await follow.load(true);
		unlock();
	}
	const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
	if (error && current() && !['ALREADY_FOLLOWING', 'NOT_FOLLOWING', 'FOLLOW_REQUEST_NOT_FOUND'].includes(String(code))) await os.alert({ type: 'error', text: i18n.ts.somethingHappened });
}
</script>

<style lang="scss" module>
.root { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: 0 0 auto; align-self: flex-start; min-height: 26px; max-width: min(150px, 42vw); padding: 0 10px; border: 1px solid var(--MI_THEME-divider); border-radius: 50px; color: var(--MI_THEME-fg); background: transparent; font-family: var(--zalip-font-family, inherit); font-size: 12px; font-weight: 700; line-height: 1.25; transition: background .15s, border-color .15s; }
.root > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.root > i { display: grid; place-items: center; flex: 0 0 14px; width: 14px; height: 14px; font-size: 14px; line-height: 1; vertical-align: 0; }
.root > i::before { display: block; font-size: 1em; line-height: 1; }
.root:hover:not(:disabled) { background: var(--MI_THEME-buttonHoverBg); border-color: var(--MI_THEME-fgTransparentWeak); }
.root:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.root:disabled { opacity: .65; }
.selected { background: var(--MI_THEME-panelHighlight); }
.spinner { animation: followSpin 1s linear infinite; }
@keyframes followSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .root { transition: none; } .spinner { animation: none; } }
@media (pointer: coarse) { .root { min-height: 44px; } }
@media (max-width: 600px) {
	.root { --zalip-follow-compact-size: 36px; position: relative; width: var(--zalip-follow-compact-size); min-width: var(--zalip-follow-compact-size); max-width: var(--zalip-follow-compact-size); min-height: var(--zalip-follow-compact-size); flex-basis: var(--zalip-follow-compact-size); box-sizing: border-box; padding: 0; gap: 0; border-color: transparent; background: transparent; }
	.root::before { content: ''; position: absolute; inset: 0; margin: auto; width: 28px; height: 28px; box-sizing: border-box; border: 1px solid var(--MI_THEME-divider); border-radius: 50%; background: transparent; }
	.root.selected::before { background: var(--MI_THEME-panelHighlight); }
	.root:hover:not(:disabled) { background: transparent; border-color: transparent; }
	.root:hover:not(:disabled)::before { background: var(--MI_THEME-buttonHoverBg); border-color: var(--MI_THEME-fgTransparentWeak); }
	.root > i { position: relative; }
	.root > span { display: none; }
}
@media (max-width: 600px) and (pointer: coarse) { .root { --zalip-follow-compact-size: 44px; } }
</style>
