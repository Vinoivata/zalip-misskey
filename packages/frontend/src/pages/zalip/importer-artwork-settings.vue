<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<fieldset :class="$style.root" :disabled="disabled">
	<legend>{{ i18n.ts.zalip._importer.artworkGroup }}</legend>
	<p :class="$style.hint">{{ i18n.ts.zalip._importer.artworkPolicyHint }}</p>
	<div :class="$style.form">
		<label><span>{{ i18n.ts.zalip._importer.artworkStorage }}</span><select v-model="mode"><option value="local">{{ i18n.ts.zalip._importer.artworkLocalConfigured }}</option><option value="remote">{{ i18n.ts.zalip._importer.artworkRemote }}</option><option v-if="mode === 'local-webp'" value="local-webp">{{ i18n.ts.zalip._importer.artworkLocalLegacy }}</option></select></label>
		<template v-if="mode === 'local'">
			<label><span>{{ i18n.ts.zalip._importer.artworkFormat }}</span><select v-model="settings.format"><option value="webp">WebP</option><option value="avif">AVIF</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="original">{{ i18n.ts.zalip._importer.artworkOriginal }}</option></select></label>
			<label><span>{{ i18n.ts.zalip._importer.artworkQuality }}</span><input v-model.number="settings.quality" type="number" min="1" max="100" step="1" required :disabled="settings.format === 'original'"></label>
			<label><span>{{ i18n.ts.zalip._importer.artworkGalleryLimit }}</span><input v-model.number="settings.galleryLimit" type="number" min="0" max="18" step="1" required></label>
			<label :class="$style.check"><input v-model="settings.keepOriginal" type="checkbox">{{ i18n.ts.zalip._importer.artworkKeepOriginal }}</label>
		</template>
	</div>
	<template v-if="mode === 'local'">
		<p :class="$style.hint">{{ settings.format === 'original' ? i18n.ts.zalip._importer.artworkOriginalHint : i18n.ts.zalip._importer.artworkDimensionsHint }}</p>
		<div v-if="settings.format !== 'original'" :class="$style.sizes">
			<fieldset v-for="field in importerArtworkFields" :key="field"><legend>{{ importerFieldLabel(field) }}</legend><div :class="$style.sizeInputs"><label><span>{{ i18n.ts.zalip._importer.artworkWidth }}</span><input v-model.number="settings.sizes[field].width" type="number" min="0" max="5000" step="1" required></label><label><span>{{ i18n.ts.zalip._importer.artworkHeight }}</span><input v-model.number="settings.sizes[field].height" type="number" min="0" max="5000" step="1" required></label><label><span>{{ i18n.ts.zalip._importer.artworkFit }}</span><select v-model="settings.sizes[field].fit"><option value="inside">{{ i18n.ts.zalip._importer.artworkFitInside }}</option><option value="cover">{{ i18n.ts.zalip._importer.artworkFitCover }}</option></select></label></div></fieldset>
		</div>
	</template>
</fieldset>
</template>

<script setup lang="ts">
import type { ImportArtworkSettings, ImportSelection } from '@/utility/zalip-importer.js';
import { importerFieldLabel } from '@/utility/zalip-importer.js';
import { importerArtworkFields } from '@/utility/zalip-importer-artwork.js';
import { i18n } from '@/i18n.js';

defineProps<{ disabled: boolean }>();
const mode = defineModel<ImportSelection['artwork']>('mode', { required: true });
const settings = defineModel<ImportArtworkSettings>('settings', { required: true });
</script>

<style lang="scss" module>
.root { min-width: 0; margin: 18px 0; padding: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.root legend { padding: 0 6px; font-weight: 700; }
.hint { color: var(--MI_THEME-fgTransparentWeak); font-size: .85rem; line-height: 1.6; }
.form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.root label { display: flex; flex-direction: column; gap: 7px; min-width: 0; font-size: .86rem; }
.root input:not([type="checkbox"]), .root select { box-sizing: border-box; width: 100%; min-width: 0; padding: 10px 12px; color: var(--MI_THEME-fg); background: var(--MI_THEME-bg); border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.root input:focus-visible, .root select:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.root .check { flex-direction: row; align-items: center; gap: 8px; }
.check input { accent-color: var(--MI_THEME-accent); }
.sizes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
.sizes fieldset { min-width: 0; padding: 12px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.sizeInputs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.sizeInputs > label:last-child { grid-column: 1 / -1; }
@media (max-width: 650px) { .form, .sizes { grid-template-columns: 1fr; } .root { padding: 12px; } }
</style>
