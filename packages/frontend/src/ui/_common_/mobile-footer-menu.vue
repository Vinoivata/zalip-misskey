<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="$style.root">
	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.zalip.title" :title="navbarItemDef.zalip.title" to="/" exact>
		<div :class="$style.itemInner">
			<i :class="$style.itemIcon" class="ti ti-movie"></i><span :class="$style.itemText">{{ navbarItemDef.zalip.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.feed.title" :title="navbarItemDef.feed.title" to="/timeline">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.feed.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.feed.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.library.title" :title="navbarItemDef.library.title" to="/library">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.library.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.library.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.updates.title" :title="navbarItemDef.updates.title" to="/updates">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.updates.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.updates.title }}</span>
		</div>
	</MkA>

	<MkA :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.notifications.title" :title="navbarItemDef.notifications.title" to="/my/notifications">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.notifications.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.notifications.title }}</span>
			<span v-if="$i?.hasUnreadNotification" :class="$style.itemIndicator" class="_blink">
				<span class="_indicateCounter" :class="$style.itemIndicateValueIcon">{{ $i.unreadNotificationsCount > 99 ? '99+' : $i.unreadNotificationsCount }}</span>
			</span>
		</div>
	</MkA>

	<MkA v-if="$i" :class="$style.item" :activeClass="$style.active" :aria-label="navbarItemDef.profile.title" :title="navbarItemDef.profile.title" :to="`/@${$i.username}`">
		<div :class="$style.itemInner">
			<i :class="[$style.itemIcon, navbarItemDef.profile.icon]"></i><span :class="$style.itemText">{{ navbarItemDef.profile.title }}</span>
		</div>
	</MkA>
	<button v-else :class="$style.item" class="_button" :aria-label="i18n.ts.login" :title="i18n.ts.login" @click="signIn">
		<div :class="$style.itemInner">
			<i :class="$style.itemIcon" class="ti ti-login"></i><span :class="$style.itemText">{{ i18n.ts.login }}</span>
		</div>
	</button>
</div>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef, watch } from 'vue';
import { $i } from '@/i.js';
import { navbarItemDef } from '@/navbar.js';
import { i18n } from '@/i18n.js';
import { pleaseLogin } from '@/utility/please-login.js';

const rootEl = useTemplateRef('rootEl');

const rootElHeight = ref(0);

function signIn(): void {
	void pleaseLogin();
}

watch(rootEl, () => {
	if (rootEl.value) {
		rootElHeight.value = rootEl.value.offsetHeight;
		window.document.body.style.setProperty('--MI-minBottomSpacing', 'var(--MI-minBottomSpacingMobile)');
	} else {
		rootElHeight.value = 0;
		window.document.body.style.setProperty('--MI-minBottomSpacing', '0px');
	}
}, {
	immediate: true,
});
</script>

<style lang="scss" module>
.root {
	position: relative;
	z-index: 1;
	padding-bottom: env(safe-area-inset-bottom, 0px);
	display: grid;
	grid-template-columns: repeat(6, minmax(0, 1fr));
	width: 100%;
	box-sizing: border-box;
	background: var(--MI_THEME-navBg);
	color: var(--MI_THEME-navFg);
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.item {
	display: flex;
	align-items: stretch;
	justify-content: center;
	min-width: 0;
	min-height: 56px;
	padding: 6px 0;
	color: inherit;
	text-decoration: none;

	&:first-child {
		padding-left: 12px;
	}

	&:last-child {
		padding-right: 12px;
	}

	&.active {
		color: var(--MI_THEME-accent);

		.itemInner {
			background: var(--MI_THEME-accentedBg);
		}
	}
}

.itemInner {
	position: relative;
	display: grid;
	justify-items: center;
	gap: 4px;
	padding: 5px 0;
	width: 100%;
	max-width: 42px;
	margin: auto;
	border-radius: 100%;

	&:hover {
		background: var(--MI_THEME-panelHighlight);
	}

	&:active {
		background: var(--MI_THEME-panelHighlight);
	}
}

.itemIcon {
	font-size: 17px;
}

.itemText {
	max-width: 100%;
	overflow: hidden;
	font-size: 0.6rem;
	font-weight: 650;
	line-height: 1.1;
	text-align: center;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.itemIndicator {
	position: absolute;
	bottom: -4px;
	left: 0;
	right: 0;
	color: var(--MI_THEME-indicator);
	font-size: 10px;
	pointer-events: none;

	&:has(.itemIndicateValueIcon) {
		animation: none;
		font-size: 8px;
	}
}

@media (max-width: 400px) {
	.root {
		padding-inline: 2px;
	}

	.item {
		min-height: 54px;
	}

	.itemInner {
		max-width: 44px;
		padding: 7px 0;
	}

	.itemText {
		display: none;
	}
}
</style>
