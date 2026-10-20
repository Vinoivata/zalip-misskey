/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { MiZalipCatalogRelation } from '@/models/ZalipCatalogRelation.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import type { ImportRecord } from '@/core/zalip-importer/types.js';
import {
	getZalipCatalogEditorialData,
	getZalipCollectionSettings,
	decodeZalipCatalogCursor,
	encodeZalipCatalogCursor,
	matchesZalipCategoryRules,
	mergeZalipCatalogEntry,
	normalizeZalipCategoryRules,
	normalizeZalipCatalogLabel,
	normalizeZalipExternalIds,
	packZalipCatalogFacts,
	zalipCatalogSlug,
	decodeZalipFilmographyCursor,
	encodeZalipFilmographyCursor,
	normalizeZalipFilmographyFilters,
	zalipFilmographyScope,
	zalipPersonRole,
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

describe('collection semantics and visibility', () => {
	test('projects separate semantic defaults without altering provenance or private facts', () => {
		const service = new ZalipTaxonomyService({} as never, {} as never);
		const existing = entry({ type: 'collection', data: { collectionKind: 'provider', raw: 'private' } });
		expect(service.packEntry(existing).data).toEqual({ collectionKind: 'provider', semanticKind: 'theme', isEnabled: true });
		expect(existing.data).toEqual({ collectionKind: 'provider', raw: 'private' });
		expect(service.packEntry(entry({ type: 'collection', data: { semanticKind: 'franchise', isEnabled: false } }), true).data).toEqual({ semanticKind: 'franchise', isEnabled: false });
		expect(getZalipCollectionSettings({ semanticKind: 'unknown' })).toEqual({ semanticKind: 'theme', isEnabled: true });
	});

	test('each semantic setting can be editorially protected without freezing other facts', () => {
		const before = entry({ type: 'collection', data: { semanticKind: 'theme', isEnabled: true, collectionKind: 'provider' } });
		const edited = mergeZalipCatalogEntry(before, { type: 'collection', name: before.name, data: { semanticKind: 'franchise', isEnabled: false } }, 'manual', { protectOnlyChangedBaseFields: true });
		const refreshed = mergeZalipCatalogEntry(edited, { type: 'collection', name: 'Provider', data: { semanticKind: 'platform', isEnabled: true, originalName: 'New fact' } }, 'collaps');
		expect(refreshed.data).toMatchObject({ semanticKind: 'franchise', isEnabled: false, collectionKind: 'provider', originalName: 'New fact' });
		expect(getZalipCatalogEditorialData(refreshed.data).manualFields).toEqual(['data.semanticKind', 'data.isEnabled']);
	});

	test('rejects invalid semantic values and noncollection settings before opening a transaction', async () => {
		const db = { transaction: vi.fn() };
		const service = new ZalipTaxonomyService(db as never, {} as never);
		for (const input of [
			{ type: 'collection', data: { semanticKind: 'provider' } },
			{ type: 'collection', data: { semanticKind: null } },
			{ type: 'collection', data: { isEnabled: 'false' } },
			{ type: 'person', data: { isEnabled: false } },
			{ type: 'genre', data: { semanticKind: 'theme' } },
		] as const) await expect(service.saveEntry({ name: 'Name', ...input })).rejects.toThrow('INVALID_COLLECTION_DATA');
		expect(db.transaction).not.toHaveBeenCalled();
	});

	test('disabled collection membership is hidden publicly but retained for administrators', async () => {
		const collections = [entry({ id: 'disabled', type: 'collection', data: { isEnabled: false } }), entry({ id: 'enabled', type: 'collection' })];
		const relations = { find: vi.fn().mockResolvedValue(collections.map((item, i) => ({ id: `link${i}`, entryId: item.id, workId: 'work', role: '', position: i, source: 'manual', entry: item }))) };
		const works = { findOneBy: vi.fn().mockResolvedValue({ publicationState: 'published' }) };
		const service = new ZalipTaxonomyService({ getRepository: (model: unknown) => model === MiZalipWork ? works : relations } as never, {} as never);
		expect((await service.listWorkEntries('work')).map(link => link.entry.id)).toEqual(['enabled']);
		expect((await service.listWorkEntries('work', { publishedOnly: false })).map(link => link.entry.id)).toEqual(['disabled', 'enabled']);
	});
});

describe('scoped catalogue cursor pagination', () => {
	const relations = Array.from({ length: 103 }, (_, i) => ({
		id: `relation${String(i).padStart(3, '0')}`, entryId: 'entry', workId: `work${i}`, role: i === 102 ? 'director' : 'actor', position: Math.floor(i / 2), character: null, source: 'tmdb',
		work: { id: `work${i}`, slug: `work-${i}`, title: `Movie ${i}`, releaseYear: 2026, genres: [], publicationState: 'published' },
	})) as unknown as MiZalipCatalogRelation[];

	function fixture(value = entry({ type: 'collection' })) {
		let cursor: { cursorPosition: number; cursorId: string } | undefined;
		let limit = 0;
		const query = {
			innerJoinAndSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn((_sql, params) => { if (params?.cursorId) cursor = params; return query; }),
			orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(value => { limit = value; return query; }),
			getExists: vi.fn().mockResolvedValue(true),
			getMany: vi.fn(async () => relations.filter(item => !cursor || item.position > cursor.cursorPosition || (item.position === cursor.cursorPosition && item.id > cursor.cursorId)).slice(0, limit)),
		};
		for (const key of ['innerJoinAndSelect', 'where', 'orderBy', 'addOrderBy'] as const) query[key].mockReturnValue(query);
		const entries = { findOneBy: vi.fn().mockResolvedValue(value) };
		const service = new ZalipTaxonomyService({ getRepository: (model: unknown) => model === MiZalipCatalogEntry ? entries : { createQueryBuilder: () => query } } as never, {} as never);
		return { service, query, entries };
	}

	test('returns all rows beyond the previous first100 cap, with stable same-position continuation', async () => {
		const { service, query } = fixture();
		const first = await service.showEntry({ entryId: 'entry' });
		expect(first.works).toHaveLength(100);
		expect(first.nextCursor).toEqual(expect.any(String));
		if (!first.nextCursor) throw new Error('Missing continuation');
		expect(decodeZalipCatalogCursor(first.nextCursor, 'entry', true)).toEqual({ position: relations[99].position, id: relations[99].id });
		const second = await service.showEntry({ entryId: 'entry', cursor: first.nextCursor });
		expect(second.works.map(work => work.id)).toEqual(['work100', 'work101', 'work102']);
		expect(second.nextCursor).toBeNull();
		expect(query.orderBy).toHaveBeenCalledWith('relation.position', 'ASC');
		expect(query.addOrderBy).toHaveBeenCalledWith('relation.id', 'ASC');
		expect(query.take).toHaveBeenCalledWith(101);
	});

	test('filters overlapping sources in SQL before keyset filtering and row limiting', async () => {
		const { service, query } = fixture();
		const cursor = encodeZalipCatalogCursor('entry', true, { position: 1, id: 'relation001' });
		await service.showEntry({ entryId: 'entry', cursor, limit: 2 });
		const dedupIndex = query.andWhere.mock.calls.findIndex(([sql]) => String(sql).includes('NOT EXISTS'));
		const cursorIndex = query.andWhere.mock.calls.findIndex(([sql]) => String(sql).includes('cursorPosition'));
		expect(dedupIndex).toBeGreaterThanOrEqual(0);
		expect(dedupIndex).toBeLessThan(cursorIndex);
		expect(query.andWhere.mock.calls[dedupIndex][0]).toContain('preferred.source = \'manual\' AND relation.source <> \'manual\'');
		expect(query.andWhere.mock.calls[dedupIndex][0]).toContain('preferred."workId" = relation."workId" AND preferred.role = relation.role');
		expect(query.andWhere.mock.invocationCallOrder[dedupIndex]).toBeLessThan(query.take.mock.invocationCallOrder[0]);
	});

	test('empty final pages retain a public entry, while unpublished directories remain undiscoverable', async () => {
		const { service, query } = fixture();
		const cursor = encodeZalipCatalogCursor('entry', true, { position: 100000, id: 'zzzz' });
		await expect(service.showEntry({ entryId: 'entry', cursor })).resolves.toMatchObject({ works: [], nextCursor: null, entry: { id: 'entry' } });
		query.getExists.mockResolvedValue(false);
		await expect(service.showEntry({ entryId: 'entry' })).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
	});

	test('public lookup refuses disabled collections before any relation query', async () => {
		const { service, query } = fixture(entry({ type: 'collection', data: { isEnabled: false } }));
		await expect(service.showEntry({ entryId: 'entry' })).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
		expect(query.getExists).not.toHaveBeenCalled();
		await expect(service.showEntry({ entryId: 'entry', publishedOnly: false, limit: 1 })).resolves.toMatchObject({ entry: { data: { isEnabled: false } } });
	});

	test('bounded canonical cursors bind identity and public/admin visibility without leaking extra JSON', () => {
		const cursor = encodeZalipCatalogCursor('entry', true, { position: 7, id: 'relation01' });
		expect(decodeZalipCatalogCursor(cursor, 'entry', true)).toEqual({ position: 7, id: 'relation01' });
		for (const value of ['', 'a'.repeat(257), cursor + '=', Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify([1, 'entry', true, -1, 'relation01'])).toString('base64url'), Buffer.from(JSON.stringify([1, 'entry', true, 0, 'x; DROP TABLE work'])).toString('base64url')]) expect(() => decodeZalipCatalogCursor(value, 'entry', true)).toThrow('INVALID_CATALOG_CURSOR');
		expect(() => decodeZalipCatalogCursor(cursor, 'other', true)).toThrow('INVALID_CATALOG_CURSOR');
		expect(() => decodeZalipCatalogCursor(cursor, 'entry', false)).toThrow('INVALID_CATALOG_CURSOR');
	});
});

