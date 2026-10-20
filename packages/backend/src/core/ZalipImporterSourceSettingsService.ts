/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { MiZalipImporterSourceSetting, type EncryptedImporterTokens } from '@/models/ZalipImporterSourceSetting.js';
import { defaultImportApiOrigins, ImportProviderError, normalizeImportApiOrigin, type ImportProviderConfig } from './zalip-importer/providers.js';
import { importSources, type ImportSource } from './zalip-importer/types.js';
import type { DataSource } from 'typeorm';

type TokenOverrides = { apiToken?: string | null; playerToken?: string | null };
export type SaveImporterSourceSettings = { source: ImportSource; apiOrigin: string; playerOrigin?: string | null; apiToken?: string; clearApiToken?: boolean; playerToken?: string; clearPlayerToken?: boolean };
export type RuntimeImporterSettings = ImportProviderConfig & { apiOrigins: Record<ImportSource, string>; allohaPlayerOrigin: string; collapsPlayerOrigin: string };
const playerDefaults = { alloha: 'https://ascorbic-as.stravers.live', collaps: 'https://api.nextembed.ws' } as const;
const apiEnvironment = { tmdb: 'ZALIP_TMDB_API_KEY', kinopoisk: 'ZALIP_KINOPOISK_API_KEY', alloha: 'ZALIP_ALLOHA_API_TOKEN', collaps: 'ZALIP_COLLAPS_API_TOKEN', kodik: 'ZALIP_KODIK_API_TOKEN', vibix: 'ZALIP_VIBIX_API_TOKEN' } as const;
const apiOriginEnvironment = { tmdb: 'ZALIP_TMDB_API_ORIGIN', kinopoisk: 'ZALIP_KINOPOISK_API_ORIGIN', alloha: 'ZALIP_ALLOHA_API_ORIGIN', collaps: 'ZALIP_COLLAPS_API_ORIGIN', kodik: 'ZALIP_KODIK_API_ORIGIN', vibix: 'ZALIP_VIBIX_API_ORIGIN' } as const;
const optionalPlayerOriginEnvironment = { kodik: 'ZALIP_KODIK_PLAYER_ORIGIN', vibix: 'ZALIP_VIBIX_PLAYER_ORIGIN' } as const;

export function importerSettingsEncryptionKey(value: string | undefined): Buffer | null {
	if (!value || !/^[A-Za-z0-9+/]{43}=$/u.test(value)) return null;
	const decoded = Buffer.from(value, 'base64');
	return decoded.length === 32 && decoded.toString('base64') === value ? decoded : null;
}

function token(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'string' || value.length > 4096) throw new ImportProviderError('invalid-ref');
	const trimmed = value.trim();
	if (/[\s\u0000-\u001f\u007f-\u009f]/u.test(trimmed)) throw new ImportProviderError('invalid-ref');
	return trimmed || null;
}

/** Encryption authenticates both the contents and their source, preventing row-swapping attacks. */
export function encryptImporterTokens(source: ImportSource, values: TokenOverrides, key: Buffer): EncryptedImporterTokens {
	const nonce = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, nonce);
	cipher.setAAD(Buffer.from(`zalip-importer-source:${source}:v1`));
	const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
	return { version: 1, nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

export function decryptImporterTokens(source: ImportSource, value: EncryptedImporterTokens | null, key: Buffer | null): TokenOverrides {
	if (value === null) return {};
	try {
		if (!key || value.version !== 1 || typeof value.nonce !== 'string' || value.nonce.length > 24 || typeof value.tag !== 'string' || value.tag.length > 32 || typeof value.ciphertext !== 'string' || value.ciphertext.length > 20000) throw new Error('invalid-cipher');
		const nonce = Buffer.from(value.nonce, 'base64');
		const tag = Buffer.from(value.tag, 'base64');
		if (nonce.length !== 12 || tag.length !== 16) throw new Error('invalid-cipher');
		const decipher = createDecipheriv('aes-256-gcm', key, nonce);
		decipher.setAAD(Buffer.from(`zalip-importer-source:${source}:v1`));
		decipher.setAuthTag(tag);
		const decoded: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
		if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || Object.keys(decoded).some(field => !['apiToken', 'playerToken'].includes(field))) throw new Error('invalid-cipher');
		const result = decoded as TokenOverrides;
		for (const field of ['apiToken', 'playerToken'] as const) if (result[field] !== undefined && result[field] !== null && token(result[field]) !== result[field]) throw new Error('invalid-cipher');
		return result;
	} catch {
		// Never expose ciphertext, authentication tags, keys or a crypto exception.
		throw new ImportProviderError('upstream-failure');
	}
}

