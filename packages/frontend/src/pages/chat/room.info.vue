<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<MkInput v-model="name_" :disabled="!isOwner || !canWrite || pending != null">
		<template #label>{{ i18n.ts.name }}</template>
	</MkInput>

	<MkTextarea v-model="description_" :disabled="!isOwner || !canWrite || pending != null">
		<template #label>{{ i18n.ts.description }}</template>
	</MkTextarea>

	<MkButton v-if="isOwner" primary :disabled="!canWrite || pending != null" @click="save">{{ i18n.ts.save }}</MkButton>
	<p v-if="actionError" role="alert">{{ actionError }}</p>

	<hr>

	<MkButton v-if="canDelete" danger :disabled="!canWrite || pending != null" @click="del">{{ i18n.ts.zalip._chatUi.deleteGroup }}</MkButton>

	<MkSwitch v-if="!isOwner" :modelValue="isMuted" :disabled="!canWrite || pending != null" @update:modelValue="setMuted">
		<template #label>{{ i18n.ts.zalip._chatUi.muteGroup }}</template>
	</MkSwitch>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { ensureSignin } from '@/i.js';
import MkInput from '@/components/MkInput.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import { useRouter } from '@/router.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { chatConversationEvents } from '@/utility/zalip-chat-types.js';

const router = useRouter();
const $i = ensureSignin();

const props = defineProps<{
	room: Misskey.entities.ChatRoom;
}>();
const emit = defineEmits<{ (ev: 'updated', room: Misskey.entities.ChatRoom): void }>();

const isOwner = computed(() => {
	return props.room.ownerId === $i.id;
});

const canWrite = computed(() => $i.policies.chatAvailability === 'available');
const canDelete = computed(() => isOwner.value || $i.isAdmin || $i.isModerator);
const name_ = ref('');
const description_ = ref('');
const isMuted = ref(false);
const pending = ref<'save' | 'delete' | 'mute' | null>(null);
const actionError = ref('');
let epoch = 0;
let alive = true;

function current(request: number, account: string, roomId: string): boolean {
	return alive && request === epoch && account === $i.id && roomId === props.room.id;
}

async function save(): Promise<void> {
	if (!isOwner.value || !canWrite.value || pending.value) return;
	const request = epoch; const account = $i.id; const roomId = props.room.id;
	pending.value = 'save'; actionError.value = '';
	try {
		const updated = await misskeyApi('chat/rooms/update', { roomId, name: name_.value, description: description_.value });
		if (!current(request, account, roomId)) return;
		name_.value = updated.name; description_.value = updated.description;
		emit('updated', updated);
	} catch {
		if (current(request, account, roomId)) actionError.value = i18n.ts.zalip._chatUi.actionError;
	} finally {
		if (current(request, account, roomId)) pending.value = null;
	}
}

async function del(): Promise<void> {
	if (!canDelete.value || !canWrite.value || pending.value) return;
	const request = epoch; const account = $i.id; const roomId = props.room.id;
	pending.value = 'delete'; actionError.value = '';
	try {
		const { canceled } = await os.confirm({ type: 'warning', text: i18n.tsx.deleteAreYouSure({ x: name_.value }) });
		if (canceled || !current(request, account, roomId)) return;
		await misskeyApi('chat/rooms/delete', { roomId });
		if (!current(request, account, roomId)) return;
		chatConversationEvents.emit('changed');
		router.push('/chat');
	} catch {
		if (current(request, account, roomId)) actionError.value = i18n.ts.zalip._chatUi.actionError;
	} finally {
		if (current(request, account, roomId)) pending.value = null;
	}
}

async function setMuted(mute: boolean): Promise<void> {
	if (isOwner.value || !canWrite.value || pending.value || mute === isMuted.value) return;
	const request = epoch; const account = $i.id; const roomId = props.room.id;
	pending.value = 'mute'; actionError.value = '';
	try {
		await misskeyApi('chat/rooms/mute', { roomId, mute });
		if (!current(request, account, roomId)) return;
		isMuted.value = mute;
		emit('updated', { ...props.room, isMuted: mute });
	} catch {
		if (current(request, account, roomId)) actionError.value = i18n.ts.zalip._chatUi.actionError;
	} finally {
		if (current(request, account, roomId)) pending.value = null;
	}
}

watch(() => [props.room.id, props.room.name, props.room.description, props.room.isMuted, $i.id], () => {
	epoch++; pending.value = null; actionError.value = '';
	name_.value = props.room.name; description_.value = props.room.description; isMuted.value = props.room.isMuted ?? false;
}, { immediate: true });
onBeforeUnmount(() => { alive = false; epoch++; });
</script>

<style lang="scss" module>
.membership {
	display: flex;
}

.membershipBody {
	flex: 1;
	min-width: 0;
	margin-right: 8px;

	&:hover {
		text-decoration: none;
	}
}
</style>
