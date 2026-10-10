/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ImportProviderError } from '@/core/zalip-importer/providers.js';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipImporterService } from '@/core/ZalipImporterService.js';
import type { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import type { MiLocalUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';
import { assertImporterAdministrator, importerApiErrors, safeImporterCall } from './importer-common.js';
import Sources, { meta as sourcesMeta } from './admin/importer/sources.js';
import Search, { meta as searchMeta } from './admin/importer/search.js';
import Preview, { meta as previewMeta } from './admin/importer/preview.js';
import CreateRun, { meta as createRunMeta } from './admin/importer/runs/create.js';
import ListRuns, { meta as listRunsMeta } from './admin/importer/runs/list.js';
import ShowRun, { meta as showRunMeta } from './admin/importer/runs/show.js';
import ActionRun, { meta as actionRunMeta } from './admin/importer/runs/action.js';
import ListSchedules, { meta as listSchedulesMeta } from './admin/importer/schedules/list.js';
import SaveSchedule, { meta as saveScheduleMeta } from './admin/importer/schedules/save.js';
import RunSchedule, { meta as runScheduleMeta } from './admin/importer/schedules/run.js';
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
		playback: vi.fn().mockResolvedValue({ sources: [] }),
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

describe('importer API permissions and contracts', () => {
	test('all administrator endpoints require credentials and appropriate token permission', () => {
		for (const meta of [sourcesMeta, searchMeta, previewMeta, listRunsMeta, showRunMeta, listSchedulesMeta, adminListTaxonomyMeta, adminShowTaxonomyMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.kind).toBe('read:account');
		}
		for (const meta of [createRunMeta, actionRunMeta, saveScheduleMeta, runScheduleMeta, saveTaxonomyMeta, linkTaxonomyMeta]) {
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
		const denied = role(false);
		const cases = [
			[new Sources(denied, importerAsService(service)), {}],
			[new Search(denied, importerAsService(service)), { source: 'tmdb', query: 'title' }],
			[new Preview(denied, importerAsService(service)), { ref }],
			[new CreateRun(denied, importerAsService(service)), { refs: [ref], mode: 'import' }],
			[new ListRuns(denied, importerAsService(service)), {}],
			[new ShowRun(denied, importerAsService(service)), { runId: 'run01' }],
			[new ActionRun(denied, importerAsService(service)), { runId: 'run01', action: 'pause' }],
			[new ListSchedules(denied, importerAsService(service)), {}],
			[new SaveSchedule(denied, importerAsService(service)), profile],
			[new RunSchedule(denied, importerAsService(service)), { profileId: 'profile01' }],
			[new AdminListTaxonomy(denied, taxonomyAsService(catalog)), {}],
			[new AdminShowTaxonomy(denied, taxonomyAsService(catalog)), { entryId: 'entry01' }],
			[new SaveTaxonomy(denied, taxonomyAsService(catalog)), { type: 'genre', name: 'Drama' }],
			[new LinkTaxonomy(denied, taxonomyAsService(catalog)), { entryId: 'entry01', workId: 'work01' }],
		] as const;
		for (const [endpoint, params] of cases) {
			await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		}
		for (const method of [...Object.values(service), ...Object.values(catalog)]) expect(method).not.toHaveBeenCalled();
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
		expect(service.createRun).toHaveBeenCalledWith({ refs: [ref], workIds: undefined, mode: 'import', lockedFields: ['title'], categoryIds: ['entry01'], profileId: undefined }, user.id);
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
