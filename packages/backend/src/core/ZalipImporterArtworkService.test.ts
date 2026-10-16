/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiZalipWork } from '@/models/ZalipWork.js';
import { ZalipImporterArtworkService } from './ZalipImporterArtworkService.js';
import { normalizeTmdbRecord } from './zalip-importer/providers.js';
import { normalizeImportArtworkSettings } from './zalip-importer/policy.js';
import { artworkCacheUri, artworkOriginalCacheUri, importArtworkLimits } from './zalip-importer/artwork.js';
import type { ImportArtworkField, ImportArtworkSettings } from './zalip-importer/types.js';

vi.mock('@/core/DriveService.js', () => ({ DriveService: class {} }));
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));
const download = vi.hoisted(() => vi.fn());
const downloadOriginal = vi.hoisted(() => vi.fn());
vi.mock('./zalip-importer/artwork.js', async original => ({ ...await original<typeof import('./zalip-importer/artwork.js')>(), downloadImportArtwork: download, downloadOriginalImportArtwork: downloadOriginal }));

function fixture() {
	const service = new ZalipImporterArtworkService({} as never, {} as never, {} as never);
	const cache = vi.spyOn(service as unknown as { cache: (value: string, field: ImportArtworkField, settings: ImportArtworkSettings, legacy: boolean, budget: { deadlineAt: number; remainingBytes: number }) => Promise<string> }, 'cache').mockImplementation(async value => `https://zalip.example.org/files/${value.split('/').pop()}`);
	const record = normalizeTmdbRecord({ id: 1, title: 'Film', poster_path: '/poster.jpg', backdrop_path: '/backdrop.jpg', images: { logos: [{ file_path: '/logo.png', iso_639_1: 'ru' }], backdrops: Array.from({ length: 18 }, (_, index) => ({ file_path: `/gallery-${index}.jpg` })) } }, 'movie');
	return { service, cache, record };
}

