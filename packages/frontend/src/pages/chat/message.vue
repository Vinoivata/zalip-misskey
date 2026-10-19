<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<div v-if="error" role="alert">
			<p>{{ i18n.ts.zalip._chatUi.loadError }}</p><MkButton @click="initialize">{{ i18n.ts.retry }}</MkButton>
		</div>
		<div v-else-if="initializing || message == null">
			<MkLoading/>
		</div>
		<div v-else>
			<XMessage :message="message" :isSearchResult="true"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { ref, onBeforeUnmount, watch } from 'vue';
import * as Misskey from 'misskey-js';
import XMessage from './XMessage.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import MkButton from '@/components/MkButton.vue';
import { ensureSignin } from '@/i.js';

const props = defineProps<{
	messageId: string;
}>();

const initializing = ref(true);
const message = ref<Misskey.entities.ChatMessage | null>();
const error = ref(false);
const me = ensureSignin();
let epoch = 0;

async function initialize() {
	const request = ++epoch; const account = me.id;
	initializing.value = true; message.value = null; error.value = false;
	try { const result = await misskeyApi('chat/messages/show', { messageId: props.messageId }); if (request === epoch && account === me.id) message.value = result; } catch { if (request === epoch && account === me.id) error.value = true; } finally { if (request === epoch && account === me.id) initializing.value = false; }
}

watch(() => [props.messageId, me.id], () => { void initialize(); }, { immediate: true });
onBeforeUnmount(() => { epoch++; });

definePage({
	title: i18n.ts.directMessage,
});
</script>
