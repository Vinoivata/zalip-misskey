<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="[$style.root, { '_forceShrinkSpacer': isMobile, [$style.mobile]: isMobile, [$style.social]: isSocial, [$style.wide]: pageMetadata?.needWideArea, [$style.chatRoom]: isChatRoom, [$style.withMobileNav]: isMobile && !isThread && !isChatRoom }]">
	<XTitlebar v-if="prefer.r.showTitlebar.value" style="flex-shrink: 0;"/>

	<div :class="$style.nonTitlebarArea">
		<XSidebar v-if="!isMobile" :class="$style.sidebar" :showWidgetButton="!showWidgetsSide" @widgetButtonClick="widgetsShowing = true"/>

		<div :class="[$style.contents, { [$style.threadContents]: isThread, [$style.chromeHidden]: chromeHidden }, !isMobile && prefer.r.showTitlebar.value ? $style.withSidebarAndTitlebar : null]" @contextmenu.stop="onContextmenu" @scroll.capture.passive="onContentScroll">
			<div>
				<XReloadSuggestion v-if="shouldSuggestReload"/>
				<XPreferenceRestore v-if="shouldSuggestRestoreBackup"/>
				<XThemePreviewing v-if="isThemePreviewMode"/>
				<XAnnouncements v-if="$i"/>
				<XStatusBars :class="$style.statusbars"/>
			</div>
			<ZalipSiteHeader :mobile="isMobile" :hidden="chromeHidden && !isThread"/>
			<StackingRouterView v-if="prefer.s['experimental.stackingRouterView']" :class="$style.content"/>
			<RouterView v-else :class="$style.content"/>
			<XMobileFooterMenu v-if="isMobile && !isThread && !isChatRoom" :hidden="chromeHidden"/>
			<div v-if="isThread" id="zalip-reply-slot" :class="$style.replySlot"></div>
		</div>

		<div v-if="showWidgetsSide && !pageMetadata?.needWideArea" :class="$style.widgets">
			<XWidgets v-if="$i"/>
			<XDiscovery v-else/>
		</div>
	</div>

	<XCommon v-model:drawerMenuShowing="drawerMenuShowing" v-model:widgetsShowing="widgetsShowing"/>
</div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, provide, onBeforeUnmount, computed, ref, watch } from 'vue';
import { instanceName } from '@@/js/config.js';
import { isLink } from '@@/js/is-link.js';
import XCommon from './_common_/common.vue';
import type { PageMetadata } from '@/page.js';
import XMobileFooterMenu from '@/ui/_common_/mobile-footer-menu.vue';
import XPreferenceRestore from '@/ui/_common_/PreferenceRestore.vue';
import XReloadSuggestion from '@/ui/_common_/ReloadSuggestion.vue';
import XThemePreviewing from '@/ui/_common_/ThemePreviewing.vue';
import XTitlebar from '@/ui/_common_/titlebar.vue';
import XSidebar from '@/ui/_common_/navbar.vue';
import ZalipSiteHeader from '@/components/ZalipSiteHeader.vue';
import { isPreviewMode as isThemePreviewMode } from '@/theme.js';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { deviceKind } from '@/utility/device-kind.js';
import { miLocalStorage } from '@/local-storage.js';
import { mainRouter } from '@/router.js';
import { prefer } from '@/preferences.js';
import { shouldSuggestRestoreBackup } from '@/preferences/utility.js';
import { DI } from '@/di.js';
import { shouldSuggestReload } from '@/utility/reload-suggest.js';

const XWidgets = defineAsyncComponent(() => import('./_common_/widgets.vue'));
const XDiscovery = defineAsyncComponent(() => import('./_common_/zalip-discovery-widgets.vue'));
const XStatusBars = defineAsyncComponent(() => import('@/ui/_common_/statusbars.vue'));
const XAnnouncements = defineAsyncComponent(() => import('@/ui/_common_/announcements.vue'));

