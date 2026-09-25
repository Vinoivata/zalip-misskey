<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.wrap, { [$style.hidden]: hidden }]">
	<nav :class="$style.root" :aria-label="i18n.ts.menu" :inert="hidden">
		<MkA v-for="item in items" :key="item.to" :class="$style.item" :activeClass="$style.active" :aria-label="item.unread ? `${item.label} · ${i18n.ts.unread}` : item.label" :title="item.label" :to="item.to" :exact="item.to === '/'">
			<MkZalipIcon :name="item.icon"/>
			<span v-if="item.unread" :class="[$style.indicator, { [$style.counter]: item.count > 0 }]" aria-hidden="true">{{ item.count > 0 ? (item.count > 99 ? '99+' : item.count) : '' }}</span>
		</MkA>
		<button ref="accountTrigger" type="button" class="_button" :class="$style.item" :aria-label="i18n.ts.zalip.more" aria-haspopup="dialog" :aria-expanded="accountSheetOpen" @click="accountSheetOpen = true">
			<MkAvatar v-if="$i" :user="$i" :class="$style.avatar"/>
			<MkZalipIcon v-else name="person"/>
		</button>
	</nav>
</div>
<button v-if="hidden" type="button" class="_button" :class="$style.create" :aria-label="i18n.ts.zalip.feedQuickPost" @click="writePost"><MkZalipIcon name="plus"/></button>

<Teleport to="body">
	<MkModal v-if="accountSheetOpen" ref="accountModal" preferType="drawer" :returnFocusTo="accountTrigger" @click="closeAccountSheet" @esc="closeAccountSheet" @closed="onAccountSheetClosed">
		<section :class="$style.accountSheet" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.mySpace">
			<button type="button" class="_button" :class="$style.sheetHandle" :aria-label="i18n.ts.close" @click="closeAccountSheet"><span></span></button>
			<MkA v-if="$i" :to="'/@' + $i.username" :class="$style.accountCard" @click="closeAccountSheet">
				<MkAvatar :user="$i" :class="$style.accountAvatar" :link="false"/>
				<span :class="$style.accountName"><strong>{{ $i.name || $i.username }}</strong><small>@{{ $i.username }}</small></span>
				<span :class="$style.profilePill">{{ navbarItemDef.profile.title }}</span>
			</MkA>
			<button v-else type="button" class="_button" :class="$style.accountCard" @click="login"><MkZalipIcon name="person"/><strong>{{ i18n.ts.login }}</strong></button>
			<div :class="$style.sheetGrid">
				<MkA v-for="item in accountLinks" :key="item.to" :to="item.to" :class="$style.sheetTile" @click="closeAccountSheet"><i :class="item.icon" aria-hidden="true"></i><span>{{ item.label }}</span></MkA>
				<button type="button" class="_button" :class="$style.sheetTile" @click="search"><MkZalipIcon name="search"/><span>{{ i18n.ts.zalip.search }}</span></button>
			</div>
			<div :class="$style.sheetRows">
				<MkA v-if="$i?.isAdmin" to="/zalip/editor" :class="$style.sheetRow" @click="closeAccountSheet"><i class="ti ti-square-plus" aria-hidden="true"></i>{{ i18n.ts.zalip.addContent }}</MkA>
				<MkA v-if="$i?.isAdmin || $i?.isModerator" to="/admin" :class="$style.sheetRow" @click="closeAccountSheet"><i class="ti ti-shield" aria-hidden="true"></i>{{ i18n.ts.controlPanel }}</MkA>
				<button type="button" class="_button" :class="$style.sheetRow" @click="appearance"><i class="ti ti-palette" aria-hidden="true"></i>{{ i18n.ts.zalip.appearanceTitle }}</button>
				<MkA v-if="$i" to="/settings" :class="$style.sheetRow" @click="closeAccountSheet"><i class="ti ti-settings" aria-hidden="true"></i>{{ i18n.ts.settings }}</MkA>
			</div>
			<button v-if="$i" type="button" class="_button" :class="[$style.sheetRow, $style.signout]" @click="logout"><i class="ti ti-logout" aria-hidden="true"></i>{{ i18n.ts.logout }}</button>
		</section>
	</MkModal>
