<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div>
		<MkZalipSectionHeader :title="i18n.ts.zalip.bookmarksHeading" :description="i18n.ts.zalip.bookmarksDescription"/>
		<MkPagination :paginator="paginator">
			<template #empty><MkResult type="empty" :text="i18n.ts.noNotes"/></template>

			<template #default="{ items }">
				<MkNote v-for="item in items" :key="item.id" :note="item.note" :class="$style.note"/>
			</template>
		</MkPagination>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { markRaw } from 'vue';
import MkPagination from '@/components/MkPagination.vue';
import MkNote from '@/components/MkNote.vue';
import MkZalipSectionHeader from '@/components/MkZalipSectionHeader.vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { Paginator } from '@/utility/paginator.js';

const paginator = markRaw(new Paginator('i/favorites', {
	limit: 10,
}));

definePage(() => ({
	title: i18n.ts.zalip.bookmarksHeading,
	icon: 'ti ti-star',
}));
</script>

<style lang="scss" module>
.note {
	background: var(--MI_THEME-panel);
	border-radius: 0;
	border-bottom: 1px solid var(--zalip-social-border);
}
</style>