const isRoot = computed(() => mainRouter.currentRoute.value.name === 'index');
const isThread = computed(() => mainRouter.currentRoute.value.name === 'note');
const isChatRoom = computed(() => /^\/chat\/(user|room)\//.test(mainRouter.currentRoute.value.path));
const isSocial = computed(() => isThread.value || ['/', '/timeline', '/my/favorites', '/my/notifications', '/chat'].includes(mainRouter.currentRoute.value.path) || isChatRoom.value);
const chromeHidden = ref(false);
let lastScroll = 0;
let scrollTravel = 0;
let scrollElement: HTMLElement | null = null;

function onContentScroll(event: Event): void {
	const target = event.target;
	if (!isMobile.value || isThread.value || isChatRoom.value || !(target instanceof HTMLElement) || !target.classList.contains('_pageScrollable')) return;
	const y = Math.max(0, Math.min(target.scrollTop, target.scrollHeight - target.clientHeight));
	if (scrollElement !== target) {
		scrollElement = target;
		lastScroll = 0;
		scrollTravel = 0;
	}
	const delta = y - lastScroll;
	lastScroll = y;
	if (Math.sign(delta) !== Math.sign(scrollTravel)) scrollTravel = 0;
	scrollTravel += delta;
	if (y < 48) chromeHidden.value = false;
	else if (scrollTravel > 28) chromeHidden.value = true;
	else if (scrollTravel < -12) chromeHidden.value = false;
}

watch(() => mainRouter.currentRoute.value, () => {
	chromeHidden.value = false;
	lastScroll = 0;
	scrollTravel = 0;
	scrollElement = null;
});

const DESKTOP_THRESHOLD = 1400;
// Tablets are neither a narrow desktop nor a large phone.  Give them the
// focused, footer-navigation layout so the 220px sidebar cannot squeeze a
// timeline into a thin strip.
const MOBILE_THRESHOLD = 1099;

// デスクトップでウィンドウを狭くしたときモバイルUIが表示されて欲しいことはあるので deviceKind === 'desktop' の判定は行わない
const isMobile = ref(deviceKind !== 'desktop' || window.innerWidth <= MOBILE_THRESHOLD);
const showWidgetsSide = ref(!isMobile.value && window.innerWidth >= DESKTOP_THRESHOLD);

function updateViewport(): void {
	isMobile.value = deviceKind !== 'desktop' || window.innerWidth <= MOBILE_THRESHOLD;
	showWidgetsSide.value = !isMobile.value && window.innerWidth >= DESKTOP_THRESHOLD;
	if (!isMobile.value) chromeHidden.value = false;
}

window.addEventListener('resize', updateViewport, { passive: true });
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));

const pageMetadata = ref<null | PageMetadata>(null);
const widgetsShowing = ref(false);

provide(DI.router, mainRouter);
provideMetadataReceiver((metadataGetter) => {
	const info = metadataGetter();
	pageMetadata.value = info;
	if (pageMetadata.value) {
		if (isRoot.value && pageMetadata.value.title === instanceName) {
			window.document.title = pageMetadata.value.title;
		} else {
			window.document.title = `${pageMetadata.value.title} | ${instanceName}`;
		}
	}
});
provideReactiveMetadata(pageMetadata);

const drawerMenuShowing = ref(false);

mainRouter.on('change', () => {
	drawerMenuShowing.value = false;
});

if (window.innerWidth > 1024) {
	const tempUI = miLocalStorage.getItem('ui_temp');
	if (tempUI) {
		miLocalStorage.setItem('ui', tempUI);
		miLocalStorage.removeItem('ui_temp');
		window.location.reload();
	}
}

