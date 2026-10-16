/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, MoreThan } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { ZalipImporterArtworkService } from '@/core/ZalipImporterArtworkService.js';
import { artworkLocalizationKinds, artworkLocalizationRevision, artworkLocalizationRoleFields, existingArtworkSource, localizeArtworkOwnership } from './zalip-importer/localization.js';
import { importArtworkLimits } from './zalip-importer/artwork.js';
import type { ArtworkLocalizationField, ArtworkLocalizationKind, ArtworkLocalizationValue } from './zalip-importer/localization.js';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity.js';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';

const entities = { work: MiZalipWork, season: MiZalipSeason, episode: MiZalipEpisode, catalog: MiZalipCatalogEntry };
type Row = ObjectLiteral & { id: string; updatedAt: Date; tmdbId?: number | null; tmdbMediaType?: string | null; tmdbEpisodeId?: number | null; workId?: string; seasonId?: string; externalIds?: Record<string, string>; importData?: Record<string, unknown>; importValues?: Record<string, unknown>; data?: Record<string, unknown> };
type StepStatus = 'localized' | 'already-local' | 'empty' | 'stale' | 'unsupported' | 'unavailable' | 'busy';
export type ArtworkLocalizationTarget = { kind: ArtworkLocalizationKind; id: string; field: ArtworkLocalizationField; expected: string; images: number; local: number; eligible: number; unsupported: number; hosts: Record<string, number> };

/** Storage-only operator workflow: no provider requests, metadata import, identity changes or notifications. */
@Injectable()
export class ZalipArtworkLocalizationService {
	private stepActive = false;

	constructor(@Inject(DI.db) private db: DataSource, private artwork: ZalipImporterArtworkService) {}

	private repository(manager: EntityManager, kind: ArtworkLocalizationKind): Repository<Row> {
		return manager.getRepository(entities[kind]) as unknown as Repository<Row>;
	}

	private validate(kind: ArtworkLocalizationKind, field?: ArtworkLocalizationField): void {
		if (!artworkLocalizationKinds.includes(kind) || (field && !artworkLocalizationRoleFields[kind].includes(field))) throw new Error('INVALID_IMPORT_OPTIONS');
	}

	private value(row: Row, field: ArtworkLocalizationField): ArtworkLocalizationValue {
		const value: unknown = row[field];
		if (field === 'galleryPaths') {
			if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string')) throw new Error('INVALID_IMPORT_OPTIONS');
			return [...value] as string[];
		}
		if (value !== null && typeof value !== 'string') throw new Error('INVALID_IMPORT_OPTIONS');
		return value;
	}