describe('importer artwork ownership and fallback', () => {
	test('limits the background batch and leaves additional gallery images remote', async () => {
		const { service, cache, record } = fixture();
		const result = await service.prepare(record, null);
		expect(cache).toHaveBeenCalledTimes(15);
		expect(result.galleryUrls).toHaveLength(18);
		expect(result.galleryUrls[11]).toContain('zalip.example.org');
		expect(result.galleryUrls[12]).toContain('image.tmdb.org');
		expect(record.posterUrl).toContain('image.tmdb.org');
	});

	test('selected fields prevent unused downloads', async () => {
		const { service, cache, record } = fixture();
		await service.prepare(record, null, ['description']);
		expect(cache).not.toHaveBeenCalled();
	});

	test('does not replace or download editorial, cleared or explicitly locked artwork', async () => {
		const { service, cache, record } = fixture();
		const work = {
			posterPath: '/manual-poster.jpg', backdropPath: null, logoPath: record.logoUrl, galleryPaths: record.galleryUrls,
			importData: { values: { posterUrl: record.posterUrl, backdropUrl: record.backdropUrl, logoUrl: record.logoUrl, galleryUrls: record.galleryUrls }, locks: ['logoUrl'] },
		} as unknown as MiZalipWork;
		await service.prepare(record, work, undefined, ['galleryUrls']);
		expect(cache).not.toHaveBeenCalled();
	});

	test('a failed local cache keeps the remote fallback and a safe warning', async () => {
		const { service, cache, record } = fixture();
		cache.mockRejectedValue(new Error('fixture-secret'));
		const result = await service.prepare(record, null, ['posterUrl']);
		expect(result.posterUrl).toBe(record.posterUrl);
		expect(result.warnings).toEqual(['artwork-local-unavailable:posterUrl']);
		expect(JSON.stringify(result)).not.toContain('fixture-secret');
	});

	test('a failed refresh retains existing importer-owned artwork, including a whole gallery', async () => {
		const { service, cache, record } = fixture();
		const work = {
			posterPath: 'https://zalip.example.org/old.webp', galleryPaths: ['https://zalip.example.org/old-gallery.webp'],
			importData: { values: { posterUrl: 'https://zalip.example.org/old.webp', galleryUrls: ['https://zalip.example.org/old-gallery.webp'] } },
		} as unknown as MiZalipWork;
		cache.mockRejectedValue(new Error('fixture-secret'));
		const result = await service.prepare(record, work, ['posterUrl', 'galleryUrls']);
		expect(result.posterUrl).toBe(work.posterPath);
		expect(result.galleryUrls).toEqual(work.galleryPaths);
		expect(JSON.stringify(result)).not.toContain('fixture-secret');
	});

	test('a previously missing image keeps its safe remote fallback when local caching fails', async () => {
		const { service, cache, record } = fixture();
		const work = { posterPath: null, importData: { values: { posterUrl: null } } } as unknown as MiZalipWork;
		cache.mockRejectedValue(new Error('fixture-secret'));
		const result = await service.prepare(record, work, ['posterUrl']);
		expect(result.posterUrl).toBe(record.posterUrl);
	});

	test('configurable local mode uses the saved conversion policy and localizes the whole selected gallery', async () => {
		const { service, cache, record } = fixture();
		const result = await service.prepare(record, null, undefined, [], { format: 'avif', quality: 70, galleryLimit: 18 }, 'local');
		expect(cache).toHaveBeenCalledTimes(21);
		expect(cache.mock.calls[0][2]).toMatchObject({ format: 'avif', quality: 70, keepOriginal: true, galleryLimit: 18 });
		expect(result.galleryUrls.every(value => value.includes('zalip.example.org'))).toBe(true);
		const limited = await service.prepare(record, null, ['galleryUrls'], [], { galleryLimit: 2 }, 'local');
		expect(limited.galleryUrls).toHaveLength(2);
	});

	test('legacy local-webp mode retains its fixed preset even if configurable settings were supplied', async () => {
		const { service, cache, record } = fixture();
		await service.prepare(record, null, ['posterUrl'], [], { quality: 1, format: 'png' }, 'local-webp');
		expect(cache.mock.calls[0][2]).toMatchObject({ format: 'webp', quality: 80, galleryLimit: 12 });
	});

	test('configurable local failures never masquerade as downloaded external URLs', async () => {
		const { service, cache, record } = fixture();
		cache.mockRejectedValue(new Error('fixture-secret'));
		const result = await service.prepare(record, null, undefined, [], undefined, 'local');
		expect(result).toMatchObject({ posterUrl: null, backdropUrl: null, logoUrl: null, galleryUrls: [] });
		expect(result.artworkExpected).toBeUndefined();
		expect(result.warnings).toHaveLength(4);
	});

	test('exact legacy TMDB images are eligible without establishing ownership of unrelated fields', async () => {
		const { service, cache, record } = fixture();
		const work = { tmdbId: 1, tmdbMediaType: 'movie', posterPath: '/poster.jpg', backdropPath: null, logoPath: null, galleryPaths: [], importData: {} } as unknown as MiZalipWork;
		const result = await service.prepare(record, work, ['posterUrl'], [], undefined, 'local');
		expect(cache).toHaveBeenCalledTimes(1);
		expect(result.artworkExpected).toEqual({ posterUrl: '/poster.jpg' });
		expect(result.posterUrl).toContain('zalip.example.org');
		cache.mockClear();
		await service.prepare(record, { ...work, tmdbId: null } as MiZalipWork, ['posterUrl'], [], undefined, 'local');
		expect(cache).not.toHaveBeenCalled();
	});

	test('an explicit image choice can replace nonlocked editorial artwork but cannot bypass locks', async () => {
		const { service, cache, record } = fixture();
		const work = { posterPath: 'https://manual.example.org/editorial.png', importData: { values: { posterUrl: 'https://image.tmdb.org/old.jpg' } } } as unknown as MiZalipWork;
		const selected = await service.prepare(record, work, ['posterUrl'], [], undefined, 'local', ['posterUrl']);
		expect(cache).toHaveBeenCalledTimes(1);
		expect(selected.artworkExpected).toEqual({ posterUrl: work.posterPath });
		cache.mockClear();
		await service.prepare(record, work, ['posterUrl'], ['posterUrl'], undefined, 'local', ['posterUrl']);
		await service.prepare(record, { ...work, importData: { locks: ['posterUrl'] } } as MiZalipWork, ['posterUrl'], [], undefined, 'local', ['posterUrl']);
		expect(cache).not.toHaveBeenCalled();
	});

	test('explicitly clearing a gallery captures its current value, while a zero download limit alone never authorizes clearing it', async () => {
		const { service, cache, record } = fixture();
		const work = { galleryPaths: ['https://image.tmdb.org/old.jpg'], importData: {} } as unknown as MiZalipWork;
		const cleared = await service.prepare({ ...record, galleryUrls: [] }, work, ['galleryUrls'], [], undefined, 'local', ['galleryUrls']);
		expect(cleared.artworkExpected).toEqual({ galleryUrls: work.galleryPaths });
		const limited = await service.prepare(record, work, ['galleryUrls'], [], { galleryLimit: 0 }, 'local', ['galleryUrls']);
		expect(limited.artworkExpected).toBeUndefined();
		expect(cache).not.toHaveBeenCalled();
	});

	test('a gallery failure is atomic and does not authorize overwriting existing artwork', async () => {
		const { service, cache, record } = fixture();
		cache.mockRejectedValueOnce(new Error('fixture-secret'));
		const work = { galleryPaths: ['https://zalip.example.org/previous.webp'], importData: { values: { galleryUrls: ['https://zalip.example.org/previous.webp'] } } } as unknown as MiZalipWork;
		const result = await service.prepare(record, work, ['galleryUrls'], [], undefined, 'local');
		expect(result.galleryUrls).toEqual(work.galleryPaths);
		expect(result.artworkExpected).toBeUndefined();
	});

	test('the whole title has a bounded download window even if more artwork remains', async () => {
		const { service, cache, record } = fixture();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		cache.mockImplementationOnce(async () => { clock.mockReturnValue(1000 + importArtworkLimits.batchTimeoutMs); return 'https://zalip.example.org/first.webp'; });
		try {
			const result = await service.prepare(record, null, undefined, [], undefined, 'local');
			expect(cache).toHaveBeenCalledTimes(1);
			expect(result).toMatchObject({ posterUrl: 'https://zalip.example.org/first.webp', backdropUrl: null, logoUrl: null, galleryUrls: [] });
			expect(result.warnings).toHaveLength(3);
		} finally { clock.mockRestore(); }
	});
});

