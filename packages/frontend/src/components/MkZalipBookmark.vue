<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<button type="button" class="_button" :class="[$style.root, { [$style.saved]: saved }]" :aria-label="saved ? i18n.ts.unfavorite : i18n.ts.favorite" :aria-pressed="saved" :disabled="busy" @click="toggle">
	<MkZalipIcon name="bookmark" :filled="saved"/>
</button>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { i18n } from '@/i18n.js';
import { $i } from '@/i.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

const props = defineProps<{ noteId: string }>();
const saved = ref(false);
const busy = ref(false);
let loading: Promise<void> | null = null;

function load(): Promise<void> {
	if (loading) return loading;
	loading = misskeyApi('notes/state', { noteId: props.noteId }).then(state => {
		saved.value = state.isFavorited;
	}).finally(() => { loading = null; });
	return loading;
}

onMounted(() => { if ($i) void load().catch(() => { /* Retry before the first mutation. */ }); });

async function toggle(): Promise<void> {
	if (busy.value || !await pleaseLogin()) return;
	busy.value = true;
	try {
		// Another rendering or the note menu may have changed the bookmark.
		await load();
		await os.apiWithDialog(saved.value ? 'notes/favorites/delete' : 'notes/favorites/create', { noteId: props.noteId });
		saved.value = !saved.value;
	} catch {
		void load().catch(() => { /* Preserve the last confirmed state on network failure. */ });
	} finally {
		busy.value = false;
	}
}
</script>

<style lang="scss" module>
.root { display: inline-flex; align-items: center; justify-content: center; min-width: 36px; min-height: 40px; color: var(--zalip-social-muted); > svg { width: 21px; height: 21px; } }
.saved { color: var(--MI_THEME-warn); }
</style>
