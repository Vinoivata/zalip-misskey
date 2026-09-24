<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<header :class="$style.root">
	<div :class="$style.heading"><h1>{{ title }}</h1><div :class="$style.actions"><slot name="actions"></slot></div></div>
	<p v-if="description" :class="$style.description">{{ description }}</p>
	<div v-if="tabs?.length" :class="$style.tabs" role="group" :aria-label="title">
		<button v-for="item in tabs" :key="item.key" type="button" class="_button" :class="{ [$style.active]: tab === item.key }" :aria-pressed="tab === item.key" @click="tab = item.key">{{ item.title }}</button>
	</div>
</header>
</template>

<script lang="ts" setup>
defineProps<{ title: string; description?: string; tabs?: { key: string; title: string }[] }>();
const tab = defineModel<string>('tab');
</script>

<style lang="scss" module>
.root { padding: 24px 24px 16px; border-bottom: 1px solid var(--zalip-social-border); background: var(--zalip-social-panel); }
.heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.heading h1 { margin: 0; font-size: 24px; letter-spacing: -.035em; color: var(--zalip-social-fg); }
.actions { display: flex; align-items: center; gap: 6px; }
.description { margin: 8px 0 0; color: var(--zalip-social-muted); font-size: 14px; line-height: 1.5; }
.tabs { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding: 2px 0; margin-top: 18px; > button { flex: 0 0 auto; padding: 9px 14px; border-radius: 99px; color: var(--zalip-social-muted); font-size: 13px; font-weight: 600; } > button:hover { background: var(--zalip-social-hover); } .active { color: var(--zalip-social-fg); background: var(--zalip-accent-soft); box-shadow: inset 0 0 0 1px var(--zalip-accent-border); } }
@media (max-width: 600px) { .root { padding: 20px 16px 14px; } .heading h1 { font-size: 22px; } }
</style>
