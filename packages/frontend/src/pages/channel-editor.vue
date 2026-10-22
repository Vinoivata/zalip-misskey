<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader :actions="headerActions" :tabs="headerTabs">
	<div class="_spacer" style="--MI_SPACER-w: 700px;">
		<MkA to="/channels" :class="$style.back"><i class="ti ti-arrow-left" aria-hidden="true"></i> {{ i18n.ts.zalip._communities.title }}</MkA>
		<p :class="$style.notice">{{ i18n.ts.zalip._communities.publicNotice }}</p>
		<div v-if="loadError"><p role="alert">{{ i18n.ts.zalip._communities.loadError }}</p><button type="button" class="_textButton" @click="fetchChannel">{{ i18n.ts.retry }}</button></div>
		<p v-else-if="channelId && !channel" role="status">{{ i18n.ts.loading }}</p>
		<p v-else-if="!canManage" role="alert">{{ channelId ? i18n.ts.permissionDeniedErrorDescription : i18n.ts.zalip._communities.createUnavailable }}</p>
		<fieldset v-if="canManage" :disabled="saving" class="_gaps_m" :class="$style.fields">
			<MkInput v-model="name" required :disabled="saving">
				<template #label>{{ i18n.ts.name }}</template>
			</MkInput>

			<MkTextarea v-model="description" mfmAutocomplete :mfmPreview="true">
				<template #label>{{ i18n.ts.description }}</template>
			</MkTextarea>

			<MkColorInput v-model="color">
				<template #label>{{ i18n.ts.color }}</template>
			</MkColorInput>

			<MkSwitch v-model="isSensitive">
				<template #label>{{ i18n.ts.sensitive }}</template>
			</MkSwitch>

			<MkSwitch v-model="allowRenoteToExternal">
				<template #label>{{ i18n.ts._channel.allowRenoteToExternal }}</template>
			</MkSwitch>

			<div>
				<MkButton v-if="bannerId == null" @click="setBannerImage"><i class="ti ti-plus"></i> {{ i18n.ts._channel.setBanner }}</MkButton>
				<div v-else-if="bannerUrl">
					<img :src="bannerUrl" :class="$style.banner" alt="" decoding="async"/>
					<MkButton @click="removeBannerImage()"><i class="ti ti-trash"></i> {{ i18n.ts._channel.removeBanner }}</MkButton>
				</div>
			</div>

			<MkFolder v-if="channelId" :defaultOpen="true">
				<template #label>{{ i18n.ts.pinnedNotes }}</template>

				<div class="_gaps">
					<MkButton primary rounded :aria-label="i18n.ts.add" @click="addPinnedNote()"><i class="ti ti-plus" aria-hidden="true"></i></MkButton>

					<MkDraggable
						:modelValue="pinnedNoteIds.map(id => ({ id }))"
						direction="vertical"
						manualDragStart
						@update:modelValue="v => pinnedNoteIds = v.map(x => x.id)"
					>
						<template #default="{ item, dragStart }">
							<div :class="$style.pinnedNote">
								<button class="_button" :class="$style.pinnedNoteHandle" tabindex="-1" :draggable="true" @dragstart.stop="dragStart"><i class="ti ti-menu"></i></button>
								{{ item.id }}
								<button type="button" class="_button" :class="$style.pinnedNoteRemove" :aria-label="i18n.ts.remove" @click="removePinnedNote(item.id)"><i class="ti ti-x" aria-hidden="true"></i></button>
							</div>
						</template>
					</MkDraggable>
				</div>
			</MkFolder>

			<p v-if="formError" role="alert" :class="$style.error">{{ formError }}</p>
			<div class="_buttons">
				<MkButton primary :disabled="saving || !name.trim()" :wait="saving" @click="save()"><i class="ti ti-device-floppy" aria-hidden="true"></i> {{ channelId ? i18n.ts.save : i18n.ts.zalip._communities.create }}</MkButton>
				<MkButton v-if="channelId && !channel?.isArchived" danger :disabled="saving" @click="archive()"><i class="ti ti-archive" aria-hidden="true"></i> {{ i18n.ts.archive }}</MkButton>
			</div>
		</fieldset>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import MkButton from '@/components/MkButton.vue';
