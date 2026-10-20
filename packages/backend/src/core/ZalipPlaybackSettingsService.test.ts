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
		const input = [{ source: 'alloha', label: ' Alloha HD ', enabled: false, position: 1 }, { source: 'collaps', label: 'Cinema', enabled: true, position: 0 }, { source: 'kodik', label: 'KODIK', enabled: true, position: 2 }, defaultPlaybackSettings()[3]];
		const { service, repository } = fixture();
		const result = await service.save(input);
		expect(result.providers).toEqual([{ source: 'collaps', label: 'Cinema', enabled: true, position: 0 }, { source: 'alloha', label: 'Alloha HD', enabled: false, position: 1 }, { source: 'kodik', label: 'KODIK', enabled: true, position: 2 }, defaultPlaybackSettings()[3]]);
		expect(repository.upsert).toHaveBeenCalledWith({ id: 'default', providers: result.providers, updatedAt: expect.any(Date) }, ['id']);
		expect(input[0].label).toBe(' Alloha HD ');
	});

	test('reading an existing two-provider policy preserves custom settings and appends Kodik without a write', async () => {
		const providers = [{ source: 'collaps', label: 'Other cinema', enabled: false, position: 0 }, { source: 'alloha', label: 'Custom', enabled: false, position: 1 }];
		const { service, repository } = fixture(providers);
		await expect(service.show()).resolves.toEqual({ providers: [...providers, ...defaultPlaybackSettings().slice(2)] });
		expect(repository.upsert).not.toHaveBeenCalled();
		expect(providers).toHaveLength(2);
	});

	test('reading a legacy three-provider policy retains all labels, disabled state and ordering without writes', async () => {
		const providers = [{ source: 'alloha', label: 'Legacy', enabled: true, position: 2 }, { source: 'collaps', label: 'Backup', enabled: false, position: 1 }, { source: 'kodik', label: 'Anime', enabled: false, position: 0 }];
		const { service, repository } = fixture(providers);
		const expected = [...providers].sort((a, b) => a.position - b.position);
		await expect(service.show()).resolves.toEqual({ providers: [...expected, defaultPlaybackSettings()[3]] });
		expect(repository.upsert).not.toHaveBeenCalled();
		await expect(service.save(providers)).rejects.toThrow('INVALID_PLAYBACK_SETTINGS');
	});

	test('a complete policy persists customized Vibix and legacy labels, ordering and disabled flags', async () => {
		const providers = [{ source: 'vibix', label: 'Custom SDK', enabled: true, position: 0 }, { source: 'alloha', label: 'Legacy', enabled: false, position: 3 }, { source: 'collaps', label: 'Backup', enabled: false, position: 2 }, { source: 'kodik', label: 'Anime', enabled: false, position: 1 }];
		const { service, repository } = fixture(providers);
		const expected = [...providers].sort((a, b) => a.position - b.position);
		await expect(service.show()).resolves.toEqual({ providers: expected });
		await expect(service.save(providers)).resolves.toEqual({ providers: expected });
		expect(repository.upsert).toHaveBeenCalledWith({ id: 'default', providers: expected, updatedAt: expect.any(Date) }, ['id']);
		for (const length of [2, 3]) await expect(service.save(providers.slice(0, length))).rejects.toThrow('INVALID_PLAYBACK_SETTINGS');
		expect(repository.upsert).toHaveBeenCalledTimes(1);
	});

	test('legacy two-row writes cannot reset an existing customized Kodik policy', async () => {
		const { service, repository } = fixture([{ source: 'kodik', label: 'Anime', enabled: false, position: 0 }, { source: 'collaps', label: 'Backup', enabled: false, position: 1 }, { source: 'alloha', label: 'Legacy', enabled: true, position: 2 }]);
		await expect(service.save(defaultPlaybackSettings().slice(0, 2))).rejects.toThrow('INVALID_PLAYBACK_SETTINGS');
		expect(repository.upsert).not.toHaveBeenCalled();
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
	].map(value => ({ value })))('rejects invalid policy before writes: %#', async ({ value }) => {
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