</Teleport>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref, useTemplateRef } from 'vue';
import MkModal from '@/components/MkModal.vue';
import { signout } from '@/signout.js';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import type { ZalipIconName } from '@/components/MkZalipIcon.vue';
import { $i } from '@/i.js';
import { navbarItemDef } from '@/navbar.js';
import { i18n } from '@/i18n.js';
import { pleaseLogin } from '@/utility/please-login.js';
import * as os from '@/os.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { openZalipCreateMenu } from '@/utility/zalip-create.js';

defineProps<{ hidden?: boolean }>();

const items = computed<{ to: string; icon: ZalipIconName; label: string; unread?: boolean; count: number }[]>(() => [
	{ to: '/timeline', icon: 'home', label: navbarItemDef.feed.title, count: 0 },
	{ to: '/', icon: 'reels', label: navbarItemDef.zalip.title, count: 0 },
	{ to: '/my/notifications', icon: 'heart', label: i18n.ts.notifications, unread: !!$i?.hasUnreadNotification || ($i?.unreadNotificationsCount ?? 0) > 0, count: $i?.unreadNotificationsCount ?? 0 },
	{ to: '/chat', icon: 'messages', label: i18n.ts.zalip.messages, unread: !!$i?.hasUnreadChatMessages, count: 0 },
]);

function writePost(event: PointerEvent): void {
	openZalipCreateMenu(event);
}

const accountSheetOpen = ref(false);
const accountModal = useTemplateRef('accountModal');
const accountTrigger = useTemplateRef('accountTrigger');
let afterAccountSheetClosed: (() => void) | undefined;
const accountLinks = computed(() => [
	{ to: '/', icon: 'ti ti-movie', label: navbarItemDef.zalip.title },
	{ to: '/catalog', icon: 'ti ti-layout-grid', label: navbarItemDef.catalogue.title },
	{ to: '/library', icon: 'ti ti-bookmark', label: navbarItemDef.library.title },
	{ to: '/updates', icon: 'ti ti-calendar-event', label: navbarItemDef.updates.title },
	...($i ? [
		{ to: '/my/favorites', icon: 'ti ti-star', label: i18n.ts.favorites },
		{ to: '/my/widgets', icon: 'ti ti-layout', label: i18n.ts.widgets },
		{ to: '/timeline', icon: 'ti ti-message-circle', label: navbarItemDef.feed.title },
	] : []),
]);

function closeAccountSheet(): void {
	accountModal.value?.close();
}

async function onAccountSheetClosed(): Promise<void> {
	accountSheetOpen.value = false;
	// The body-teleported drawer must release its focus trap before an app popup mounts.
	await nextTick();
	const action = afterAccountSheetClosed;
	afterAccountSheetClosed = undefined;
	action?.();
}

function openAfterAccountSheet(action: () => void): void {
	afterAccountSheetClosed = action;
	closeAccountSheet();
}

function search(): void {
	openAfterAccountSheet(() => openZalipSearch());
}

function login(): void {
	openAfterAccountSheet(() => { void pleaseLogin(); });
}

function appearance(): void {
	openAfterAccountSheet(() => { void os.popupMenu(getZalipAppearanceMenu(), accountTrigger.value, { width: 280 }); });
}

function logout(): void {
	openAfterAccountSheet(() => {
		void os.confirm({ type: 'question', text: i18n.ts.logoutConfirm }).then(({ canceled }) => {
			if (!canceled) void signout();
		});
	});
}
</script>

