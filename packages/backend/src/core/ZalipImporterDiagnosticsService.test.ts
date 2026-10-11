/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ZalipImporterDiagnosticsService } from './ZalipImporterDiagnosticsService.js';
import { defaultImportApiOrigins } from './zalip-importer/providers.js';

const isolated = vi.hoisted(() => ({ providers: vi.fn() }));
vi.mock('./ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('./zalip-importer/providers.js', async original => ({
	...await original<typeof import('./zalip-importer/providers.js')>(),
	createImportProviders: isolated.providers,
}));

describe('runtime importer diagnostics settings', () => {
	test('credential and address rotation invalidate cached checks without storing secrets', async () => {
		const cache = new Map<string, string>();
		const redis = { get: vi.fn(async (key: string) => cache.get(key) ?? null), set: vi.fn(async (key: string, value: string) => { cache.set(key, value); }) };
		const settings = { getRuntime: vi.fn().mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaApiToken: 'private-first-fixture' }) };
		const check = vi.fn().mockResolvedValue(undefined);
		isolated.providers.mockReturnValue({ alloha: { status: () => ({ source: 'alloha', configured: true }), check } });
		const service = new ZalipImporterDiagnosticsService(redis as never, {} as never, settings as never);
		expect((await service.check('alloha')).cached).toBe(false);
		expect((await service.check('alloha')).cached).toBe(true);
		settings.getRuntime.mockResolvedValue({ apiOrigins: defaultImportApiOrigins, allohaApiToken: 'private-second-fixture' });
		expect((await service.check('alloha')).cached).toBe(false);
		settings.getRuntime.mockResolvedValue({ apiOrigins: { ...defaultImportApiOrigins, alloha: 'https://mirror.example.org' }, allohaApiToken: 'private-second-fixture' });
		expect((await service.check('alloha')).cached).toBe(false);
		expect(check).toHaveBeenCalledTimes(3);
		expect(settings.getRuntime).toHaveBeenCalledTimes(4);
		for (const [key, value] of cache) {
			expect(key + value).not.toContain('private-');
			expect(key + value).not.toContain('mirror.example.org');
		}
	});
});
