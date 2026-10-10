/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import type { ImportRecord } from '@/core/zalip-importer/types.js';
import {
	getZalipCatalogEditorialData,
	matchesZalipCategoryRules,
	mergeZalipCatalogEntry,
	normalizeZalipCategoryRules,
	normalizeZalipCatalogLabel,
	normalizeZalipExternalIds,
	packZalipCatalogFacts,
	zalipCatalogSlug,
} from '@/misc/zalip-taxonomy.js';

function entry(values: Partial<MiZalipCatalogEntry> = {}): MiZalipCatalogEntry {
	return {
		id: 'entry', type: 'person', slug: 'person-tmdb-10', name: 'Name', description: 'Biography',
		imageUrl: 'https://example.test/portrait.jpg', externalIds: { tmdb: '10' }, data: {},
		parentId: null, parent: null, createdAt: new Date(), updatedAt: new Date(), ...values,
	};
}

function record(values: Partial<ImportRecord> = {}): ImportRecord {
	return {
		ref: { source: 'tmdb', externalId: '100', mediaType: 'movie' }, identities: [],
		title: 'Movie', originalTitle: null, description: null, releaseYear: 2026, runtimeMinutes: null,
		kind: 'movie', genres: [], countries: [], posterUrl: null, backdropUrl: null, logoUrl: null,
		galleryUrls: [], trailerYoutubeKey: null, ratings: [], ageRating: null,
		credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [], ...values,
	};
}

