<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<div><MkZalipFeed/></div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import MkZalipFeed from '@/components/MkZalipFeed.vue';
import { definePage } from '@/page.js';
import { i18n } from '@/i18n.js';

definePage(() => ({ title: i18n.ts.timeline, icon: 'ti ti-home' }));
</script>
