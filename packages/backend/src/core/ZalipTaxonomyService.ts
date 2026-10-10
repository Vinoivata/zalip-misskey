/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import type { PackedZalipWork } from '@/core/ZalipCatalogService.js';
import type { ImportRecord } from '@/core/zalip-importer/types.js';
import { readImportState } from '@/core/zalip-importer/policy.js';
import { MiZalipCatalogEntry, zalipCatalogEntryTypes, type ZalipCatalogEntryType } from '@/models/ZalipCatalogEntry.js';
import { MiZalipCatalogRelation } from '@/models/ZalipCatalogRelation.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import {
	getZalipCatalogEditorialData,
	matchesZalipCategoryRules,
	mergeZalipCatalogEntry,
	normalizeZalipCategoryRules,
	normalizeZalipCatalogLabel,
	normalizeZalipExternalIds,
	packZalipCatalogFacts,
	zalipCatalogSlug,
	type ZalipCatalogEntryInput,
} from '@/misc/zalip-taxonomy.js';

export type { ZalipCatalogEntryInput } from '@/misc/zalip-taxonomy.js';

export type PackedZalipCatalogEntry = {
	id: string;
	type: ZalipCatalogEntryType;
	slug: string;
	name: string;
	description: string | null;
	imageUrl: string | null;
	parentId: string | null;
	externalIds: Record<string, string>;
	data: Record<string, unknown>;
};

export type ZalipCatalogLinkInput = {
	entryId: string;
	workId: string;
	role?: string;
	character?: string | null;
	position?: number;
};

export type PackedZalipCatalogLink = {
	entry: PackedZalipCatalogEntry;
	role: string;
	character: string | null;
	position: number;
	source?: string;
};

export type ZalipCatalogDirectoryOptions = {
	type?: ZalipCatalogEntryType;
	query?: string;
	limit?: number;
	offset?: number;
	publishedOnly?: boolean;
};

const publicFactKeys = new Set(['biography', 'birthday', 'deathday', 'placeOfBirth', 'homepage', 'originalName', 'aliases', 'identityQuality', 'collectionKind']);

