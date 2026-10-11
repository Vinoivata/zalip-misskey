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

	test('fact-only editor saves keep unchanged imported base fields provider-owned', () => {
		const before = entry({ data: { _zalip: { manualFields: [], fieldSources: { name: 'tmdb', description: 'tmdb', imageUrl: 'tmdb', slug: 'tmdb' } } } });
		const edited = mergeZalipCatalogEntry(before, { type: 'person', name: before.name, slug: before.slug, description: before.description, imageUrl: before.imageUrl, data: { birthday: '1970-01-01' } }, 'manual', { protectOnlyChangedBaseFields: true });
		expect(getZalipCatalogEditorialData(edited.data)).toEqual({ manualFields: ['data.birthday'], fieldSources: { name: 'tmdb', description: 'tmdb', imageUrl: 'tmdb', slug: 'tmdb', 'data.birthday': 'manual' } });
		const refreshed = mergeZalipCatalogEntry(edited, { type: 'person', name: 'Provider name', description: 'New biography', imageUrl: 'https://example.test/new.jpg', data: { birthday: '1980-01-01' } }, 'tmdb');
		expect(refreshed).toMatchObject({ name: 'Provider name', description: 'New biography', imageUrl: 'https://example.test/new.jpg', data: { birthday: '1970-01-01' } });
	});

	test('changed editor fields and explicit null clears stay protected, including existing locks', () => {
		const before = entry({ description: null, data: { _zalip: { manualFields: ['imageUrl'], fieldSources: { imageUrl: 'manual' } } } });
		const edited = mergeZalipCatalogEntry(before, { type: 'person', name: 'Editorial name', description: null, imageUrl: before.imageUrl, parentId: null }, 'manual', { protectOnlyChangedBaseFields: true });
		expect(getZalipCatalogEditorialData(edited.data).manualFields).toEqual(['imageUrl', 'name', 'description', 'parentId']);
		const refreshed = mergeZalipCatalogEntry(edited, { type: 'person', name: 'Provider name', description: 'Provider text', imageUrl: 'https://example.test/new.jpg' }, 'tmdb');
		expect(refreshed).toMatchObject({ name: 'Editorial name', description: null, imageUrl: before.imageUrl });
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

	test('editing one fact protects only that fact and preserves explicit editorial clears', () => {
		const edited = mergeZalipCatalogEntry(entry(), { type: 'person', name: 'Name', data: { birthday: null } }, 'manual');
		const updated = mergeZalipCatalogEntry(edited, { type: 'person', name: 'Name', data: { birthday: '1970-01-01', biography: 'Imported biography' } }, 'tmdb');
		expect(updated.data.birthday).toBeNull();
		expect(updated.data.biography).toBe('Imported biography');
		expect(getZalipCatalogEditorialData(updated.data).manualFields).toContain('data.birthday');
		expect(getZalipCatalogEditorialData(updated.data).manualFields).not.toContain('data');
	});

	test('legacy whole-data ownership remains protected and empty facts do not erase data', () => {
		const before = entry({ data: { birthday: '1970-01-01', _zalip: { manualFields: ['data'], fieldSources: { data: 'manual' } } } });
		expect(mergeZalipCatalogEntry(before, { type: 'person', name: 'Name', data: { biography: 'Provider' } }, 'tmdb').data).not.toHaveProperty('biography');
		const refreshed = mergeZalipCatalogEntry(entry({ data: { birthday: '1970-01-01', aliases: ['Name'] } }), { type: 'person', name: 'Name', data: { birthday: null, aliases: [] } }, 'tmdb');
		expect(refreshed.data.birthday).toBe('1970-01-01');
		expect(refreshed.data.aliases).toEqual(['Name']);
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

	test('saveEntry does not claim the mandatory unchanged name when editing person facts', async () => {
		const before = entry({ externalIds: {}, data: { _zalip: { manualFields: [], fieldSources: { name: 'tmdb', description: 'tmdb', imageUrl: 'tmdb' } } } });
		const repository = { findOneBy: vi.fn().mockResolvedValue(before), create: vi.fn(value => value), save: vi.fn() };
		const manager = { query: vi.fn(), getRepository: () => repository };
		const service = new ZalipTaxonomyService({ transaction: async (action: (manager: unknown) => Promise<unknown>) => action(manager) } as never, {} as never);
		await service.saveEntry({ type: 'person', name: before.name, data: { birthday: '1970-01-01' } }, before.id);
		expect(getZalipCatalogEditorialData(repository.save.mock.calls[0][0].data)).toEqual({ manualFields: ['data.birthday'], fieldSources: { name: 'tmdb', description: 'tmdb', imageUrl: 'tmdb', 'data.birthday': 'manual' } });
	});
});

describe('serialized catalogue entry deletion', () => {
	test('uses the same directory transaction lock as enrichment and import before deleting', async () => {
		const repository = { delete: vi.fn().mockResolvedValue({ affected: 1 }) };
		const manager = { query: vi.fn(), getRepository: vi.fn().mockReturnValue(repository) };
		const db = { transaction: vi.fn(async action => await action(manager)), getRepository: vi.fn() };
		const service = new ZalipTaxonomyService(db as never, {} as never);
		await service.deleteEntry('entry');
		expect(db.transaction).toHaveBeenCalledOnce();
		expect(db.getRepository).not.toHaveBeenCalled();
		expect(manager.query).toHaveBeenCalledExactlyOnceWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-directories']);
		expect(manager.getRepository).toHaveBeenCalledWith(MiZalipCatalogEntry);
		expect(repository.delete).toHaveBeenCalledExactlyOnceWith({ id: 'entry' });
		expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(repository.delete.mock.invocationCallOrder[0]);
	});

	test('reports an absent entry from within the locked transaction', async () => {
		const repository = { delete: vi.fn().mockResolvedValue({ affected: 0 }) };
		const manager = { query: vi.fn(), getRepository: () => repository };
		const service = new ZalipTaxonomyService({ transaction: async (action: (manager: unknown) => Promise<unknown>) => action(manager) } as never, {} as never);
		await expect(service.deleteEntry('missing')).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
		expect(manager.query.mock.invocationCallOrder[0]).toBeLessThan(repository.delete.mock.invocationCallOrder[0]);
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

describe('explicit person enrichment', () => {
	function fixture(person = entry()) {
		const identityQuery = { where: vi.fn(), setParameter: vi.fn(), andWhere: vi.fn(), getMany: vi.fn().mockResolvedValue([person]) };
		for (const key of ['where', 'setParameter', 'andWhere'] as const) identityQuery[key].mockReturnValue(identityQuery);
		const repository = { findOneBy: vi.fn().mockResolvedValue(person), create: vi.fn(value => value), save: vi.fn(), createQueryBuilder: () => identityQuery };
		const manager = { query: vi.fn(), getRepository: () => repository };
		const service = new ZalipTaxonomyService({ getRepository: manager.getRepository, transaction: async (action: (manager: unknown) => Promise<unknown>) => action(manager) } as never, {} as never);
		return { service, repository, manager };
	}

	test('enriches only the selected verified identity and keeps manual metadata', async () => {
		const edited = mergeZalipCatalogEntry(entry({ description: null }), { type: 'person', name: 'Editorial name', data: { birthday: null } }, 'manual');
		const { service, repository } = fixture(entry(edited));
		const fetch = vi.fn().mockResolvedValue({ type: 'person', name: 'Provider name', description: 'Biography', externalIds: { tmdb: '10' }, data: { birthday: '1970-01-01', biography: 'Biography', identityQuality: 'verified' } });
		const result = await service.enrichPerson('entry', 'tmdb', fetch);
		expect(fetch).toHaveBeenCalledWith('10');
		expect(result.entry).toMatchObject({ id: 'entry', name: 'Editorial name', description: 'Biography', data: { birthday: null, biography: 'Biography' } });
		expect(result.changedFields).toContain('description');
		expect(result.changedFields).not.toContain('name');
		expect(result.entry.data).not.toHaveProperty('_zalip');
		expect(repository.save).toHaveBeenCalledOnce();
	});

	test('nonempty legacy values without provenance are preserved', async () => {
		const { service } = fixture(entry({ data: { birthday: '1970-01-01' } }));
		const result = await service.enrichPerson('entry', 'tmdb', vi.fn().mockResolvedValue({ type: 'person', name: 'Provider', description: 'New biography', externalIds: { tmdb: '10' }, data: { birthday: '1980-01-01', placeOfBirth: 'Москва' } }));
		expect(result.entry).toMatchObject({ name: 'Name', description: 'Biography', data: { birthday: '1970-01-01', placeOfBirth: 'Москва' } });
	});

	test('refuses unknown, nonperson or unmapped entries before requesting a provider', async () => {
		for (const person of [entry({ type: 'studio' }), entry({ externalIds: {} }), entry({ externalIds: { tmdb: '0' } })]) {
			const { service, repository } = fixture(person);
			const fetch = vi.fn();
			await expect(service.enrichPerson('entry', 'tmdb', fetch)).rejects.toMatchObject({ code: 'invalid-ref' });
			expect(fetch).not.toHaveBeenCalled();
			expect(repository.save).not.toHaveBeenCalled();
		}
		const { service, repository } = fixture();
		repository.findOneBy.mockResolvedValue(null);
		await expect(service.enrichPerson('missing', 'tmdb', vi.fn())).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
	});

	test('rejects upstream or concurrently changed identities before writing', async () => {
		const { service, repository } = fixture();
		await expect(service.enrichPerson('entry', 'tmdb', vi.fn().mockResolvedValue({ type: 'person', name: 'Other', externalIds: { tmdb: '11' } }))).rejects.toMatchObject({ code: 'malformed-response' });
		expect(repository.save).not.toHaveBeenCalled();
		repository.findOneBy.mockResolvedValueOnce(entry()).mockResolvedValueOnce(entry({ externalIds: { tmdb: '11' } }));
		await expect(service.enrichPerson('entry', 'tmdb', vi.fn().mockResolvedValue({ type: 'person', name: 'Name', externalIds: { tmdb: '10' } }))).rejects.toThrow('CATALOG_ID_CONFLICT');
		expect(repository.save).not.toHaveBeenCalled();
	});

	test('does not recreate a person deleted while the provider request was running', async () => {
		const { service, repository } = fixture();
		repository.findOneBy.mockResolvedValueOnce(entry()).mockResolvedValueOnce(null);
		await expect(service.enrichPerson('entry', 'tmdb', vi.fn().mockResolvedValue({ type: 'person', name: 'Name', externalIds: { tmdb: '10' } }))).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
		expect(repository.save).not.toHaveBeenCalled();
	});
});

describe('bounded category rule recalculation', () => {
	function fixture(candidates = [
		{ id: 'work1', kind: 'movie', genres: ['драма'], releaseYear: 2026, importData: { countries: ['Россия'] } },
		{ id: 'work2', kind: 'series', genres: [], releaseYear: 2026, importData: {} },
		{ id: 'work3', kind: 'movie', genres: ['драма'], releaseYear: 2026, importData: { locks: ['categories'] } },
	]) {
		const category = entry({ id: 'category', type: 'category', data: { rules: { kinds: ['movie'], genres: ['драма'] } } });
		const query = { orderBy: vi.fn(), where: vi.fn(), take: vi.fn(), getMany: vi.fn().mockResolvedValue(candidates) };
		for (const key of ['orderBy', 'where', 'take'] as const) query[key].mockReturnValue(query);
		const categories = { findOneBy: vi.fn().mockResolvedValue(category) };
		const works = { createQueryBuilder: () => query };
		const links = { findOneBy: vi.fn().mockResolvedValue(null), create: vi.fn(value => value), save: vi.fn(), delete: vi.fn() };
		const manager = { query: vi.fn(), getRepository: (model: unknown) => model === MiZalipWork ? works : model === MiZalipCatalogEntry ? categories : links };
		const db = { transaction: vi.fn(async action => await action(manager)), getRepository: manager.getRepository };
		const service = new ZalipTaxonomyService(db as never, { gen: () => 'relation' } as never);
		return { service, query, categories, links, manager, db };
	}

	test('replaces only rule-owned membership of the selected category, skipping protected works', async () => {
		const { service, links, manager } = fixture();
		const result = await service.recalculateCategory({ entryId: 'category' });
		expect(result).toEqual({ processed: 3, matched: 1, skipped: 1, nextCursor: null });
		expect(links.save).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'category', workId: 'work1', source: 'rules' }));
		expect(links.delete).toHaveBeenCalledExactlyOnceWith({ entryId: 'category', workId: 'work2', source: 'rules' });
		expect(manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-membership:work1']);
	});

	test('uses a stable cursor and one extra row instead of unbounded catalogue scans', async () => {
		const { service, query, links } = fixture();
		const result = await service.recalculateCategory({ entryId: 'category', afterId: 'work0', limit: 2 });
		expect(query.where).toHaveBeenCalledWith('work.id > :afterId', { afterId: 'work0' });
		expect(query.take).toHaveBeenCalledWith(3);
		expect(result).toEqual({ processed: 2, matched: 1, skipped: 0, nextCursor: 'work2' });
		expect(links.save).toHaveBeenCalledTimes(1);
	});

	test('unknown selected IDs fail before any membership writes', async () => {
		const { service, query, links } = fixture([]);
		await expect(service.recalculateCategory({ entryId: 'category', workIds: ['unknown'] })).rejects.toThrow('NO_SUCH_WORK');
		expect(query.where).toHaveBeenCalledWith('work.id IN (:...workIds)', { workIds: ['unknown'] });
		expect(links.save).not.toHaveBeenCalled();
		expect(links.delete).not.toHaveBeenCalled();
	});

	test('rejects oversized, duplicate and ambiguous batches before opening a transaction', async () => {
		const { service, db } = fixture();
		for (const options of [{ limit: 101 }, { limit: 0 }, { workIds: [] }, { workIds: ['one', 'one'] }, { workIds: ['one'], afterId: 'one' }, { workIds: Array.from({ length: 101 }, (_, i) => `work${i}`) }]) await expect(service.recalculateCategory({ entryId: 'category', ...options })).rejects.toThrow('INVALID_CATALOG_RECALCULATE');
		expect(db.transaction).not.toHaveBeenCalled();
	});

	test('cleared rules remove old rule-derived membership without affecting manual links', async () => {
		const { service, categories, links } = fixture();
		categories.findOneBy.mockResolvedValue(entry({ id: 'category', type: 'category', data: { rules: {} } }));
		const result = await service.recalculateCategory({ entryId: 'category' });
		expect(result.matched).toBe(0);
		expect(links.save).not.toHaveBeenCalled();
		expect(links.delete.mock.calls.every(([criteria]) => criteria.source === 'rules' && criteria.entryId === 'category')).toBe(true);
	});

	test('only category entries can trigger recalculation', async () => {
		const { service, categories, links } = fixture();
		categories.findOneBy.mockResolvedValue(entry({ type: 'person' }));
		await expect(service.recalculateCategory({ entryId: 'entry' })).rejects.toThrow('INVALID_CATALOG_RECALCULATE');
		expect(links.save).not.toHaveBeenCalled();
		expect(links.delete).not.toHaveBeenCalled();
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
