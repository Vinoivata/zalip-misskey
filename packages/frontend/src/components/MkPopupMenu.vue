<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	v-slot="{ type, maxHeight }"
	:manualShowing="manualShowing"
	:zPriority="'high'"
	:anchorElement="anchorElement"
	:preferType="modalType"
	:transparentBg="true"
	:returnFocusTo="returnFocusTo"
	@click="click"
	@close="onModalClose"
	@closed="onModalClosed"
>
	<MkMenu
		:items="items"
		:align="align"
		:width="width"
		:appearance="appearance"
		:max-height="maxHeight"
		:asDrawer="type === 'drawer'"
		:returnFocusTo="returnFocusTo"
		:debugDisablePredictionCone="debugDisablePredictionCone"
		:debugShowPredictionCone="debugShowPredictionCone"
		:class="{ [$style.drawer]: type === 'drawer' }"
		@close="onMenuClose"
		@hide="hide"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import { ref, useTemplateRef } from 'vue';
import MkModal from './MkModal.vue';
import MkMenu from './MkMenu.vue';
import type { MenuItem } from '@/types/menu.js';

const props = defineProps<{
	items: MenuItem[];
	align?: 'center' | string;
	width?: number;
	appearance?: 'zalip-note';
	anchorElement?: HTMLElement | null;
	returnFocusTo?: HTMLElement | null;
	debugDisablePredictionCone?: boolean;
	debugShowPredictionCone?: boolean;
}>();

// MkModal initializes drawer geometry on opening; do not depend on touch/UA
// detection for the mobile post menu (including narrow desktop/PWA windows).
const modalType = props.appearance === 'zalip-note' && window.matchMedia('(max-width: 600px)').matches ? 'drawer' : 'auto';

const emit = defineEmits<{
	(ev: 'closed'): void;
	(ev: 'closing'): void;
}>();

const modal = useTemplateRef('modal');
const manualShowing = ref(true);
const hiding = ref(false);

function click() {
	close();
}

function onModalClose() {
	emit('closing');
}

function onMenuClose() {
	close();
	if (hiding.value) {
		// hidingであればclosedを発火
		emit('closed');
	}
}

function onModalClosed() {
	if (!hiding.value) {
		// hidingでなければclosedを発火
		emit('closed');
	}
}

function hide() {
	manualShowing.value = false;
	hiding.value = true;

	// closeは呼ぶ必要がある
	modal.value?.close();
}

function close() {
	manualShowing.value = false;

	// closeは呼ぶ必要がある
	modal.value?.close();
}
</script>

<style lang="scss" module>
.drawer {
	border-radius: 24px;
	border-bottom-right-radius: 0;
	border-bottom-left-radius: 0;
}
</style>
