/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ImportPersonInput } from './zalip-importer/persons.js';
import { ZalipPersonImportService } from './ZalipPersonImportService.js';

vi.mock('@/core/ZalipTaxonomyService.js', () => ({ ZalipTaxonomyService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('@/core/ZalipImporterArtworkService.js', () => ({ ZalipImporterArtworkService: class {} }));
const upstream = vi.hoisted(() => vi.fn());
vi.mock('./zalip-importer/providers.js', async original => ({ ...await original<typeof import('./zalip-importer/providers.js')>(), createConfiguredImportTransport: () => upstream }));

beforeEach(() => {
	upstream.mockReset().mockImplementation(async (request: string) => new URL(request).hostname === 'kinopoiskapiunofficial.tech'
		? { personId: 20, nameRu: 'Имя', posterUrl: 'https://st.kp.yandex.net/images/actor_iphone/20.jpg', facts: ['Fact'], token: 'not-projected' }
		: { id: 10, name: 'Имя', biography: 'Bio', profile_path: '/portrait.jpg', secret: 'not-projected' });
});

function fixture(canImportImage = true) {
	const entry = { id: 'entry01', type: 'person', slug: 'person-tmdb-10', name: 'Имя', description: null, imageUrl: null, parentId: null, externalIds: { tmdb: '10' }, data: {} };
	const taxonomy = {
		findImportedPerson: vi.fn().mockResolvedValue(null),
		importPerson: vi.fn(async (input: ImportPersonInput) => ({ entry: { ...entry, name: input.name, imageUrl: input.imageUrl ?? null, externalIds: input.externalIds }, created: true, changedFields: ['imageUrl'] })),
		enrichPerson: vi.fn(async (_entryId: string, _source: string, callback: (id: string, context: { canImportImage: boolean }) => Promise<ImportPersonInput>) => { const input = await callback('10', { canImportImage }); return { entry: { ...entry, imageUrl: input.imageUrl ?? null }, changedFields: ['description'] }; }),
	};
	const config = { tmdbApiKey: 'fixture-private-key', kinopoiskApiKey: 'fixture-private-key', apiOrigins: { tmdb: 'https://api.themoviedb.org', kinopoisk: 'https://kinopoiskapiunofficial.tech' } };
	const settings = { getRuntime: vi.fn().mockResolvedValue(config) };
	const artwork = { cachePersonPhoto: vi.fn().mockResolvedValue('https://zalip.example.org/files/portrait.webp') };
	const redis = { get: vi.fn().mockResolvedValue('100'), eval: vi.fn().mockResolvedValue(1) };
	return { entry, taxonomy, settings, artwork, redis, service: new ZalipPersonImportService(taxonomy as never, settings as never, artwork as never, redis as never) };
}

describe('standalone person import service', () => {
	test('preview uses fixed provider person requests without catalogue or Drive writes', async () => {
		const { service, taxonomy, artwork, settings } = fixture();
		const result = await service.importPerson('tmdb', 'https://www.themoviedb.org/person/10-name');
		expect(result).toMatchObject({ preview: true, source: 'tmdb', externalId: '10', existingEntry: null, entry: null, created: false, changedFields: [], warnings: [], person: { type: 'person', name: 'Имя', description: 'Bio', externalIds: { tmdb: '10' } } });
		expect(taxonomy.findImportedPerson).toHaveBeenCalledWith('tmdb', '10');
		expect(upstream).toHaveBeenCalledTimes(2);
		for (const [request] of upstream.mock.calls) expect(new URL(request).pathname).toBe('/3/person/10');
		expect(settings.getRuntime).toHaveBeenCalledOnce();
		expect(taxonomy.importPerson).not.toHaveBeenCalled(); expect(artwork.cachePersonPhoto).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toMatch(/fixture-private-key|not-projected|localizedImage|_zalip/u);
	});

	test('explicit import localizes the photo and supplies only a server-created ownership marker', async () => {
		const { service, taxonomy, artwork } = fixture();
		const result = await service.importPerson('tmdb', '10', false);
		expect(artwork.cachePersonPhoto).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w500/portrait.jpg');
		expect(taxonomy.importPerson).toHaveBeenCalledWith(expect.objectContaining({ type: 'person', externalIds: { tmdb: '10' }, imageUrl: 'https://zalip.example.org/files/portrait.webp', localizedImage: 'https://zalip.example.org/files/portrait.webp' }), 'tmdb');
		expect(result).toMatchObject({ preview: false, created: true, entry: { id: 'entry01', imageUrl: 'https://zalip.example.org/files/portrait.webp' }, warnings: [] });
		expect(result.person.imageUrl).toBe('https://image.tmdb.org/t/p/w500/portrait.jpg');
		expect(JSON.stringify(result)).not.toContain('localizedImage');
	});

	test('existing exact identities are displayed and protected photographs are neither fetched nor supplied for replacement', async () => {
		const { service, taxonomy, artwork, entry } = fixture();
		taxonomy.findImportedPerson.mockResolvedValue({ entry, canImportImage: false });
		taxonomy.importPerson.mockResolvedValue({ entry, created: false, changedFields: [] } as never);
		const result = await service.importPerson('tmdb', '10', false);
		expect(result).toMatchObject({ existingEntry: entry, created: false, changedFields: [] });
		expect(artwork.cachePersonPhoto).not.toHaveBeenCalled();
		expect(taxonomy.importPerson.mock.calls[0][0]).not.toHaveProperty('imageUrl');
	});

	test('cache failure keeps only a normalized public remote photo and a closed warning', async () => {
		const { service, taxonomy, artwork } = fixture();
		artwork.cachePersonPhoto.mockRejectedValue(new Error('private-upstream-url?token=not-projected'));
		const result = await service.importPerson('kinopoisk', 'https://www.kinopoisk.ru/name/20/', false);
		expect(result.warnings).toEqual(['person-photo-local-unavailable']);
		expect(result.entry?.imageUrl).toBe('https://st.kp.yandex.net/images/actor_iphone/20.jpg');
		expect(taxonomy.importPerson.mock.calls[0][0]).not.toHaveProperty('localizedImage');
		expect(JSON.stringify(result)).not.toMatch(/private-upstream-url|fixture-private-key|not-projected/u);
	});

	test('missing or unsafe provider photographs do not trigger a download or fabricated warning', async () => {
		const { service, artwork } = fixture();
		upstream.mockResolvedValue({ personId: 20, nameRu: 'Имя', posterUrl: 'https://example.com/photo.jpg?api_key=not-projected' });
		const result = await service.importPerson('kinopoisk', '20', false);
		expect(result.person.imageUrl).toBeNull(); expect(result.warnings).toEqual([]); expect(artwork.cachePersonPhoto).not.toHaveBeenCalled();
	});

	test('invalid references reject before settings, database lookup or any upstream call', async () => {
		const { service, taxonomy, settings } = fixture();
		await expect(service.importPerson('tmdb', 'https://evil.example.org/person/10', false)).rejects.toMatchObject({ code: 'invalid-ref' });
		expect(taxonomy.findImportedPerson).not.toHaveBeenCalled(); expect(settings.getRuntime).not.toHaveBeenCalled(); expect(upstream).not.toHaveBeenCalled();
	});

	test('provider identity mismatch fails before artwork or catalogue mutations', async () => {
		const { service, taxonomy, artwork } = fixture();
		upstream.mockResolvedValue({ personId: 21, nameRu: 'Имя' });
		await expect(service.importPerson('kinopoisk', '20', false)).rejects.toMatchObject({ code: 'malformed-response' });
		expect(taxonomy.importPerson).not.toHaveBeenCalled(); expect(artwork.cachePersonPhoto).not.toHaveBeenCalled();
	});

	test('Kinopoisk requests retain shared Redis budget protection', async () => {
		const { service, taxonomy, redis } = fixture();
		redis.eval.mockResolvedValue(0);
		await expect(service.importPerson('kinopoisk', '20')).rejects.toMatchObject({ code: 'quota-exceeded' });
		expect(redis.eval).toHaveBeenCalledOnce(); expect(upstream).not.toHaveBeenCalled(); expect(taxonomy.importPerson).not.toHaveBeenCalled();
	});

	test.each([true, false])('manual enrichment shares the local photo policy, eligible=%s', async allowed => {
		const { service, taxonomy, artwork } = fixture(allowed);
		const result = await service.enrichPerson('entry01', 'tmdb');
		expect(taxonomy.enrichPerson).toHaveBeenCalledWith('entry01', 'tmdb', expect.any(Function));
		expect(artwork.cachePersonPhoto).toHaveBeenCalledTimes(allowed ? 1 : 0);
		expect(result.warnings).toEqual([]);
	});

	test('enrichment exposes the same closed photo-fallback warning', async () => {
		const { service, artwork } = fixture(); artwork.cachePersonPhoto.mockRejectedValue(new Error('not-projected'));
		expect((await service.enrichPerson('entry01', 'tmdb')).warnings).toEqual(['person-photo-local-unavailable']);
	});
});
