<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.row" role="group" :aria-label="i18n.ts.zalip.appearancePalette">
	<button v-for="option in options" :key="option.value" type="button" class="_button" :class="[$style.option, { [$style.selected]: selected === option.value }]" :style="{ '--palette-color': option.color }" :aria-label="option.label" :title="option.label" :aria-pressed="selected === option.value" @click="select(option.value)"><i :class="option.icon" aria-hidden="true"></i></button>
</div>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{
	options: { value: string; label: string; icon: string; color: string }[];
	initialValue: string | null;
	onSelect: (value: string) => void;
}>();
const selected = ref(props.initialValue);

function select(value: string): void {
	props.onSelect(value);
	selected.value = value;
}
</script>

<style lang="scss" module>
.row { display: flex; justify-content: space-between; gap: 8px; padding: 8px 16px 12px; }
.option { display: grid; place-items: center; width: 46px; height: 46px; border: 1px solid transparent; border-radius: 50%; color: var(--palette-color); font-size: 25px; }
.option:hover { background: color-mix(in srgb, var(--palette-color) 12%, transparent); }
.selected { border-color: var(--palette-color); background: color-mix(in srgb, var(--palette-color) 12%, transparent); }
</style>
