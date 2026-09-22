<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 640px;">
		<p>{{ i18n.ts.zalip.widgetsHint }}</p>
		<XWidgets/>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import XWidgets from '@/ui/_common_/widgets.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';

definePage(() => ({ title: i18n.ts.widgets, icon: 'ti ti-layout', needWideArea: true }));
</script>
