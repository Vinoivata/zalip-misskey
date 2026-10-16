<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section :class="$style.root">
	<h3>{{ i18n.ts.zalip._importer.artworkChoose }}</h3>
	<p :class="$style.hint">{{ i18n.ts.zalip._importer.artworkChooseHint }}</p>
	<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._importer.artworkGroup"><button v-for="field in importerArtworkFields" :key="field" type="button" class="_button" :class="{ [$style.active]: activeField === field }" :aria-pressed="activeField === field" @click="activeField = field">{{ importerFieldLabel(field) }} <small>{{ fieldCandidates(field).length }}</small></button></nav>
	<div :class="$style.toolbar"><label>{{ i18n.ts.zalip._importer.source }}<select v-model="source"><option value="">{{ i18n.ts.zalip._importer.artworkAllSources }}</option><option v-for="provider in availableSources" :key="provider" :value="provider">{{ importerSourceLabel(provider) }}</option></select></label><button type="button" class="_button" :class="$style.button" :disabled="disabled || blocked || choices[activeField] === undefined" @click="resetField">{{ i18n.ts.zalip._importer.artworkAutomatic }}</button><span v-if="activeField === 'galleryUrls'" :class="$style.hint">{{ i18n.tsx.zalip._importer.artworkSelectedCount({ count: String(selectedCount), limit: String(galleryLimit) }) }}</span></div>
	<p v-if="blocked" :class="$style.protected"><i class="ti ti-lock" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.artworkProtected }}</p>
	<p v-else-if="editorial" :class="$style.hint">{{ i18n.ts.zalip._importer.artworkEditorialHint }}</p>
	<p v-if="activeField === 'galleryUrls' && galleryLimit === 0" :class="$style.hint">{{ i18n.ts.zalip._importer.artworkGalleryDisabled }}</p>
	<p v-if="!visibleCandidates.length" :class="$style.hint">{{ i18n.ts.zalip._importer.artworkCandidatesEmpty }}</p>
	<div v-else :class="$style.grid">
		<article v-for="candidate in visibleCandidates" :key="candidate.id" :class="[$style.card, { [$style.selected]: selected(candidate) }]">
			<button type="button" class="_button" :class="[$style.image, { [$style.portrait]: activeField === 'posterUrl', [$style.logo]: activeField === 'logoUrl' }]" :aria-label="i18n.tsx.zalip._importer.artworkEnlarge({ field: importerFieldLabel(candidate.field), source: importerSourceLabel(candidate.source) })" @click="viewing = candidate"><img v-if="imageUrl(candidate)" :src="imageUrl(candidate)" alt="" loading="lazy" @error="imageFailed(candidate)"><i v-if="imageUrl(candidate)" class="ti ti-zoom-in" aria-hidden="true"></i><i v-else class="ti ti-photo-off" :class="$style.missing" aria-hidden="true"></i></button>
			<div :class="$style.information"><strong>{{ importerSourceLabel(candidate.source) }}</strong><small>{{ candidate.width != null && candidate.height != null ? `${candidate.width} × ${candidate.height}` : i18n.ts.zalip._importer.artworkUnknownSize }} · {{ candidate.language ?? i18n.ts.zalip._importer.artworkLanguageNeutral }}</small><label :class="$style.choice"><input :type="activeField === 'galleryUrls' ? 'checkbox' : 'radio'" :name="`artwork-${activeField}`" :checked="selected(candidate)" :disabled="disabled || blocked || (!selected(candidate) && activeField === 'galleryUrls' && selectedCount >= galleryLimit)" @change="choose(candidate)">{{ selected(candidate) ? i18n.ts.zalip._importer.artworkChosen : i18n.ts.zalip._importer.artworkUse }}</label></div>
		</article>
	</div>
	<Teleport to="body">
		<MkModalWindow v-if="viewing" :width="1000" :height="760" @close="viewing = null" @click="viewing = null" @esc="viewing = null"><template #header>{{ importerFieldLabel(viewing.field) }} · {{ importerSourceLabel(viewing.source) }}</template><div :class="$style.large"><img v-if="imageUrl(viewing, true)" :src="imageUrl(viewing, true)" :alt="importerFieldLabel(viewing.field)" @error="imageFailed(viewing, true)"><p v-else :class="$style.hint" role="status"><i class="ti ti-photo-off" aria-hidden="true"></i> {{ i18n.ts.zalip._importer.artworkImageUnavailable }}</p></div></MkModalWindow>
	</Teleport>
</section>
</template>

<script setup lang="ts">
import { computed, onDeactivated, ref } from 'vue';
import type { ImportArtworkCandidate, ImportArtworkChoices, ImportArtworkField, ImportPreview, ImportSource } from '@/utility/zalip-importer.js';
import { importerFieldLabel, importerImageUrl, importerSourceLabel } from '@/utility/zalip-importer.js';
import { importerArtworkChoiceSelected, importerArtworkFieldLocked, importerArtworkFields } from '@/utility/zalip-importer-artwork.js';
import MkModalWindow from '@/components/MkModalWindow.vue';
import { i18n } from '@/i18n.js';