function cacheFixture() {
	const stored = new Map<string, { uri: string; url: string; webpublicUrl: string }>();
	const repository = { findOneBy: vi.fn(async ({ uri }: { uri: string }) => stored.get(uri) ?? null) };
	const connection = { connect: vi.fn(), release: vi.fn(), query: vi.fn(async () => [{ locked: true }]) };
	const drive = { addFile: vi.fn(async ({ uri, name }: { uri: string; name: string }) => {
		const file = { uri, url: `https://zalip.example.org/files/${name}`, webpublicUrl: 'https://zalip.example.org/files/different-webpublic.webp' };
		stored.set(uri, file);
		return file;
	}) };
	const service = new ZalipImporterArtworkService({ createQueryRunner: () => connection, getRepository: () => repository } as never, drive as never, { getAgentForHttps: () => undefined } as never);
	const cache = (service as unknown as { cache: (value: string, field: ImportArtworkField, settings: ImportArtworkSettings, legacy: boolean, budget: { deadlineAt: number; remainingBytes: number }) => Promise<string> }).cache.bind(service);
	download.mockReset().mockResolvedValue({ original: Buffer.from('original'), processed: Buffer.from('processed'), originalExtension: 'png', extension: 'avif', format: 'avif', width: 100, height: 150 });
	return { service, stored, repository, connection, drive, cache };
}

