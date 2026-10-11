/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import type { MiLocalUser } from '@/models/User.js';
import EnrichPerson, { meta as enrichMeta } from './enrich-person.js';
import Recalculate, { meta as recalculateMeta } from './recalculate.js';
import Delete, { meta as deleteMeta } from './delete.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;

function role(allowed: boolean): RoleService { return { isAdministrator: vi.fn().mockResolvedValue(allowed) } as unknown as RoleService; }

function taxonomy() { return { enrichPerson: vi.fn().mockResolvedValue({ entry: {}, changedFields: [] }), recalculateCategory: vi.fn().mockResolvedValue({ processed: 0, matched: 0, skipped: 0, nextCursor: null }), deleteEntry: vi.fn().mockResolvedValue(undefined) }; }

function asService(service: ReturnType<typeof taxonomy>): ZalipTaxonomyService { return service as unknown as ZalipTaxonomyService; }

describe('taxonomy administration workflows', () => {
	test('all workflows require credentials and write permission', () => {
		for (const meta of [enrichMeta, recalculateMeta, deleteMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.kind).toBe('write:account');
			expect(meta.prohibitMoved).toBe(true);
			expect(meta.limit.max).toBeLessThanOrEqual(10);
		}
	});

	test('ordinary users cannot enrich, recalculate or delete before any service or Redis access', async () => {
		const service = taxonomy();
		const cases = [
			[new EnrichPerson(role(false), asService(service), {} as never), { entryId: 'entry01', source: 'tmdb' }],
			[new Recalculate(role(false), asService(service)), { entryId: 'entry01' }],
			[new Delete(role(false), asService(service)), { entryId: 'entry01' }],
		] as const;
		for (const [endpoint, params] of cases) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
	});

	test('enrichment forwards only canonical source and selected record ID', async () => {
		const service = taxonomy();
		const endpoint = new EnrichPerson(role(true), asService(service), {} as never);
		await endpoint.exec({ entryId: 'entry01', source: 'tmdb', i: 'auth-placeholder' }, user, null);
		expect(service.enrichPerson).toHaveBeenCalledWith('entry01', 'tmdb', expect.any(Function));
		for (const params of [{ entryId: 'entry01', source: 'collaps' }, { entryId: 'entry01', source: 'tmdb', externalId: '10' }, { entryId: 'entry01', source: 'tmdb', token: 'unexpected' }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
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
});
