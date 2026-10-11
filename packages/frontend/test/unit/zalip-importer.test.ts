/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { i18n } from '../../src/i18n.js';
import { formatImporterValue, importerCollectionIds, importerFieldGroups, importerFields, importerFiltersValid, importerImageUrl, importerImdbId, importerMaintenanceRequest, importerOptions, importerPlaybackSettings, importerProgress, importerReference, importerReferenceKey, importerRefreshSequence, importerRequestCurrent, importerRequestFinish, importerRequestInvalidate, importerRequestStart, importerRequestState, importerSelection, importerServiceForm, importerServiceOrigin, importerServiceRequest, importerServiceSettingsUpdate, importerWarningLabel, importerWarningLabels, importerWorkIds, splitImporterReferenceLines, taxonomyAppendWorks, taxonomyBaseChanges, taxonomyCollectionChanges, taxonomyFacts, taxonomyPersonChanges } from '../../src/utility/zalip-importer.js';
import type { ImportPlaybackProvider, ImportServiceSettings, TaxonomyWork } from '../../src/utility/zalip-importer.js';

describe('importer presentation helpers', () => {
	it('trims and deduplicates references without splitting provider URLs', () => {
		expect(splitImporterReferenceLines('  movie:11\r\n\nmovie:11\nhttps://provider.example/a,b  ')).toEqual(['movie:11', 'https://provider.example/a,b']);
	});
	it('accepts image paths and public web URLs but not executable or credential-bearing URLs', () => {
		expect(importerImageUrl('/poster.jpg')).toBe('https://image.tmdb.org/t/p/w500/poster.jpg');
		expect(importerImageUrl('https://example.org/poster.jpg')).toBe('https://example.org/poster.jpg');
		expect(importerImageUrl('javascript:alert(1)')).toBeNull();
		expect(importerImageUrl('https://token@example.org/poster.jpg')).toBeNull();
		expect(importerImageUrl('//example.org/poster.jpg')).toBeNull();
		expect(importerImageUrl('/../poster.jpg')).toBeNull();
		expect(importerImageUrl(null)).toBeNull();
	});
	it('keeps movie and TV namespaces separate and reads only supported card URLs', () => {
		expect(importerReference('tmdb', 'movie', 'https://www.themoviedb.org/tv/11-title')).toEqual({ source: 'tmdb', mediaType: 'tv', externalId: '11' });
		expect(importerReference('kinopoisk', 'movie', 'https://www.kinopoisk.ru/series/123/')).toEqual({ source: 'kinopoisk', mediaType: 'tv', externalId: '123' });
		expect(importerReference('collaps', 'movie', 'https://www.themoviedb.org/movie/11')).toBeNull();
		expect(importerReference('tmdb', 'movie', 'https://themoviedb.org.evil.example/movie/11')).toBeNull();
		expect(importerReference('tmdb', 'movie', '0')).toBeNull();
		expect(importerReference('tmdb', 'movie', 'not-an-id')).toBeNull();
		expect(importerReference('alloha', 'tv', 'tmdb:tv:11')).toEqual({ source: 'alloha', mediaType: 'tv', externalId: 'tmdb:tv:11' });
		expect(importerReferenceKey({ source: 'tmdb', mediaType: 'movie', externalId: '11' })).not.toBe(importerReferenceKey({ source: 'tmdb', mediaType: 'tv', externalId: '11' }));
	});
	it('retains zero and shows an explicit empty value in the diff', () => {
		expect(formatImporterValue(0)).toBe('0');
		expect(formatImporterValue([])).toBe('—');
		expect(formatImporterValue(['Драма', 'Комедия'])).toBe('Драма, Комедия');
		expect(formatImporterValue('<script>')).toBe('<script>');
	});
	it('bounds progress for incomplete and interrupted jobs', () => {
		expect(importerProgress(2, 4)).toBe(50);
		expect(importerProgress(8, 4)).toBe(100);
		expect(importerProgress(-1, 4)).toBe(0);
		expect(importerProgress(0, 0)).toBe(0);
		expect(importerProgress(NaN, 4)).toBe(0);
	});
	it('keeps persisted artwork warnings visible with translated field labels', () => {
		const poster = i18n.tsx.zalip._importer.warningArtworkLocal({ field: i18n.ts.zalip._importer.poster });
		const gallery = i18n.tsx.zalip._importer.warningArtworkLocal({ field: i18n.ts.zalip._importer.gallery });
		expect(importerWarningLabels(['artwork-local-unavailable:posterUrl', 'artwork-local-unavailable:galleryUrls', 'artwork-local-unavailable:posterUrl'])).toEqual([poster, gallery]);
		expect(importerWarningLabels(undefined)).toEqual([]);
		expect(importerWarningLabels(null)).toEqual([]);
		expect(importerWarningLabels([])).toEqual([]);
	});
	it('humanizes only closed warning codes without echoing arbitrary provider text', () => {
		expect(importerWarningLabel('tmdb-season-12-unavailable')).toBe(i18n.tsx.zalip._importer.warningSeasonUnavailable({ number: '12' }));
		expect(importerWarningLabel('collaps-metadata-partial')).toBe(i18n.tsx.zalip._importer.warningMetadataPartial({ source: 'Collaps' }));
		expect(importerWarningLabel('alloha-player-url-rejected')).toBe(i18n.tsx.zalip._importer.warningPlayerRejected({ source: 'Alloha' }));
		expect(importerWarningLabel('kinopoisk:quota-exceeded')).toBe(i18n.tsx.zalip._importer.warningSource({ source: i18n.ts.zalip._importer.sourceKinopoisk, reason: i18n.ts.zalip._importer.errorQuota }));
		for (const code of ['artwork-local-unavailable:token', 'tmdb:upstream-failure https://example.org/?token=private', 'tmdb-season-10000-unavailable', '<script>private</script>']) expect(importerWarningLabel(code)).toBe(i18n.ts.zalip._importer.warningGeneric);
		expect(importerWarningLabel({ token: 'private' })).toBe(i18n.ts.zalip._importer.warningGeneric);
		expect(importerWarningLabels(Array.from({ length: 51 }, (_, index) => `tmdb-season-${index}-unavailable`))).toHaveLength(50);
	});
	it('keeps explicit empty options empty and snapshots grouped form values', () => {
		const defaults = importerSelection();
		expect(defaults.fields).toEqual([...importerFields]);
		expect(defaults.sources).toEqual(['tmdb', 'kinopoisk', 'alloha', 'collaps']);
		const selection = importerSelection({ sources: [], fields: [], fieldSources: { title: 'tmdb' } });
		const options = importerOptions(selection);
		expect(options).toEqual({ sources: [], fields: [], fieldSources: { title: 'tmdb' }, artwork: 'remote' });
		selection.sources.push('collaps'); selection.fields.push('title'); selection.fieldSources.title = 'collaps';
		expect(options).toEqual({ sources: [], fields: [], fieldSources: { title: 'tmdb' }, artwork: 'remote' });
		expect(importerFieldGroups.flatMap(group => group.fields).sort()).toEqual([...importerFields].sort());
	});
	it('normalizes compact filters and preserves zero thresholds and local artwork', () => {
		const selection = importerSelection({ filters: { yearFrom: 2020, ratingMin: 0 }, artwork: 'local-webp' });
		selection.filters.genres = ' Драма, Драма,  Научная  фантастика ';
		expect(importerOptions(selection).filters).toEqual({ yearFrom: 2020, ratingMin: 0, genres: ['Драма', 'Научная фантастика'] });
		expect(importerOptions(selection).artwork).toBe('local-webp');
		expect(importerFiltersValid(selection)).toBe(true);
		selection.filters.yearTo = '2019'; expect(importerFiltersValid(selection)).toBe(false);
		selection.filters.yearTo = '2025'; selection.filters.ratingMin = '11'; expect(importerFiltersValid(selection)).toBe(false);
		selection.filters.ratingMin = '8'; selection.filters.genres = 'a'.repeat(101); expect(importerFiltersValid(selection)).toBe(false);
	});
	it('accepts exact IMDb IDs and card links without confusing spoofed hosts', () => {
		expect(importerImdbId('tt1234567')).toBe('tt1234567');
		expect(importerImdbId('tt12345')).toBe('tt12345');
		expect(importerImdbId('https://www.imdb.com/title/tt1234567/?ref=x')).toBe('tt1234567');
		expect(importerImdbId('https://imdb.com.evil.example/title/tt1234567/')).toBeNull();
		expect(importerImdbId('https://token@imdb.com/title/tt1234567/')).toBeNull();
		expect(importerReference('collaps', 'tv', 'tt1234567')).toEqual({ source: 'collaps', mediaType: 'tv', externalId: 'imdb:tt1234567' });
		expect(importerReference('tmdb', 'movie', 'imdb:tt1234567')).toEqual({ source: 'tmdb', mediaType: 'movie', externalId: 'imdb:tt1234567' });
		expect(importerReference('alloha', 'movie', 'tt1234567')).toBeNull();
	});
	it('deduplicates selected work IDs and rejects unbounded or malformed batches', () => {
		expect(importerWorkIds('abc123, def456\nabc123')).toEqual(['abc123', 'def456']);
		expect(importerWorkIds('')).toBeNull();
		expect(importerWorkIds('abc/def')).toBeNull();
		expect(importerWorkIds(Array.from({ length: 101 }, (_, index) => `id${index}`).join('\n'))).toBeNull();
	});
	it('renders only allowed plain facts and safe homepage links', () => {
		expect(taxonomyFacts({ biography: 'Biography', birthday: '2000-01-01', aliases: ['One', 1, 'Two'], homepage: 'https://example.org/person', token: 'secret', _provenance: {} })).toEqual([{ key: 'birthday', value: '2000-01-01' }, { key: 'aliases', value: 'One, Two' }, { key: 'homepage', value: 'example.org', href: 'https://example.org/person' }]);
		expect(taxonomyFacts({ homepage: 'javascript:alert(1)' })).toEqual([]);
		expect(taxonomyFacts({ homepage: 'https://password@example.org' })).toEqual([]);
	});
	it('does not create locks for untouched person facts and supports explicit clearing', () => {
		const form = { originalName: '', birthday: '2000-01-01', deathday: '', placeOfBirth: '', homepage: '', biography: 'Bio', aliases: 'Alias' };
		const original = { birthday: '2000-01-01', biography: 'Bio', aliases: ['Alias'], identityQuality: 'verified' };
		expect(taxonomyPersonChanges(form, original)).toEqual({});
		form.biography = ''; form.aliases = ''; form.originalName = 'New Name';
		expect(taxonomyPersonChanges(form, original)).toEqual({ biography: null, aliases: [], originalName: 'New Name' });
	});
	it('omits untouched optional base fields while preserving explicit clears', () => {
		const form = { slug: 'person', description: 'Imported biography', imageUrl: 'https://example.org/person.jpg', parentId: '' };
		const original = { ...form, parentId: null };
		expect(taxonomyBaseChanges(form, original)).toEqual({});
		form.description = ''; form.imageUrl = ''; form.slug = 'new-slug';
		expect(taxonomyBaseChanges(form, original)).toEqual({ slug: 'new-slug', description: null, imageUrl: null });
		expect(taxonomyBaseChanges({ slug: '', description: '', imageUrl: '', parentId: '' }, null)).toEqual({ description: null, imageUrl: null, parentId: null });
	});
	it('snapshots global player labels without changing provider identities', () => {
		const providers: ImportPlaybackProvider[] = [{ source: 'collaps', label: ' Cinema ', enabled: false, position: 1 }, { source: 'alloha', label: 'Alloha', enabled: true, position: 0 }];
		const result = importerPlaybackSettings(providers);
		expect(result?.providers).toEqual([{ source: 'alloha', label: 'Alloha', enabled: true, position: 0 }, { source: 'collaps', label: 'Cinema', enabled: false, position: 1 }]);
		providers[0].label = 'Changed'; expect(result?.providers[1].label).toBe('Cinema');
		expect(importerPlaybackSettings([providers[0]])).toBeNull();
		expect(importerPlaybackSettings([providers[0], { ...providers[1], source: 'collaps' }])).toBeNull();
		expect(importerPlaybackSettings([providers[0], { ...providers[1], position: 1 }])).toBeNull();
		for (const label of ['', ' '.repeat(2), 'x'.repeat(41), 'private\nvalue', 'private\u0085value']) expect(importerPlaybackSettings([{ ...providers[0], label }, providers[1]])).toBeNull();
	});
	it('adds effective work pages without losing earlier cards or distinct roles', () => {
		const make = (id: string, role: string | null): TaxonomyWork => ({ id, slug: id, title: id, releaseYear: null, posterPath: null, kind: 'movie', role });
		const first = [make('one', 'actor')];
		expect(taxonomyAppendWorks(first, [make('one', 'actor'), make('one', 'director'), make('two', null), make('two', '')])).toEqual([make('one', 'actor'), make('one', 'director'), make('two', null)]);
		expect(taxonomyAppendWorks(first, [])).toEqual(first);
		expect(first).toHaveLength(1);
	});
	it('validates bounded collection IDs without guessing references or importing names', () => {
		expect(importerCollectionIds(' 12, 34\n12 ')).toEqual(['12', '34']);
		expect(importerCollectionIds('')).toEqual([]);
		for (const text of ['0', '012', 'movie:12', 'https://example.org/12', '1'.repeat(17), Array.from({ length: 101 }, (_, index) => String(index + 1)).join('\n')]) expect(importerCollectionIds(text)).toBeNull();
	});
	it('separates maintenance kinds and snapshots only permitted bounded options', () => {
		const form = { kind: 'collection-backfill' as const, source: 'collaps' as const, collectionIds: '12\n12\n34', batchLimit: 20, timeBudgetSeconds: 60 };
		const result = importerMaintenanceRequest(form);
		expect(result).toEqual({ kind: 'collection-backfill', source: 'collaps', options: { collectionIds: ['12', '34'] }, batchLimit: 20, timeBudgetSeconds: 60 });
		form.collectionIds = '56'; expect(result?.options?.collectionIds).toEqual(['12', '34']);
		expect(importerMaintenanceRequest({ ...form, collectionIds: '' })).toEqual({ kind: 'collection-backfill', source: 'collaps', batchLimit: 20, timeBudgetSeconds: 60 });
		expect(importerMaintenanceRequest({ ...form, kind: 'collections-dictionary', collectionIds: 'ignored' })?.options).toBeUndefined();
		expect(importerMaintenanceRequest({ ...form, kind: 'person-enrichment', source: 'tmdb', collectionIds: 'ignored' })?.options).toBeUndefined();
		expect(importerMaintenanceRequest({ ...form, kind: 'person-enrichment' })).toBeNull();
		expect(importerMaintenanceRequest({ ...form, source: 'tmdb' })).toBeNull();
		for (const batchLimit of [19, 51, NaN, 20.5]) expect(importerMaintenanceRequest({ ...form, batchLimit })).toBeNull();
		for (const timeBudgetSeconds of [9, 121, Infinity, 10.5]) expect(importerMaintenanceRequest({ ...form, timeBudgetSeconds })).toBeNull();
	});
	it('submits only edited collection presentation settings, preserving provenance', () => {
		expect(taxonomyCollectionChanges({ semanticKind: 'theme', isEnabled: true }, { collectionKind: 'provider', _zalip: {} })).toEqual({});
		expect(taxonomyCollectionChanges({ semanticKind: 'franchise', isEnabled: false }, { semanticKind: 'theme', isEnabled: true, collectionKind: 'provider' })).toEqual({ semanticKind: 'franchise', isEnabled: false });
		expect(taxonomyCollectionChanges({ semanticKind: 'platform', isEnabled: false }, { semanticKind: 'platform', isEnabled: false })).toEqual({});
	});
	it('preserves the new-title-only player filter without introducing it by default', () => {
		expect(importerOptions(importerSelection()).filters).toBeUndefined();
		const selection = importerSelection({ filters: { requirePlayer: true } });
		expect(importerOptions(selection).filters).toEqual({ requirePlayer: true });
		selection.filters.requirePlayer = false;
		expect(importerOptions(selection).filters).toBeUndefined();
	});
	it('humanizes only the closed maintenance warning codes', () => {
		expect(importerWarningLabel('dictionary-pagination-uncertain')).toBe(i18n.ts.zalip._importer.warningDictionaryPagination);
		expect(importerWarningLabel('collection-identity-conflict')).toBe(i18n.ts.zalip._importer.warningCollectionConflict);
		expect(importerWarningLabel('collection-field-locked')).toBe(i18n.ts.zalip._importer.warningCollectionLocked);
		expect(importerWarningLabel('person-id-missing')).toBe(i18n.ts.zalip._importer.warningPersonIdMissing);
		expect(importerWarningLabel('__proto__')).toBe(i18n.ts.zalip._importer.warningGeneric);
		expect(importerWarningLabel('collection-identity-conflict:private')).toBe(i18n.ts.zalip._importer.warningGeneric);
	});
	it('refreshes details only while the list sequence remains ready', async () => {
		const calls: string[] = [];
		const list = async (): Promise<void> => { calls.push('list'); };
		const show = async (): Promise<void> => { calls.push('show'); };
		await importerRefreshSequence(list, show, () => false);
		expect(calls).toEqual([]);
		await importerRefreshSequence(list, show, () => true);
		expect(calls).toEqual(['list', 'show']);
	});
	it('does not leave actions blocked when delayed list and show reads overlap an action', async () => {
		const deferred = <T,>() => {
			let resolve!: (value: T) => void;
			const promise = new Promise<T>(done => { resolve = done; });
			return { promise, resolve };
		};
		const list = deferred<void>();
		const show = deferred<string>();
		const action = deferred<string>();
		const state = importerRequestState();
		const revision = importerRequestStart(state);
		let current = 'running';
		let busy = false;
		let subsequentShows = 0;
		const pendingShow = show.promise.then(value => {
			if (importerRequestCurrent(state, revision)) current = value;
		}).finally(() => { importerRequestFinish(state, revision); });
		const refresh = importerRefreshSequence(() => list.promise, async () => { subsequentShows++; }, () => !busy);
		busy = true;
		const pendingAction = action.promise.then(value => {
			importerRequestInvalidate(state);
			current = value;
			busy = false;
		});
		list.resolve();
		await refresh;
		expect(subsequentShows).toBe(0);
		action.resolve('cancelled');
		await pendingAction;
		expect(state.loading).toBe(false);
		expect(state.error).toBe('');
		show.resolve('running');
		await pendingShow;
		expect(current).toBe('cancelled');
		expect(state.loading).toBe(false);
	});
	it('invalidates a stale request without letting its completion stop a newer request', () => {
		const state = importerRequestState();
		const first = importerRequestStart(state);
		state.error = 'previous';
		importerRequestInvalidate(state);
		expect(importerRequestCurrent(state, first)).toBe(false);
		expect(state).toEqual({ revision: 2, loading: false, error: '' });
		const second = importerRequestStart(state);
		importerRequestFinish(state, first);
		expect(state.loading).toBe(true);
		importerRequestFinish(state, second);
		expect(state.loading).toBe(false);
	});
	it('snapshots visible native-admin credentials without migrating unchanged environment keys', () => {
		const settings: ImportServiceSettings = { source: 'alloha', apiOrigin: 'https://api.service.org', playerOrigin: 'https://player.service.org', apiToken: 'fixture-api', apiTokenSet: true, apiTokenOrigin: 'environment', playerToken: 'fixture-player', playerTokenSet: true, playerTokenOrigin: 'environment', updatedAt: null };
		const form = importerServiceForm(settings);
		expect(form.apiToken).toBe('fixture-api');
		expect(form.playerToken).toBe('fixture-player');
		expect(importerServiceRequest(settings, form)).toEqual({ source: 'alloha', apiOrigin: settings.apiOrigin, playerOrigin: settings.playerOrigin });
		form.apiOrigin = 'https://new.service.org/';
		form.apiToken = ''; form.playerToken = '';
		expect(importerServiceRequest(settings, form)).toEqual({ source: 'alloha', apiOrigin: 'https://new.service.org', playerOrigin: settings.playerOrigin });
		expect(settings.apiOrigin).toBe('https://api.service.org');
		expect(settings.apiToken).toBe('fixture-api');
	});
	it('keeps replacement and explicit disabling separate and limits player-token writes to Alloha', () => {
		const settings: ImportServiceSettings = { source: 'alloha', apiOrigin: 'https://api.service.org', playerOrigin: 'https://player.service.org', apiToken: 'fixture-api', apiTokenSet: true, apiTokenOrigin: 'database', playerToken: 'fixture-player', playerTokenSet: true, playerTokenOrigin: 'database', updatedAt: null };
		const form = importerServiceForm(settings);
		form.apiToken = ' new-api '; form.playerToken = 'new-player';
		expect(importerServiceRequest(settings, form)).toMatchObject({ apiToken: 'new-api', playerToken: 'new-player' });
		form.clearApiToken = true;
		expect(importerServiceRequest(settings, form)).toBeNull();
		form.apiToken = ''; form.playerToken = ''; form.clearPlayerToken = true;
		expect(importerServiceRequest(settings, form)).toEqual({ source: 'alloha', apiOrigin: settings.apiOrigin, playerOrigin: settings.playerOrigin, clearApiToken: true, clearPlayerToken: true });
		const collaps = { ...settings, source: 'collaps' as const };
		expect(importerServiceRequest(collaps, importerServiceForm(collaps))).toEqual({ source: 'collaps', apiOrigin: settings.apiOrigin, playerOrigin: settings.playerOrigin });
	});
	it('preserves each unsaved form baseline when saving another source after a concurrent rotation', () => {
		const original: ImportServiceSettings = { source: 'collaps', apiOrigin: 'https://api.service.org', playerOrigin: 'https://player.service.org', apiToken: 'fixture-original', apiTokenSet: true, apiTokenOrigin: 'database', playerToken: null, playerTokenSet: false, playerTokenOrigin: 'none', updatedAt: null };
		const tmdb = { ...original, source: 'tmdb' as const, playerOrigin: null };
		const previous = { encryptionReady: true, sources: [tmdb, original] };
		const form = importerServiceForm(original);
		form.apiOrigin = 'https://edited.service.org';
		const rotated = { ...original, apiToken: 'fixture-rotated', updatedAt: '2026-10-12T00:00:00Z' };
		const saved = { ...tmdb, apiOrigin: 'https://saved.service.org' };
		const result = { encryptionReady: false, sources: [saved, rotated] };
		const merged = importerServiceSettingsUpdate(previous, result, 'tmdb');
		expect(merged.encryptionReady).toBe(false);
		expect(merged.sources.find(entry => entry.source === 'tmdb')).toEqual(saved);
		const preserved = merged.sources.find(entry => entry.source === 'collaps')!;
		expect(preserved).toEqual(original);
		expect(importerServiceRequest(preserved, form)).toEqual({ source: 'collaps', apiOrigin: 'https://edited.service.org', playerOrigin: original.playerOrigin });
		form.apiToken = 'fixture-intentionally-edited';
		expect(importerServiceRequest(preserved, form)?.apiToken).toBe('fixture-intentionally-edited');
		expect(result.sources[1]).toEqual(rotated);
		expect(previous.sources[1]).toEqual(original);
	});
	it('refreshes all service baselines only on an explicit full settings reload', () => {
		const entry: ImportServiceSettings = { source: 'alloha', apiOrigin: 'https://api.service.org', playerOrigin: 'https://player.service.org', apiToken: 'fixture-old', apiTokenSet: true, apiTokenOrigin: 'database', playerToken: 'fixture-player-old', playerTokenSet: true, playerTokenOrigin: 'database', updatedAt: null };
		const result = { encryptionReady: true, sources: [{ ...entry, apiToken: 'fixture-new', playerToken: 'fixture-player-new' }] };
		const reloaded = importerServiceSettingsUpdate({ encryptionReady: true, sources: [entry] }, result);
		expect(reloaded).toEqual(result);
		expect(reloaded.sources[0]).not.toBe(result.sources[0]);
		expect(importerServiceRequest(reloaded.sources[0], importerServiceForm(reloaded.sources[0]))).toEqual({ source: 'alloha', apiOrigin: entry.apiOrigin, playerOrigin: entry.playerOrigin });
		expect(importerServiceSettingsUpdate(null, result)).toEqual(result);
	});
	it('validates replacement Alloha iframe credentials without resubmitting unchanged legacy values', () => {
		const entry: ImportServiceSettings = { source: 'alloha', apiOrigin: 'https://api.service.org', playerOrigin: 'https://player.service.org', apiToken: null, apiTokenSet: false, apiTokenOrigin: 'none', playerToken: 'fixture:legacy-player', playerTokenSet: true, playerTokenOrigin: 'environment', updatedAt: null };
		const form = importerServiceForm(entry);
		expect(importerServiceRequest(entry, form)).toEqual({ source: 'alloha', apiOrigin: entry.apiOrigin, playerOrigin: entry.playerOrigin });
		for (const value of ['short', 'fixture.invalid', 'x'.repeat(513)]) { form.playerToken = value; expect(importerServiceRequest(entry, form)).toBeNull(); }
		for (const value of ['12345678', 'fixture-player_key', 'x'.repeat(512)]) { form.playerToken = value; expect(importerServiceRequest(entry, form)?.playerToken).toBe(value); }
		form.playerToken = '';
		expect(importerServiceRequest(entry, form)).toEqual({ source: 'alloha', apiOrigin: entry.apiOrigin, playerOrigin: entry.playerOrigin });
	});
	it('accepts public HTTPS origins only, with server DNS checks remaining authoritative', () => {
		expect(importerServiceOrigin(' https://API.service.org/ ')).toBe('https://api.service.org');
		for (const value of ['http://api.service.org', 'https://key@api.service.org', 'https://api.service.org:443', 'https://api.service.org:8443', 'https://api.service.org/path', 'https://api.service.org?token=fixture', 'https://api.service.org#fixture', 'https://api.service.org?', 'https://127.0.0.1', 'https://[::1]', 'https://localhost', 'https://host.local', 'https://api.service.org\n/path', 'javascript:fixture']) expect(importerServiceOrigin(value)).toBeNull();
	});
	it('bounds service credentials without accepting whitespace or control characters inside them', () => {
		const settings: ImportServiceSettings = { source: 'tmdb', apiOrigin: 'https://api.service.org', playerOrigin: null, apiToken: null, apiTokenSet: false, apiTokenOrigin: 'none', playerToken: null, playerTokenSet: false, playerTokenOrigin: 'none', updatedAt: null };
		const form = importerServiceForm(settings);
		for (const apiToken of ['x'.repeat(4097), 'fixture token', 'fixture\nvalue', 'fixture\u0000value', 'fixture\u0085value']) { form.apiToken = apiToken; expect(importerServiceRequest(settings, form)).toBeNull(); }
		form.apiToken = 'x'.repeat(4096);
		expect(importerServiceRequest(settings, form)?.apiToken).toHaveLength(4096);
		form.apiToken = ''; form.playerOrigin = 'https://ignored.service.org'; form.playerToken = 'ignored-player'; form.clearPlayerToken = true;
		expect(importerServiceRequest(settings, form)).toEqual({ source: 'tmdb', apiOrigin: settings.apiOrigin });
	});
});
