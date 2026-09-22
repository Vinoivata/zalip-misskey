<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="'dialog'"
	@click="onClose"
	@esc="onClose"
	@closed="emit('closed')"
>
	<div :class="$style.root">
		<div :class="$style.header">
			<div :class="$style.headerText"><i class="ti ti-login-2"></i> {{ i18n.ts.login }}</div>
			<button type="button" :class="$style.closeButton" class="_button" :aria-label="i18n.ts.close" @click="onClose"><i class="ti ti-x"></i></button>
		</div>
		<div :class="$style.content">
			<MkSignin :autoSet="autoSet" :message="message" :openOnRemote="openOnRemote" :initialUsername="initialUsername" @login="onLogin"/>
			<button v-if="autoSet" type="button" class="_button" :class="$style.signup" @click="signUp"><i class="ti ti-user-plus"></i> {{ i18n.ts.signup }}</button>
		</div>
	</div>
</MkModal>
</template>

<script lang="ts" setup>
import * as Misskey from 'misskey-js';
import { useTemplateRef } from 'vue';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import MkSignin from '@/components/MkSignin.vue';
import MkModal from '@/components/MkModal.vue';
import { i18n } from '@/i18n.js';
import { openZalipSignup } from '@/utility/zalip-signup.js';

withDefaults(defineProps<{
	autoSet?: boolean;
	message?: string,
	openOnRemote?: OpenOnRemoteOptions,
	initialUsername?: string;
}>(), {
	autoSet: false,
	message: '',
	openOnRemote: undefined,
	initialUsername: undefined,
});

const emit = defineEmits<{
	(ev: 'done', v: Misskey.entities.SigninFlowResponse & { finished: true }): void;
	(ev: 'closed'): void;
	(ev: 'cancelled'): void;
}>();

const modal = useTemplateRef('modal');

function signUp(): void {
	modal.value?.close();
	void openZalipSignup();
}

function onClose() {
	emit('cancelled');
	if (modal.value) modal.value.close();
}

function onLogin(res: Misskey.entities.SigninFlowResponse & { finished: true }) {
	emit('done', res);
	if (modal.value) modal.value.close();
}
</script>

<style lang="scss" module>
.root {
	overflow: auto;
	margin: auto;
	position: relative;
	width: min(440px, calc(100vw - 24px));
	max-height: calc(100dvh - 32px);
	box-sizing: border-box;
	background: var(--MI_THEME-panel);
	border-radius: var(--zalip-radius-big);
}

.header {
	position: sticky;
	top: 0;
	left: 0;
	width: 100%;
	height: 50px;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	font-weight: bold;
	backdrop-filter: var(--MI-blur, blur(15px));
	background: color(from var(--MI_THEME-bg) srgb r g b / 0.5);
	z-index: 1;
}

.headerText {
	padding: 0 20px;
	box-sizing: border-box;
}

.closeButton {
	margin-left: auto;
	padding: 16px;
	font-size: 16px;
	line-height: 16px;
}

.content {
	padding: 24px;
	box-sizing: border-box;
}

.signup {
	display: block;
	width: 100%;
	min-height: 48px;
	margin-top: 24px;
	border-radius: var(--zalip-radius);
	background: var(--MI_THEME-panelHighlight);
	font-weight: 700;
}
</style>
