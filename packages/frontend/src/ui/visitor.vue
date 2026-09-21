<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<XSidebar v-if="!isMobile" :class="$style.sidebar"/>

	<div :class="$style.main">
		<ZalipSiteHeader/>
		<div :class="$style.content">
			<RouterView/>
		</div>
		<XMobileFooterMenu v-if="isMobile"/>
	</div>
</div>
<XCommon/>
</template>

<script lang="ts" setup>
import { computed, provide, ref } from 'vue';
import { instanceName } from '@@/js/config.js';
import XCommon from './_common_/common.vue';
import type { PageMetadata } from '@/page.js';
import ZalipSiteHeader from '@/components/ZalipSiteHeader.vue';
import { provideMetadataReceiver, provideReactiveMetadata } from '@/page.js';
import { mainRouter } from '@/router.js';
import { DI } from '@/di.js';
import XSidebar from '@/ui/_common_/navbar.vue';
import XMobileFooterMenu from '@/ui/_common_/mobile-footer-menu.vue';
import { deviceKind } from '@/utility/device-kind.js';

const isRoot = computed(() => mainRouter.currentRoute.value.name === 'index');
const MOBILE_THRESHOLD = 767;

const pageMetadata = ref<null | PageMetadata>(null);

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

const isMobile = ref(deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD);
window.addEventListener('resize', () => {
	isMobile.value = deviceKind === 'smartphone' || window.innerWidth <= MOBILE_THRESHOLD;
}, { passive: true });
</script>

<style lang="scss" module>
.root {
	--zalip-content-max-width: 960px;
	--zalip-content-small-max-width: 640px;
	--zalip-container-offset: 24px;
	--zalip-nav-width: 220px;
	--zalip-aside-width: 344px;
	--zalip-radius: 10px;
	--zalip-radius-big: 16px;
	--zalip-radius-small: 6px;

	display: flex;
	height: 100dvh;
	overflow: clip;
	background: var(--MI_THEME-navBg);
}

.sidebar {
	border-right: solid 0.5px var(--MI_THEME-divider);
}

.main {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-width: 0;
}

.content {
	display: flex;
	flex-direction: column;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overflow-x: clip;
	background: var(--MI_THEME-bg);
}

@media (max-width: 767px) {
	.root {
		--zalip-container-offset: 16px;
	}
}
</style>
