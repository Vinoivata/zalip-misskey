/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import { defaultPlaybackSettings } from '@/core/zalip-importer/playback-settings.js';
import Show, { meta as showMeta } from './show.js';
import Save, { meta as saveMeta } from './save.js';
import AllohaShow from '../../../playback/alloha/show.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));
vi.mock('@/core/ZalipPlaybackSettingsService.js', () => ({ ZalipPlaybackSettingsService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;

function fixture(allowed = true) {
	const role = { isAdministrator: vi.fn().mockResolvedValue(allowed) };
	const settings = { show: vi.fn().mockResolvedValue({ providers: defaultPlaybackSettings() }), save: vi.fn().mockResolvedValue({ providers: defaultPlaybackSettings() }) };
	return { role, settings, show: new Show(role as never, settings as never), save: new Save(role as never, settings as never) };
}

describe('playback policy endpoints', () => {
	test('protects settings by credentials, permission scopes and administrator role', async () => {
		expect(showMeta.requireCredential).toBe(true);
		expect(showMeta.kind).toBe('read:account');
		expect(saveMeta.requireCredential).toBe(true);
		expect(saveMeta.kind).toBe('write:account');
		expect(saveMeta.prohibitMoved).toBe(true);
		const f = fixture(false);
		await expect(f.show.exec({}, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		await expect(f.save.exec({ providers: defaultPlaybackSettings() }, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED', httpStatusCode: 403 });
		expect(f.settings.show).not.toHaveBeenCalled();
		expect(f.settings.save).not.toHaveBeenCalled();
	});

	test('passes only explicit display settings and safely maps validation failures', async () => {
		const f = fixture();
		await f.save.exec({ providers: defaultPlaybackSettings(), i: 'auth-placeholder' }, user, null);
		expect(f.settings.save).toHaveBeenCalledWith(defaultPlaybackSettings());
		for (const params of [{ providers: [] }, { providers: defaultPlaybackSettings(), token: 'forbidden' }, { providers: [{ ...defaultPlaybackSettings()[0], url: 'https://example.org' }, defaultPlaybackSettings()[1]] }]) await expect(f.save.exec(params, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		f.settings.save.mockRejectedValue(new Error('INVALID_PLAYBACK_SETTINGS'));
		await expect(f.save.exec({ providers: defaultPlaybackSettings() }, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_INVALID', httpStatusCode: 400 });
	});

	test('disabled Alloha cannot be restored through the legacy cached endpoint', async () => {
		const f = fixture();
		const providers = defaultPlaybackSettings();
		providers[0] = { ...providers[0], enabled: false, label: 'Primary' };
		f.settings.show.mockResolvedValue({ providers });
		const catalog = { getAllohaPlayback: vi.fn().mockResolvedValue({ available: true, iframe: 'https://ascorbic-as.stravers.live/embed/1', translations: [{ id: 1 }], lastCheckedAt: '2026-10-12' }) };
		const endpoint = new AllohaShow(catalog as never, f.settings as never, { getRuntime: vi.fn().mockResolvedValue({}) } as never);
		await expect(endpoint.exec({ slug: 'title' }, user, null)).resolves.toEqual({ available: false, iframe: null, translations: [], lastCheckedAt: '2026-10-12', label: 'Primary' });
		catalog.getAllohaPlayback.mockResolvedValue(null);
		await expect(endpoint.exec({ slug: 'unpublished' }, user, null)).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_WORK', httpStatusCode: 404 });
	});
});
