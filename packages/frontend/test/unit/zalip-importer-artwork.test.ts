/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { importerFiltersValid, importerOptions, importerSelection } from '../../src/utility/zalip-importer.js';
import type { ImportArtworkCandidate, ImportPreview } from '../../src/utility/zalip-importer.js';
import { importerArtworkChoiceSelected, importerArtworkCurrentChoices, importerArtworkFieldLocked, importerArtworkLimitChoices, importerArtworkOptions, importerArtworkPreview, importerArtworkSameRef, importerArtworkSelectionStale, importerArtworkSettings, importerArtworkSettingsValid } from '../../src/utility/zalip-importer-artwork.js';
import Picker from '../../src/pages/zalip/importer-artwork-picker.vue';
import { i18n } from '../../src/i18n.js';

vi.mock('../../src/components/MkModalWindow.vue', () => ({ default: { template: '<div data-testid="artwork-preview-window"><button data-testid="artwork-preview-close" @click="$emit(\'close\')">Close</button><slot /></div>' } }));

const makeCandidate = (id: string, field: ImportArtworkCandidate['field'] = 'posterUrl', source: ImportArtworkCandidate['source'] = 'tmdb'): ImportArtworkCandidate => ({ id: id.repeat(64), field, source, url: `https://images.example.org/${id}.jpg`, previewUrl: `https://images.example.org/${id}-small.jpg`, width: 1000, height: 1500, language: 'ru' });
const poster = makeCandidate('a');
const alternative = makeCandidate('b', 'posterUrl', 'kinopoisk');
const gallery = makeCandidate('c', 'galleryUrls');
const gallery2 = makeCandidate('d', 'galleryUrls', 'kinopoisk');