function onContextmenu(ev: PointerEvent) {
	if (isLink(ev.target as HTMLElement)) return;
	if (['INPUT', 'TEXTAREA', 'IMG', 'VIDEO', 'CANVAS'].includes((ev.target as HTMLElement).tagName) || (ev.target as HTMLElement).attributes.getNamedItem('contenteditable') != null) return;
	if (window.getSelection()?.toString() !== '') return;
	const path = mainRouter.getCurrentFullPath();
	os.contextMenu([{
		type: 'label',
		text: path,
	}, {
		icon: 'ti ti-window-maximize',
		text: i18n.ts.openInWindow,
		action: () => {
			os.pageWindow(path);
		},
	}], ev);
}
</script>

<style lang="scss" module>
$widgets-hide-threshold: 1399px;

.root {
	height: 100dvh;
	overflow: clip;
	contain: strict;
	display: flex;
	flex-direction: column;
	background: var(--zalip-social-bg);
	color: var(--zalip-social-fg);
}

.root {
	--MI_THEME-bg: var(--zalip-social-bg);
	--MI_THEME-panel: var(--zalip-social-panel);
	--MI_THEME-fg: var(--zalip-social-fg);
	--MI_THEME-fgHighlighted: var(--zalip-social-fg);
	--MI_THEME-fgTransparentWeak: var(--zalip-social-muted);
	--MI_THEME-fgTransparent: var(--zalip-social-muted);
	--MI_THEME-divider: var(--zalip-social-border);
	--MI_THEME-panelHighlight: var(--zalip-social-hover);
	font-family: Inter, Arial, sans-serif;
}

@media (max-width: 1099px) {
	.root {
		--zalip-container-offset: 18px;
	}
}

.nonTitlebarArea {
	display: flex;
	flex: 1;
	min-height: 0;
	width: 100%;
	max-width: 1600px;
	margin: 0 auto;
}

.sidebar {
	flex: 0 0 240px;
}

.contents {
	position: relative;
	display: flex;
	flex-direction: column;
	flex: 1;
	height: 100%;
	min-width: 0;
	--zalip-chrome-top: 0px;

	&.withSidebarAndTitlebar {
		background: var(--MI_THEME-navBg);
		border-radius: 12px 0 0 0;
		overflow: clip;
	}
}

.content {
	flex: 1;
	min-height: 0;
	box-sizing: border-box;
}
.replySlot { position: absolute; z-index: 1100; bottom: max(12px, env(safe-area-inset-bottom, 0px)); left: 12px; right: 12px; max-width: calc(var(--zalip-feed-width) - 24px); margin-inline: auto; pointer-events: none; }

.social .contents { border-inline: 1px solid var(--zalip-social-border); background: var(--zalip-social-panel); }
.social :global(._pageScrollable) { background: var(--zalip-social-panel); }

.statusbars {
	position: sticky;
	top: 0;
	left: 0;
}

.widgets {
	flex: 0 0 280px;
	width: 280px;
	height: 100%;
	box-sizing: border-box;
	overflow: auto;
	padding: 20px 12px 24px 20px;
	background: var(--zalip-social-bg);

	@media (max-width: $widgets-hide-threshold) {
		display: none;
	}
}

.mobile {
	.nonTitlebarArea { max-width: 920px; }
	.contents { --zalip-chrome-top: 53px; }
	.content :global(._pageScrollable) { scrollbar-width: none; scroll-padding-top: 53px; }
	.content :global(._pageScrollable) > div { padding-top: 53px; }
	.content :global(._pageScrollableReversed) > div { padding-top: 53px; }
	&.withMobileNav .content :global(._pageScrollable) > div { padding-bottom: calc(112px + env(safe-area-inset-bottom, 0px)); }
	.chromeHidden { --zalip-chrome-top: 0px; }
}
.mobile.wide .nonTitlebarArea { max-width: 1200px; }
.mobile.chatRoom {
	.content { margin-top: 53px; }
	.content :global(._pageScrollable) > div, .content :global(._pageScrollableReversed) > div { padding-top: 0; }
}
@media (max-width: 700px) { .social .contents { border-inline: 0; } }
</style>
