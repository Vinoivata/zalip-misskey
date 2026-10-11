/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ImportProviderError } from '@/core/zalip-importer/providers.js';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipImporterService } from '@/core/ZalipImporterService.js';
import type { ZalipImporterDiagnosticsService } from '@/core/ZalipImporterDiagnosticsService.js';
import type { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import type { MiLocalUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';
import { assertImporterAdministrator, importerApiErrors, safeImporterCall } from './importer-common.js';
import Sources, { meta as sourcesMeta } from './admin/importer/sources.js';
import SourceCheck, { meta as sourceCheckMeta } from './admin/importer/sources/check.js';
import Diagnostics, { meta as diagnosticsMeta } from './admin/importer/diagnostics.js';
import Resolve, { meta as resolveMeta } from './admin/importer/resolve.js';
import Search, { meta as searchMeta } from './admin/importer/search.js';
import Preview, { meta as previewMeta } from './admin/importer/preview.js';
import CreateRun, { meta as createRunMeta } from './admin/importer/runs/create.js';
import ListRuns, { meta as listRunsMeta } from './admin/importer/runs/list.js';
import ShowRun, { meta as showRunMeta } from './admin/importer/runs/show.js';
import ActionRun, { meta as actionRunMeta } from './admin/importer/runs/action.js';
import ListSchedules, { meta as listSchedulesMeta } from './admin/importer/schedules/list.js';
import SaveSchedule, { meta as saveScheduleMeta } from './admin/importer/schedules/save.js';
import RunSchedule, { meta as runScheduleMeta } from './admin/importer/schedules/run.js';
import ActionSchedule, { meta as actionScheduleMeta } from './admin/importer/schedules/action.js';
import ShowWorkState, { meta as showWorkStateMeta } from './admin/importer/work-state/show.js';
import SaveWorkState, { meta as saveWorkStateMeta } from './admin/importer/work-state/save.js';
import AdminListTaxonomy, { meta as adminListTaxonomyMeta } from './admin/importer/taxonomy/list.js';
import AdminShowTaxonomy, { meta as adminShowTaxonomyMeta } from './admin/importer/taxonomy/show.js';
import SaveTaxonomy, { meta as saveTaxonomyMeta } from './admin/importer/taxonomy/save.js';
import LinkTaxonomy, { meta as linkTaxonomyMeta } from './admin/importer/taxonomy/link.js';
import ListTaxonomy, { meta as listTaxonomyMeta } from './taxonomy/list.js';
import ShowTaxonomy, { meta as showTaxonomyMeta } from './taxonomy/show.js';
import Playback, { meta as playbackMeta } from './playback/sources.js';

// Exercise endpoint executors with dependency fakes, without Nest/DB/Redis/network initialization.
vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipImporterService.js', () => ({ ZalipImporterService: class {} }));
vi.mock('@/core/ZalipImporterDiagnosticsService.js', () => ({ ZalipImporterDiagnosticsService: class {} }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;
const ref = { source: 'tmdb', externalId: '123', mediaType: 'movie' } as const;
const profile = { name: 'Metadata', enabled: true, source: 'tmdb', mode: 'metadata', intervalMinutes: 60 };

function role(administrator: boolean): RoleService {
	return { isAdministrator: vi.fn().mockResolvedValue(administrator) } as unknown as RoleService;
}

function importer() {
	return {
		sources: vi.fn().mockReturnValue({ sources: [] }),
		search: vi.fn().mockResolvedValue({ items: [], page: 1, hasMore: false }),
		preview: vi.fn().mockResolvedValue({ record: {}, workId: null, changes: [], warnings: [] }),
		createRun: vi.fn().mockResolvedValue({ id: 'run01', state: 'queued' }),
		listRuns: vi.fn().mockResolvedValue({ runs: [] }),
		showRun: vi.fn().mockResolvedValue({ run: {}, items: [] }),
		actionRun: vi.fn().mockResolvedValue({ id: 'run01', state: 'paused' }),
		listProfiles: vi.fn().mockResolvedValue({ profiles: [] }),
		saveProfile: vi.fn().mockResolvedValue({ id: 'profile01' }),
		runProfile: vi.fn().mockResolvedValue({ id: 'run01', state: 'queued' }),
		actionProfile: vi.fn().mockResolvedValue({ id: 'profile01', profile: {} }),
		showWorkState: vi.fn().mockResolvedValue({ workId: 'work01', title: 'Work', locks: [], fields: [] }),
		saveWorkState: vi.fn().mockResolvedValue({ workId: 'work01', title: 'Work', locks: [], fields: [] }),
		playback: vi.fn().mockResolvedValue({ sources: [] }),
	};
}

function diagnostics() {
	return {
		statistics: vi.fn().mockResolvedValue({ subscriptions: { total: 0, works: 0 }, availability: { total: 0, pendingPublished: 0, oldestPendingAt: null }, releases: { total: 0, pendingPublished: 0, oldestPendingAt: null } }),
		resolve: vi.fn().mockResolvedValue({ ref, title: 'Title', releaseYear: 2020, posterUrl: null }),
		check: vi.fn().mockResolvedValue({ source: 'tmdb', configured: true, checkedAt: '2026-10-11T00:00:00.000Z', latencyMs: 5, ok: true, error: null, cached: false }),
	};
}

function taxonomy() {
	return {
		listEntries: vi.fn().mockResolvedValue([]),
		showEntry: vi.fn().mockResolvedValue({ entry: {}, works: [] }),
		listWorkEntries: vi.fn().mockResolvedValue([]),
		saveEntry: vi.fn().mockResolvedValue({ id: 'entry01' }),
		linkWork: vi.fn().mockResolvedValue(undefined),
		unlinkWork: vi.fn().mockResolvedValue(undefined),
	};
}

const importerAsService = (service: ReturnType<typeof importer>) => service as unknown as ZalipImporterService;
const taxonomyAsService = (service: ReturnType<typeof taxonomy>) => service as unknown as ZalipTaxonomyService;
const diagnosticsAsService = (service: ReturnType<typeof diagnostics>) => service as unknown as ZalipImporterDiagnosticsService;

describe('importer API permissions and contracts', () => {
	test('all administrator endpoints require credentials and appropriate token permission', () => {
		for (const meta of [sourcesMeta, sourceCheckMeta, diagnosticsMeta, resolveMeta, showWorkStateMeta, searchMeta, previewMeta, listRunsMeta, showRunMeta, listSchedulesMeta, adminListTaxonomyMeta, adminShowTaxonomyMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.kind).toBe('read:account');
		}
		for (const meta of [createRunMeta, actionRunMeta, saveScheduleMeta, runScheduleMeta, actionScheduleMeta, saveWorkStateMeta, saveTaxonomyMeta, linkTaxonomyMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.kind).toBe('write:account');
			expect(meta.prohibitMoved).toBe(true);
		}
		expect(listTaxonomyMeta.requireCredential).toBe(false);
		expect(showTaxonomyMeta.requireCredential).toBe(false);
		expect(playbackMeta.requireCredential).toBe(true);
		expect(playbackMeta.kind).toBe('read:account');
	});

	test('all administrator executors deny ordinary users before accessing a service', async () => {
		const service = importer();
		const catalog = taxonomy();
		const checks = diagnostics();
		const denied = role(false);
		const cases = [
			[new Sources(denied, importerAsService(service)), {}],
			[new SourceCheck(denied, diagnosticsAsService(checks)), { source: 'tmdb' }],
			[new Diagnostics(denied, diagnosticsAsService(checks)), {}],
			[new Resolve(denied, diagnosticsAsService(checks)), { source: 'tmdb', imdbId: 'tt1234567', mediaType: 'movie' }],
			[new ShowWorkState(denied, importerAsService(service)), { workId: 'work01' }],
			[new SaveWorkState(denied, importerAsService(service)), { workId: 'work01', lockedFields: [] }],
			[new Search(denied, importerAsService(service)), { source: 'tmdb', query: 'title' }],
			[new Preview(denied, importerAsService(service)), { ref }],
			[new CreateRun(denied, importerAsService(service)), { refs: [ref], mode: 'import' }],
			[new ListRuns(denied, importerAsService(service)), {}],
			[new ShowRun(denied, importerAsService(service)), { runId: 'run01' }],
			[new ActionRun(denied, importerAsService(service)), { runId: 'run01', action: 'pause' }],
			[new ListSchedules(denied, importerAsService(service)), {}],
			[new SaveSchedule(denied, importerAsService(service)), profile],
			[new RunSchedule(denied, importerAsService(service)), { profileId: 'profile01' }],
			[new ActionSchedule(denied, importerAsService(service)), { profileId: 'profile01', action: 'disable' }],
			[new AdminListTaxonomy(denied, taxonomyAsService(catalog)), {}],
			[new AdminShowTaxonomy(denied, taxonomyAsService(catalog)), { entryId: 'entry01' }],
			[new SaveTaxonomy(denied, taxonomyAsService(catalog)), { type: 'genre', name: 'Drama' }],
			[new LinkTaxonomy(denied, taxonomyAsService(catalog)), { entryId: 'entry01', workId: 'work01' }],
		] as const;
		for (const [endpoint, params] of cases) {
			await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		}
		for (const method of [...Object.values(service), ...Object.values(catalog), ...Object.values(checks)]) expect(method).not.toHaveBeenCalled();
	});

	test('search forwards typed parameters but never the body authentication token', async () => {
		const service = importer();
		const endpoint = new Search(role(true), importerAsService(service));
		await endpoint.exec({ i: 'body-auth-placeholder', source: 'tmdb', query: 'title' }, user, null);
		expect(service.search).toHaveBeenCalledWith('tmdb', 'title', 1, undefined);
		await expect(endpoint.exec({ source: 'unknown', query: 'title' }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({ source: 'tmdb', query: 'title', token: 'unexpected' }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(searchMeta.limit.max).toBeLessThanOrEqual(10);
		expect(previewMeta.limit.max).toBeLessThanOrEqual(6);
	});

	test('run creation strips authentication, rejects ambiguity and caps batch size', async () => {
		const service = importer();
		const endpoint = new CreateRun(role(true), importerAsService(service));
		await endpoint.exec({ i: 'body-auth-placeholder', refs: [ref], mode: 'import', lockedFields: ['title'], categoryIds: ['entry01'] }, user, null);
		expect(service.createRun).toHaveBeenCalledWith({ refs: [ref], workIds: undefined, mode: 'import', lockedFields: ['title'], categoryIds: ['entry01'], profileId: undefined, options: undefined }, user.id);
		for (const params of [
			{ mode: 'import' }, { mode: 'import', refs: [] },
			{ mode: 'import', refs: [ref], workIds: ['work01'] },
			{ mode: 'import', refs: [ref], lockedFields: ['secret'] },
			{ mode: 'import', refs: [{ ...ref, externalId: 'https://private.invalid' }] },
			{ mode: 'import', refs: [{ ...ref, apiToken: 'unexpected' }] },
			{ mode: 'import', workIds: Array.from({ length: 101 }, (_, index) => 'work' + index) },
		]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.createRun).toHaveBeenCalledTimes(1);
	});

	test('schedule and taxonomy writes use an explicit allowlist', async () => {
		const service = importer();
		const catalog = taxonomy();
		const schedule = new SaveSchedule(role(true), importerAsService(service));
		await schedule.exec({ ...profile, i: 'body-auth-placeholder' }, user, null);
		expect(service.saveProfile.mock.calls[0][0]).not.toHaveProperty('i');
		await expect(schedule.exec({ ...profile, intervalMinutes: 14 }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(schedule.exec({ ...profile, intervalMinutes: 43201 }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		const save = new SaveTaxonomy(role(true), taxonomyAsService(catalog));
		await save.exec({ type: 'category', name: 'Movies', data: { rules: { kinds: ['movie'], yearFrom: 2020 } } }, user, null);
		for (const data of [{ _zalip: { manualFields: [] } }, { token: 'unexpected' }, { rules: { kinds: ['bad'] } }]) {
			await expect(save.exec({ type: 'category', name: 'Movies', data }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		}
		expect(catalog.saveEntry).toHaveBeenCalledTimes(1);
	});

	test('preview, run and schedule options preserve explicit empty selections without accepting secrets', async () => {
		const service = importer();
		const preview = new Preview(role(true), importerAsService(service));
		const create = new CreateRun(role(true), importerAsService(service));
		const schedule = new SaveSchedule(role(true), importerAsService(service));
		const options = { sources: [], fields: [], fieldSources: { description: 'kinopoisk' }, filters: { kinds: ['movie'], yearFrom: 2020, ratingMin: 0, genres: ['Драма'], countries: ['Япония'] }, artwork: 'local-webp' };
		await preview.exec({ i: 'body-auth-placeholder', ref, workId: 'work01', options }, user, null);
		expect(service.preview).toHaveBeenCalledWith(ref, 'work01', options);
		await create.exec({ i: 'body-auth-placeholder', refs: [{ ...ref, externalId: 'imdb:tt1234567' }], mode: 'import', options }, user, null);
		expect(service.createRun.mock.calls[0][0]).toMatchObject({ refs: [{ ...ref, externalId: 'imdb:tt1234567' }], options });
		expect(service.createRun.mock.calls[0][0]).not.toHaveProperty('i');
		await schedule.exec({ ...profile, options }, user, null);
		expect(service.saveProfile.mock.calls[0][0]).toMatchObject({ options });
		for (const invalid of [
			{ sources: ['bad'] }, { sources: ['tmdb', 'tmdb'] }, { fields: ['secret'] },
			{ fieldSources: { description: 'bad' } }, { fieldSources: { token: 'tmdb' } },
			{ apiKey: 'unexpected' }, { artwork: 'unsafe' },
			{ filters: { ratingMin: 11 } }, { filters: { yearFrom: 1887 } },
			{ filters: { yearTo: 3001 } }, { filters: { kinds: ['bad'] } },
			{ filters: { genres: Array.from({ length: 51 }, (_, index) => `Genre${index}`) } },
			{ filters: { genres: ['a'.repeat(101)] } }, { filters: { apiToken: 'unexpected' } },
		]) {
			await expect(preview.exec({ ref, options: invalid }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
			await expect(create.exec({ refs: [ref], mode: 'import', options: invalid }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
			await expect(schedule.exec({ ...profile, options: invalid }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		}
		expect(service.preview).toHaveBeenCalledTimes(1);
		expect(service.createRun).toHaveBeenCalledTimes(1);
		expect(service.saveProfile).toHaveBeenCalledTimes(1);
	});

	test('diagnostics is read-only and source checks allow provider names, not configuration overrides', async () => {
		const checks = diagnostics();
		const statistics = new Diagnostics(role(true), diagnosticsAsService(checks));
		const check = new SourceCheck(role(true), diagnosticsAsService(checks));
		await statistics.exec({ i: 'body-auth-placeholder' }, user, null);
		expect(checks.statistics).toHaveBeenCalledWith();
		await expect(statistics.exec({ deliverNow: true }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await check.exec({ i: 'body-auth-placeholder', source: 'collaps' }, user, null);
		expect(checks.check).toHaveBeenCalledWith('collaps');
		for (const params of [{}, { source: 'bad' }, { source: 'tmdb', apiKey: 'unexpected' }, { source: 'tmdb', url: 'https://private.invalid' }]) await expect(check.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(checks.check).toHaveBeenCalledTimes(1);
		expect(diagnosticsMeta.limit.max).toBeLessThanOrEqual(10);
		expect(sourceCheckMeta.limit.max).toBeLessThanOrEqual(10);
	});

	test('IMDb resolution requires an exact typed ID and a supported provider', async () => {
		const checks = diagnostics();
		const resolve = new Resolve(role(true), diagnosticsAsService(checks));
		await resolve.exec({ i: 'body-auth-placeholder', source: 'kinopoisk', imdbId: 'tt1234567', mediaType: 'tv' }, user, null);
		expect(checks.resolve).toHaveBeenCalledWith('kinopoisk', 'tt1234567', 'tv');
		for (const params of [
			{ source: 'alloha', imdbId: 'tt1234567', mediaType: 'movie' },
			{ source: 'tmdb', imdbId: '1234567', mediaType: 'movie' },
			{ source: 'tmdb', imdbId: 'https://www.imdb.com/title/tt1234567/', mediaType: 'movie' },
			{ source: 'tmdb', imdbId: 'tt1234567', mediaType: 'anime' },
			{ source: 'tmdb', imdbId: 'tt1234567', mediaType: 'movie', token: 'unexpected' },
			{ source: 'tmdb', imdbId: 'tt1234567' },
		]) await expect(resolve.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(checks.resolve).toHaveBeenCalledTimes(1);
		expect(resolveMeta.limit.max).toBeLessThanOrEqual(6);
	});

	test('schedule actions use allowlisted operations and enforce source-independent name bounds', async () => {
		const service = importer();
		const action = new ActionSchedule(role(true), importerAsService(service));
		for (const operation of ['enable', 'disable', 'reset-cursor', 'delete']) {
			await action.exec({ i: 'body-auth-placeholder', profileId: 'profile01', action: operation }, user, null);
			expect(service.actionProfile).toHaveBeenLastCalledWith('profile01', operation);
		}
		for (const params of [{ profileId: 'profile01', action: 'publish' }, { profileId: 'profile01', action: 'enable', source: 'tmdb' }, { action: 'delete' }]) await expect(action.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		const save = new SaveSchedule(role(true), importerAsService(service));
		await save.exec({ ...profile, name: 'n'.repeat(120), source: 'collaps', mode: 'discovery', enabled: false }, user, null);
		expect(service.saveProfile.mock.calls[0][0]).toMatchObject({ enabled: false, source: 'collaps', mode: 'discovery' });
		for (const params of [{ ...profile, name: 'n'.repeat(121) }, { ...profile, mode: 'collection', collectionId: 'a'.repeat(101) }, { ...profile, mode: 'autopublish' }]) await expect(save.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.actionProfile).toHaveBeenCalledTimes(4);
		expect(service.saveProfile).toHaveBeenCalledTimes(1);
	});

	test('persistent work protection saves an exact empty replacement, not additive run locks', async () => {
		const service = importer();
		const show = new ShowWorkState(role(true), importerAsService(service));
		const save = new SaveWorkState(role(true), importerAsService(service));
		await show.exec({ i: 'body-auth-placeholder', workId: 'work01' }, user, null);
		expect(service.showWorkState).toHaveBeenCalledWith('work01');
		await save.exec({ i: 'body-auth-placeholder', workId: 'work01', lockedFields: ['title', 'description'] }, user, null);
		expect(service.saveWorkState).toHaveBeenLastCalledWith('work01', ['title', 'description']);
		await save.exec({ workId: 'work01', lockedFields: [] }, user, null);
		expect(service.saveWorkState).toHaveBeenLastCalledWith('work01', []);
		for (const params of [{ workId: 'work01' }, { workId: 'work01', lockedFields: ['private'] }, { workId: 'work01', lockedFields: ['title', 'title'] }, { workId: 'work01', lockedFields: [], overwriteEditorial: true }]) await expect(save.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(show.exec({ workId: 'work01', token: 'unexpected' }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.saveWorkState).toHaveBeenCalledTimes(2);
	});

	test('new endpoint failures retain safe mappings without provider URLs or raw causes', async () => {
		const service = importer();
		const checks = diagnostics();
		const upstream = new Error('https://private.invalid?token=do-not-return', { cause: { apiKey: 'do-not-return' } });
		checks.statistics.mockRejectedValueOnce(upstream);
		checks.check.mockRejectedValueOnce(new ImportProviderError('rate-limited', 12345));
		checks.resolve.mockRejectedValueOnce(new ImportProviderError('not-found'));
		service.actionProfile.mockRejectedValueOnce(new Error('IMPORT_RUN_BUSY'));
		service.showWorkState.mockRejectedValueOnce(new Error('NO_SUCH_WORK'));
		service.saveWorkState.mockRejectedValueOnce(upstream);
		const cases = [
			[new Diagnostics(role(true), diagnosticsAsService(checks)), {}, 'ZALIP_IMPORT_UNAVAILABLE'],
			[new SourceCheck(role(true), diagnosticsAsService(checks)), { source: 'tmdb' }, 'ZALIP_IMPORT_RATE_LIMITED'],
			[new Resolve(role(true), diagnosticsAsService(checks)), { source: 'tmdb', imdbId: 'tt1234567', mediaType: 'movie' }, 'ZALIP_IMPORT_NOT_FOUND'],
			[new ActionSchedule(role(true), importerAsService(service)), { profileId: 'profile01', action: 'delete' }, 'ZALIP_IMPORT_CONFLICT'],
			[new ShowWorkState(role(true), importerAsService(service)), { workId: 'work01' }, 'ZALIP_IMPORT_NOT_FOUND'],
			[new SaveWorkState(role(true), importerAsService(service)), { workId: 'work01', lockedFields: [] }, 'ZALIP_IMPORT_UNAVAILABLE'],
		] as const;
		for (const [endpoint, params, expected] of cases) {
			const error: unknown = await endpoint.exec(params, user, null).then(() => null, value => value);
			expect(error).toBeInstanceOf(ApiError);
			expect(error).toMatchObject({ code: expected });
			expect(JSON.stringify(error)).not.toContain('private.invalid');
			expect(JSON.stringify(error)).not.toContain('do-not-return');
			expect(error).not.toHaveProperty('cause');
		}
	});

	test('public taxonomy can never request draft metadata', async () => {
		const catalog = taxonomy();
		const service = taxonomyAsService(catalog);
		const list = new ListTaxonomy(service);
		await list.exec({}, null, null);
		expect(catalog.listEntries).toHaveBeenCalledWith({ type: undefined, query: undefined, limit: 50, offset: 0, publishedOnly: true });
		await expect(list.exec({ publishedOnly: false }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		const show = new ShowTaxonomy(service);
		await show.exec({ workId: 'work01' }, null, null);
		expect(catalog.listWorkEntries).toHaveBeenCalledWith('work01', { publishedOnly: true });
		await show.exec({ slug: 'драма', type: 'genre' }, null, null);
		expect(catalog.showEntry).toHaveBeenCalledWith({ entryId: undefined, slug: 'драма', type: 'genre', limit: 100, publishedOnly: true });
		await expect(show.exec({ workId: 'work01', entryId: 'entry01' }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(show.exec({ entryId: 'entry01', publishedOnly: false }, null, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('admin taxonomy uses unpublished view and link removal calls only unlink', async () => {
		const catalog = taxonomy();
		const service = taxonomyAsService(catalog);
		await new AdminListTaxonomy(role(true), service).exec({}, user, null);
		expect(catalog.listEntries.mock.calls[0][0]).toMatchObject({ publishedOnly: false });
		await new AdminShowTaxonomy(role(true), service).exec({ workId: 'work01' }, user, null);
		expect(catalog.listWorkEntries).toHaveBeenCalledWith('work01', { publishedOnly: false });
		await new LinkTaxonomy(role(true), service).exec({ entryId: 'entry01', workId: 'work01', role: 'cast', remove: true }, user, null);
		expect(catalog.unlinkWork).toHaveBeenCalledWith({ entryId: 'entry01', workId: 'work01', role: 'cast' });
		expect(catalog.linkWork).not.toHaveBeenCalled();
	});

	test('playback accepts a work ID only and preserves published guard errors', async () => {
		const service = importer();
		const endpoint = new Playback(importerAsService(service));
		await endpoint.exec({ workId: 'work01' }, user, null);
		expect(service.playback).toHaveBeenCalledWith('work01');
		await expect(endpoint.exec({ workId: 'work01', publishedOnly: false }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		service.playback.mockRejectedValueOnce(new Error('NO_SUCH_WORK'));
		await expect(endpoint.exec({ workId: 'draft01' }, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_NOT_FOUND', httpStatusCode: 404 });
	});
});

describe('safe importer error mapping', () => {
	test('guard grants only an administrator', async () => {
		await expect(assertImporterAdministrator(role(true), user)).resolves.toBeUndefined();
		await expect(assertImporterAdministrator(role(false), user)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
	});
	test.each([
		['not-found', 'ZALIP_IMPORT_NOT_FOUND'],
		['not-configured', 'ZALIP_IMPORT_NOT_CONFIGURED'],
		['invalid-ref', 'ZALIP_IMPORT_INVALID'],
		['unsupported', 'ZALIP_IMPORT_INVALID'],
		['quota-exceeded', 'ZALIP_IMPORT_QUOTA_EXCEEDED'],
		['rate-limited', 'ZALIP_IMPORT_RATE_LIMITED'],
		['malformed-response', 'ZALIP_IMPORT_UNAVAILABLE'],
		['upstream-failure', 'ZALIP_IMPORT_UNAVAILABLE'],
	] as const)('maps %s without returning provider details', async (code, expected) => {
		await expect(safeImporterCall(() => { throw new ImportProviderError(code, 60000); })).rejects.toMatchObject({ code: expected });
	});
	test('unknown messages and error causes never enter the API response', async () => {
		const upstream = new Error('https://upstream.invalid?token=do-not-return', { cause: { headers: { Authorization: 'do-not-return' } } });
		try {
			await safeImporterCall(() => { throw upstream; });
			throw new Error('Expected safe API error');
		} catch (error) {
			expect(error).toBeInstanceOf(ApiError);
			expect((error as ApiError).code).toBe('ZALIP_IMPORT_UNAVAILABLE');
			expect(String(error)).not.toContain('do-not-return');
			expect(JSON.stringify(error)).not.toContain('upstream.invalid');
			expect(error).not.toHaveProperty('cause');
		}
	});
	test('known catalogue errors remain typed and existing API errors retain identity', async () => {
		await expect(safeImporterCall(() => { throw new Error('IMPORT_IDENTITY_CONFLICT'); })).rejects.toMatchObject({ code: 'ZALIP_IMPORT_CONFLICT' });
		await expect(safeImporterCall(() => { throw new Error('ZALIP_CATALOG_ENTRY_NOT_FOUND'); })).rejects.toMatchObject({ code: 'ZALIP_IMPORT_NOT_FOUND' });
		const error = new ApiError(importerApiErrors.invalid);
		await expect(safeImporterCall(() => { throw error; })).rejects.toBe(error);
	});
});