/** Catalogue directories and membership. HTTP callers enforce administrator permissions. */
@Injectable()
export class ZalipTaxonomyService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
	) {
	}

	public packEntry(entry: MiZalipCatalogEntry, admin = false): PackedZalipCatalogEntry {
		const facts = packZalipCatalogFacts(entry.data);
		const data = Object.fromEntries(Object.entries(facts).filter(([key]) => publicFactKeys.has(key)));
		const rules = normalizeZalipCategoryRules(facts.rules);
		if (admin && entry.type === 'category' && rules) data.rules = rules;
		return {
			id: entry.id,
			type: entry.type,
			slug: entry.slug,
			name: entry.name,
			description: entry.description,
			imageUrl: entry.imageUrl,
			parentId: entry.parentId,
			externalIds: { ...entry.externalIds },
			data,
		};
	}

	private validateInput(input: ZalipCatalogEntryInput): ZalipCatalogEntryInput {
		if (!zalipCatalogEntryTypes.includes(input.type)) throw new Error('INVALID_CATALOG_TYPE');
		const name = input.name.trim();
		const slug = input.slug === undefined ? undefined : zalipCatalogSlug(input.slug);
		if (!name || name.length > 256 || !(slug ?? zalipCatalogSlug(name))) throw new Error('INVALID_CATALOG_ENTRY');
		if ((input.description?.length ?? 0) > 8192 || (input.imageUrl?.length ?? 0) > 1024) throw new Error('INVALID_CATALOG_ENTRY');
		if (input.data?.rules !== undefined && input.data.rules !== null && (input.type !== 'category' || !normalizeZalipCategoryRules(input.data.rules))) throw new Error('INVALID_CATALOG_RULES');
		if (input.imageUrl) {
			let url: URL;
			try {
				url = new URL(input.imageUrl);
			} catch {
				throw new Error('INVALID_CATALOG_IMAGE');
			}
			if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_CATALOG_IMAGE');
		}
		return { ...input, name, slug, externalIds: normalizeZalipExternalIds(input.externalIds) };
	}

	private validateSource(source: string): void {
		if (!/^[a-z0-9_-]{1,32}$/u.test(source)) throw new Error('INVALID_CATALOG_SOURCE');
	}

	private async assertParent(manager: EntityManager, entryId: string, type: ZalipCatalogEntryType, parentId: string | null): Promise<void> {
		if (!parentId) return;
		if (type !== 'category') throw new Error('INVALID_CATALOG_PARENT');
		const seen = new Set([entryId]);
		let candidate: string | null = parentId;
		while (candidate) {
			if (seen.has(candidate)) throw new Error('CATALOG_PARENT_CYCLE');
			seen.add(candidate);
			const parent = await manager.getRepository(MiZalipCatalogEntry).findOneBy({ id: candidate });
			if (!parent || parent.type !== type) throw new Error('INVALID_CATALOG_PARENT');
			candidate = parent.parentId;
		}
	}

	/** Global directory lock prevents ambiguous provider-ID races while the test catalogue is small. */
	private async lockEntries(manager: EntityManager): Promise<void> {
		await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-directories']);
	}

	public async saveEntry(input: ZalipCatalogEntryInput, entryId?: string): Promise<PackedZalipCatalogEntry> {
		const clean = this.validateInput(input);
		return this.db.transaction(async manager => {
			await this.lockEntries(manager);
			const repository = manager.getRepository(MiZalipCatalogEntry);
			const existing = entryId ? await repository.findOneBy({ id: entryId }) : null;
			if (entryId && !existing) throw new Error('NO_SUCH_CATALOG_ENTRY');
			if (existing && existing.type !== clean.type) throw new Error('CATALOG_TYPE_IMMUTABLE');
			const entry = existing ?? this.newEntry(clean);
			await this.assertParent(manager, entry.id, entry.type, clean.parentId ?? entry.parentId);
			const updated = repository.create({ ...entry, ...mergeZalipCatalogEntry(entry, clean, 'manual'), updatedAt: new Date() });
			const conflict = await repository.findOneBy({ type: updated.type, slug: updated.slug });
			if (conflict && conflict.id !== updated.id) throw new Error('CATALOG_SLUG_CONFLICT');
			await this.assertExternalIds(manager, updated.type, updated.externalIds, updated.id);
			await repository.save(updated);
			return this.packEntry(updated, true);
		});
	}

	private newEntry(input: ZalipCatalogEntryInput): MiZalipCatalogEntry {
		const now = new Date();
		return this.db.getRepository(MiZalipCatalogEntry).create({
			id: this.idService.gen(),
			createdAt: now,
			updatedAt: now,
			type: input.type,
			slug: input.slug ?? zalipCatalogSlug(input.name),
			name: input.name,
			description: null,
			imageUrl: null,
			externalIds: {},
			data: {},
			parentId: null,
		});
	}

	private async findByExternalIds(manager: EntityManager, type: ZalipCatalogEntryType, ids: Record<string, string>): Promise<MiZalipCatalogEntry[]> {
		const pairs = Object.entries(ids);
		if (pairs.length === 0) return [];
		const query = manager.getRepository(MiZalipCatalogEntry).createQueryBuilder('entry').where('entry.type = :type', { type });
		const conditions = pairs.map((pair, index) => {
			query.setParameter(`identity${index}`, JSON.stringify(Object.fromEntries([pair])));
			return `entry."externalIds" @> :identity${index}::jsonb`;
		});
		return query.andWhere(`(${conditions.join(' OR ')})`).getMany();
	}

	private async assertExternalIds(manager: EntityManager, type: ZalipCatalogEntryType, ids: Record<string, string>, entryId: string): Promise<void> {
		if ((await this.findByExternalIds(manager, type, ids)).some(entry => entry.id !== entryId)) throw new Error('CATALOG_ID_CONFLICT');
	}

	public async upsertImportedEntry(input: ZalipCatalogEntryInput, source: string): Promise<MiZalipCatalogEntry> {
		this.validateSource(source);
		if (source === 'manual') throw new Error('INVALID_CATALOG_SOURCE');
		const clean = this.validateInput(input);
		return this.db.transaction(async manager => {
			await this.lockEntries(manager);
			const repository = manager.getRepository(MiZalipCatalogEntry);
			const matches = await this.findByExternalIds(manager, clean.type, clean.externalIds ?? {});
			if (matches.length > 1) throw new Error('CATALOG_ID_CONFLICT');
			let existing: MiZalipCatalogEntry | undefined = matches.length > 0 ? matches[0] : undefined;
			const label = normalizeZalipCatalogLabel(clean.name, clean.type);
			if (!existing && ['genre', 'studio'].includes(clean.type)) {
				existing = await repository.createQueryBuilder('entry')
					.where('entry.type = :type', { type: clean.type })
					.andWhere('LOWER(entry.name) = :name', { name: label })
					.getOne() ?? undefined;
			}
			const identityPairs = Object.entries(clean.externalIds ?? {});
			const firstIdentity = identityPairs.length > 0 ? identityPairs[0] : undefined;
			const fallbackSlug = clean.slug ?? (firstIdentity ? zalipCatalogSlug(`${clean.type}-${firstIdentity[0]}-${firstIdentity[1]}`) : zalipCatalogSlug(label));
			const bySlug = await repository.findOneBy({ type: clean.type, slug: fallbackSlug });
			if (!existing && bySlug) {
				if (['person', 'collection'].includes(clean.type) && firstIdentity) {
					const storedId = bySlug.externalIds[firstIdentity[0]];
					if (storedId !== firstIdentity[1]) throw new Error('CATALOG_SLUG_CONFLICT');
				}
				existing = bySlug;
			}
			const entry = existing ?? this.newEntry({ ...clean, slug: fallbackSlug });
			await this.assertParent(manager, entry.id, entry.type, clean.parentId ?? entry.parentId);
			const updated = repository.create({ ...entry, ...mergeZalipCatalogEntry(entry, { ...clean, slug: clean.slug }, source), updatedAt: new Date() });
			await this.assertExternalIds(manager, updated.type, updated.externalIds, updated.id);
			await repository.save(updated);
			return updated;
		});
	}

	public async deleteEntry(entryId: string): Promise<void> {
		const result = await this.db.getRepository(MiZalipCatalogEntry).delete({ id: entryId });
		if (!result.affected) throw new Error('NO_SUCH_CATALOG_ENTRY');
	}

	public async listEntries(options: ZalipCatalogDirectoryOptions = {}): Promise<PackedZalipCatalogEntry[]> {
		const publishedOnly = options.publishedOnly ?? true;
		const query = this.db.getRepository(MiZalipCatalogEntry).createQueryBuilder('entry');
		if (options.type) query.andWhere('entry.type = :type', { type: options.type });
		const text = options.query?.trim();
		if (text) query.andWhere('entry.name ILIKE :query', { query: `%${text.replace(/[\\%_]/gu, '\\$&')}%` });
		if (publishedOnly) {
			query.andWhere('EXISTS (SELECT 1 FROM "zalip_catalog_relation" relation INNER JOIN "zalip_work" work ON work.id = relation."workId" WHERE relation."entryId" = entry.id AND work."publicationState" = :publicationState)', { publicationState: 'published' });
		}
		const entries = await query.orderBy('entry.name', 'ASC').addOrderBy('entry.id', 'ASC')
			.take(Math.min(200, Math.max(1, options.limit ?? 50))).skip(Math.max(0, options.offset ?? 0)).getMany();
		return entries.map(entry => this.packEntry(entry, !publishedOnly));
	}

	public async showEntry(options: {
		entryId?: string;
		slug?: string;
		type?: ZalipCatalogEntryType;
		publishedOnly?: boolean;
		limit?: number;
	}): Promise<{ entry: PackedZalipCatalogEntry; works: (PackedZalipWork & { role: string; character: string | null; position: number })[] }> {
		if (!options.entryId && (!options.slug || !options.type)) throw new Error('INVALID_CATALOG_LOOKUP');
		const publishedOnly = options.publishedOnly ?? true;
		const entry = await this.db.getRepository(MiZalipCatalogEntry).findOneBy(options.entryId ? { id: options.entryId } : { type: options.type, slug: options.slug });
		if (!entry) throw new Error('NO_SUCH_CATALOG_ENTRY');
		const query = this.db.getRepository(MiZalipCatalogRelation).createQueryBuilder('relation')
			.innerJoinAndSelect('relation.work', 'work').where('relation.entryId = :entryId', { entryId: entry.id });
		if (publishedOnly) query.andWhere('work.publicationState = :publicationState', { publicationState: 'published' });
		const relations = await query.orderBy('relation.position', 'ASC').addOrderBy('work.releaseYear', 'DESC').addOrderBy('relation.id', 'ASC')
			.take(Math.min(200, Math.max(1, options.limit ?? 100))).getMany();
		if (publishedOnly && relations.length === 0) throw new Error('NO_SUCH_CATALOG_ENTRY');
		const ordered = this.effectiveRelations(relations);
		const works = ordered.flatMap(relation => relation.work ? [{
			...this.packWork(relation.work), role: relation.role, character: relation.character, position: relation.position,
		}] : []);
		return { entry: this.packEntry(entry, !publishedOnly), works };
	}

	private packWork(work: MiZalipWork): PackedZalipWork {
		return {
			id: work.id, slug: work.slug, kind: work.kind, title: work.title, originalTitle: work.originalTitle,
			description: work.description, releaseYear: work.releaseYear, genres: work.genres,
			runtimeMinutes: work.runtimeMinutes, posterPath: work.posterPath, backdropPath: work.backdropPath,
			logoPath: work.logoPath, trailerYoutubeKey: work.trailerYoutubeKey, communityRating: null, ratingCount: 0,
		};
	}

	/** Explicit editorial membership wins over any overlapping source membership. */
	private effectiveRelations(relations: MiZalipCatalogRelation[]): MiZalipCatalogRelation[] {
		const result = new Map<string, MiZalipCatalogRelation>();
		for (const relation of relations) {
			const key = `${relation.entryId}:${relation.workId}:${relation.role}`;
			const previous = result.get(key);
			if (!previous || (relation.source === 'manual' && previous.source !== 'manual')) result.set(key, relation);
		}
		return [...result.values()].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
	}

	public async listWorkEntries(workId: string, options: { publishedOnly?: boolean } = {}): Promise<PackedZalipCatalogLink[]> {
		const publishedOnly = options.publishedOnly ?? true;
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
		if (!work || (publishedOnly && work.publicationState !== 'published')) throw new Error('NO_SUCH_WORK');
		const relations = await this.db.getRepository(MiZalipCatalogRelation).find({ where: { workId }, relations: { entry: true }, order: { position: 'ASC', id: 'ASC' } });
		return this.effectiveRelations(relations).flatMap(relation => relation.entry ? [{
			entry: this.packEntry(relation.entry, !publishedOnly), role: relation.role,
			character: relation.character, position: relation.position, ...(!publishedOnly ? { source: relation.source } : {}),
		}] : []);
	}

	private normalizeLink(input: ZalipCatalogLinkInput): Required<ZalipCatalogLinkInput> {
		const role = input.role?.trim() ?? '';
		const position = input.position ?? 0;
		const characterText = input.character?.trim();
		const character = characterText?.length ? characterText : null;
		if (role.length > 64 || (character?.length ?? 0) > 256 || !Number.isInteger(position) || position < 0 || position > 100000) throw new Error('INVALID_CATALOG_LINK');
		return { ...input, role, character, position };
	}

	private async saveLink(manager: EntityManager, input: ZalipCatalogLinkInput, source: string): Promise<void> {
		const clean = this.normalizeLink(input);
		const repository = manager.getRepository(MiZalipCatalogRelation);
		const existing = await repository.findOneBy({ entryId: clean.entryId, workId: clean.workId, role: clean.role, source });
		await repository.save(repository.create({
			id: existing?.id ?? this.idService.gen(), createdAt: existing?.createdAt ?? new Date(), updatedAt: new Date(), ...clean, source,
		}));
	}

	public async linkWork(input: ZalipCatalogLinkInput, source = 'manual'): Promise<void> {
		this.validateSource(source);
		this.normalizeLink(input);
		await this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-catalog-membership:${input.workId}`]);
			if (!await manager.getRepository(MiZalipWork).existsBy({ id: input.workId })) throw new Error('NO_SUCH_WORK');
			if (!await manager.getRepository(MiZalipCatalogEntry).existsBy({ id: input.entryId })) throw new Error('NO_SUCH_CATALOG_ENTRY');
			await this.saveLink(manager, input, source);
		});
	}

	public async unlinkWork(input: Pick<ZalipCatalogLinkInput, 'entryId' | 'workId' | 'role'>, source = 'manual'): Promise<void> {
		this.validateSource(source);
		const role = input.role?.trim() ?? '';
		await this.db.getRepository(MiZalipCatalogRelation).delete({ entryId: input.entryId, workId: input.workId, role, source });
	}

	public async replaceImportedWorkRelations(
		workId: string,
		source: string,
		inputs: Omit<ZalipCatalogLinkInput, 'workId'>[],
		options: { complete?: boolean; types?: ZalipCatalogEntryType[] } = {},
	): Promise<void> {
		this.validateSource(source);
		if (source === 'manual') throw new Error('INVALID_CATALOG_SOURCE');
		const clean = inputs.map(input => this.normalizeLink({ ...input, workId }));
		await this.db.transaction(async manager => {
			await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`zalip-catalog-membership:${workId}`]);
			if (!await manager.getRepository(MiZalipWork).existsBy({ id: workId })) throw new Error('NO_SUCH_WORK');
			const entryIds = [...new Set(clean.map(input => input.entryId))];
			const entries = entryIds.length > 0 ? await manager.getRepository(MiZalipCatalogEntry).findBy({ id: In(entryIds) }) : [];
			if (entries.length !== entryIds.length || entries.some(entry => options.types && !options.types.includes(entry.type))) throw new Error('NO_SUCH_CATALOG_ENTRY');
			const repository = manager.getRepository(MiZalipCatalogRelation);
			if (options.complete) {
				const previous = await repository.find({ where: { workId, source }, relations: { entry: true } });
				const desired = new Set(clean.map(input => `${input.entryId}:${input.role}`));
				const removed = previous.filter(relation => (!options.types || (relation.entry && options.types.includes(relation.entry.type))) && !desired.has(`${relation.entryId}:${relation.role}`));
				if (removed.length > 0) await repository.delete({ id: In(removed.map(relation => relation.id)) });
			}
			for (const input of clean) await this.saveLink(manager, input, source);
		});
	}

	/** Provider-normalized records never replace categories selected manually by the editor. */
	public async syncImportedWork(workId: string, record: ImportRecord, protectedFields: string[] = []): Promise<void> {
		const protectedSet = new Set(protectedFields);
		const grouped = new Map<string, { source: string; type: ZalipCatalogEntryType; links: Omit<ZalipCatalogLinkInput, 'workId'>[] }>();
		const group = (source: string, type: ZalipCatalogEntryType) => {
			const key = `${source}:${type}`;
			const existing = grouped.get(key);
			if (existing) return existing;
			const created = { source, type, links: [] as Omit<ZalipCatalogLinkInput, 'workId'>[] };
			grouped.set(key, created);
			return created;
		};
		if (!protectedSet.has('credits')) {
			group(record.ref.source, 'person');
			for (const [position, credit] of record.credits.entries()) {
				if (!credit.name.trim()) continue;
				const unresolved = createHash('sha256').update(normalizeZalipCatalogLabel(credit.name)).digest('hex').slice(0, 16);
				const entry = await this.upsertImportedEntry({
					type: 'person', name: credit.name.trim().slice(0, 256), imageUrl: credit.imageUrl,
					...(credit.externalId ? { externalIds: { [credit.source]: credit.externalId } } : {
						slug: `person-${credit.source}-${workId}-${unresolved}`, data: { identityQuality: 'unresolved' },
					}),
				}, credit.source);
				group(credit.source, 'person').links.push({ entryId: entry.id, role: credit.role.slice(0, 64), character: credit.character?.slice(0, 256), position });
			}
		}
		if (!protectedSet.has('companies')) {
			group(record.ref.source, 'studio');
			for (const [position, company] of record.companies.entries()) {
				if (!company.name.trim()) continue;
				const entry = await this.upsertImportedEntry({
					type: 'studio', name: company.name.trim().slice(0, 256), imageUrl: company.imageUrl,
					...(company.externalId ? { externalIds: { [company.source]: company.externalId } } : {}),
				}, company.source);
				group(company.source, 'studio').links.push({ entryId: entry.id, position });
			}
		}
		if (!protectedSet.has('genres')) {
			const genres = group(record.ref.source, 'genre');
			for (const [position, label] of record.genres.entries()) {
				const name = normalizeZalipCatalogLabel(label, 'genre');
				if (!name) continue;
				const entry = await this.upsertImportedEntry({ type: 'genre', name: name.slice(0, 256) }, record.ref.source);
				genres.links.push({ entryId: entry.id, position });
			}
		}
		if (!protectedSet.has('collections')) {
			group(record.ref.source, 'collection');
			for (const [position, collection] of record.collections.entries()) {
				if (!collection.name.trim()) continue;
				const entry = await this.upsertImportedEntry({
					type: 'collection', name: collection.name.trim().slice(0, 256), description: collection.description,
					imageUrl: collection.imageUrl, externalIds: { [collection.source]: collection.externalId },
					data: { collectionKind: 'provider' },
				}, collection.source);
				group(collection.source, 'collection').links.push({ entryId: entry.id, position });
			}
		}
		for (const batch of grouped.values()) {
			await this.replaceImportedWorkRelations(workId, batch.source, batch.links, { complete: record.complete, types: [batch.type] });
		}
		if (!protectedSet.has('categories')) await this.assignCategoryRules(workId, record);
	}

	/** Rules live in the administrator-managed category facts, never in provider payloads. */
	public async assignCategoryRules(workId: string, record: ImportRecord): Promise<void> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
		if (!work) throw new Error('NO_SUCH_WORK');
		const canonical = { ...record, kind: work.kind, genres: work.genres, releaseYear: work.releaseYear, countries: readImportState(work.importData).countries };
		const categories = await this.db.getRepository(MiZalipCatalogEntry).findBy({ type: 'category' });
		const matching = categories.filter(category => matchesZalipCategoryRules(category.data.rules, canonical));
		await this.replaceImportedWorkRelations(workId, 'rules', matching.map((category, position) => ({ entryId: category.id, position })), {
			complete: record.complete, types: ['category'],
		});
	}

	public getProtectedFields(entry: MiZalipCatalogEntry): string[] {
		return getZalipCatalogEditorialData(entry.data).manualFields;
	}
}
