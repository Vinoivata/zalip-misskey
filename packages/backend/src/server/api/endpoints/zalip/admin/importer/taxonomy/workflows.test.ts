/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import type { ZalipPersonImportService } from '@/core/ZalipPersonImportService.js';
import type { MiLocalUser } from '@/models/User.js';
import PublicShow from '../../../taxonomy/show.js';
import EnrichPerson, { meta as enrichMeta } from './enrich-person.js';
import Recalculate, { meta as recalculateMeta } from './recalculate.js';
import Delete, { meta as deleteMeta } from './delete.js';
import Show from './show.js';
import Save from './save.js';
import ImportPerson, { meta as personMeta } from './import-person.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('@/core/ZalipPersonImportService.js', () => ({ ZalipPersonImportService: class {}, personImportWarnings: ['person-photo-local-unavailable'] }));

const user = { id: 'admin01' } as MiLocalUser;

function role(allowed: boolean): RoleService { return { isAdministrator: vi.fn().mockResolvedValue(allowed) } as unknown as RoleService; }

function taxonomy() { return { enrichPerson: vi.fn().mockResolvedValue({ entry: {}, changedFields: [] }), recalculateCategory: vi.fn().mockResolvedValue({ processed: 0, matched: 0, skipped: 0, nextCursor: null }), deleteEntry: vi.fn().mockResolvedValue(undefined), showEntry: vi.fn().mockResolvedValue({ entry: {}, works: [], nextCursor: null }), listWorkEntries: vi.fn().mockResolvedValue([]), saveEntry: vi.fn().mockResolvedValue({}) }; }

function asService(service: ReturnType<typeof taxonomy>): ZalipTaxonomyService { return service as unknown as ZalipTaxonomyService; }

function persons(service: object): ZalipPersonImportService { return service as ZalipPersonImportService; }

