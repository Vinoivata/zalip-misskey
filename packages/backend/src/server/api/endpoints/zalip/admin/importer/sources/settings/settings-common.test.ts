/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { RoleService } from '@/core/RoleService.js';
import type { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import type { MiLocalUser } from '@/models/User.js';
import Show, { meta as showMeta } from './show.js';
import Save, { meta as saveMeta } from './save.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
const user = { id: 'admin01' } as MiLocalUser;

function fixture(administrator = true) {
	const methods = { show: vi.fn().mockResolvedValue({ encryptionReady: true, sources: [] }), save: vi.fn().mockResolvedValue({ encryptionReady: true, sources: [] }) };
	const role = { isAdministrator: vi.fn().mockResolvedValue(administrator) };
	return { role: role as unknown as RoleService, roles: role, settings: methods as unknown as ZalipImporterSourceSettingsService, methods };
}

describe('secure native administrator source-settings contracts', () => {
	test('both endpoints require native credentials with secure meta, never OAuth permission scopes', () => {
		for (const meta of [showMeta, saveMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.secure).toBe(true);
			expect(meta).not.toHaveProperty('kind');
		}
		expect(saveMeta.prohibitMoved).toBe(true);
	});
	test('non-administrators are denied before reading or saving any credentials', async () => {
		const { role, settings, methods } = fixture(false);
		await expect(new Show(role, settings).exec({}, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		await expect(new Save(role, settings).exec({ source: 'tmdb', apiOrigin: 'https://api.themoviedb.org', apiToken: 'synthetic-key' }, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		expect(methods.show).not.toHaveBeenCalled();
		expect(methods.save).not.toHaveBeenCalled();
	});
	test('unexpected role lookup errors are closed before API-call logging could expose submitted keys', async () => {
		const { role, roles, settings, methods } = fixture();
		roles.isAdministrator.mockRejectedValue(new Error('synthetic-role-database-error'));
		for (const [endpoint, params] of [[new Show(role, settings), {}], [new Save(role, settings), { source: 'alloha', apiOrigin: 'https://apbugall.org', apiToken: 'synthetic-private-key' }]] as const) await expect(endpoint.exec(params, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_UNAVAILABLE' });
		expect(methods.show).not.toHaveBeenCalled();
		expect(methods.save).not.toHaveBeenCalled();
	});
	test('closed bounded input forwards only source settings, not caller authentication', async () => {
		const { role, settings, methods } = fixture();
		const endpoint = new Save(role, settings);
		await endpoint.exec({ i: 'synthetic-native-auth', source: 'tmdb', apiOrigin: 'https://api.themoviedb.org', apiToken: 'synthetic-source-key' }, user, null);
		expect(methods.save.mock.calls[0][0]).not.toHaveProperty('i');
		expect(methods.save.mock.calls[0][0]).toMatchObject({ source: 'tmdb', apiToken: 'synthetic-source-key' });
		for (const extra of [{ unexpected: true }, { apiToken: 'x'.repeat(4097) }, { apiOrigin: 'x'.repeat(1025) }, { source: 'imdb' }]) await expect(endpoint.exec({ source: 'tmdb', apiOrigin: 'https://api.themoviedb.org', ...extra }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(methods.save).toHaveBeenCalledTimes(1);
	});
});