import MkInput from '@/components/MkInput.vue';
import MkColorInput from '@/components/MkColorInput.vue';
import { selectFile } from '@/utility/drive.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';
import MkFolder from '@/components/MkFolder.vue';
import MkSwitch from '@/components/MkSwitch.vue';
import MkTextarea from '@/components/MkTextarea.vue';
import MkDraggable from '@/components/MkDraggable.vue';
import { useRouter } from '@/router.js';
import { $i, iAmModerator } from '@/i.js';

const router = useRouter();

const props = defineProps<{
	channelId?: string;
}>();

const channel = ref<Misskey.entities.Channel | null>(null);
const name = ref<string>('');
const description = ref<string | null>(null);
const bannerUrl = ref<string | null>(null);
const bannerId = ref<string | null>(null);
const color = ref('#000');
const isSensitive = ref(false);
const allowRenoteToExternal = ref(true);
const pinnedNoteIds = ref<Misskey.entities.Note['id'][]>([]);
const canManage = computed(() => $i != null && (props.channelId == null ? $i.policies.canCreateChannel : channel.value != null && ($i.id === channel.value.userId || iAmModerator)));
const saving = ref(false);
const formError = ref('');
const loadError = ref(false);
let fetchRequest = 0;
let bannerRequest = 0;
let pinRequest = 0;
let bannerSelectionRequest = 0;
let alive = true;

function editorScope() { return { epoch: fetchRequest, channelId: props.channelId, account: $i?.id, token: $i?.token ?? null }; }

function currentScope(scope: ReturnType<typeof editorScope>): boolean { return alive && scope.epoch === fetchRequest && scope.channelId === props.channelId && scope.account === $i?.id && scope.token === ($i?.token ?? null) && canManage.value; }

watch(() => bannerId.value, async () => {
	const request = ++bannerRequest;
	const fileId = bannerId.value;
	const scope = editorScope();
	if (bannerId.value == null) {
		bannerUrl.value = null;
	} else {
		if (!currentScope(scope)) return;
		try {
			const file = await misskeyApi('drive/files/show', { fileId: bannerId.value }, scope.token);
			if (currentScope(scope) && request === bannerRequest && bannerId.value === fileId) bannerUrl.value = file.url;
		} catch { if (currentScope(scope) && request === bannerRequest) bannerUrl.value = null; }
	}
});

async function fetchChannel() {
	const request = ++fetchRequest;
	const channelId = props.channelId;
	const account = $i?.id;
	const token = $i?.token ?? null;
	bannerRequest++; pinRequest++; bannerSelectionRequest++;
	channel.value = null; loadError.value = false; saving.value = false; formError.value = '';
	name.value = ''; description.value = null; bannerId.value = null; bannerUrl.value = null; pinnedNoteIds.value = [];
	if (channelId == null) return;
	try {
		const result = await misskeyApi('channels/show', { channelId }, token);
		if (!alive || request !== fetchRequest || props.channelId !== channelId || $i?.id !== account || ($i?.token ?? null) !== token) return;

		name.value = result.name;
		description.value = result.description;
		bannerId.value = result.bannerId;
		bannerUrl.value = result.bannerUrl;
		isSensitive.value = result.isSensitive;
		pinnedNoteIds.value = result.pinnedNoteIds;
		color.value = result.color;
		allowRenoteToExternal.value = result.allowRenoteToExternal;

		channel.value = result;
	} catch { if (alive && request === fetchRequest) loadError.value = true; }
}

watch(() => [props.channelId, $i?.id, $i?.token], fetchChannel, { immediate: true });
onBeforeUnmount(() => { alive = false; fetchRequest++; bannerRequest++; });

async function addPinnedNote() {
	if (!canManage.value || saving.value) return;
	const scope = editorScope();
	const request = ++pinRequest;
	const current = () => currentScope(scope) && request === pinRequest && !saving.value;
	try {
		const { canceled, result: value } = await os.inputText({
			title: i18n.ts.noteIdOrUrl,
		});
		if (canceled || value == null || !current()) return;
		const fromUrl = value.includes('/') ? value.split('/').pop() : null;
		const note = await misskeyApi('notes/show', {
			noteId: fromUrl ?? value,
		}, scope.token);
		if (current() && !pinnedNoteIds.value.includes(note.id)) pinnedNoteIds.value.unshift(note.id);
	} catch { if (current()) formError.value = i18n.ts.somethingHappened; }
}

