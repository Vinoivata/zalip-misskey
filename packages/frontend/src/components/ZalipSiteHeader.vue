<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="[$style.root, { [$style.threadHeader]: isThread }]">
	<button type="button" class="_button" :class="$style.mobileCreate" :aria-label="isThread ? 'Назад' : i18n.ts.zalip.feedQuickPost" @click="isThread ? goBack() : writePost()"><i :class="isThread ? 'ti ti-arrow-left' : 'ti ti-plus'"></i></button>
	<MkA v-if="!isThread" to="/" :class="$style.mobileBrand" :aria-label="i18n.ts.zalip.brand">zalip</MkA>
	<div v-else :class="$style.threadTitle">Обсуждение</div>
	<button type="button" class="_button" :class="$style.search" @click="openSearch">
		<i class="ti ti-search"></i>
		<span :class="$style.searchDesktop">{{ i18n.ts.zalip.siteSearchPlaceholder }}</span>
		<span :class="$style.searchMobile">{{ i18n.ts.zalip.search }}</span>
		<kbd>Ctrl K</kbd>
	</button>
	<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.zalip.appearanceTitle" @click="openAppearance">
		<i class="ti ti-sun-moon"></i>
	</button>
	<button v-if="$i == null" type="button" class="_button" :class="$style.signup" @click="openZalipSignup"><span>{{ i18n.ts.signup }}</span></button>
	<button v-if="$i == null" type="button" class="_button" :class="$style.login" :aria-label="i18n.ts.login" @click="signIn">
		<i class="ti ti-login-2"></i><span>{{ i18n.ts.login }}</span>
	</button>
	<button v-else type="button" class="_button" :class="$style.account" :aria-label="`Аккаунт @${$i.username}`" @click="openAccount">
		<MkAvatar :user="$i" :class="$style.avatar"/><span :class="$style.accountName">@{{ $i.username }}</span>
	</button>
</header>
</template>

<script lang="ts" setup>
import { getAccountMenu } from '@/accounts.js';
import { computed } from 'vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { openZalipSignup } from '@/utility/zalip-signup.js';
import { mainRouter } from '@/router.js';

const isThread = computed(() => mainRouter.currentRoute.value.name === 'note');

function openSearch(): void {
	openZalipSearch();
}

function openAppearance(ev: PointerEvent): void {
	void os.popupMenu(getZalipAppearanceMenu(), ev.currentTarget ?? ev.target, { align: 'right', width: 280 });
}

function signIn(): void {
	void pleaseLogin();
}

function goBack(): void {
	window.history.back();
}

async function writePost(): Promise<void> {
	if (!await pleaseLogin()) return;
	void os.post();
}

async function openAccount(ev: PointerEvent): Promise<void> {
	const items = await getAccountMenu({ withExtraOperation: true });
	void os.popupMenu(items, ev.currentTarget ?? ev.target, { align: 'right' });
}
</script>

<style lang="scss" module>
.root {
	position: relative;
	z-index: 1200;
	display: grid;
	grid-template-columns: minmax(0, 620px) auto auto auto;
	align-items: center;
	justify-content: center;
	gap: 10px;
	min-height: 56px;
	padding: 8px 18px;
	box-sizing: border-box;
	border-bottom: 1px solid var(--MI_THEME-divider);
	background: color-mix(in srgb, var(--MI_THEME-bg) 92%, transparent);
	backdrop-filter: blur(18px);
}

.mobileBrand {
	display: none;
	color: var(--MI_THEME-fg);
	font-size: 1.25rem;
	font-weight: 950;
	letter-spacing: -0.08em;
	text-decoration: none;
}

.mobileCreate { display: none; }

.threadTitle { display: none; }

.search {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	height: 44px;
	padding: 0 12px;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-panel);
	color: var(--MI_THEME-fgTransparentWeak);
	text-align: left;
}

.search > span {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.search > .searchMobile { display: none; }

.search kbd {
	padding: 3px 6px;
	border: 1px solid var(--MI_THEME-divider);
		border-radius: var(--zalip-radius-small);
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font: inherit;
	font-size: 0.68rem;
}

.iconButton, .account, .login, .signup {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 7px;
	height: 44px;
	padding: 0 11px;
	border-radius: var(--zalip-radius);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.95rem;
	font-weight: 700;
	text-decoration: none;
}

.iconButton:hover, .account:hover {
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fg);
}

.iconButton {
	width: 40px;
	padding: 0;
	font-size: 1.1rem;
}

.login {
	background: var(--MI_THEME-accent);
	color: var(--MI_THEME-fgOnAccent);
}

.signup { background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); }

.account {
	max-width: 160px;
}

.accountName {
	overflow: hidden;
	text-overflow: ellipsis;
}

.avatar {
	flex: 0 0 auto;
	width: 28px;
	height: 28px;
}

@media (max-width: 980px) {
	.root {
		grid-template-columns: minmax(0, 620px) auto auto auto;
		justify-content: stretch;
	}
}

@media (max-width: 1099px) {
	.root {
		grid-template-columns: 40px minmax(0, 1fr) 40px 40px;
		gap: 6px;
		min-height: 52px;
		padding: 6px 10px;
	}

	.mobileCreate { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--MI_THEME-fgTransparent); font-size: 1.38rem; }
	.mobileCreate:hover { background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); }

	.mobileBrand { display: block; justify-self: center; font-size: 1.55rem; letter-spacing: -0.11em; }
	.threadTitle { display: block; justify-self: center; font-size: 1.08rem; font-weight: 800; }

	.search {
		grid-column: 4;
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: transparent;
		font-size: 1.38rem;
	}

	.search > .searchMobile { display: none; }

	.searchDesktop, .search kbd, .accountName, .signup {
		display: none;
	}

	.iconButton { display: grid; grid-column: 3; place-items: center; width: 40px; height: 40px; padding: 0; border-radius: 50%; }

	.account, .login { display: none; }

	.threadHeader {
		grid-template-columns: 40px minmax(0, 1fr) 40px;

		.search, .iconButton { display: none; }

		.threadTitle { grid-column: 2; }
		.mobileCreate { justify-self: start; }
	}
}
</style>