describe('Zalip catalogue normalization and ownership', () => {
	test('normalizes whitespace, Unicode and genre synonyms without changing person identity', () => {
		expect(normalizeZalipCatalogLabel('  Science   Fiction ', 'genre')).toBe('фантастика');
		expect(normalizeZalipCatalogLabel(' Science Fiction ', 'person')).toBe('science fiction');
		expect(zalipCatalogSlug('  Актёр / Режиссёр  ')).toBe('актёр-режиссёр');
		expect(zalipCatalogSlug('a'.repeat(200))).toHaveLength(160);
	});

	test('keeps namespaced IDs distinct and rejects oversized or invalid identities', () => {
		expect(normalizeZalipExternalIds({ ' TMDB:Person ': ' 10 ', kinopoisk: '20' })).toEqual({ 'tmdb:person': '10', kinopoisk: '20' });
		expect(() => normalizeZalipExternalIds({ 'invalid key': '10' })).toThrow('INVALID_EXTERNAL_IDS');
		expect(() => normalizeZalipExternalIds({ tmdb: '' })).toThrow('INVALID_EXTERNAL_IDS');
		expect(() => normalizeZalipExternalIds({ constructor: '10' })).toThrow('INVALID_EXTERNAL_IDS');
	});

	test('manual changes become protected independently by field', () => {
		const before = entry();
		const edited = mergeZalipCatalogEntry(before, { type: 'person', name: 'Editorial name', description: 'Editorial biography' }, 'manual');
		const refreshed = mergeZalipCatalogEntry(edited, { type: 'person', name: 'Provider name', description: 'Provider biography', imageUrl: 'https://example.test/new.jpg' }, 'tmdb');
		expect(refreshed.name).toBe('Editorial name');
		expect(refreshed.description).toBe('Editorial biography');
		expect(refreshed.imageUrl).toBe('https://example.test/new.jpg');
		expect(getZalipCatalogEditorialData(refreshed.data).manualFields).toEqual(['name', 'description']);
	});

	test('empty or incomplete provider data does not erase existing information', () => {
		const before = entry({ data: { birthday: '1970-01-01' } });
		const refreshed = mergeZalipCatalogEntry(before, { type: 'person', name: 'Name', description: '  ', imageUrl: null, data: {} }, 'tmdb');
		expect(refreshed.description).toBe('Biography');
		expect(refreshed.imageUrl).toBe(before.imageUrl);
		expect(refreshed.data.birthday).toBe('1970-01-01');
	});

	test('an explicit editorial clear is preserved during subsequent imports', () => {
		const edited = mergeZalipCatalogEntry(entry(), { type: 'person', name: 'Name', description: null }, 'manual');
		expect(edited.description).toBeNull();
		expect(mergeZalipCatalogEntry(edited, { type: 'person', name: 'Name', description: 'Provider text' }, 'tmdb').description).toBeNull();
	});

	test('merges compatible IDs and fails instead of silently remapping a person', () => {
		expect(mergeZalipCatalogEntry(entry(), { type: 'person', name: 'Name', externalIds: { kinopoisk: '20' } }, 'kinopoisk').externalIds).toEqual({ tmdb: '10', kinopoisk: '20' });
		expect(() => mergeZalipCatalogEntry(entry(), { type: 'person', name: 'Name', externalIds: { tmdb: '11' } }, 'tmdb')).toThrow('CATALOG_ID_CONFLICT');
	});

	test('caller-supplied ownership metadata cannot unlock editorial fields', () => {
		const edited = mergeZalipCatalogEntry(entry(), { type: 'person', name: 'Protected', data: { birthday: '1970-01-01', _zalip: { manualFields: [] } } }, 'manual');
		const refreshed = mergeZalipCatalogEntry(edited, { type: 'person', name: 'Overwrite', data: { _zalip: { manualFields: [] } } }, 'tmdb');
		expect(refreshed.name).toBe('Protected');
		expect(packZalipCatalogFacts(refreshed.data)).toEqual({ birthday: '1970-01-01' });
	});

	test('does not expose provider payloads or ownership data in public directories', () => {
		const service = new ZalipTaxonomyService({} as never, {} as never);
		const packed = service.packEntry(entry({ data: { biography: 'Bio', raw: { token: 'not-a-real-token' }, rules: { all: true }, _zalip: { manualFields: ['name'] } } }));
		expect(packed.data).toEqual({ biography: 'Bio' });
		expect(service.packEntry(entry({ data: { _zalip: { manualFields: ['name'] }, birthday: '1970-01-01' } }), true).data).toEqual({ birthday: '1970-01-01' });
	});

	test('roundtrips category rules only to administrators, excluding unknown and private JSON', async () => {
		const repository = { findOneBy: vi.fn().mockResolvedValue(null), create: vi.fn(value => value), save: vi.fn() };
		const manager = { query: vi.fn(), getRepository: () => repository };
		const service = new ZalipTaxonomyService({ getRepository: manager.getRepository, transaction: async (action: (manager: unknown) => Promise<unknown>) => action(manager) } as never, { gen: () => 'category' } as never);
		const rules = { genres: ['драма'], yearFrom: 2020 };
		const saved = await service.saveEntry({ type: 'category', name: 'Drama', data: { rules, raw: { secret: 'private' } } });
		expect(saved.data).toEqual({ rules });
		expect(repository.save.mock.calls[0][0].data.rules).toEqual(rules);
		expect(service.packEntry(repository.save.mock.calls[0][0]).data).toEqual({});
		expect(service.packEntry(entry({ type: 'category', data: { rules: { ...rules, token: 'private' }, raw: 'private' } }), true).data).toEqual({ rules });
		await expect(service.saveEntry({ type: 'category', name: 'Invalid', data: { rules: { countries: 'Россия' } } })).rejects.toThrow('INVALID_CATALOG_RULES');
	});
});

describe('Zalip category rules', () => {
	const work = { kind: 'movie', genres: ['фантастика', 'драма'], countries: ['Россия'], releaseYear: 2026 };

	test('requires all configured dimensions, accepting alternatives inside one dimension', () => {
		expect(matchesZalipCategoryRules({ kinds: ['movie'], genres: ['Science Fiction'], countries: [' Россия '], yearFrom: 2020 }, work)).toBe(true);
		expect(matchesZalipCategoryRules({ genres: ['comedy'], countries: ['Россия'] }, work)).toBe(false);
		expect(matchesZalipCategoryRules({ kinds: ['series'] }, work)).toBe(false);
	});

	test('does not assign every title for empty, malformed or inverted rules', () => {
		for (const value of [null, {}, [], { countries: 'Россия' }, { yearFrom: 2030, yearTo: 2020 }, { yearFrom: 1 }, { genres: [12] }]) {
			expect(matchesZalipCategoryRules(value, work)).toBe(false);
		}
		expect(matchesZalipCategoryRules({ all: true }, work)).toBe(true);
		expect(matchesZalipCategoryRules({ yearFrom: 2020 }, { ...work, releaseYear: null })).toBe(false);
	});

	test('projects and bounds editable rule fields without exposing arbitrary JSON', () => {
		expect(normalizeZalipCategoryRules({ genres: [' драма ', 'драма'], raw: 'private', token: 'private' })).toEqual({ genres: ['драма'] });
		expect(normalizeZalipCategoryRules({ kinds: ['unrecognized'] })).toBeNull();
		expect(normalizeZalipCategoryRules({ countries: Array.from({ length: 101 }, () => 'Россия') })).toBeNull();
		expect(normalizeZalipCategoryRules({ genres: [''] })).toBeNull();
	});
});

