<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<MkA to="/" :class="$style.mobileBrand" :aria-label="i18n.ts.zalip.brand">zalip</MkA>
	<button type="button" class="_button" :class="$style.search" @click="openSearch">
		<i class="ti ti-search"></i>
		<span>{{ i18n.ts.zalip.siteSearchPlaceholder }}</span>
		<kbd>Ctrl K</kbd>
	</button>
	<button type="button" class="_button" :class="$style.iconButton" :aria-label="i18n.ts.zalip.appearanceTitle" @click="openAppearance">
		<i class="ti ti-sun-moon"></i>
	</button>
	<button v-if="$i == null" type="button" class="_button" :class="$style.login" :aria-label="i18n.ts.login" @click="signIn">
		<i class="ti ti-login-2"></i><span>{{ i18n.ts.login }}</span>
	</button>
	<button v-else type="button" class="_button" :class="$style.account" :aria-label="`Аккаунт @${$i.username}`" @click="openAccount">
		<MkAvatar :user="$i" :class="$style.avatar"/><span>@{{ $i.username }}</span>
	</button>
</header>
</template>

<script lang="ts" setup>
import { getAccountMenu } from '@/accounts.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { pleaseLogin } from '@/utility/please-login.js';

function openSearch(): void {
	openZalipSearch();
}

function openAppearance(ev: PointerEvent): void {
	void os.popupMenu(getZalipAppearanceMenu(), ev.currentTarget ?? ev.target, { align: 'right', width: 280 });
}

function signIn(): void {
	void pleaseLogin();
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
	grid-template-columns: minmax(260px, 620px) auto auto;
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

.search {
	display: flex;
	align-items: center;
	gap: 10px;
	min-width: 0;
	height: 40px;
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

.search kbd {
	padding: 3px 6px;
	border: 1px solid var(--MI_THEME-divider);
		border-radius: var(--zalip-radius-small);
	background: var(--MI_THEME-panelHighlight);
	color: var(--MI_THEME-fgTransparentWeak);
	font: inherit;
	font-size: 0.68rem;
}

.iconButton, .account, .login {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 7px;
	height: 40px;
	padding: 0 11px;
	border-radius: var(--zalip-radius);
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 0.82rem;
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

.account {
	max-width: 160px;
}

.account > span {
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
		grid-template-columns: minmax(220px, 620px) auto auto;
		justify-content: stretch;
	}
}

@media (max-width: 767px) {
	.root {
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: 8px;
		min-height: 52px;
		padding: 6px 10px;
	}

	.mobileBrand {
		display: block;
	}

	.search {
		height: 38px;
		justify-content: center;
	}

	.search > span {
		font-size: 0;
	}

	.search > span::after {
		content: "";
		font-size: 0.8rem;
	}

	.search kbd, .iconButton, .account > span, .login > span {
		display: none;
	}

	.account, .login {
		width: 38px;
		height: 38px;
		padding: 0;
	}
}
</style>
