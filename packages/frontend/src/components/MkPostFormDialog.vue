<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<MkModal
	ref="modal"
	:preferType="compact ? 'drawer' : 'dialog'"
	:class="$style.modal"
	@click="onBgClick()"
	@closed="onModalClosed()"
	@esc="onEsc"
>
	<MkPostForm
		ref="form"
		:class="$style.form"
		class="_popup"
		role="dialog"
		aria-modal="true"
		:aria-label="props.reply ? i18n.ts.reply : props.renote ? i18n.ts.quote : i18n.ts.zalip._postForm.newPost"
		v-bind="props"
		autofocus
		freezeAfterPosted
		@posted="onPosted"
		@cancel="_close()"
		@esc="_close()"
	/>
</MkModal>
</template>

<script lang="ts" setup>
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue';
import type { PostFormProps } from '@/types/post-form.js';
import MkModal from '@/components/MkModal.vue';
import MkPostForm from '@/components/MkPostForm.vue';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<PostFormProps & {
	instant?: boolean;
	fixed?: boolean;
	autofocus?: boolean;
	mock?: boolean;
}>(), {
	initialLocalOnly: undefined,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const modal = useTemplateRef('modal');
const form = useTemplateRef('form');
const compact = ref(window.innerWidth <= 600);

function resize(): void { compact.value = window.innerWidth <= 600; }

onMounted(() => window.addEventListener('resize', resize, { passive: true }));
onBeforeUnmount(() => window.removeEventListener('resize', resize));

function onPosted() {
	modal.value?.close({
		useSendAnimation: !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
	});
}

async function _close() {
	const canClose = await form.value?.canClose();
	if (!canClose) return;
	form.value?.abortUploader();
	modal.value?.close();
}

function onEsc() {
	_close();
}

function onBgClick() {
	_close();
}

function onModalClosed() {
	emit('closed');
}
</script>

<style lang="scss" module>
.form {
	width: 100%;
	max-width: 600px;
	max-height: calc(100dvh - 64px);
	margin: auto;
	overflow-y: auto;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 20px;
	box-shadow: 0 20px 80px var(--MI_THEME-shadow);

	@media (max-width: 600px) {
		max-width: none;
		max-height: calc(100dvh - env(safe-area-inset-top) - 12px);
		border-radius: 20px 20px 0 0;
		border-bottom: 0;
	}
}
@media (prefers-reduced-motion: reduce) {
	.modal, .modal :deep(*) { transition: none !important; animation: none !important; }
}
</style>