function credential(values: TokenOverrides, field: keyof TokenOverrides, fallback: string | undefined) {
	return values[field] === undefined ? token(fallback) : values[field] ?? null;
}

function credentialOrigin(values: TokenOverrides, field: keyof TokenOverrides, fallback: string | undefined): 'environment' | 'database' | 'none' {
	return credential(values, field, fallback) ? values[field] === undefined ? 'environment' : 'database' : 'none';
}

/** Keys are encrypted at rest. Only secure, administrator-only endpoints may display them. */
@Injectable()
export class ZalipImporterSourceSettingsService {
	constructor(@Inject(DI.db) private db: DataSource) {}

	private key() { return importerSettingsEncryptionKey(process.env.ZALIP_IMPORTER_SETTINGS_KEY); }

	private async settings() {
		const key = this.key();
		const rows = await this.db.getRepository(MiZalipImporterSourceSetting).find();
		return importSources.map(source => {
			const row = rows.find(candidate => candidate.source === source);
			const values = row ? decryptImporterTokens(source, row.encryptedTokens, key) : {};
			const apiOrigin = normalizeImportApiOrigin(row?.apiOrigin ?? (process.env[apiOriginEnvironment[source]] || defaultImportApiOrigins[source]));
			const optionalPlayerOrigin = source === 'kodik' || source === 'vibix' ? row ? row.playerOrigin : process.env[optionalPlayerOriginEnvironment[source]] || null : null;
			const playerOrigin = source === 'alloha' || source === 'collaps' ? normalizeImportApiOrigin(row?.playerOrigin ?? (process.env[source === 'alloha' ? 'ZALIP_ALLOHA_PLAYER_ORIGIN' : 'ZALIP_COLLAPS_PLAYER_ORIGIN'] || playerDefaults[source])) : optionalPlayerOrigin ? normalizeImportApiOrigin(optionalPlayerOrigin) : null;
			return { source, apiOrigin, playerOrigin, values, updatedAt: row?.updatedAt.toISOString() ?? null };
		});
	}

	public async show() {
		return {
			encryptionReady: this.key() !== null,
			sources: (await this.settings()).map(({ source, apiOrigin, playerOrigin, values, updatedAt }) => {
				const apiToken = credential(values, 'apiToken', process.env[apiEnvironment[source]]);
				const playerToken = source === 'alloha' ? credential(values, 'playerToken', process.env.ZALIP_ALLOHA_PLAYER_TOKEN) : null;
				return { source, apiOrigin, playerOrigin, apiToken, playerToken, apiTokenSet: apiToken !== null, apiTokenOrigin: credentialOrigin(values, 'apiToken', process.env[apiEnvironment[source]]), playerTokenSet: playerToken !== null, playerTokenOrigin: source === 'alloha' ? credentialOrigin(values, 'playerToken', process.env.ZALIP_ALLOHA_PLAYER_TOKEN) : 'none' as const, updatedAt };
			}),
		};
	}