describe('taxonomy administration workflows', () => {
	test('all workflows require credentials and write permission', () => {
		for (const meta of [enrichMeta, personMeta, recalculateMeta, deleteMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.kind).toBe('write:account');
			expect(meta.prohibitMoved).toBe(true);
			expect(meta.limit.max).toBeLessThanOrEqual(10);
		}
	});

	test('ordinary users cannot enrich, recalculate or delete before any service or Redis access', async () => {
		const service = taxonomy();
		const cases = [
			[new EnrichPerson(role(false), persons(service)), { entryId: 'entry01', source: 'tmdb' }],
			[new ImportPerson(role(false), persons(service)), { source: 'tmdb', reference: '10' }],
			[new Recalculate(role(false), asService(service)), { entryId: 'entry01' }],
			[new Delete(role(false), asService(service)), { entryId: 'entry01' }],
		] as const;
		for (const [endpoint, params] of cases) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
	});

	test('enrichment forwards only canonical source and selected record ID', async () => {
		const service = taxonomy();
		const endpoint = new EnrichPerson(role(true), persons(service));
		await endpoint.exec({ entryId: 'entry01', source: 'tmdb', i: 'auth-placeholder' }, user, null);
		expect(service.enrichPerson).toHaveBeenCalledWith('entry01', 'tmdb');
		for (const params of [{ entryId: 'entry01', source: 'collaps' }, { entryId: 'entry01', source: 'tmdb', externalId: '10' }, { entryId: 'entry01', source: 'tmdb', token: 'unexpected' }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('standalone person import defaults to preview and only forwards bounded explicit identities', async () => {
		const service = { importPerson: vi.fn().mockResolvedValue({ preview: true }) };
		const endpoint = new ImportPerson(role(true), persons(service));
		await endpoint.exec({ source: 'tmdb', reference: 'https://www.themoviedb.org/person/10-name', i: 'auth-placeholder' }, user, null);
		expect(service.importPerson).toHaveBeenLastCalledWith('tmdb', 'https://www.themoviedb.org/person/10-name', true);
		await endpoint.exec({ source: 'kinopoisk', reference: '20', preview: false }, user, null);
		expect(service.importPerson).toHaveBeenLastCalledWith('kinopoisk', '20', false);
		for (const params of [{ source: 'collaps', reference: '10' }, { source: 'tmdb', reference: '' }, { source: 'tmdb', reference: 'a'.repeat(1025) }, { source: 'tmdb', reference: '10', preview: 'false' }, { source: 'tmdb', reference: '10', imageUrl: 'https://example.com/image.jpg' }, { source: 'tmdb', reference: '10', token: 'unexpected' }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.importPerson).toHaveBeenCalledTimes(2);
	});

	test('person import upstream failures use the closed native error contract', async () => {
		const service = { importPerson: vi.fn().mockRejectedValue(new Error('https://example.com/?api_key=fixture-secret')) };
		const error = await new ImportPerson(role(true), persons(service)).exec({ source: 'tmdb', reference: '10' }, user, null).catch(value => value);
		expect(error).toMatchObject({ code: 'ZALIP_IMPORT_UNAVAILABLE' });
		expect(JSON.stringify(error)).not.toContain('fixture-secret');
		expect(personMeta.res.properties.warnings.items.enum).toEqual(['person-photo-local-unavailable']);
	});

	test('recalculation bounds batches and rejects ambiguous work selection', async () => {
		const service = taxonomy();
		const endpoint = new Recalculate(role(true), asService(service));
		await endpoint.exec({ entryId: 'entry01', afterId: 'work01', limit: 10, i: 'auth-placeholder' }, user, null);
		expect(service.recalculateCategory).toHaveBeenCalledWith({ entryId: 'entry01', workIds: undefined, afterId: 'work01', limit: 10 });
		for (const params of [{ entryId: 'entry01', limit: 101 }, { entryId: 'entry01', workIds: [] }, { entryId: 'entry01', workIds: ['work01', 'work01'] }, { entryId: 'entry01', workIds: ['work01'], afterId: 'work02' }, { entryId: 'entry01', source: 'manual' }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.recalculateCategory).toHaveBeenCalledTimes(1);
	});

	test('deletion is an explicit administrative action without provider or catalogue-wide parameters', async () => {
		const service = taxonomy();
		const endpoint = new Delete(role(true), asService(service));
		await expect(endpoint.exec({ entryId: 'entry01' }, user, null)).resolves.toEqual({ deleted: true });
		expect(service.deleteEntry).toHaveBeenCalledWith('entry01');
		await expect(endpoint.exec({ entryId: 'entry01', all: true }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('public and admin show retain first-page and work lookup contracts while forwarding scoped cursors', async () => {
		const service = taxonomy();
		const endpoint = new PublicShow(asService(service));
		await expect(endpoint.exec({ entryId: 'entry01' }, null, null)).resolves.toEqual({ entry: {}, works: [], nextCursor: null });
		expect(service.showEntry).toHaveBeenLastCalledWith({ entryId: 'entry01', slug: undefined, type: undefined, limit: 100, cursor: undefined, publishedOnly: true });
		await endpoint.exec({ slug: 'collection', type: 'collection', cursor: 'opaque01', limit: 10 }, null, null);
		expect(service.showEntry).toHaveBeenLastCalledWith({ entryId: undefined, slug: 'collection', type: 'collection', limit: 10, cursor: 'opaque01', publishedOnly: true });
		await expect(endpoint.exec({ workId: 'work01' }, null, null)).resolves.toEqual({ entries: [] });
		const admin = new Show(role(true), asService(service));
		await admin.exec({ entryId: 'entry01', cursor: 'opaque01' }, user, null);
		expect(service.showEntry).toHaveBeenLastCalledWith({ entryId: 'entry01', slug: undefined, type: undefined, limit: 100, cursor: 'opaque01', publishedOnly: false });
	});

	test('cursor payloads are bounded and disallowed on work membership lookups, before service access', async () => {
		const service = taxonomy();
		for (const endpoint of [new PublicShow(asService(service)), new Show(role(true), asService(service))]) {
			for (const params of [{ entryId: 'entry01', cursor: '' }, { entryId: 'entry01', cursor: 'a'.repeat(2049) }, { entryId: 'entry01', cursor: 'not/valid' }, { workId: 'work01', cursor: 'opaque' }, { entryId: 'entry01', workId: 'work01', cursor: 'opaque' }, { entryId: 'entry01', limit: 101 }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		}
		expect(service.showEntry).not.toHaveBeenCalled();
		expect(service.listWorkEntries).not.toHaveBeenCalled();
	});

	test('collection semantic edits require admin permission and explicit validated values', async () => {
		const service = taxonomy();
		const params = { entryId: 'entry01', type: 'collection', name: 'Collection', data: { semanticKind: 'franchise', isEnabled: false } };
		await expect(new Save(role(false), asService(service)).exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		expect(service.saveEntry).not.toHaveBeenCalled();
		const endpoint = new Save(role(true), asService(service));
		await endpoint.exec(params, user, null);
		expect(service.saveEntry).toHaveBeenCalledWith(expect.objectContaining({ data: { semanticKind: 'franchise', isEnabled: false } }), 'entry01');
		for (const data of [{ semanticKind: 'provider' }, { isEnabled: null }, { isEnabled: 'false' }, { semanticKind: 'theme', _zalip: {} }]) await expect(endpoint.exec({ ...params, data }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(service.saveEntry).toHaveBeenCalledTimes(1);
	});
});
