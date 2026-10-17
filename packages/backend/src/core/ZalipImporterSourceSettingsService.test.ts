/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { MiZalipImporterSourceSetting } from '@/models/ZalipImporterSourceSetting.js';
import { decryptImporterTokens, encryptImporterTokens, importerSettingsEncryptionKey, ZalipImporterSourceSettingsService } from './ZalipImporterSourceSettingsService.js';
import { defaultImportApiOrigins } from './zalip-importer/providers.js';

const key = Buffer.alloc(32, 7);
beforeEach(() => {
	vi.stubEnv('ZALIP_IMPORTER_SETTINGS_KEY', key.toString('base64'));
	for (const name of ['ZALIP_TMDB_API_KEY', 'ZALIP_KINOPOISK_API_KEY', 'ZALIP_ALLOHA_API_TOKEN', 'ZALIP_COLLAPS_API_TOKEN', 'ZALIP_ALLOHA_PLAYER_TOKEN', 'ZALIP_TMDB_API_ORIGIN', 'ZALIP_KINOPOISK_API_ORIGIN', 'ZALIP_ALLOHA_API_ORIGIN', 'ZALIP_COLLAPS_API_ORIGIN', 'ZALIP_ALLOHA_PLAYER_ORIGIN', 'ZALIP_COLLAPS_PLAYER_ORIGIN', 'ZALIP_ALLOHA_IFRAME_HOSTS', 'ZALIP_COLLAPS_IFRAME_HOSTS', 'ZALIP_KODIK_API_TOKEN', 'ZALIP_KODIK_API_ORIGIN', 'ZALIP_KODIK_PLAYER_ORIGIN', 'ZALIP_KODIK_IFRAME_HOSTS']) vi.stubEnv(name, undefined);
});
afterEach(() => vi.unstubAllEnvs());

function fixture() {
	const rows: MiZalipImporterSourceSetting[] = [];
	const repository = {
		find: vi.fn(async () => structuredClone(rows)),
		findOneBy: vi.fn(async ({ source }: { source: string }) => structuredClone(rows.find(row => row.source === source) ?? null)),
		create: (row: MiZalipImporterSourceSetting) => row,
		save: vi.fn(async (row: MiZalipImporterSourceSetting) => { const index = rows.findIndex(value => value.source === row.source); if (index < 0) rows.push(structuredClone(row)); else rows[index] = structuredClone(row); return row; }),
	};
	const db = { getRepository: () => repository, query: vi.fn(), transaction: vi.fn(async (action: (manager: unknown) => unknown) => action(db)) };
	return { service: new ZalipImporterSourceSettingsService(db as never), rows, repository, db };
}

describe('source credentials encryption', () => {
	test('only a canonical 32-byte base64 key is accepted', () => {
		expect(importerSettingsEncryptionKey(key.toString('base64'))).toEqual(key);
		for (const value of [undefined, '', 'fixture-key', Buffer.alloc(16).toString('base64'), key.toString('base64') + '\n']) expect(importerSettingsEncryptionKey(value)).toBeNull();
	});
	test('AES-GCM is randomized, authenticated and bound to the provider source', () => {
		const first = encryptImporterTokens('alloha', { apiToken: 'fixture-api-token', playerToken: 'fixture-public-token' }, key);
		const second = encryptImporterTokens('alloha', { apiToken: 'fixture-api-token', playerToken: 'fixture-public-token' }, key);
		expect(first.ciphertext).not.toBe(second.ciphertext);
		expect(JSON.stringify(first)).not.toContain('fixture-api-token');
		expect(decryptImporterTokens('alloha', first, key)).toEqual({ apiToken: 'fixture-api-token', playerToken: 'fixture-public-token' });
		expect(() => decryptImporterTokens('collaps', first, key)).toThrow('upstream-failure');
		expect(() => decryptImporterTokens('alloha', { ...first, tag: Buffer.alloc(16).toString('base64') }, key)).toThrow('upstream-failure');
		expect(() => decryptImporterTokens('alloha', first, Buffer.alloc(32, 8))).toThrow('upstream-failure');
	});
});