	/** Server-only configuration snapshot. Never return this from public content endpoints. */
	public async getRuntime(): Promise<RuntimeImporterSettings> {
		const settings = await this.settings();
		const apiToken = (source: ImportSource) => credential(settings.find(row => row.source === source)!.values, 'apiToken', process.env[apiEnvironment[source]]) ?? undefined;
		const kodikIframeHosts = process.env.ZALIP_KODIK_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
		return {
			apiOrigins: Object.fromEntries(settings.map(row => [row.source, row.apiOrigin])) as Record<ImportSource, string>,
			tmdbApiKey: apiToken('tmdb'), kinopoiskApiKey: apiToken('kinopoisk'), allohaApiToken: apiToken('alloha'), collapsApiToken: apiToken('collaps'), kodikApiToken: apiToken('kodik'), vibixApiToken: apiToken('vibix'),
			allohaPlayerToken: credential(settings.find(row => row.source === 'alloha')!.values, 'playerToken', process.env.ZALIP_ALLOHA_PLAYER_TOKEN) ?? undefined,
			allohaPlayerOrigin: settings.find(row => row.source === 'alloha')!.playerOrigin!, collapsPlayerOrigin: settings.find(row => row.source === 'collaps')!.playerOrigin!,
			allohaIframeHosts: process.env.ZALIP_ALLOHA_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean),
			collapsIframeHosts: process.env.ZALIP_COLLAPS_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean),
			kodikPlayerOrigin: settings.find(row => row.source === 'kodik')!.playerOrigin ?? undefined,
			kodikIframeHosts: kodikIframeHosts.length ? kodikIframeHosts : ['kodikplayer.com'],
			vibixPlayerOrigin: settings.find(row => row.source === 'vibix')!.playerOrigin ?? undefined,
			vibixIframeHosts: process.env.ZALIP_VIBIX_IFRAME_HOSTS?.split(',').map(value => value.trim()).filter(Boolean) ?? [],
		};
	}

	public async save(input: SaveImporterSourceSettings) {
		if (!input || !importSources.includes(input.source)) throw new ImportProviderError('invalid-ref');
		const apiOrigin = normalizeImportApiOrigin(input.apiOrigin);
		const optionalPlayerOrigin = input.source === 'kodik' || input.source === 'vibix';
		const playerOrigin = input.playerOrigin === undefined ? undefined : input.playerOrigin === null && optionalPlayerOrigin ? null : normalizeImportApiOrigin(input.playerOrigin as string);
		if (playerOrigin !== undefined && !['alloha', 'collaps', 'kodik', 'vibix'].includes(input.source)) throw new ImportProviderError('invalid-ref');
		if (input.source !== 'alloha' && (input.playerToken !== undefined || input.clearPlayerToken !== undefined)) throw new ImportProviderError('invalid-ref');
		if ((input.clearApiToken !== undefined && typeof input.clearApiToken !== 'boolean') || (input.clearPlayerToken !== undefined && typeof input.clearPlayerToken !== 'boolean')) throw new ImportProviderError('invalid-ref');
		const apiToken = token(input.apiToken), playerToken = token(input.playerToken);
		if (playerToken && !/^[A-Za-z0-9_-]{8,512}$/u.test(playerToken)) throw new ImportProviderError('invalid-ref');
		if ((apiToken && input.clearApiToken) || (playerToken && input.clearPlayerToken)) throw new ImportProviderError('invalid-ref');
		const key = this.key();
		if (!key) throw new ImportProviderError('not-configured');
		await this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-importer-settings:${input.source}`]);
			const repository = manager.getRepository(MiZalipImporterSourceSetting);
			const existing = await repository.findOneBy({ source: input.source });
			const values = existing ? decryptImporterTokens(input.source, existing.encryptedTokens, key) : {};
			if (apiToken || input.clearApiToken) values.apiToken = input.clearApiToken ? null : apiToken;
			if (playerToken || input.clearPlayerToken) values.playerToken = input.clearPlayerToken ? null : playerToken;
			const environmentPlayerOrigin = input.source === 'kodik' || input.source === 'vibix' ? process.env[optionalPlayerOriginEnvironment[input.source]] : undefined;
			const retainedPlayerOrigin = existing ? existing.playerOrigin : environmentPlayerOrigin ? normalizeImportApiOrigin(environmentPlayerOrigin) : null;
			await repository.save(repository.create({ source: input.source, apiOrigin, playerOrigin: playerOrigin === undefined ? retainedPlayerOrigin : playerOrigin, encryptedTokens: Object.keys(values).length ? encryptImporterTokens(input.source, values, key) : null, updatedAt: new Date() }));
		});
		return this.show();
	}
}