function preview(): ImportPreview {
	return { record: { ref: { source: 'tmdb', externalId: '11', mediaType: 'movie' }, identities: [], title: 'Title', originalTitle: null, description: null, releaseYear: 2020, runtimeMinutes: 100, kind: 'movie', genres: [], countries: [], posterUrl: poster.url, backdropUrl: null, logoUrl: null, galleryUrls: [gallery.url], artworkCandidates: [poster, alternative, gallery, gallery2], trailerYoutubeKey: null, ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [] }, workId: null, changes: ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'].map(field => ({ field, before: null, after: field === 'posterUrl' ? poster.url : null, protected: false, selected: true })), warnings: [] };
}

afterEach(cleanup);

describe('importer artwork policy snapshots', () => {
	it('keeps legacy jobs remote and creates a complete configurable local policy', () => {
		expect(importerSelection().artwork).toBe('remote');
		const selection = importerSelection({ artwork: 'local' });
		expect(selection.artworkSettings).toMatchObject({ format: 'webp', quality: 85, keepOriginal: true, galleryLimit: 18 });
		expect(importerSelection({ artwork: 'local-webp' }).artworkSettings).toMatchObject({ quality: 80, galleryLimit: 12 });
		const options = importerOptions(selection);
		selection.artworkSettings.sizes.posterUrl.width = 500;
		expect(options.artworkSettings?.sizes.posterUrl.width).toBe(780);
	});
	it('round-trips all conversion controls without sharing size objects', () => {
		const settings = importerArtworkSettings(); settings.format = 'avif'; settings.quality = 72; settings.keepOriginal = false; settings.galleryLimit = 0; settings.sizes.posterUrl = { width: 450, height: 0, fit: 'cover' };
		const options = importerOptions(importerSelection({ artwork: 'local', artworkSettings: settings }));
		expect(options.artworkSettings).toEqual(settings);
		settings.sizes.posterUrl.width = 800;
		expect(options.artworkSettings?.sizes.posterUrl.width).toBe(450);
	});
	it('rejects invalid integer, format and size controls before queueing', () => {
		for (const patch of [{ quality: 0 }, { quality: 101 }, { quality: 50.5 }, { galleryLimit: -1 }, { galleryLimit: 19 }, { format: 'svg' }]) expect(importerArtworkSettingsValid({ ...importerArtworkSettings(), ...patch } as ReturnType<typeof importerArtworkSettings>)).toBe(false);
		const selection = importerSelection({ artwork: 'local' }); selection.artworkSettings.sizes.logoUrl.width = 5001;
		expect(importerFiltersValid(selection)).toBe(false);
		selection.artworkSettings.sizes.logoUrl.width = 0; selection.artworkSettings.sizes.logoUrl.height = 0;
		expect(importerFiltersValid(selection)).toBe(true);
	});
	it('binds choices to the exact reference and never inherits them into schedules', () => {
		const base = preview(); const choices = { posterUrl: alternative.id, galleryUrls: [gallery2.id] };
		const options = importerArtworkOptions(importerOptions(importerSelection({ artwork: 'local' })), base.record.ref, choices);
		choices.galleryUrls.push(gallery.id); base.record.ref.externalId = 'other';
		expect(options.artworkSelections).toEqual([{ ref: { source: 'tmdb', externalId: '11', mediaType: 'movie' }, choices: { posterUrl: alternative.id, galleryUrls: [gallery2.id] } }]);
		expect(importerOptions(importerSelection(options)).artworkSelections).toBeUndefined();
		expect(importerArtworkSameRef(options.artworkSelections![0].ref, base.record.ref)).toBe(false);
		expect(importerArtworkSameRef({ source: 'tmdb', mediaType: 'movie', externalId: '11' }, { source: 'tmdb', mediaType: 'tv', externalId: '11' })).toBe(false);
	});
	it('recognizes only closed artwork stale codes without echoing upstream messages', () => {
		for (const value of ['IMPORT_ARTWORK_SELECTION_STALE', 'ZALIP_IMPORT_ARTWORK_SELECTION_STALE', { code: 'ZALIP_IMPORT_ARTWORK_SELECTION_STALE' }]) expect(importerArtworkSelectionStale(value)).toBe(true);
		for (const value of [null, {}, { message: 'ZALIP_IMPORT_ARTWORK_SELECTION_STALE' }, 'IMPORT_ARTWORK_SELECTION_STALE https://private.example/?token=secret', 'import-failed']) expect(importerArtworkSelectionStale(value)).toBe(false);
	});
});

describe('artwork preview projection', () => {
	it('updates images and diffs instantly without mutating automatic values or settings', () => {
		const base = preview(); const changed = importerArtworkPreview(base, { posterUrl: alternative.id, galleryUrls: [gallery2.id, gallery.id] });
		expect(changed.record.posterUrl).toBe(alternative.url);
		expect(changed.record.galleryUrls).toEqual([gallery2.url, gallery.url]);
		expect(changed.changes.find(change => change.field === 'posterUrl')?.after).toBe(alternative.url);
		expect(base.record.posterUrl).toBe(poster.url);
		expect(importerArtworkPreview(base, {}).record.posterUrl).toBe(poster.url);
	});
	it('does not project protected, unselected, wrong-role or foreign IDs', () => {
		const base = preview(); base.changes[0].protected = true;
		expect(importerArtworkPreview(base, { posterUrl: alternative.id }).record.posterUrl).toBe(poster.url);
		base.changes[0].protected = false; base.changes[0].selected = false;
		expect(importerArtworkPreview(base, { posterUrl: alternative.id }).record.posterUrl).toBe(poster.url);
		base.changes[0].selected = true;
		for (const id of [gallery.id, 'f'.repeat(64)]) expect(importerArtworkPreview(base, { posterUrl: id }).record.posterUrl).toBe(poster.url);
		expect(importerArtworkPreview(base, { posterUrl: alternative.id }, ['posterUrl']).record.posterUrl).toBe(poster.url);
		expect(base.changes[0].protected).toBe(false);
	});
	it('supports explicit empty gallery and displays automatic or manual selection consistently', () => {
		const base = preview();
		expect(importerArtworkPreview(base, { galleryUrls: [] }).record.galleryUrls).toEqual([]);
		expect(importerArtworkChoiceSelected(poster, {}, base)).toBe(true);
		expect(importerArtworkChoiceSelected(poster, { posterUrl: alternative.id }, base)).toBe(false);
		expect(importerArtworkChoiceSelected(gallery, { galleryUrls: [] }, base)).toBe(false);
	});
	it('prunes stale and protected choices after refresh and deduplicates automatic URL selection', () => {
		const base = preview(); base.changes[0].protected = true;
		expect(importerArtworkCurrentChoices(base, { posterUrl: alternative.id, logoUrl: poster.id, galleryUrls: [gallery.id, 'f'.repeat(64)] })).toEqual({ galleryUrls: [gallery.id] });
		const duplicate = { ...gallery, id: 'e'.repeat(64), source: 'kinopoisk' as const }; base.record.artworkCandidates!.push(duplicate);
		expect(importerArtworkChoiceSelected(duplicate, {}, base)).toBe(false);
	});
	it('allows an explicit editorial replacement but never bypasses persisted or per-job locks', () => {
		const base = preview(); base.locks = []; base.workId = 'existing1'; base.changes[0].protected = true;
		const choices = { posterUrl: alternative.id };
		expect(importerArtworkFieldLocked(base, 'posterUrl')).toBe(false);
		expect(importerArtworkPreview(base, {}).changes[0].protected).toBe(true);
		expect(importerArtworkCurrentChoices(base, choices)).toEqual(choices);
		expect(importerArtworkPreview(base, choices)).toMatchObject({ record: { posterUrl: alternative.url } });
		expect(importerArtworkPreview(base, choices).changes[0].protected).toBe(false);
		expect(importerArtworkPreview(base, choices, ['posterUrl']).record.posterUrl).toBe(poster.url);
		base.locks = ['posterUrl'];
		expect(importerArtworkFieldLocked(base, 'posterUrl')).toBe(true);
		expect(importerArtworkCurrentChoices(base, choices)).toEqual({});
		expect(importerArtworkPreview(base, choices).record.posterUrl).toBe(poster.url);
	});
	it('caps automatic and manual gallery preview, selections and queued choices consistently', () => {
		const base = preview(); base.record.galleryUrls = [gallery.url, gallery2.url];
		expect(importerArtworkPreview(base, {}, [], 1).record.galleryUrls).toEqual([gallery.url]);
		expect(importerArtworkChoiceSelected(gallery2, {}, base, 1)).toBe(false);
		const choices = { posterUrl: alternative.id, galleryUrls: [gallery2.id, gallery.id] };
		expect(importerArtworkPreview(base, choices, [], 1).record.galleryUrls).toEqual([gallery2.url]);
		expect(importerArtworkChoiceSelected(gallery, choices, base, 1)).toBe(false);
		expect(importerArtworkLimitChoices(choices, 1)).toEqual({ posterUrl: alternative.id, galleryUrls: [gallery2.id] });
		expect(choices.galleryUrls).toEqual([gallery2.id, gallery.id]);
	});
	it('preserves existing gallery at zero download limit but retains an explicit empty clear', () => {
		const base = preview(); base.workId = 'work1'; base.changes.find(change => change.field === 'galleryUrls')!.before = ['https://site.example/files/old.webp'];
		expect(importerArtworkPreview(base, {}, [], 0).record.galleryUrls).toEqual(['https://site.example/files/old.webp']);
		expect(importerArtworkPreview(base, { galleryUrls: [gallery.id] }, [], 0).record.galleryUrls).toEqual(['https://site.example/files/old.webp']);
		expect(importerArtworkLimitChoices({ galleryUrls: [gallery.id] }, 0)).toEqual({});
		expect(importerArtworkChoiceSelected(gallery, {}, base, 0)).toBe(false);
		expect(importerArtworkPreview(base, { galleryUrls: [] }, [], 0).record.galleryUrls).toEqual([]);
		expect(importerArtworkLimitChoices({ galleryUrls: [] }, 0)).toEqual({ galleryUrls: [] });
		base.workId = null;
		expect(importerArtworkPreview(base, {}, [], 0).record.galleryUrls).toEqual([]);
	});
});

describe('artwork image picker', () => {
	it('filters sources and emits an ID, never a provider URL', async () => {
		const view = render(Picker, { props: { preview: preview(), disabled: false, galleryLimit: 18, lockedFields: [], modelValue: {} } });
		expect(view.getAllByRole('radio')).toHaveLength(2);
		await fireEvent.update(view.getByRole('combobox'), 'kinopoisk');
		expect(view.getAllByRole('radio')).toHaveLength(1);
		await fireEvent.click(view.getByRole('radio'));
		expect(view.emitted()['update:modelValue']).toEqual([[{ posterUrl: alternative.id }]]);
	});
	it('keeps protected fields read-only and bounds gallery additions', async () => {
		const view = render(Picker, { props: { preview: preview(), disabled: false, galleryLimit: 1, lockedFields: ['posterUrl'], modelValue: {} } });
		expect(view.getAllByRole('radio').every(input => (input as HTMLInputElement).disabled)).toBe(true);
		await fireEvent.click(view.getByRole('button', { name: new RegExp(i18n.ts.zalip._importer.gallery, 'u') }));
		const inputs = view.getAllByRole('checkbox') as HTMLInputElement[];
		expect(inputs[0].disabled).toBe(false); expect(inputs[1].disabled).toBe(true);
		await fireEvent.click(inputs[0]);
		expect(view.emitted()['update:modelValue']).toEqual([[{ galleryUrls: [] }]]);
	});
	it('distinguishes automatic editorial protection from a real persisted lock', async () => {
		const base = preview(); base.locks = []; base.changes[0].protected = true;
		const view = render(Picker, { props: { preview: base, disabled: false, galleryLimit: 18, lockedFields: [], modelValue: {} } });
		expect(view.getByText(i18n.ts.zalip._importer.artworkEditorialHint)).toBeTruthy();
		expect(view.getAllByRole('radio').every(input => !(input as HTMLInputElement).disabled)).toBe(true);
		await fireEvent.click(view.getAllByRole('radio')[1]);
		expect(view.emitted()['update:modelValue']).toEqual([[{ posterUrl: alternative.id }]]);
		await view.rerender({ preview: { ...base, locks: ['posterUrl'] } });
		expect(view.getAllByRole('radio').every(input => (input as HTMLInputElement).disabled)).toBe(true);
	});
	it('counts effective automatic gallery choices after reducing the limit', async () => {
		const base = preview(); base.record.galleryUrls = [gallery.url, gallery2.url];
		const view = render(Picker, { props: { preview: base, disabled: false, galleryLimit: 1, lockedFields: [], modelValue: {} } });
		await fireEvent.click(view.getByRole('button', { name: new RegExp(i18n.ts.zalip._importer.gallery, 'u') }));
		const inputs = view.getAllByRole('checkbox') as HTMLInputElement[];
		expect(inputs.filter(input => input.checked)).toHaveLength(1);
		await view.rerender({ galleryLimit: 0 });
		expect(view.getByText(i18n.ts.zalip._importer.artworkGalleryDisabled)).toBeTruthy();
		expect(inputs.every(input => !input.checked && input.disabled)).toBe(true);
	});
	it('falls back from a failed thumbnail to its original, then to a placeholder', async () => {
		const view = render(Picker, { props: { preview: preview(), disabled: false, galleryLimit: 18, lockedFields: [], modelValue: {} } });
		let image = view.container.querySelector('img')!;
		expect(image.getAttribute('src')).toBe(poster.previewUrl);
		await fireEvent.error(image);
		image = view.container.querySelector('img')!;
		expect(image.getAttribute('src')).toBe(poster.url);
		await fireEvent.error(image);
		expect(view.container.querySelector('article')!.querySelector('img')).toBeNull();
		expect(view.container.querySelector('article .ti-photo-off')).toBeTruthy();
	});
	it('keeps an image with an invalid thumbnail safe and falls back in the large preview', async () => {
		const base = preview(); base.record.artworkCandidates![0] = { ...poster, previewUrl: 'javascript:alert(1)' };
		const view = render(Picker, { props: { preview: base, disabled: false, galleryLimit: 18, lockedFields: [], modelValue: {} } });
		const thumbnail = view.container.querySelector('img')!;
		expect(thumbnail.getAttribute('src')).toBe(poster.url);
		await fireEvent.click(thumbnail.closest('button')!);
		const large = view.getByRole('img', { name: i18n.ts.zalip._importer.poster });
		expect(large.getAttribute('src')).toBe(poster.url);
		await fireEvent.error(large);
		expect(view.getByText(i18n.ts.zalip._importer.artworkImageUnavailable)).toBeTruthy();
	});
	it('teleports the large preview outside the page stacking context and closes cleanly', async () => {
		const view = render(Picker, { props: { preview: preview(), disabled: false, galleryLimit: 18, lockedFields: [], modelValue: {} } });
		await fireEvent.click(view.container.querySelector('img')!.closest('button')!);
		const modal = view.getByTestId('artwork-preview-window');
		expect(document.body.contains(modal)).toBe(true);
		expect(view.container.contains(modal)).toBe(false);
		await fireEvent.click(view.getByTestId('artwork-preview-close'));
		expect(view.queryByTestId('artwork-preview-window')).toBeNull();
	});
});