describe('native importer artwork storage', () => {
	test('existing-image localization stores only exact original bytes and reuses the retained-original cache', async () => {
		const { service, drive, stored } = cacheFixture();
		downloadOriginal.mockReset().mockResolvedValue({ original: Buffer.from('exact-original'), originalExtension: 'png', format: 'png', width: 100, height: 150 });
		const url = 'https://image.tmdb.org/t/p/w500/chosen.png';
		const budget = { deadlineAt: Date.now() + 60000, remainingBytes: 100000 };
		const result = await service.cacheOriginal(url, budget);
		expect(result).toMatch(/\.png$/u);
		expect(result).not.toContain('different-webpublic');
		expect(drive.addFile).toHaveBeenCalledTimes(1);
		expect(stored.has(artworkOriginalCacheUri(new URL(url)))).toBe(true);
		expect(budget.remainingBytes).toBe(100000 - Buffer.byteLength('exact-original'));
		expect(download).not.toHaveBeenCalled();
		await service.cacheOriginal(url, budget);
		expect(downloadOriginal).toHaveBeenCalledTimes(1);
	});
	test('stores originals independently and returns the actual processed URL instead of re-encoded webpublic', async () => {
		const { cache, drive, connection, stored } = cacheFixture();
		const url = 'https://image.tmdb.org/t/p/original/photo.png';
		const settings = normalizeImportArtworkSettings({ format: 'avif' });
		const budget = { deadlineAt: Date.now() + 60000, remainingBytes: 100000 };
		const result = await cache(url, 'posterUrl', settings, false, budget);
		expect(drive.addFile).toHaveBeenCalledTimes(2);
		expect(result).toMatch(/\.avif$/u);
		expect(result).not.toContain('different-webpublic');
		expect(stored.has(artworkOriginalCacheUri(new URL(url)))).toBe(true);
		expect(stored.has(artworkCacheUri(new URL(url), 'posterUrl', settings, false))).toBe(true);
		expect(budget.remainingBytes).toBe(100000 - 17);
		await cache(url, 'posterUrl', settings, false, budget);
		expect(download).toHaveBeenCalledTimes(1);
		expect(connection.release).toHaveBeenCalledTimes(2);
	});

	test('a new size reuses the original, while keepOriginal false creates only the processed asset', async () => {
		const { cache, drive } = cacheFixture();
		const url = 'https://image.tmdb.org/t/p/original/photo.png';
		const budget = { deadlineAt: Date.now() + 60000, remainingBytes: 100000 };
		await cache(url, 'posterUrl', normalizeImportArtworkSettings(), false, budget);
		await cache(url, 'posterUrl', normalizeImportArtworkSettings({ sizes: { posterUrl: { width: 500 } } }), false, budget);
		expect(drive.addFile).toHaveBeenCalledTimes(3);
		await cache('https://image.tmdb.org/t/p/original/other.png', 'logoUrl', normalizeImportArtworkSettings({ keepOriginal: false }), false, budget);
		expect(drive.addFile).toHaveBeenCalledTimes(4);
	});

	test('insufficient total byte budget creates no stored assets and always releases the lock', async () => {
		const { cache, drive, connection } = cacheFixture();
		await expect(cache('https://image.tmdb.org/photo.png', 'posterUrl', normalizeImportArtworkSettings(), false, { deadlineAt: Date.now() + 60000, remainingBytes: 1 })).rejects.toThrow('IMPORT_ARTWORK_BUDGET');
		expect(drive.addFile).not.toHaveBeenCalled();
		expect(connection.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock(hashtext($1))', [artworkOriginalCacheUri(new URL('https://image.tmdb.org/photo.png'))]);
		expect(connection.release).toHaveBeenCalled();
	});

	test('cache contention never waits indefinitely or releases another worker lock', async () => {
		const { cache, drive, connection } = cacheFixture();
		connection.query.mockResolvedValueOnce([{ locked: false }]);
		await expect(cache('https://image.tmdb.org/photo.png', 'posterUrl', normalizeImportArtworkSettings(), false, { deadlineAt: Date.now() + 60000, remainingBytes: 100000 })).rejects.toThrow('IMPORT_ARTWORK_BUSY');
		expect(download).not.toHaveBeenCalled();
		expect(drive.addFile).not.toHaveBeenCalled();
		expect(connection.query).toHaveBeenCalledTimes(1);
		expect(connection.release).toHaveBeenCalled();
	});
});
