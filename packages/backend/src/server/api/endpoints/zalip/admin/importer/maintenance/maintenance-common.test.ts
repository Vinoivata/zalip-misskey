/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipImporterMaintenanceService } from '@/core/ZalipImporterMaintenanceService.js';
import type { MiLocalUser } from '@/models/User.js';
import Create, { meta as createMeta } from './create.js';
import List, { meta as listMeta } from './list.js';
import Show, { meta as showMeta } from './show.js';
import Action, { meta as actionMeta } from './action.js';
import ListProfiles, { meta as listProfilesMeta } from './schedules/list.js';
import SaveProfile, { meta as saveProfileMeta } from './schedules/save.js';
import ActionProfile, { meta as actionProfileMeta } from './schedules/action.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipImporterMaintenanceService.js', () => ({ ZalipImporterMaintenanceService: class {} }));
const user = { id: 'admin01' } as MiLocalUser;

function fixture(administrator: boolean) {
	const role = { isAdministrator: vi.fn().mockResolvedValue(administrator) } as unknown as RoleService;
	const methods = { createRun: vi.fn().mockResolvedValue({ runId: 'run01' }), listRuns: vi.fn().mockResolvedValue([]), showRun: vi.fn().mockResolvedValue({}), actionRun: vi.fn().mockResolvedValue({}), listProfiles: vi.fn().mockResolvedValue([]), saveProfile: vi.fn().mockResolvedValue({}), actionProfile: vi.fn().mockResolvedValue(null) };
	return { role, service: methods as unknown as ZalipImporterMaintenanceService, methods };
}

describe('maintenance administrator API contracts', () => {
	test('all seven endpoints require credentials, closed schemas and read/write token permissions', () => {
		for (const meta of [listMeta, showMeta, listProfilesMeta]) { expect(meta.requireCredential).toBe(true); expect(meta.kind).toBe('read:account'); }
		for (const meta of [createMeta, actionMeta, saveProfileMeta, actionProfileMeta]) { expect(meta.requireCredential).toBe(true); expect(meta.kind).toBe('write:account'); expect(meta.prohibitMoved).toBe(true); }
	});
	test('ordinary users and moderators are denied before any maintenance method', async () => {
		const { role, service, methods } = fixture(false);
		const cases = [
			[new Create(role, service), { kind: 'collections-dictionary', source: 'collaps' }],
			[new List(role, service), {}],
			[new Show(role, service), { runId: 'run01' }],
			[new Action(role, service), { runId: 'run01', action: 'resume' }],
			[new ListProfiles(role, service), {}],
			[new SaveProfile(role, service), { name: 'People', kind: 'person-enrichment', source: 'tmdb', intervalMinutes: 1440 }],
			[new ActionProfile(role, service), { profileId: 'profile01', action: 'enable' }],
		] as const;
		for (const [endpoint, params] of cases) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		for (const method of Object.values(methods)) expect(method).not.toHaveBeenCalled();
	});
	test('creation strips authentication and rejects secrets, fake work refs and oversized batches', async () => {
		const { role, service, methods } = fixture(true);
		const endpoint = new Create(role, service);
		await endpoint.exec({ i: 'fixture-auth', kind: 'collections-dictionary', source: 'collaps', batchLimit: 20 }, user, null);
		expect(methods.createRun).toHaveBeenCalledWith({ kind: 'collections-dictionary', source: 'collaps', options: undefined, batchLimit: 20, timeBudgetSeconds: undefined }, user.id);
		for (const params of [{ kind: 'movie', source: 'collaps' }, { kind: 'collections-dictionary', source: 'collaps', refs: [] }, { kind: 'collections-dictionary', source: 'collaps', batchLimit: 100 }, { kind: 'collection-backfill', source: 'collaps', options: { token: 'secret' } }, { kind: 'collection-backfill', source: 'collaps', options: { collectionIds: ['https://bad'] } }]) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(methods.createRun).toHaveBeenCalledTimes(1);
	});
	test('schedule saving cannot supply enabled/cursor, keeps authentication outside service', async () => {
		const { role, service, methods } = fixture(true);
		const endpoint = new SaveProfile(role, service);
		const params = { name: 'People', kind: 'person-enrichment', source: 'tmdb', intervalMinutes: 1440 };
		await endpoint.exec({ ...params, i: 'fixture-auth' }, user, null);
		expect(methods.saveProfile.mock.calls[0][0]).not.toHaveProperty('i');
		for (const extra of [{ enabled: true }, { cursor: {} }, { intervalMinutes: 1 }]) await expect(endpoint.exec({ ...params, ...extra }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});
});
