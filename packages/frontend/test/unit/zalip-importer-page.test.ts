/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { ImportPreview, ImportRun, ImportRunItem } from '@/utility/zalip-importer.js';
import Importer from '@/pages/zalip/importer.vue';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { importerFields, importerSources } from '@/utility/zalip-importer.js';

vi.mock('@/i.js', () => ({ iAmAdmin: true }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/os.js', () => ({ confirm: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/pages/zalip/importer-artwork-settings.vue', () => ({ default: { template: '<div data-testid="artwork-settings" />' } }));
vi.mock('@/pages/zalip/importer-artwork-picker.vue', () => ({ default: { emits: ['update:modelValue'], template: '<button type="button" @click="$emit(\'update:modelValue\', { posterUrl: \'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\' })">Select fixture poster</button>' } }));

const ref = { source: 'tmdb' as const, mediaType: 'movie' as const, externalId: '11' };
const run: ImportRun = { id: 'run1', mode: 'import', state: 'completed', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', total: 1, completed: 1, failed: 0, error: null, profileId: null };
const item: ImportRunItem = { id: 'item1', position: 0, state: 'completed', ref, workId: 'work1', error: null, warnings: [] };

function preview(): ImportPreview {
	return { workId: null, locks: [], warnings: [], changes: importerFields.map(field => ({ field, before: null, after: field === 'title' ? 'Fixture title' : null, protected: false, selected: true })), record: { ref, identities: [], title: 'Fixture title', originalTitle: null, description: null, releaseYear: 2026, runtimeMinutes: 100, kind: 'movie', genres: [], countries: [], posterUrl: 'https://images.example/automatic.jpg', backdropUrl: null, logoUrl: null, galleryUrls: [], artworkCandidates: [{ id: 'b'.repeat(64), source: 'tmdb', field: 'posterUrl', url: 'https://images.example/selected.jpg', previewUrl: 'https://images.example/selected-small.jpg', width: 780, height: 1170, language: 'ru' }], trailerYoutubeKey: null, ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [] } };
}

function setup(props: { source?: string; mediaType?: string; externalId?: string; imagesOnly?: string; workId?: string } = {}) {
	return render(Importer, { props, global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
	vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint) => {
		if (endpoint === 'zalip/admin/importer/sources') return { sources: importerSources.map(source => ({ source, configured: true, capabilities: { search: source !== 'alloha', collections: true, updates: true }, dailyLimit: null })) };
		if (endpoint === 'zalip/admin/importer/taxonomy/list') return { entries: [] };
		if (endpoint === 'zalip/admin/importer/schedules/list') return { profiles: [] };
		if (endpoint === 'zalip/admin/importer/runs/list') return { runs: [run] };
		if (endpoint === 'zalip/admin/importer/runs/show') return { run, items: [item] };
		if (endpoint === 'zalip/admin/importer/runs/create') return { id: run.id, state: 'queued' };
		if (endpoint === 'zalip/admin/importer/preview') return preview();
		if (endpoint === 'zalip/admin/importer/search') return { items: [{ ref, title: 'Fixture title', originalTitle: null, releaseYear: 2026, posterUrl: null }], page: 1, hasMore: false };
		if (endpoint === 'zalip/admin/importer/work-state/show') return { workId: 'work1', title: 'Imported fixture', locks: [], fields: [] };
		throw new Error('Unexpected fixture endpoint');
	});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('importer focused presentation', () => {
	it('previews a Vibix KP reference with the sixth source without publishing automatically', async () => {
		const view = setup({ source: 'vibix', mediaType: 'movie', externalId: '435' });
		await view.findByRole('heading', { name: 'Fixture title' });
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/preview', expect.objectContaining({ ref: { source: 'vibix', mediaType: 'movie', externalId: '435' } }));
		expect(view.getByLabelText(i18n.ts.zalip._importer.references)).toHaveProperty('placeholder', '435\nimdb:tt0133093');
		expect(view.getByText(i18n.ts.zalip._importer.vibixReferencesHint)).toBeTruthy();
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/create')).toBe(false);
	});
	it('shows an unconfigured Vibix source but prevents choosing it for lookup', async () => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => endpoint === 'zalip/admin/importer/sources' ? { sources: importerSources.map(source => ({ source, configured: source !== 'vibix', capabilities: { search: true, collections: false, updates: false }, dailyLimit: null })) } : original(endpoint, params));
		const view = setup();
		await waitFor(() => expect(view.getByRole('button', { name: i18n.ts.zalip._importer.find }).hasAttribute('disabled')).toBe(false));
		const sourceSelect = view.getByLabelText(i18n.ts.zalip._importer.references).closest('form')!.querySelector('select')!;
		expect(sourceSelect.querySelector('option[value="vibix"]')).toHaveProperty('disabled', true);
	});
	it('allows disabling a previously enabled Vibix player after credentials were cleared, but not re-enabling it', async () => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => {
			if (endpoint === 'zalip/admin/importer/sources') return { sources: importerSources.map(source => ({ source, configured: source !== 'vibix', capabilities: { search: true, collections: false, updates: false }, dailyLimit: null })) };
			if (endpoint === 'zalip/admin/importer/playback-settings/show') return { providers: ['alloha', 'collaps', 'kodik', 'vibix'].map((source, position) => ({ source, label: source, enabled: true, position })) };
			if (endpoint === 'zalip/admin/importer/maintenance/list' || endpoint === 'zalip/admin/importer/maintenance/schedules/list') return [];
			return original(endpoint, params);
		});
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.maintenance }));
		const label = await view.findByLabelText(`Vibix · ${i18n.ts.zalip._importer.playerLabel}`);
		const checkbox = label.closest('div')!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		expect(checkbox.checked).toBe(true);
		expect(checkbox.disabled).toBe(false);
		await fireEvent.click(checkbox);
		expect(checkbox.checked).toBe(false);
		expect(checkbox.disabled).toBe(true);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/playback-settings/save')).toBe(false);
	});
	it('shows inputs before collapsed options and source diagnostics without losing other tabs', async () => {
		const view = setup();
		await waitFor(() => expect(view.getByRole('button', { name: i18n.ts.zalip._importer.find }).hasAttribute('disabled')).toBe(false));
		const input = view.getByRole('heading', { name: i18n.ts.zalip._importer.searchHeading });
		const options = view.getByText(i18n.ts.zalip._importer.importOptions).closest('details')!;
		const sources = view.getByText(i18n.ts.zalip._importer.sources, { selector: 'summary' }).closest('details')!;
		expect(input.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(options.open).toBe(false);
		expect(sources.open).toBe(false);
		for (const name of [i18n.ts.zalip._importer.runs, i18n.ts.zalip._importer.directories, i18n.ts.zalip._importer.schedules, i18n.ts.zalip._importer.maintenance, i18n.ts.zalip._importer.serviceSettings]) expect(view.getByRole('button', { name })).toBeTruthy();
	});
	it('previews an ID before writing, keeps one enqueue path and snapshots chosen artwork and locks', async () => {
		const view = setup();
		await fireEvent.update(view.getByLabelText(i18n.ts.zalip._importer.references), '11');
		await fireEvent.submit(view.getByLabelText(i18n.ts.zalip._importer.references).closest('form')!);
		await view.findByRole('heading', { name: 'Fixture title' });
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/create')).toBe(false);
		expect(view.queryByRole('button', { name: i18n.ts.zalip._importer.enqueue, hidden: true })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Select fixture poster' }));
		const compare = view.getByText(i18n.ts.zalip._importer.reviewChanges, { selector: 'summary', exact: false }).closest('details')!;
		compare.open = true;
		await fireEvent.click(view.getByRole('checkbox', { name: i18n.tsx.zalip._importer.protectField({ field: i18n.ts.zalip._importer.description }) }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.enqueueDraft }));
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/runs/create', expect.objectContaining({ refs: [ref], mode: 'import', lockedFields: ['description'], options: expect.objectContaining({ artwork: 'local', artworkSelections: [{ ref, choices: { posterUrl: 'b'.repeat(64) } }] }) })));
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint.includes('update-state'))).toBe(false);
	});
	it('opens actual field options separately from protection and retains the existing bulk action after closing preview', async () => {
		const view = setup();
		await fireEvent.update(view.getByLabelText(i18n.ts.zalip._importer.references), '11\n12');
		await fireEvent.submit(view.getByLabelText(i18n.ts.zalip._importer.references).closest('form')!);
		await view.findByRole('heading', { name: 'Fixture title' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.importOptions }));
		expect(view.getByText(i18n.ts.zalip._importer.importOptions, { selector: 'summary' }).closest('details')!.open).toBe(true);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.closePreview }));
		const bulk = view.getByText(i18n.ts.zalip._importer.bulkImport, { selector: 'summary', exact: false }).closest('details')!;
		bulk.open = true;
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.enqueue }));
		await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/runs/create', expect.objectContaining({ refs: [ref, { ...ref, externalId: '12' }], options: expect.not.objectContaining({ artworkSelections: expect.anything() }) })));
	});
	it('inspects the imported work in the existing protection view and links only to the real editor route', async () => {
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.runs }));
		await fireEvent.click(await view.findByRole('button', { name: new RegExp(run.id) }));
		await fireEvent.click(await view.findByRole('button', { name: i18n.tsx.zalip._importer.itemWorkId({ id: 'work1' }) }));
		await view.findByRole('heading', { name: 'Imported fixture' });
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/work-state/show', { workId: 'work1' });
		expect(view.getByLabelText(i18n.ts.zalip._importer.workId).closest('details')!.open).toBe(true);
		expect(view.getByRole('link', { name: i18n.ts.zalip._importer.editor }).getAttribute('href')).toBe('/zalip/editor');
	});
	it('keeps image-only editor prefill bound to the exact work and exposes its existing image settings', async () => {
		const view = setup({ source: 'tmdb', mediaType: 'movie', externalId: '11', imagesOnly: '1', workId: 'work1' });
		await view.findByRole('heading', { name: 'Fixture title' });
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/preview', expect.objectContaining({ ref, workId: 'work1', options: expect.objectContaining({ fields: ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'], artwork: 'local' }) }));
		expect(view.getByText(i18n.ts.zalip._importer.importOptions, { selector: 'summary' }).closest('details')!.open).toBe(true);
		expect(view.getByTestId('artwork-settings')).toBeTruthy();
		expect(view.getByLabelText(i18n.ts.zalip._importer.references)).toHaveProperty('value', '11');
	});
	it('does not submit a stale preview after changing selected fields and requires explicit refresh', async () => {
		const view = setup({ source: 'tmdb', mediaType: 'movie', externalId: '11' });
		await view.findByRole('heading', { name: 'Fixture title' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.importOptions }));
		view.getByText(i18n.ts.zalip._importer.metadata, { selector: 'summary', exact: false }).closest('details')!.open = true;
		await fireEvent.click(view.getByRole('checkbox', { name: i18n.ts.zalip._importer.description }));
		const submit = view.getByRole('button', { name: i18n.ts.zalip._importer.enqueueDraft });
		expect(submit.hasAttribute('disabled')).toBe(true);
		await fireEvent.click(submit);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/create')).toBe(false);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.refreshPreview }));
		await waitFor(() => expect(view.getByRole('button', { name: i18n.ts.zalip._importer.enqueueDraft }).hasAttribute('disabled')).toBe(false));
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(([endpoint]) => endpoint === 'zalip/admin/importer/preview')).toHaveLength(2);
	});
});