<style lang="scss" module>
.wrap {
	position: absolute;
	z-index: 1200;
	bottom: max(24px, env(safe-area-inset-bottom, 0px));
	left: 0;
	right: 0;
	display: flex;
	justify-content: center;
	padding: 0 16px;
	pointer-events: none;
	transition: transform .4s cubic-bezier(.34, 1.56, .64, 1), opacity .25s ease;
}
.hidden { transform: translateY(calc(100% + 40px)); opacity: 0; }
.root, .create {
	background: var(--zalip-glass);
	-webkit-backdrop-filter: blur(22px) saturate(1.6) contrast(.9);
	backdrop-filter: blur(22px) saturate(1.6) contrast(.9);
	box-shadow: 0 10px 30px var(--zalip-glass-shadow), inset 0 1px var(--zalip-glass-highlight);
}
.root {
	position: relative;
	display: flex;
	align-items: center;
	width: 100%;
	max-width: 400px;
	height: 68px;
	padding: 0 8px;
	box-sizing: border-box;
	border: 1px solid var(--zalip-glass-highlight);
	border-radius: 34px;
	pointer-events: auto;
}
.item {
	position: relative;
	display: grid;
	place-items: center;
	flex: 1;
	height: 100%;
	min-width: 0;
	color: var(--zalip-social-subtle);
	text-decoration: none;
	-webkit-tap-highlight-color: transparent;
	&::before {
		content: '';
		position: absolute;
		width: 55px;
		max-width: 100%;
		height: 46px;
		border-radius: 28px;
		transition: background .2s ease, transform .2s ease;
	}
	> svg, > .avatar { position: relative; width: 24px; height: 24px; }
	&.active {
		color: var(--zalip-social-fg);
		&::before { background: var(--zalip-glass-active); transform: scaleX(1.12); }
	}
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); border-radius: 30px; }
	> .avatar { width: 32px; height: 32px; opacity: .85; }
}
.indicator { position: absolute; z-index: 1; top: 15px; left: calc(50% + 5px); width: 8px; height: 8px; border: 2px solid var(--zalip-social-panel); border-radius: 99px; background: var(--MI_THEME-accent); pointer-events: none; }
.counter { top: 8px; min-width: 16px; width: auto; height: 16px; padding: 0 3px; color: var(--MI_THEME-fgOnAccent); font-size: 10px; line-height: 16px; font-weight: 700; text-align: center; }
.create {
	position: absolute;
	z-index: 1190;
	bottom: max(24px, env(safe-area-inset-bottom, 0px));
	right: 16px;
	display: grid;
	place-items: center;
	width: 56px;
	height: 56px;
	border: 1px solid var(--zalip-glass-highlight);
	border-radius: 16px;
	color: var(--zalip-social-fg);
	> svg { width: 28px; height: 28px; }
}
@media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }

.accountSheet { width: min(100%, 540px); max-height: 88dvh; box-sizing: border-box; overflow: auto; overscroll-behavior: contain; margin: 0 auto; padding: 0 16px max(24px, env(safe-area-inset-bottom)); border-radius: 28px 28px 0 0; background: var(--zalip-social-panel); color: var(--zalip-social-fg); }
.sheetHandle { display: grid; place-items: center; width: 100%; height: 34px; }
.sheetHandle span { width: 36px; height: 4px; border-radius: 99px; background: var(--zalip-social-subtle); opacity: .6; }
.accountCard { display: flex; align-items: center; gap: 12px; width: 100%; box-sizing: border-box; padding: 16px; margin-bottom: 12px; border-radius: 18px; background: var(--zalip-social-raised); text-decoration: none; }
.accountAvatar { flex: 0 0 50px; width: 50px; height: 50px; }
.accountName { display: grid; gap: 4px; min-width: 0; flex: 1; }
.accountName strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 17px; }
.accountName small { color: var(--zalip-social-muted); overflow-wrap: anywhere; }
.profilePill { padding: 8px 12px; border-radius: 99px; background: var(--zalip-social-hover); font-size: 12px; font-weight: 600; }
.sheetGrid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.sheetTile { display: grid; grid-template-rows: 24px minmax(28px, auto); justify-items: center; align-content: start; gap: 8px; min-height: 88px; padding: 14px 4px 10px; box-sizing: border-box; border-radius: 16px; background: var(--zalip-social-raised); color: var(--zalip-social-muted); text-align: center; text-decoration: none; font-size: 11px; line-height: 14px; overflow-wrap: anywhere; }
.sheetTile > span { width: 100%; }
.sheetTile i, .sheetTile svg { display: grid; place-items: center; width: 24px; height: 24px; font-size: 23px; line-height: 1; color: var(--zalip-social-fg); }
.sheetTile:hover, .accountCard:hover { background: var(--zalip-accent-soft); }
.sheetRows { padding: 16px 0; }
.sheetRow { display: flex; align-items: center; gap: 14px; width: 100%; box-sizing: border-box; min-height: 48px; padding: 10px 14px; border-radius: 12px; text-align: left; font-size: 15px; font-weight: 600; text-decoration: none; }
.sheetRow i { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; font-size: 22px; line-height: 1; }
.sheetRow:hover { background: var(--zalip-social-hover); }
.signout { padding-top: 18px; border-top: 1px solid var(--zalip-social-border); border-radius: 0; color: var(--MI_THEME-error); }
@media (max-width: 350px) { .accountCard { padding: 12px; gap: 8px; } .profilePill { padding: 8px; font-size: 11px; } .accountAvatar { flex-basis: 40px; width: 40px; height: 40px; } .accountName strong { font-size: 14px; } }
</style>
