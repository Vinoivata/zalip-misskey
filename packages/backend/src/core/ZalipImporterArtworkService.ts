/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { writeFile } from 'node:fs/promises';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { DriveService } from '@/core/DriveService.js';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { createTemp } from '@/misc/create-temp.js';
import type { MiZalipWork } from '@/models/ZalipWork.js';
import { currentImportFields } from './zalip-importer/apply.js';
import { canUpdateField, nonEmpty, normalizeImportArtworkSettings, readImportState } from './zalip-importer/policy.js';
import { artworkCacheUri, artworkOriginalCacheUri, downloadImportArtwork, downloadOriginalImportArtwork, equivalentImportArtwork, importArtworkLimits, importArtworkUrl } from './zalip-importer/artwork.js';
import type { ImportArtworkField, ImportArtworkSettings, ImportArtworkSettingsInput, ImportField, ImportRecord, PreparedImportRecord } from './zalip-importer/types.js';

type ArtworkBudget = { deadlineAt: number; remainingBytes: number };

/** Optional background-only cache, using native Drive storage and preserving original files. */
@Injectable()
export class ZalipImporterArtworkService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private drive: DriveService,
		private http: HttpRequestService,
	) {}

	/** Existing-catalogue localization is byte-preserving, never a new provider image selection. */
	public async cacheOriginal(value: string, budget: ArtworkBudget = { deadlineAt: Date.now() + importArtworkLimits.batchTimeoutMs, remainingBytes: importArtworkLimits.batchBytes }): Promise<string> {
		const url = importArtworkUrl(value);
		if (!url) throw new Error('IMPORT_ARTWORK_REJECTED');
		const uri = artworkOriginalCacheUri(url);
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [uri]) as { locked: boolean }[];
			if (!lock?.locked) throw new Error('IMPORT_ARTWORK_BUSY');
			locked = true;
			const cached = await this.db.getRepository(MiDriveFile).findOneBy({ uri, userId: IsNull(), isLink: false });
			if (cached) return cached.url;
			if (Date.now() >= budget.deadlineAt || budget.remainingBytes <= 0) throw new Error('IMPORT_ARTWORK_BUDGET');
			const image = await downloadOriginalImportArtwork(url, this.http.getAgentForHttps(url), budget.deadlineAt);
			if (image.original.length > budget.remainingBytes || Date.now() >= budget.deadlineAt) throw new Error('IMPORT_ARTWORK_BUDGET');
			budget.remainingBytes -= image.original.length;
			const [path, cleanup] = await createTemp();
			try {
				await writeFile(path, image.original);
				const file = await this.drive.addFile({ user: null, path, name: `zalip-artwork-original-${uri.slice(-16)}.${image.originalExtension}`, uri, isLink: false, sensitive: false });
				return file.url;
			} finally { cleanup(); }
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [uri]); } finally { await connection.release(); }
		}
	}

	public async prepare(record: ImportRecord, work: MiZalipWork | null, fields?: readonly ImportField[], extraLocks: readonly string[] = [], inputSettings?: ImportArtworkSettingsInput, mode: 'local-webp' | 'local' = 'local-webp', selectedArtworkFields: readonly ImportArtworkField[] = []): Promise<PreparedImportRecord> {
		const result: PreparedImportRecord = structuredClone(record);
		delete result.artworkExpected;
		const legacy = mode === 'local-webp';
		const settings = normalizeImportArtworkSettings(legacy ? undefined : inputSettings, legacy);
		const state = readImportState(work?.importData);
		const current = work ? currentImportFields(work) : {};
		const budget: ArtworkBudget = { deadlineAt: Date.now() + importArtworkLimits.batchTimeoutMs, remainingBytes: importArtworkLimits.batchBytes };
		for (const field of ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'] as const) {
			if (fields && !fields.includes(field)) continue;
			const locked = state.locks.includes(field) || extraLocks.includes(field);
			const equivalent = work && state.values[field] === undefined && equivalentImportArtwork(current[field], record[field], Boolean(work.tmdbId && work.tmdbMediaType));
			if (locked || (work && !selectedArtworkFields.includes(field) && !equivalent && !canUpdateField(current[field], state.values[field], record[field], false))) continue;
			const values = field === 'galleryUrls' ? result.galleryUrls.slice(0, settings.galleryLimit) : result[field] ? [result[field]] : [];
			if (field === 'galleryUrls' && !legacy) result.galleryUrls = values;
			if (!values.length) {
				if (work && field === 'galleryUrls' && selectedArtworkFields.includes(field) && record.galleryUrls.length === 0) {
					result.artworkExpected ??= {};
					result.artworkExpected.galleryUrls = [...work.galleryPaths];
				}
				continue;
			}
			let failed = false;
			for (let position = 0; position < values.length; position++) {
				try {
					if (Date.now() >= budget.deadlineAt || budget.remainingBytes <= 0) throw new Error('IMPORT_ARTWORK_BUDGET');
					const local = await this.cache(values[position], field, settings, legacy, budget);
					if (field === 'galleryUrls') result.galleryUrls[position] = local;
					else result[field] = local;
				} catch {
					failed = true;
					result.warnings.push(`artwork-local-unavailable:${field}`);
				}
			}
			// A failed refresh must not replace existing working artwork with a rejected URL.
			// Gallery updates are atomic so a partial download cannot corrupt its ordering.
			if (failed && work && nonEmpty(current[field])) {
				if (field === 'galleryUrls') result.galleryUrls = [...work.galleryPaths];
				else if (field === 'posterUrl') result.posterUrl = work.posterPath;
				else if (field === 'backdropUrl') result.backdropUrl = work.backdropPath;
				else result.logoUrl = work.logoPath;
			} else if (failed && !legacy) {
				// The configurable local mode never reports a failed download as a localized external URL.
				if (field === 'galleryUrls') result.galleryUrls = [];
				else result[field] = null;
			}
			if (!failed && work) {
				result.artworkExpected ??= {};
				if (field === 'galleryUrls') result.artworkExpected.galleryUrls = [...work.galleryPaths];
				else if (field === 'posterUrl') result.artworkExpected.posterUrl = work.posterPath;
				else if (field === 'backdropUrl') result.artworkExpected.backdropUrl = work.backdropPath;
				else result.artworkExpected.logoUrl = work.logoPath;
			}
		}
		result.warnings = [...new Set(result.warnings)];
		return result;
	}

	private async cache(value: string, field: ImportArtworkField, settings: ImportArtworkSettings, legacy: boolean, budget: ArtworkBudget): Promise<string> {
		const url = importArtworkUrl(value);
		if (!url) throw new Error('IMPORT_ARTWORK_REJECTED');
		const uri = artworkCacheUri(url, field, settings, legacy);
		const originalUri = artworkOriginalCacheUri(url);
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [originalUri]) as { locked: boolean }[];
			if (!lock?.locked) throw new Error('IMPORT_ARTWORK_BUSY');
			locked = true;
			const files = this.db.getRepository(MiDriveFile);
			const cached = await files.findOneBy({ uri, userId: IsNull(), isLink: false });
			const original = settings.keepOriginal ? await files.findOneBy({ uri: originalUri, userId: IsNull(), isLink: false }) : null;
			if (cached && (!settings.keepOriginal || original)) return cached.url;
			const image = await downloadImportArtwork(url, field, this.http.getAgentForHttps(url), settings, legacy, budget.deadlineAt);
			const cost = image.original.length + (cached ? 0 : image.processed.length);
			if (cost > budget.remainingBytes || Date.now() >= budget.deadlineAt) throw new Error('IMPORT_ARTWORK_BUDGET');
			budget.remainingBytes -= cost;
			const store = async (data: Buffer, identity: string, extension: string) => {
				const existing = await files.findOneBy({ uri: identity, userId: IsNull(), isLink: false });
				if (existing) return existing;
				const [path, cleanup] = await createTemp();
				try {
					await writeFile(path, data);
					return await this.drive.addFile({ user: null, path, name: `zalip-artwork-${uri.slice(-16)}.${extension}`, uri: identity, isLink: false, sensitive: false });
				} finally { cleanup(); }
			};
			if (settings.keepOriginal && !original) await store(image.original, originalUri, image.originalExtension);
			const file = cached ?? await store(image.processed, uri, image.extension);
			// Native webpublic alternatives may change format or dimensions, ignoring this job's policy.
			return file.url;
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [originalUri]); } finally { await connection.release(); }
		}
	}
}