describe('distinct-work person filmography', () => {
	const works = [
		{ id: 'a', title: 'Alpha', releaseYear: 2025, kind: 'movie' },
		{ id: 'b', title: 'Beta', releaseYear: 2025, kind: 'series' },
		{ id: 'c', title: 'Gamma', releaseYear: 2020, kind: 'movie' },
		{ id: 'd', title: 'Delta', releaseYear: null, kind: 'anime' },
		{ id: 'e', title: 'Echo', releaseYear: null, kind: 'animation' },
		{ id: 'draft', title: 'Private', releaseYear: 2026, kind: 'movie', publicationState: 'draft' },
	].map(work => ({ publicationState: 'published', slug: work.id, genres: [], ...work })) as unknown as MiZalipWork[];
	const links = works.map((work, index) => ({ id: `actor${index}`, entryId: 'entry', workId: work.id, work, role: index === 1 ? 'voice_male' : 'actor', character: 'Character', position: index, source: 'tmdb' }));
	links.push({ ...links[0], id: 'director', role: 'director', character: 'Creator', position: 10 });
	links.push({ ...links[0], id: 'editorial', source: 'manual', character: 'Editorial', position: 7 });

	function fixture(visible = true, additional: typeof links = []) {
		const memberLinks = [...links, ...additional];
		const queries: Record<string, ReturnType<typeof vi.fn>>[] = []; const memberships: Record<string, ReturnType<typeof vi.fn>>[] = [];
		const entries = { findOneBy: vi.fn().mockResolvedValue(entry({ data: { biography: 'Public', _zalip: { secret: 'hidden' }, raw: 'hidden' } })) };
		const repository = (model: unknown) => model === MiZalipCatalogEntry ? entries : { createQueryBuilder: () => {
			const state: Record<string, unknown> = {}; let take = 0; let sort = 'newest'; let nullAnchor = false;
			const query: Record<string, ReturnType<typeof vi.fn>> = {};
			for (const method of ['where', 'andWhere', 'innerJoin', 'addOrderBy']) query[method] = vi.fn((sql, parameters) => { Object.assign(state, parameters); if (String(sql).includes('releaseYear IS NULL AND work.id')) nullAnchor = true; return query; });
			query.orderBy = vi.fn((column, direction) => { sort = String(column).includes('LOWER') ? 'title' : column === 'work.releaseYear' && direction === 'ASC' ? 'oldest' : 'newest'; return query; });
			query.take = vi.fn(value => { take = value; return query; });
			query.getExists = vi.fn(async () => visible);
			query.getMany = vi.fn(async () => {
				if (model === MiZalipCatalogRelation) return memberLinks.filter(link => (!state.publicationState || link.work.publicationState === state.publicationState) && (!state.pageWorkIds || (state.pageWorkIds as string[]).includes(link.workId)));
				const selected = works.filter(work => (!state.publicationState || work.publicationState === state.publicationState) && (!state.filmographyKind || work.kind === state.filmographyKind) && (state.filmographyYearFrom === undefined || work.releaseYear !== null && work.releaseYear >= Number(state.filmographyYearFrom)) && (state.filmographyYearTo === undefined || work.releaseYear !== null && work.releaseYear <= Number(state.filmographyYearTo)) && (!state.filmographyRole || memberLinks.some(link => link.workId === work.id && zalipPersonRole(link.role) === state.filmographyRole)));
				selected.sort((left, right) => sort === 'title' ? left.title.toLowerCase().localeCompare(right.title.toLowerCase(), 'en') || left.id.localeCompare(right.id) : left.releaseYear === right.releaseYear ? left.id.localeCompare(right.id) : left.releaseYear === null ? 1 : right.releaseYear === null ? -1 : (left.releaseYear - right.releaseYear) * (sort === 'newest' ? -1 : 1));
				return selected.filter(work => !state.cursorId || sort === 'title' ? !state.cursorId || work.title.toLowerCase() > String(state.cursorValue).toLowerCase() || work.title.toLowerCase() === String(state.cursorValue).toLowerCase() && work.id > String(state.cursorId) : nullAnchor ? work.releaseYear === null && work.id > String(state.cursorId) : work.releaseYear === null || (sort === 'newest' ? Number(work.releaseYear) < Number(state.cursorValue) : Number(work.releaseYear) > Number(state.cursorValue)) || work.releaseYear === state.cursorValue && work.id > String(state.cursorId)).slice(0, take);
			});
			(model === MiZalipCatalogRelation ? memberships : queries).push(query); return query;
		} };
		const service = new ZalipTaxonomyService({ getRepository: repository } as never, {} as never);
		return { service, queries, memberships, entries };
	}

	test('keeps all effective credits on one unique-work page and never repeats works across equal-year boundaries', async () => {
		const { service, queries } = fixture();
		const first = await service.showEntry({ entryId: 'entry', limit: 1 });
		expect(first.works).toHaveLength(1);
		expect(first.works[0]).toMatchObject({ id: 'a', role: 'actor', character: 'Editorial', credits: [{ role: 'actor', character: 'Editorial' }, { role: 'director', character: 'Creator' }] });
		expect(first.entry.data).toEqual({ biography: 'Public' });
		const seen = ['a']; let cursor = first.nextCursor;
		while (cursor) { const page = await service.showEntry({ entryId: 'entry', limit: 1, cursor }); seen.push(...new Set(page.works.map(work => work.id))); cursor = page.nextCursor; }
		expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
		expect(queries[0].take).toHaveBeenCalledWith(2);
		expect(queries[0].orderBy).toHaveBeenCalledWith('work.releaseYear', 'DESC', 'NULLS LAST');
	});

	test('applies canonical roles, kind and year bounds in SQL before paging unique works', async () => {
		const { service, queries, memberships } = fixture();
		const page = await service.showEntry({ entryId: 'entry', role: 'actor', kind: 'series', yearFrom: 2024, yearTo: 2026, sort: 'oldest', limit: 1 });
		expect(page.works.map(work => work.id)).toEqual(['b']); expect(page.nextCursor).toBeNull();
		expect(queries[0].where).toHaveBeenCalledWith(expect.stringContaining('CASE WHEN'), { entryId: 'entry', filmographyRole: 'actor' });
		expect(queries[0].andWhere).toHaveBeenCalledWith('work.kind = :filmographyKind', { filmographyKind: 'series' });
		expect(queries[0].andWhere).toHaveBeenCalledWith('work.releaseYear >= :filmographyYearFrom', { filmographyYearFrom: 2024 });
		expect(queries[0].andWhere).toHaveBeenCalledWith('work.releaseYear <= :filmographyYearTo', { filmographyYearTo: 2026 });
		expect(queries[0].orderBy).toHaveBeenCalledWith('work.releaseYear', 'ASC', 'NULLS LAST');
		expect(memberships[0].andWhere).toHaveBeenCalledWith(expect.stringContaining('ORDER BY bounded.position ASC, bounded.id ASC LIMIT 300'), { boundedRole: 'actor' });
		const effective = memberships[0].andWhere.mock.calls.find(([sql]) => String(sql).includes('SELECT bounded.id'))!;
		expect(effective[0]).toContain("preferred.source = 'manual' AND bounded.source <> 'manual'");
	});

	test('a person linked only to drafts is not disclosed, while explicit administrator access remains possible', async () => {
		const hidden = fixture(false);
		await expect(hidden.service.showEntry({ entryId: 'entry' })).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
		expect(hidden.queries).toHaveLength(0);
		const admin = await hidden.service.showEntry({ entryId: 'entry', publishedOnly: false });
		expect(admin.works.some(work => work.id === 'draft')).toBe(true);
	});

	test('bounds large legacy credit sets without repeating the packed work or splitting its credits across pages', async () => {
		const additional = Array.from({ length: 400 }, (_, i) => ({ ...links[0], id: `extra${i}`, role: `job${i}`, position: 1000 + i }));
		const { service, memberships } = fixture(true, additional);
		const page = await service.showEntry({ entryId: 'entry', role: 'participant', limit: 1 });
		expect(page.works).toHaveLength(1); expect(page.works[0].id).toBe('a'); expect(page.works[0].credits).toHaveLength(300); expect(page.nextCursor).toBeNull();
		expect(memberships[0].andWhere).toHaveBeenCalledWith(expect.stringContaining('LIMIT 300'), { boundedRole: 'participant' });
	});

	test('title pages use stable lower-case SQL keys, and filtered-empty persons remain public', async () => {
		const { service, queries } = fixture();
		const first = await service.showEntry({ entryId: 'entry', sort: 'title', limit: 2 });
		expect([...new Set(first.works.map(work => work.id))]).toEqual(['a', 'b']);
		const second = await service.showEntry({ entryId: 'entry', sort: 'title', limit: 2, cursor: first.nextCursor! });
		expect([...new Set(second.works.map(work => work.id))]).toEqual(['d', 'e']);
		expect(queries[0].orderBy).toHaveBeenCalledWith('LOWER(work.title) COLLATE "C"', 'ASC');
		await expect(service.showEntry({ entryId: 'entry', yearFrom: 2099 })).resolves.toMatchObject({ entry: { id: 'entry' }, works: [], nextCursor: null });
	});

	test('rejects changed filter/sort/visibility scope, malformed cursors and invalid input before work queries', async () => {
		const { service, queries, memberships } = fixture();
		const first = await service.showEntry({ entryId: 'entry', limit: 1 }); const count = queries.length;
		for (const filters of [{ role: 'actor' }, { kind: 'movie' }, { yearFrom: 2000 }, { yearTo: 2026 }, { sort: 'oldest' }, { publishedOnly: false }] as const) await expect(service.showEntry({ entryId: 'entry', cursor: first.nextCursor!, ...filters })).rejects.toThrow('INVALID_CATALOG_CURSOR');
		expect(queries).toHaveLength(count);
		for (const options of [{ role: 'sql' }, { sort: 'private' }, { kind: 'book' }, { yearFrom: 1799 }, { yearTo: 3001 }, { yearFrom: 2025, yearTo: 2020 }, { limit: 201 }]) await expect(service.showEntry({ entryId: 'entry', ...options } as never)).rejects.toThrow('INVALID_CATALOG_LOOKUP');
		const hidden = fixture(); hidden.memberships.push(...memberships); hidden.entries.findOneBy.mockResolvedValue(null);
		await expect(hidden.service.showEntry({ entryId: 'missing' })).rejects.toThrow('NO_SUCH_CATALOG_ENTRY');
	});

	test('cursor codec binds public/private scope and supports long Unicode title keys without accepting extra JSON', () => {
		const scope = zalipFilmographyScope('entry', true, { sort: 'title' }); const title = '🎬'.repeat(256);
		const cursor = encodeZalipFilmographyCursor(scope, title, 'work01');
		expect(cursor.length).toBeGreaterThan(256); expect(decodeZalipFilmographyCursor(cursor, scope, 'title')).toEqual({ value: title, id: 'work01' });
		for (const value of ['', 'a'.repeat(2049), cursor + '=', encodeZalipFilmographyCursor(scope, title + 'x', 'work01'), encodeZalipFilmographyCursor(scope, 2025, 'work01'), encodeZalipFilmographyCursor(scope, 'Title', 'bad/id')]) expect(() => decodeZalipFilmographyCursor(value, scope, 'title')).toThrow('INVALID_CATALOG_CURSOR');
		expect(() => decodeZalipFilmographyCursor(cursor, zalipFilmographyScope('entry', false, { sort: 'title' }), 'title')).toThrow('INVALID_CATALOG_CURSOR');
		expect(normalizeZalipFilmographyFilters({})).toMatchObject({ sort: 'newest' });
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
		expect(fetch).toHaveBeenCalledWith('10', { canImportImage: false });
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

describe('standalone person identity and image ownership', () => {
	function fixture(initial: MiZalipCatalogEntry[] = []) {
		const rows = [...initial]; let identities: Record<string, string>[] = [];
		const query = { where: vi.fn(), setParameter: vi.fn((_key, value) => { identities.push(JSON.parse(value)); return query; }), andWhere: vi.fn(), getMany: vi.fn(async () => rows.filter(row => row.type === 'person' && identities.some(ids => Object.entries(ids).every(([key, value]) => row.externalIds[key] === value)))) };
		query.where.mockImplementation(() => { identities = []; return query; }); query.andWhere.mockReturnValue(query);
		const repository = { createQueryBuilder: () => query, create: vi.fn(value => value), findOneBy: vi.fn(async criteria => rows.find(row => Object.entries(criteria).every(([key, value]) => row[key as keyof MiZalipCatalogEntry] === value)) ?? null), save: vi.fn(async value => { const position = rows.findIndex(row => row.id === value.id); if (position < 0) rows.push(value); else rows[position] = value; return value; }) };
		const manager = { query: vi.fn(), getRepository: () => repository };
		const db = { manager, getRepository: manager.getRepository, transaction: vi.fn(async action => action(manager)) };
		const service = new ZalipTaxonomyService(db as never, { gen: () => 'newperson' } as never);
		return { service, rows, repository, manager, query, db };
	}

	const incoming = { type: 'person' as const, name: 'Imported', description: 'Imported biography', imageUrl: 'https://image.tmdb.org/t/p/w500/new.jpg', externalIds: { tmdb: '10' }, data: { biography: 'Imported biography', birthday: '1980-01-01' } };

	test('creates a standalone ID-based person and retries update that same identity without creating works', async () => {
		const context = fixture();
		expect(await context.service.findImportedPerson('tmdb', '10')).toBeNull();
		const first = await context.service.importPerson(incoming, 'tmdb');
		expect(first).toMatchObject({ created: true, entry: { id: 'newperson', slug: 'person-tmdb-10', externalIds: { tmdb: '10' }, data: { biography: 'Imported biography' } } });
		const second = await context.service.importPerson({ ...incoming, description: 'Updated' }, 'tmdb');
		expect(second).toMatchObject({ created: false, entry: { id: 'newperson', description: 'Updated' }, changedFields: ['description'] });
		expect(context.rows).toHaveLength(1); expect(context.manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-directories']);
		expect(context.repository.save.mock.calls.every(([value]) => value.type === 'person')).toBe(true);
	});

	test('never merges a name or secondary IMDb hint into another source identity', async () => {
		const context = fixture([entry({ slug: 'person-kinopoisk-20', externalIds: { kinopoisk: '20', imdb: 'nm10' } })]);
		expect(await context.service.findImportedPerson('tmdb', '10')).toBeNull();
		await expect(context.service.importPerson({ ...incoming, externalIds: { tmdb: '10', imdb: 'nm10' } }, 'tmdb')).rejects.toThrow('CATALOG_ID_CONFLICT');
		expect(context.repository.save).not.toHaveBeenCalled(); expect(context.rows[0].externalIds).toEqual({ kinopoisk: '20', imdb: 'nm10' });
	});

	test('keeps legacy/manual fields and explicit clears while allowing independent missing facts', async () => {
		const context = fixture([entry({ description: null, data: { birthday: null, _zalip: { manualFields: ['description', 'data.birthday'], fieldSources: {} } } })]);
		const found = await context.service.findImportedPerson('tmdb', '10'); expect(found?.canImportImage).toBe(false);
		const result = await context.service.importPerson(incoming, 'tmdb');
		expect(result.entry).toMatchObject({ name: 'Name', description: null, imageUrl: 'https://example.test/portrait.jpg', data: { birthday: null, biography: 'Imported biography' } });
		expect(result.entry.data).not.toHaveProperty('_zalip');
	});

	test('rechecks existing photo protection before applying a localized image and records only actually-applied ownership', async () => {
		const person = entry({ data: { _zalip: { manualFields: [], fieldSources: { imageUrl: 'tmdb', name: 'tmdb', description: 'tmdb' } } } });
		const context = fixture([person]); expect((await context.service.findImportedPerson('tmdb', '10'))?.canImportImage).toBe(true);
		const local = 'https://site.test/files/photo.webp';
		await context.service.importPerson({ ...incoming, imageUrl: local, localizedImage: local }, 'tmdb');
		expect(getZalipCatalogEditorialData(context.rows[0].data).localArtwork).toEqual({ imageUrl: local });
		expect((await context.service.findImportedPerson('tmdb', '10'))?.canImportImage).toBe(false);
		await context.service.importPerson({ ...incoming, imageUrl: 'https://site.test/files/other.webp', localizedImage: 'https://site.test/files/other.webp' }, 'tmdb');
		expect(context.rows[0].imageUrl).toBe(local); expect(getZalipCatalogEditorialData(context.rows[0].data).localArtwork).toEqual({ imageUrl: local });
	});

	test('malformed and duplicate source identities fail before any save or guessed repair', async () => {
		const context = fixture([entry(), entry({ id: 'duplicate' })]);
		await expect(context.service.findImportedPerson('tmdb', '10')).rejects.toThrow('CATALOG_ID_CONFLICT');
		await expect(context.service.importPerson(incoming, 'tmdb')).rejects.toThrow('CATALOG_ID_CONFLICT');
		for (const id of ['0', '01', '9007199254740992', '../10']) await expect(context.service.findImportedPerson('tmdb', id)).rejects.toMatchObject({ code: 'invalid-ref' });
		await expect(context.service.importPerson({ ...incoming, type: 'studio' }, 'tmdb')).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(context.repository.save).not.toHaveBeenCalled();
	});

	test('enrichment passes image policy and preserves a concurrently-added manual photo lock', async () => {
		const person = entry({ data: { _zalip: { manualFields: [], fieldSources: { imageUrl: 'tmdb' } } } }); const context = fixture([person]);
		const fetch = vi.fn(async (_id, policy) => {
			expect(policy).toEqual({ canImportImage: true });
			person.data = { _zalip: { manualFields: ['imageUrl'], fieldSources: { imageUrl: 'manual' } } };
			return { ...incoming, imageUrl: 'https://site.test/new.webp', localizedImage: 'https://site.test/new.webp' };
		});
		const result = await context.service.enrichPerson('entry', 'tmdb', fetch);
		expect(result.entry.imageUrl).toBe(person.imageUrl); expect(getZalipCatalogEditorialData(context.rows[0].data).localArtwork).toBeUndefined();
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
		const works = { existsBy: vi.fn().mockResolvedValue(true), findOne: vi.fn().mockResolvedValue({ id: 'work', importData: {} }) };
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
		expect(manager.query.mock.calls.map(([, parameters]) => parameters)).toEqual([['zalip-catalog-directories'], ['zalip-catalog-membership:work']]);
		expect(relations.find).toHaveBeenCalledWith({ where: { workId: 'work', source: 'tmdb' }, relations: { entry: true } });
		expect(relations.delete).toHaveBeenCalledWith(expect.objectContaining({ id: expect.objectContaining({ _value: ['provider'] }) }));
		expect(relations.save).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'new', workId: 'work', source: 'tmdb' }));
	});

	test('link and unlink acquire the directory lock before membership, serializing with entry deletion', async () => {
		const { service, relations, manager } = membershipFixture();
		await service.linkWork({ entryId: 'new', workId: 'work', role: 'part', position: 2 }, 'collaps');
		expect(manager.query.mock.calls.map(([, parameters]) => parameters)).toEqual([['zalip-catalog-directories'], ['zalip-catalog-membership:work']]);
		expect(relations.save).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'new', workId: 'work', source: 'collaps', role: 'part', position: 2 }));
		manager.query.mockClear();
		await service.unlinkWork({ entryId: 'new', workId: 'work', role: ' part ' }, 'collaps');
		expect(manager.query.mock.calls.map(([, parameters]) => parameters)).toEqual([['zalip-catalog-directories'], ['zalip-catalog-membership:work']]);
		expect(relations.delete).toHaveBeenCalledWith({ entryId: 'new', workId: 'work', role: 'part', source: 'collaps' });
	});

	test('partial updates never remove existing source links', async () => {
		const { service, relations } = membershipFixture();
		await service.replaceImportedWorkRelations('work', 'tmdb', [{ entryId: 'new' }], { complete: false, types: ['genre'] });
		expect(relations.find).not.toHaveBeenCalled();
		expect(relations.delete).not.toHaveBeenCalled();
		expect(relations.save).toHaveBeenCalledOnce();
	});

	test.each(['collections', 'categories'] as const)('rechecks %s editorial protection under the work row lock before linking', async protectedField => {
		const { service, relations, works, manager } = membershipFixture();
		works.findOne.mockResolvedValue({ id: 'work', importData: { locks: [protectedField] } });
		await expect(service.linkWork({ entryId: 'new', workId: 'work' }, 'collaps', protectedField)).resolves.toBe(false);
		expect(manager.query.mock.calls.map(([, parameters]) => parameters)).toEqual([['zalip-catalog-directories'], ['zalip-catalog-membership:work']]);
		expect(works.findOne).toHaveBeenCalledExactlyOnceWith({ where: { id: 'work' }, lock: { mode: 'pessimistic_write' } });
		expect(relations.save).not.toHaveBeenCalled();
		expect(relations.delete).not.toHaveBeenCalled();
	});

	test('unlocked maintenance links return success while manual membership remains unrestricted', async () => {
		const { service, relations, works } = membershipFixture();
		await expect(service.linkWork({ entryId: 'new', workId: 'work' }, 'collaps', 'collections')).resolves.toBe(true);
		works.findOne.mockResolvedValue({ id: 'work', importData: { locks: ['collections'] } });
		await expect(service.linkWork({ entryId: 'new', workId: 'work' })).resolves.toBe(true);
		expect(works.findOne).toHaveBeenCalledOnce();
		expect(relations.save).toHaveBeenCalledTimes(2);
	});

	test('unknown locked work or invalid protection field fails before relation writes', async () => {
		const { service, relations, works } = membershipFixture();
		works.findOne.mockResolvedValue(null);
		await expect(service.linkWork({ entryId: 'new', workId: 'work' }, 'collaps', 'collections')).rejects.toThrow('NO_SUCH_WORK');
		await expect(service.linkWork({ entryId: 'new', workId: 'work' }, 'collaps', 'invalid' as 'collections')).rejects.toThrow('INVALID_CATALOG_LINK');
		expect(relations.save).not.toHaveBeenCalled();
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
		expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('entry.data->\'isEnabled\' IS DISTINCT FROM \'false\'::jsonb'), { collectionType: 'collection' });
		expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('work."publicationState" = :publicationState'), { publicationState: 'published' });
		query.andWhere.mockClear();
		await service.listEntries({ type: 'person', publishedOnly: false });
		expect(query.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('isEnabled'), expect.anything());
		expect(query.andWhere).not.toHaveBeenCalledWith(expect.stringContaining('publicationState'), expect.anything());
	});

	test('directory search escapes patterns and only reads typed public name/alias facts; profession never matches draft-only credits', async () => {
		const query = { andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), skip: vi.fn(), getMany: vi.fn().mockResolvedValue([]) };
		for (const key of ['andWhere', 'orderBy', 'addOrderBy', 'take', 'skip'] as const) query[key].mockReturnValue(query);
		const service = new ZalipTaxonomyService({ getRepository: () => ({ createQueryBuilder: () => query }) } as never, {} as never);
		await service.listEntries({ type: 'person', query: 'A%_\\B', role: 'director' });
		const search = query.andWhere.mock.calls.find(([sql]) => String(sql).includes('ILIKE'))!;
		expect(search[1]).toEqual({ query: '%A\\%\\_\\\\B%' });
		expect(search[0]).toContain("jsonb_typeof(entry.data->'aliases') = 'array'");
		expect(search[0]).toContain("jsonb_typeof(alias.value) = 'string'");
		expect(search[0]).toContain("jsonb_typeof(entry.data->'originalName') = 'string'");
		expect(search[0]).not.toContain('_zalip');
		expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('linked_work."publicationState" = :professionPublicationState'), { professionRole: 'director', professionPublicationState: 'published' });
		for (const options of [{ role: 'unknown' }, { role: 'actor', type: 'studio' }, { query: 'x'.repeat(257) }, { limit: 201 }, { offset: 10001 }]) await expect(service.listEntries(options as never)).rejects.toThrow('INVALID_CATALOG_LOOKUP');
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