function removePinnedNote(id: string) {
	if (!canManage.value || saving.value) return;
	pinnedNoteIds.value = pinnedNoteIds.value.filter(x => x !== id);
}

async function save(): Promise<void> {
	if (!canManage.value || saving.value) return;
	const cleanedName = name.value.trim();
	if (!cleanedName || Array.from(cleanedName).length > 128 || Array.from(description.value ?? '').length > 2048) { formError.value = i18n.ts.invalidValue; return; }
	const channelId = props.channelId;
	const scope = editorScope();
	const current = () => currentScope(scope);
	saving.value = true; formError.value = '';
	const params = {
		name: cleanedName,
		description: description.value,
		bannerId: bannerId.value,
		color: color.value,
		isSensitive: isSensitive.value,
		allowRenoteToExternal: allowRenoteToExternal.value,
	} satisfies Misskey.entities.ChannelsCreateRequest;

	try {
		if (channelId != null) {
			await misskeyApi('channels/update', {
				...params,
				channelId,
				pinnedNoteIds: [...pinnedNoteIds.value],
			}, scope.token);
			if (current()) os.success();
		} else {
			const created = await misskeyApi('channels/create', params, scope.token);
			if (current()) {
				router.push('/channels/:channelId', {
					params: {
						channelId: created.id,
					},
				});
			}
		}
	} catch { if (current()) formError.value = i18n.ts.somethingHappened; } finally { if (current()) saving.value = false; }
}

async function archive() {
	if (props.channelId == null || !canManage.value || saving.value) return;
	const channelId = props.channelId;
	const scope = editorScope();
	const current = () => currentScope(scope);
	saving.value = true;

	try {
		const { canceled } = await os.confirm({
			type: 'warning',
			title: i18n.tsx.channelArchiveConfirmTitle({ name: name.value }),
			text: i18n.ts.channelArchiveConfirmDescription,
		});
		if (canceled || !current()) return;

		await misskeyApi('channels/update', {
			channelId,
			isArchived: true,
		}, scope.token);
		if (current()) {
			if (channel.value) channel.value.isArchived = true;
			os.success();
		}
	} catch { if (current()) formError.value = i18n.ts.somethingHappened; } finally { if (current()) saving.value = false; }
}

async function setBannerImage(evt: PointerEvent): Promise<void> {
	if (!canManage.value || saving.value) return;
	const scope = editorScope();
	const request = ++bannerSelectionRequest;
	try {
		const file = await selectFile({ anchorElement: evt.currentTarget ?? evt.target, multiple: false });
		if (currentScope(scope) && request === bannerSelectionRequest && !saving.value) bannerId.value = file.id;
	} catch { /* The native drive chooser handles its own cancellation/error UI. */ }
}

function removeBannerImage() {
	if (!canManage.value || saving.value) return;
	bannerSelectionRequest++;
	bannerId.value = null;
}

const headerActions = computed(() => []);

const headerTabs = computed(() => []);

definePage(() => ({
	title: props.channelId ? i18n.ts.zalip._communities.edit : i18n.ts.zalip._communities.create,
	icon: 'ti ti-users',
}));
</script>

<style lang="scss" module>
.fields { min-width: 0; margin: 0; padding: 0; border: 0; }
.back { display: inline-flex; align-items: center; gap: 8px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.notice { padding: 14px 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.5; }
.banner { display: block; width: 100%; border-radius: var(--MI-radius); }
.error { color: var(--MI_THEME-error); }
.pinnedNote {
	position: relative;
	display: block;
	line-height: 2.85rem;
	text-overflow: ellipsis;
	overflow: hidden;
	white-space: nowrap;
	color: var(--MI_THEME-navFg);
}

.pinnedNoteRemove {
	position: absolute;
	z-index: 10000;
	width: 32px;
	height: 32px;
	color: var(--MI_THEME-error);
	right: 8px;
	opacity: 0.8;
}

.pinnedNoteHandle {
	cursor: move;
	width: 32px;
	height: 32px;
	margin: 0 8px;
	opacity: 0.5;
}
</style>
