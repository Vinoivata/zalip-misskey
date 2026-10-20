<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div class="_gaps">
	<div v-if="invitations.length > 0" class="_gaps_s">
		<MkFolder v-for="invitation in invitations" :key="invitation.id" :defaultOpen="true">
			<template #icon><i class="ti ti-users-group"></i></template>
			<template #label>{{ invitation.room.name }}</template>
			<template #suffix><MkTime :time="invitation.createdAt"/></template>
			<template #footer>
				<div class="_buttons">
					<MkButton primary :disabled="!canWrite || pending.has(invitation.room.id)" @click="join(invitation)"><i class="ti ti-plus"></i> {{ i18n.ts.zalip._chatUi.joinGroup }}</MkButton>
					<MkButton danger :disabled="!canWrite || pending.has(invitation.room.id)" @click="ignore(invitation)"><i class="ti ti-x"></i> {{ i18n.ts.zalip._chatUi.ignoreInvitation }}</MkButton>
				</div>
			</template>

			<div :class="$style.invitationBody">
				<MkAvatar :user="invitation.room.owner" :class="$style.invitationBodyAvatar" link/>
				<div style="flex: 1;" class="_gaps_s">
					<MkUserName :user="invitation.room.owner"/>
					<hr>
					<div>{{ invitation.room.description === '' ? i18n.ts.noDescription : invitation.room.description }}</div>
				</div>
			</div>
		</MkFolder>
	</div>
	<p v-if="actionError" role="alert">{{ actionError }}</p>
	<MkError v-if="loadError" @retry="fetchInvitations"/>
	<MkResult v-else-if="!fetching && invitations.length == 0" type="empty" :text="i18n.ts.zalip.chatNoInvitations"/>
	<MkLoading v-if="fetching"/>
</div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import { i18n } from '@/i18n.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { useRouter } from '@/router.js';
import MkFolder from '@/components/MkFolder.vue';
import { ensureSignin } from '@/i.js';
import { chatConversationEvents } from '@/utility/zalip-chat-types.js';

const router = useRouter();
const me = ensureSignin();
const canWrite = computed(() => me.policies.chatAvailability === 'available');

const fetching = ref(true);
const loadError = ref(false);
const invitations = ref<Misskey.entities.ChatRoomInvitation[]>([]);
const pending = ref(new Set<string>());
const actionError = ref('');
let epoch = 0;
let fetchGeneration = 0;
let alive = true;

function current(request: number, account: string): boolean {
	return alive && request === epoch && account === me.id;
}

async function fetchInvitations(): Promise<void> {
	const request = epoch; const generation = ++fetchGeneration; const account = me.id;
	fetching.value = true;
	loadError.value = false;
	try {
		const result = await misskeyApi('chat/rooms/invitations/inbox');
		if (current(request, account) && generation === fetchGeneration) invitations.value = result;
	} catch {
		if (current(request, account) && generation === fetchGeneration) loadError.value = true;
	} finally {
		if (current(request, account) && generation === fetchGeneration) fetching.value = false;
	}
}

async function act(invitation: Misskey.entities.ChatRoomInvitation, action: 'join' | 'ignore'): Promise<void> {
	const roomId = invitation.room.id;
	if (!canWrite.value || pending.value.has(roomId) || !invitations.value.some(item => item.id === invitation.id)) return;
	const request = epoch; const account = me.id;
	pending.value = new Set([...pending.value, roomId]); actionError.value = '';
	try {
		await misskeyApi(action === 'join' ? 'chat/rooms/join' : 'chat/rooms/invitations/ignore', { roomId });
		if (!current(request, account)) return;
		fetchGeneration++;
		invitations.value = invitations.value.filter(item => item.room.id !== roomId);
		chatConversationEvents.emit('changed');
		void fetchInvitations();
		if (action === 'join') router.push('/chat/room/:roomId', { params: { roomId } });
	} catch {
		if (current(request, account)) actionError.value = i18n.ts.zalip._chatUi.actionError;
	} finally {
		if (current(request, account)) { const remaining = new Set(pending.value); remaining.delete(roomId); pending.value = remaining; }
	}
}

function join(invitation: Misskey.entities.ChatRoomInvitation): Promise<void> { return act(invitation, 'join'); }

function ignore(invitation: Misskey.entities.ChatRoomInvitation): Promise<void> { return act(invitation, 'ignore'); }

watch(() => me.id, () => { epoch++; fetchGeneration++; invitations.value = []; pending.value = new Set(); actionError.value = ''; void fetchInvitations(); }, { immediate: true });
onBeforeUnmount(() => { alive = false; epoch++; fetchGeneration++; });

defineExpose({ refresh: fetchInvitations });
</script>

<style lang="scss" module>
.invitationBody {
	display: flex;
	align-items: center;
}

.invitationBodyAvatar {
	margin-right: 12px;
	width: 45px;
	height: 45px;
}
</style>