const props = defineProps<{ preview: ImportPreview; disabled: boolean; galleryLimit: number; lockedFields: string[] }>();
const choices = defineModel<ImportArtworkChoices>({ required: true });
const activeField = ref<ImportArtworkField>('posterUrl');
const source = ref<ImportSource | ''>('');
const viewing = ref<ImportArtworkCandidate | null>(null);
onDeactivated(() => { viewing.value = null; });
const failedImages = ref<Record<string, number>>({});
const candidates = computed(() => (props.preview.record.artworkCandidates ?? []).filter(candidate => importerImageUrl(candidate.url)));
const availableSources = computed(() => [...new Set(candidates.value.map(candidate => candidate.source))]);
const visibleCandidates = computed(() => fieldCandidates(activeField.value).filter(candidate => !source.value || candidate.source === source.value));
const blocked = computed(() => importerArtworkFieldLocked(props.preview, activeField.value, props.lockedFields));
const editorial = computed(() => props.preview.changes.some(change => change.field === activeField.value && change.protected));
const selectedCount = computed(() => fieldCandidates('galleryUrls').filter(selected).length);

function fieldCandidates(field: ImportArtworkField): ImportArtworkCandidate[] { return candidates.value.filter(candidate => candidate.field === field); }

function selected(candidate: ImportArtworkCandidate): boolean { return importerArtworkChoiceSelected(candidate, choices.value, props.preview, props.galleryLimit); }

function imageUrl(candidate: ImportArtworkCandidate, large = false): string | undefined {
	const urls = [...new Set((large ? [candidate.url, candidate.previewUrl] : [candidate.previewUrl, candidate.url]).map(value => importerImageUrl(value)).filter((value): value is string => value !== null))];
	return urls[failedImages.value[`${candidate.id}:${large}`] ?? 0];
}

function imageFailed(candidate: ImportArtworkCandidate, large = false): void {
	const key = `${candidate.id}:${large}`;
	failedImages.value = { ...failedImages.value, [key]: Math.min(2, (failedImages.value[key] ?? 0) + 1) };
}

function resetField(): void { if (props.disabled || blocked.value) return; const next = { ...choices.value }; delete next[activeField.value]; choices.value = next; }

function choose(candidate: ImportArtworkCandidate): void {
	if (props.disabled || blocked.value || candidate.field !== activeField.value) return;
	if (candidate.field === 'galleryUrls') {
		const ids = fieldCandidates('galleryUrls').filter(selected).map(item => item.id);
		if (!ids.includes(candidate.id) && ids.length >= props.galleryLimit) return;
		choices.value = { ...choices.value, galleryUrls: ids.includes(candidate.id) ? ids.filter(id => id !== candidate.id) : [...ids, candidate.id] };
	} else choices.value = { ...choices.value, [candidate.field]: candidate.id };
}
</script>

<style lang="scss" module>
.root { margin: 24px 0; padding: 18px 0; border-top: 1px solid var(--MI_THEME-divider); border-bottom: 1px solid var(--MI_THEME-divider); }
.root h3 { margin: 0 0 8px; }
.hint { color: var(--MI_THEME-fgTransparentWeak); font-size: .83rem; line-height: 1.6; }
.tabs { display: flex; gap: 6px; overflow-x: auto; margin: 16px 0; }
.tabs button, .button { padding: 10px 12px; border-radius: var(--MI-radius); white-space: nowrap; background: var(--MI_THEME-buttonBg); }
.tabs .active { color: var(--MI_THEME-accent); background: var(--MI_THEME-accentedBg); }
.tabs small { margin-left: 4px; opacity: .7; }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; }
.toolbar label { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
.toolbar select { padding: 8px 12px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); }
.protected { display: flex; align-items: center; gap: 8px; color: var(--MI_THEME-warn); font-size: .85rem; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(145px, 1fr)); gap: 12px; }
.card { min-width: 0; overflow: clip; border: 2px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-bg); }
.selected { border-color: var(--MI_THEME-accent); }
.image { display: grid; position: relative; width: 100%; aspect-ratio: 16 / 10; place-items: center; overflow: hidden; }
.image img { width: 100%; height: 100%; object-fit: cover; }
.image.portrait { aspect-ratio: 2 / 3; }
.image.logo img { object-fit: contain; padding: 10px; box-sizing: border-box; }
.image > i { position: absolute; right: 6px; bottom: 6px; padding: 5px; background: var(--MI_THEME-panel); border-radius: var(--MI-radius); }
.image > .missing { position: static; padding: 0; color: var(--MI_THEME-fgTransparentWeak); background: transparent; font-size: 2rem; }
.information { display: flex; flex-direction: column; gap: 7px; padding: 10px; }
.information strong { font-size: .85rem; }
.information small { color: var(--MI_THEME-fgTransparentWeak); font-size: .75rem; }
.choice { display: flex; align-items: center; gap: 6px; font-size: .83rem; }
.choice input { accent-color: var(--MI_THEME-accent); }
// Keep below the native window's 64px outer margin and 46px header, including rounding.
.large { display: grid; grid-template-rows: minmax(0, 1fr); place-items: center; width: 100%; height: min(660px, calc(100dvh - 112px)); max-height: 100%; min-width: 0; min-height: 0; overflow: hidden; padding: 16px; box-sizing: border-box; }
.large img { display: block; width: auto; height: auto; min-width: 0; min-height: 0; max-width: 100%; max-height: min(620px, calc(100dvh - 144px)); object-fit: contain; }
.root button:focus-visible, .root input:focus-visible, .root select:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
@media (max-width: 450px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