describe('administrator source settings', () => {
	test('no stored override retains environment configuration and safe public origins', async () => {
		vi.stubEnv('ZALIP_TMDB_API_KEY', 'fixture-environment-key');
		const context = fixture();
		const show = await context.service.show();
		expect(show.sources.find(row => row.source === 'tmdb')).toMatchObject({ apiOrigin: defaultImportApiOrigins.tmdb, apiTokenSet: true, apiTokenOrigin: 'environment', apiToken: 'fixture-environment-key', playerToken: null });
		expect((await context.service.getRuntime()).tmdbApiKey).toBe('fixture-environment-key');
		expect(context.rows).toHaveLength(0);
	});
	test('save encrypts secrets and separates private API token from explicit public iframe token', async () => {
		const context = fixture();
		const show = await context.service.save({ source: 'alloha', apiOrigin: 'https://api.provider.org', playerOrigin: 'https://player.provider.org', apiToken: 'fixture-private-api', playerToken: 'fixture-public-player' });
		expect(JSON.stringify(context.rows)).not.toContain('fixture-private-api');
		expect(JSON.stringify(context.rows)).not.toContain('fixture-public-player');
		expect(show.sources.find(row => row.source === 'alloha')).toMatchObject({ apiToken: 'fixture-private-api', playerToken: 'fixture-public-player', apiTokenOrigin: 'database' });
		const runtime = await context.service.getRuntime();
		expect(runtime).toMatchObject({ allohaApiToken: 'fixture-private-api', allohaPlayerToken: 'fixture-public-player', allohaPlayerOrigin: 'https://player.provider.org', apiOrigins: { alloha: 'https://api.provider.org' } });
	});
	test('blank preserves environment or existing database tokens; explicit clear suppresses environment fallback', async () => {
		vi.stubEnv('ZALIP_TMDB_API_KEY', 'fixture-environment');
		const context = fixture();
		await context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: '   ' });
		expect((await context.service.getRuntime()).tmdbApiKey).toBe('fixture-environment');
		expect(context.rows[0].encryptedTokens).toBeNull();
		await context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture-database' });
		await context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: '' });
		expect((await context.service.getRuntime()).tmdbApiKey).toBe('fixture-database');
		const show = await context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, clearApiToken: true });
		expect((await context.service.getRuntime()).tmdbApiKey).toBeUndefined();
		expect(show.sources.find(row => row.source === 'tmdb')).toMatchObject({ apiToken: null, apiTokenSet: false, apiTokenOrigin: 'none' });
	});
	test('runtime reads settings afresh so key/address rotation requires no process restart', async () => {
		const context = fixture();
		await context.service.save({ source: 'kinopoisk', apiOrigin: defaultImportApiOrigins.kinopoisk, apiToken: 'fixture-first' });
		expect((await context.service.getRuntime()).kinopoiskApiKey).toBe('fixture-first');
		await context.service.save({ source: 'kinopoisk', apiOrigin: 'https://api.provider.org', apiToken: 'fixture-second' });
		expect(await context.service.getRuntime()).toMatchObject({ kinopoiskApiKey: 'fixture-second', apiOrigins: { kinopoisk: 'https://api.provider.org' } });
	});
	test('Kodik defaults need no public player token or forced mirror', async () => {
		const context = fixture();
		expect((await context.service.show()).sources.find(row => row.source === 'kodik')).toMatchObject({ apiOrigin: 'https://kodik-api.com', playerOrigin: null, apiToken: null, playerToken: null, playerTokenSet: false, playerTokenOrigin: 'none' });
		expect(await context.service.getRuntime()).toMatchObject({ apiOrigins: { kodik: 'https://kodik-api.com' }, kodikApiToken: undefined, kodikPlayerOrigin: undefined, kodikIframeHosts: ['kodikplayer.com'] });
		expect(context.rows).toHaveLength(0);
		vi.stubEnv('ZALIP_KODIK_IFRAME_HOSTS', ' ,  ');
		expect((await context.service.getRuntime()).kodikIframeHosts).toEqual(['kodikplayer.com']);
	});
	test('Kodik environment credentials, API origin, optional mirror and iframe hosts stay separate', async () => {
		vi.stubEnv('ZALIP_KODIK_API_TOKEN', 'fixture-kodik-environment');
		vi.stubEnv('ZALIP_KODIK_API_ORIGIN', 'https://api.provider.org');
		vi.stubEnv('ZALIP_KODIK_PLAYER_ORIGIN', 'https://player.provider.org');
		vi.stubEnv('ZALIP_KODIK_IFRAME_HOSTS', ' kodikplayer.com, player.provider.org, ');
		const context = fixture();
		expect((await context.service.show()).sources.find(row => row.source === 'kodik')).toMatchObject({ apiOrigin: 'https://api.provider.org', playerOrigin: 'https://player.provider.org', apiToken: 'fixture-kodik-environment', apiTokenOrigin: 'environment', playerToken: null });
		expect(await context.service.getRuntime()).toMatchObject({ kodikApiToken: 'fixture-kodik-environment', apiOrigins: { kodik: 'https://api.provider.org' }, kodikPlayerOrigin: 'https://player.provider.org', kodikIframeHosts: ['kodikplayer.com', 'player.provider.org'] });
	});
	test('Kodik database token is encrypted, visible to admin and can be rotated or explicitly cleared', async () => {
		vi.stubEnv('ZALIP_KODIK_API_TOKEN', 'fixture-kodik-environment');
		const context = fixture();
		const show = await context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, apiToken: 'fixture-kodik-first' });
		expect(JSON.stringify(context.rows)).not.toContain('fixture-kodik-first');
		expect(show.sources.find(row => row.source === 'kodik')).toMatchObject({ apiToken: 'fixture-kodik-first', apiTokenOrigin: 'database', playerToken: null });
		expect(decryptImporterTokens('kodik', context.rows[0].encryptedTokens, key)).toEqual({ apiToken: 'fixture-kodik-first' });
		expect(() => decryptImporterTokens('collaps', context.rows[0].encryptedTokens, key)).toThrow('upstream-failure');
		await context.service.save({ source: 'kodik', apiOrigin: 'https://api.provider.org', apiToken: 'fixture-kodik-second', playerOrigin: 'https://player.provider.org' });
		expect(await context.service.getRuntime()).toMatchObject({ kodikApiToken: 'fixture-kodik-second', apiOrigins: { kodik: 'https://api.provider.org' }, kodikPlayerOrigin: 'https://player.provider.org' });
		await context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, clearApiToken: true });
		expect((await context.service.getRuntime()).kodikApiToken).toBeUndefined();
	});
	test('a Kodik mirror is retained on unrelated saves and explicit null clears it without restoring the environment', async () => {
		vi.stubEnv('ZALIP_KODIK_PLAYER_ORIGIN', 'https://player.provider.org');
		const context = fixture();
		await context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, apiToken: 'fixture-kodik' });
		expect((await context.service.getRuntime()).kodikPlayerOrigin).toBe('https://player.provider.org');
		await context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, playerOrigin: null });
		expect((await context.service.getRuntime()).kodikPlayerOrigin).toBeUndefined();
		await context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik });
		expect((await context.service.getRuntime()).kodikPlayerOrigin).toBeUndefined();
		expect(context.rows[0].playerOrigin).toBeNull();
	});
	test('Kodik rejects public tokens and non-origin mirrors before writing', async () => {
		const context = fixture();
		for (const playerOrigin of ['http://player.provider.org', 'https://127.0.0.1', 'https://player.provider.org/path', 'https://player.provider.org?token=fixture', 'https://user@player.provider.org', 'https://player.provider.org:8443', 'https://player.provider.org#fragment']) {
			await expect(context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, playerOrigin })).rejects.toMatchObject({ code: 'invalid-ref' });
		}
		for (const input of [{ playerToken: 'fixture-public-token' }, { clearPlayerToken: true }, { clearPlayerToken: false }]) await expect(context.service.save({ source: 'kodik', apiOrigin: defaultImportApiOrigins.kodik, ...input })).rejects.toMatchObject({ code: 'invalid-ref' });
		await expect(context.service.save({ source: 'alloha', apiOrigin: defaultImportApiOrigins.alloha, playerOrigin: null })).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(context.rows).toHaveLength(0);
	});
	test('invalid origin, secret parameters, token controls and unsupported player settings write nothing', async () => {
		const context = fixture();
		for (const input of [{ source: 'tmdb', apiOrigin: 'http://api.provider.org' }, { source: 'tmdb', apiOrigin: 'https://127.0.0.1' }, { source: 'tmdb', apiOrigin: 'https://api.provider.org/path' }, { source: 'tmdb', apiOrigin: 'https://api.provider.org?token=fixture' }, { source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, playerOrigin: 'https://player.provider.org' }, { source: 'collaps', apiOrigin: defaultImportApiOrigins.collaps, playerToken: 'fixture' }, { source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture token' }, { source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture\nheader' }, { source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture', clearApiToken: true }]) await expect(context.service.save(input as never)).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(context.rows).toHaveLength(0);
	});
	test('browser-visible Alloha tokens obey the actual embed format and can share an explicitly approved API value', async () => {
		const context = fixture();
		for (const playerToken of ['short', 'fixture.token', 'fixture/token', 'x'.repeat(513)]) await expect(context.service.save({ source: 'alloha', apiOrigin: defaultImportApiOrigins.alloha, playerToken })).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(context.rows).toHaveLength(0);
		await context.service.save({ source: 'alloha', apiOrigin: defaultImportApiOrigins.alloha, apiToken: 'fixture-approved-shared-token', playerToken: 'fixture-approved-shared-token' });
		expect(await context.service.getRuntime()).toMatchObject({ allohaApiToken: 'fixture-approved-shared-token', allohaPlayerToken: 'fixture-approved-shared-token' });
	});
	test('missing encryption key blocks writes, while corrupted ciphertext fails safely', async () => {
		const context = fixture();
		vi.stubEnv('ZALIP_IMPORTER_SETTINGS_KEY', undefined);
		expect((await context.service.show()).encryptionReady).toBe(false);
		await expect(context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture' })).rejects.toMatchObject({ code: 'not-configured' });
		expect(context.rows).toHaveLength(0);
		vi.stubEnv('ZALIP_IMPORTER_SETTINGS_KEY', key.toString('base64'));
		await context.service.save({ source: 'tmdb', apiOrigin: defaultImportApiOrigins.tmdb, apiToken: 'fixture' });
		context.rows[0].encryptedTokens!.tag = Buffer.alloc(16).toString('base64');
		await expect(context.service.getRuntime()).rejects.toMatchObject({ code: 'upstream-failure' });
	});
});
