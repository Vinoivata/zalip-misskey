/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ZalipImporterArtworkService } from './ZalipImporterArtworkService.js';
import { normalizeTmdbRecord } from './zalip-importer/providers.js';
import type { MiZalipWork } from '@/models/ZalipWork.js';

vi.mock('@/core/DriveService.js', () => ({ DriveService: class {} }));
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));

function fixture() {
	const service = new ZalipImporterArtworkService({} as never, {} as never, {} as never);
	const cache = vi.spyOn(service as unknown as { cache: (value: string) => Promise<string> }, 'cache').mockImplementation(async value => `https://zalip.example.org/files/${value.split('/').pop()}`);
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
});
