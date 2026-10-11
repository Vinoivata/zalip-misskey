/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ZalipPlaybackSettingsService } from './ZalipPlaybackSettingsService.js';
import { defaultPlaybackSettings, normalizePlaybackSettings } from './zalip-importer/playback-settings.js';

function fixture(providers?: unknown) {
	const repository = { findOneBy: vi.fn().mockResolvedValue(providers === undefined ? null : { providers }), upsert: vi.fn().mockResolvedValue(undefined) };
	return { repository, service: new ZalipPlaybackSettingsService({ getRepository: () => repository } as never) };
}

describe('global playback display policy', () => {
	test('defaults are detached and missing rows need no write', async () => {
		const { service, repository } = fixture();
		await expect(service.show()).resolves.toEqual({ providers: defaultPlaybackSettings() });
		expect(repository.upsert).not.toHaveBeenCalled();
		const defaults = defaultPlaybackSettings();
		defaults[0].enabled = false;
		expect(defaultPlaybackSettings()[0].enabled).toBe(true);
	});

	test('normalizes labels and ordering without changing provider identities', async () => {
		const input = [{ source: 'alloha', label: ' Alloha HD ', enabled: false, position: 1 }, { source: 'collaps', label: 'Cinema', enabled: true, position: 0 }];
		const { service, repository } = fixture();
		const result = await service.save(input);
		expect(result.providers).toEqual([{ source: 'collaps', label: 'Cinema', enabled: true, position: 0 }, { source: 'alloha', label: 'Alloha HD', enabled: false, position: 1 }]);
		expect(repository.upsert).toHaveBeenCalledWith({ id: 'default', providers: result.providers, updatedAt: expect.any(Date) }, ['id']);
		expect(input[0].label).toBe(' Alloha HD ');
	});

	test.each([null, {}, [], [defaultPlaybackSettings()[0]], [...defaultPlaybackSettings(), defaultPlaybackSettings()[0]],
		[{ ...defaultPlaybackSettings()[0], source: 'tmdb' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], source: 'collaps' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], position: 1 }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], label: '  ' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], label: 'a'.repeat(41) }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], label: 'unsafe\u0001text' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], label: 'unsafe\u0085text' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], enabled: 'true' }, defaultPlaybackSettings()[1]],
		[{ ...defaultPlaybackSettings()[0], token: 'must-not-store' }, defaultPlaybackSettings()[1]],
	])('rejects invalid policy before writes: %#', async (value) => {
		expect(() => normalizePlaybackSettings(value)).toThrow('INVALID_PLAYBACK_SETTINGS');
		const { service, repository } = fixture();
		await expect(service.save(value)).rejects.toThrow('INVALID_PLAYBACK_SETTINGS');
		expect(repository.upsert).not.toHaveBeenCalled();
	});

	test('invalid persisted policy falls back but database outages propagate', async () => {
		await expect(fixture([]).service.show()).resolves.toEqual({ providers: defaultPlaybackSettings() });
		const { service, repository } = fixture();
		repository.findOneBy.mockRejectedValue(new Error('DATABASE_UNAVAILABLE'));
		await expect(service.show()).rejects.toThrow('DATABASE_UNAVAILABLE');
	});
});
