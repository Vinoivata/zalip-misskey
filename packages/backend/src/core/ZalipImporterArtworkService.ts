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
import { canUpdateField, nonEmpty, readImportState } from './zalip-importer/policy.js';
import { artworkCacheUri, downloadImportArtwork, importArtworkUrl, type ImportArtworkField } from './zalip-importer/artwork.js';
import type { ImportField, ImportRecord } from './zalip-importer/types.js';

/** Optional background-only cache, using native Drive storage and preserving original files. */
@Injectable()
export class ZalipImporterArtworkService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private drive: DriveService,
		private http: HttpRequestService,
	) {}

	public async prepare(record: ImportRecord, work: MiZalipWork | null, fields?: readonly ImportField[], extraLocks: readonly string[] = []): Promise<ImportRecord> {
		const result = structuredClone(record);
		const state = readImportState(work?.importData);
		const current = work ? currentImportFields(work) : {};
		for (const field of ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'] as const) {
			if (fields && !fields.includes(field)) continue;
			if (work && !canUpdateField(current[field], state.values[field], record[field], state.locks.includes(field) || extraLocks.includes(field))) continue;
			const values = field === 'galleryUrls' ? result.galleryUrls.slice(0, 12) : result[field] ? [result[field]] : [];
			let failed = false;
			for (let position = 0; position < values.length; position++) {
				try {
					const local = await this.cache(values[position], field);
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
			}
		}
		result.warnings = [...new Set(result.warnings)];
		return result;
	}

	private async cache(value: string, field: ImportArtworkField): Promise<string> {
		const url = importArtworkUrl(value);
		if (!url) throw new Error('IMPORT_ARTWORK_REJECTED');
		const uri = artworkCacheUri(url, field);
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			await connection.query('SELECT pg_advisory_lock(hashtext($1))', [uri]);
			locked = true;
			const files = this.db.getRepository(MiDriveFile);
			const cached = await files.findOneBy({ uri, userId: IsNull(), isLink: false });
			if (cached) return cached.webpublicUrl ?? cached.url;
			const image = await downloadImportArtwork(url, field, this.http.getAgentForHttps(url));
			const store = async (data: Buffer, identity: string, extension: string) => {
				const existing = await files.findOneBy({ uri: identity, userId: IsNull(), isLink: false });
				if (existing) return existing;
				const [path, cleanup] = await createTemp();
				try {
					await writeFile(path, data);
					return await this.drive.addFile({ user: null, path, name: `zalip-artwork-${uri.slice(-16)}.${extension}`, uri: identity, isLink: false, sensitive: false });
				} finally { cleanup(); }
			};
			await store(image.original, `${uri}:original`, image.extension);
			const file = await store(image.webp, uri, 'webp');
			return file.webpublicUrl ?? file.url;
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [uri]); } finally { await connection.release(); }
		}
	}
}
