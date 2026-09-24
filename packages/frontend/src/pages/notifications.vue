<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div>
		<MkZalipSectionHeader v-model:tab="tab" :title="i18n.ts.notifications" :tabs="headerTabs">
			<template #actions>
				<button v-if="tab === 'all'" type="button" class="_button" :class="[$style.action, { [$style.active]: includeTypes != null }]" :aria-label="i18n.ts.filter" @click="setFilter"><MkZalipIcon name="settings"/></button>
				<button v-if="tab === 'all'" type="button" class="_button" :class="$style.action" :aria-label="i18n.ts.markAllAsRead" @click="markRead"><MkZalipIcon name="check"/></button>
			</template>
		</MkZalipSectionHeader>
		<div v-if="tab === 'all'">
			<MkStreamingNotificationsTimeline :class="$style.notifications" :excludeTypes="excludeTypes"/>
		</div>
		<div v-else-if="tab === 'mentions'">
			<MkNotesTimeline :paginator="mentionsPaginator" noGap :withControl="false"/>
		</div>
		<div v-else-if="tab === 'directNotes'">
			<MkNotesTimeline :paginator="directNotesPaginator" noGap :withControl="false"/>
		</div>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, markRaw, ref } from 'vue';
import { notificationTypes } from 'misskey-js';
import MkZalipSectionHeader from '@/components/MkZalipSectionHeader.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import MkStreamingNotificationsTimeline from '@/components/MkStreamingNotificationsTimeline.vue';
import MkNotesTimeline from '@/components/MkNotesTimeline.vue';
import * as os from '@/os.js';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const tab = ref('all');
const includeTypes = ref<string[] | null>(null);
const excludeTypes = computed(() => includeTypes.value ? notificationTypes.filter(t => !includeTypes.value!.includes(t)) : null);

const mentionsPaginator = markRaw(new Paginator('notes/mentions', {
	limit: 10,
}));

const directNotesPaginator = markRaw(new Paginator('notes/mentions', {
	limit: 10,
	params: {
		visibility: 'specified',
	},
}));

function setFilter(ev: PointerEvent) {
	const typeItems = notificationTypes.map(t => ({
		text: i18n.ts._notification._types[t],
		active: (includeTypes.value && includeTypes.value.includes(t)) ?? false,
		action: () => {
			includeTypes.value = [t];
		},
	}));
	const items = includeTypes.value != null ? [{
		icon: 'ti ti-x',
		text: i18n.ts.clear,
		action: () => {
			includeTypes.value = null;
		},
	}, { type: 'divider' as const }, ...typeItems] : typeItems;
	os.popupMenu(items, ev.currentTarget ?? ev.target);
}

async function markRead(): Promise<void> {
	try {
		await os.apiWithDialog('notifications/mark-all-as-read', {});
	} catch { /* The dialog displays the server error. */ }
}

const headerTabs = computed(() => [{
	key: 'all',
	title: i18n.ts.all,
	icon: 'ti ti-point',
}, {
	key: 'mentions',
	title: i18n.ts.mentions,
	icon: 'ti ti-at',
}, {
	key: 'directNotes',
	title: i18n.ts.directNotes,
	icon: 'ti ti-mail',
}]);

definePage(() => ({
	title: i18n.ts.notifications,
	icon: 'ti ti-bell',
}));
</script>

<style module lang="scss">
.notifications {
	border-radius: 0;
	overflow: clip;
}
.action { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; color: var(--zalip-social-muted); font-size: 22px; > svg { width: 22px; height: 22px; } &:hover { background: var(--zalip-social-hover); } }
.active { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
</style>