describe('Zalip catalogue membership', () => {
	function membershipFixture() {
		const oldEntry = entry({ id: 'old', type: 'genre' });
		const newEntry = entry({ id: 'new', type: 'genre' });
		const manual = { id: 'manual', entryId: oldEntry.id, workId: 'work', role: '', source: 'manual', entry: oldEntry };
		const previous = { id: 'provider', entryId: oldEntry.id, workId: 'work', role: '', source: 'tmdb', entry: oldEntry };
		const relations = {
			find: vi.fn().mockResolvedValue([previous]), findOneBy: vi.fn().mockResolvedValue(null),
			create: vi.fn(value => value), save: vi.fn(), delete: vi.fn(),
		};
		const entries = { findBy: vi.fn().mockResolvedValue([newEntry]), existsBy: vi.fn().mockResolvedValue(true) };
		const works = { existsBy: vi.fn().mockResolvedValue(true) };
		const manager = {
			query: vi.fn(),
			getRepository: (model: unknown) => model === MiZalipWork ? works : model === MiZalipCatalogEntry ? entries : relations,
		};
		const db = { transaction: vi.fn(async action => await action(manager)), getRepository: manager.getRepository };
		const service = new ZalipTaxonomyService(db as never, { gen: () => 'generated' } as never);
		return { service, relations, entries, works, manager, manual, previous };
	}

	test('complete source updates replace only their own links, under a work-specific lock', async () => {
		const { service, relations, manager } = membershipFixture();
		await service.replaceImportedWorkRelations('work', 'tmdb', [{ entryId: 'new' }], { complete: true, types: ['genre'] });
		expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-membership:work']);
		expect(relations.find).toHaveBeenCalledWith({ where: { workId: 'work', source: 'tmdb' }, relations: { entry: true } });
		expect(relations.delete).toHaveBeenCalledWith(expect.objectContaining({ id: expect.objectContaining({ _value: ['provider'] }) }));
		expect(relations.save).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'new', workId: 'work', source: 'tmdb' }));
	});

	test('partial updates never remove existing source links', async () => {
		const { service, relations } = membershipFixture();
		await service.replaceImportedWorkRelations('work', 'tmdb', [{ entryId: 'new' }], { complete: false, types: ['genre'] });
		expect(relations.find).not.toHaveBeenCalled();
		expect(relations.delete).not.toHaveBeenCalled();
		expect(relations.save).toHaveBeenCalledOnce();
	});

	test('replacement of genres cannot remove credits owned by the same source', async () => {
		const { service, relations, previous } = membershipFixture();
		relations.find.mockResolvedValue([{ ...previous, entry: entry({ type: 'person' }) }]);
		await service.replaceImportedWorkRelations('work', 'tmdb', [{ entryId: 'new' }], { complete: true, types: ['genre'] });
		expect(relations.delete).not.toHaveBeenCalled();
	});

	test('rejects using the imported replacement method for manual membership', async () => {
		const { service, relations } = membershipFixture();
		await expect(service.replaceImportedWorkRelations('work', 'manual', [], { complete: true })).rejects.toThrow('INVALID_CATALOG_SOURCE');
		expect(relations.delete).not.toHaveBeenCalled();
	});

	test('rejects unknown titles and noncanonical membership IDs before writing', async () => {
		const { service, works, relations, entries } = membershipFixture();
		works.existsBy.mockResolvedValue(false);
		await expect(service.replaceImportedWorkRelations('missing', 'tmdb', [{ entryId: 'new' }])).rejects.toThrow('NO_SUCH_WORK');
		expect(relations.save).not.toHaveBeenCalled();
		works.existsBy.mockResolvedValue(true);
		entries.findBy.mockResolvedValue([]);
		await expect(service.replaceImportedWorkRelations('work', 'tmdb', [{ entryId: 'provider-film-id' }])).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
	});

	test('public work links deny drafts, even when their directory entries are otherwise public', async () => {
		const works = { findOneBy: vi.fn().mockResolvedValue({ id: 'draft', publicationState: 'draft' }) };
		const relations = { find: vi.fn() };
		const service = new ZalipTaxonomyService({ getRepository: (model: unknown) => model === MiZalipWork ? works : relations } as never, {} as never);
		await expect(service.listWorkEntries('draft')).rejects.toThrow('NO_SUCH_WORK');
		expect(relations.find).not.toHaveBeenCalled();
	});

	test('public directory queries require published membership while admin queries retain drafts', async () => {
		const query = { andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), skip: vi.fn(), getMany: vi.fn().mockResolvedValue([]) };
		for (const key of ['andWhere', 'orderBy', 'addOrderBy', 'take', 'skip'] as const) query[key].mockReturnValue(query);
		const service = new ZalipTaxonomyService({ getRepository: () => ({ createQueryBuilder: () => query }) } as never, {} as never);
		await service.listEntries({ type: 'person' });
		expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('work."publicationState" = :publicationState'), { publicationState: 'published' });
		query.andWhere.mockClear();
		await service.listEntries({ type: 'person', publishedOnly: false });
		expect(query.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('publicationState'), expect.anything());
	});

	test('manual role, character and position win over duplicate provider credits', async () => {
		const common = { entryId: 'entry', workId: 'work', role: 'actor', entry: entry() };
		const relations = { find: vi.fn().mockResolvedValue([
			{ ...common, id: 'provider', source: 'tmdb', character: 'Provider character', position: 0 },
			{ ...common, id: 'manual', source: 'manual', character: 'Editorial character', position: 7 },
		]) };
		const works = { findOneBy: vi.fn().mockResolvedValue({ publicationState: 'published' }) };
		const service = new ZalipTaxonomyService({ getRepository: (model: unknown) => model === MiZalipWork ? works : relations } as never, {} as never);
		const result = await service.listWorkEntries('work');
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({ character: 'Editorial character', position: 7 });
		expect(result[0]).not.toHaveProperty('source');
	});

	test('protected source fields never create or replace directory entries', async () => {
		const service = new ZalipTaxonomyService({} as never, {} as never);
		const upsert = vi.spyOn(service, 'upsertImportedEntry');
		const replace = vi.spyOn(service, 'replaceImportedWorkRelations');
		const assign = vi.spyOn(service, 'assignCategoryRules');
		await service.syncImportedWork('work', record({ credits: [{ source: 'tmdb', externalId: '10', name: 'Actor', role: 'actor', character: null, imageUrl: null }] }), ['credits', 'companies', 'genres', 'collections', 'categories']);
		expect(upsert).not.toHaveBeenCalled();
		expect(replace).not.toHaveBeenCalled();
		expect(assign).not.toHaveBeenCalled();
	});

	test('unknown person IDs are work-scoped instead of merging unrelated namesakes', async () => {
		const service = new ZalipTaxonomyService({} as never, {} as never);
		const upsert = vi.spyOn(service, 'upsertImportedEntry').mockResolvedValue(entry());
		vi.spyOn(service, 'replaceImportedWorkRelations').mockResolvedValue();
		const content = record({ complete: false, credits: [{ source: 'collaps', externalId: null, name: 'Александр Иванов', role: 'actor', character: null, imageUrl: null }] });
		await service.syncImportedWork('first-work', content, ['companies', 'genres', 'collections', 'categories']);
		await service.syncImportedWork('second-work', content, ['companies', 'genres', 'collections', 'categories']);
		expect(upsert.mock.calls[0][0].slug).toContain('first-work');
		expect(upsert.mock.calls[1][0].slug).toContain('second-work');
		expect(upsert.mock.calls[0][0].data).toEqual({ identityQuality: 'unresolved' });
	});
});