	private async tmdbOwned(kind: ArtworkLocalizationKind, row: Row): Promise<boolean> {
		if (kind === 'work') return Boolean(row.tmdbId && row.tmdbMediaType);
		if (kind === 'catalog') return Boolean(row.externalIds?.tmdb);
		if (kind === 'episode' && row.tmdbEpisodeId) return true;
		const season = kind === 'season' ? row : await this.db.getRepository(MiZalipSeason).findOneBy({ id: row.seasonId });
		if (!season?.workId) return false;
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: season.workId });
		return Boolean(work?.tmdbId && work.tmdbMediaType);
	}

	private async lockOwner(manager: EntityManager, kind: ArtworkLocalizationKind, row: Row): Promise<void> {
		if (kind === 'catalog') {
			// Match taxonomy writers' lock order, including their unlocked reads before save().
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-directories']);
		} else if (kind === 'season' || kind === 'episode') {
			const season = kind === 'season' ? row : await manager.getRepository(MiZalipSeason).findOneBy({ id: row.seasonId });
			if (!season?.workId) throw new Error('NO_SUCH_WORK');
			// Importers and legacy season refreshes acquire the work lock before related row saves.
			await manager.getRepository(MiZalipWork).findOne({ where: { id: season.workId }, lock: { mode: 'pessimistic_write' } });
		}
	}

	private async native(value: string): Promise<boolean> {
		// Exact native rows also cover owned object storage and manually uploaded Drive files.
		const file = await this.db.getRepository(MiDriveFile).findOne({ where: [{ url: value, isLink: false }, { webpublicUrl: value, isLink: false }, { thumbnailUrl: value, isLink: false }] });
		return Boolean(file);
	}

	private async describe(kind: ArtworkLocalizationKind, row: Row, field: ArtworkLocalizationField): Promise<ArtworkLocalizationTarget> {
		const value = this.value(row, field);
		const values = Array.isArray(value) ? value : value ? [value] : [];
		const result: ArtworkLocalizationTarget = { kind, id: row.id, field, expected: artworkLocalizationRevision(kind, row.id, field, value), images: values.length, local: 0, eligible: 0, unsupported: 0, hosts: {} };
		const tmdbOwned = await this.tmdbOwned(kind, row);
		for (const current of values) {
			if (await this.native(current)) { result.local++; continue; }
			const source = existingArtworkSource(current, tmdbOwned);
			if (source) { result.eligible++; result.hosts[source.hostname] = (result.hosts[source.hostname] ?? 0) + 1; } else { result.unsupported++; }
		}
		return result;
	}

	public async inspect(kind: ArtworkLocalizationKind, afterId?: string, limit = 100): Promise<{ targets: ArtworkLocalizationTarget[]; nextId: string | null }> {
		this.validate(kind);
		if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (afterId && !/^[a-zA-Z0-9]{1,32}$/u.test(afterId))) throw new Error('INVALID_IMPORT_OPTIONS');
		const rows = await this.repository(this.db.manager, kind).find({ where: afterId ? { id: MoreThan(afterId) } : {}, order: { id: 'ASC' }, take: limit });
		const targets: ArtworkLocalizationTarget[] = [];
		for (const row of rows) for (const field of artworkLocalizationRoleFields[kind]) {
			const target = await this.describe(kind, row, field);
			if (target.images) targets.push(target);
		}
		return { targets, nextId: rows.length === limit ? rows[rows.length - 1].id : null };
	}

	public async step(kind: ArtworkLocalizationKind, id: string, field: ArtworkLocalizationField, expected: string): Promise<{ kind: ArtworkLocalizationKind; id: string; field: ArtworkLocalizationField; status: StepStatus; images: number }> {
		this.validate(kind, field);
		if (!/^[a-zA-Z0-9]{1,32}$/u.test(id) || !/^[a-f0-9]{64}$/u.test(expected)) throw new Error('INVALID_IMPORT_OPTIONS');
		// A cache operation uses a lock connection plus native Drive queries. Never let
		// parallel administrator calls hold every pool slot while waiting for each other.
		// Fail fast rather than retaining an unbounded queue of pending requests.
		if (this.stepActive) return { kind, id, field, status: 'busy', images: 0 };
		this.stepActive = true;
		try {
			return await this.localize(kind, id, field, expected);
		} finally { this.stepActive = false; }
	}

	private async localize(kind: ArtworkLocalizationKind, id: string, field: ArtworkLocalizationField, expected: string): Promise<{ kind: ArtworkLocalizationKind; id: string; field: ArtworkLocalizationField; status: StepStatus; images: number }> {
		const report = (status: StepStatus, images = 0) => ({ kind, id, field, status, images });
		const connection = this.db.createQueryRunner();
		let locked = false;
		try {
			await connection.connect();
			const lockKey = `zalip:artwork-localization:${kind}:${id}:${field}`;
			const [lock] = await connection.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [lockKey]) as { locked: boolean }[];
			if (!lock?.locked) return report('busy');
			locked = true;
			const repository = this.repository(this.db.manager, kind);
			const before = await repository.findOneBy({ id });
			if (!before) return report('stale');
			const target = await this.describe(kind, before, field);
			if (target.expected !== expected) return report('stale', target.images);
			if (!target.images) return report('empty');
			if (target.local === target.images) return report('already-local', target.images);
			if (target.unsupported) return report('unsupported', target.images);
			const oldValue = this.value(before, field);
			const values = Array.isArray(oldValue) ? oldValue : [oldValue!];
			const tmdbOwned = await this.tmdbOwned(kind, before);
			const budget = { deadlineAt: Date.now() + (field === 'galleryPaths' ? 60000 : 45000), remainingBytes: importArtworkLimits.batchBytes };
			const localized: string[] = [];
			try {
				for (const current of values) localized.push(await this.native(current) ? current : await this.artwork.cacheOriginal(existingArtworkSource(current, tmdbOwned)!.href, budget));
			} catch { return report('unavailable', values.length); }
			const nextValue = Array.isArray(oldValue) ? localized : localized[0];
			const applied = await this.db.transaction(async manager => {
				await this.lockOwner(manager, kind, before);
				const lockedRepository = this.repository(manager, kind);
				const current = await lockedRepository.findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
				if (!current || artworkLocalizationRevision(kind, id, field, this.value(current, field)) !== expected) return false;
				const metadataField = kind === 'work' ? 'importData' : kind === 'catalog' ? 'data' : 'importValues';
				const update = { [field]: nextValue, updatedAt: new Date(), [metadataField]: localizeArtworkOwnership(kind, current[metadataField] ?? {}, field, oldValue, nextValue) };
				await lockedRepository.update({ id }, update as QueryDeepPartialEntity<Row>);
				return true;
			});
			return report(applied ? 'localized' : 'stale', values.length);
		} finally {
			try { if (locked) await connection.query('SELECT pg_advisory_unlock(hashtext($1))', [`zalip:artwork-localization:${kind}:${id}:${field}`]); } finally { await connection.release(); }
		}
	}
}
