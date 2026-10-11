/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { artworkCacheUri, downloadImportArtwork, importArtworkUrl } from './artwork.js';

const mockedFetch = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockedFetch }));
afterEach(() => mockedFetch.mockReset());

describe('bounded local importer artwork', () => {
	test('accepts exact CDN hosts only, never tokens, redirectors or arbitrary servers', () => {
		expect(importArtworkUrl('https://image.tmdb.org/t/p/original/photo.jpg')).not.toBeNull();
		expect(importArtworkUrl('https://st.kp.yandex.net/images/film.jpg')).not.toBeNull();
		for (const url of ['https://image.tmdb.org.evil.example.org/photo.jpg', 'https://127.0.0.1/photo.jpg', 'https://image.tmdb.org/photo.jpg?api_key=fixture', 'https://kinopoiskapiunofficial.tech/api/v1/api_keys/fixture', 'http://image.tmdb.org/photo.jpg', 'https://user:fixture@image.tmdb.org/photo.jpg']) expect(importArtworkUrl(url)).toBeNull();
	});

	test('cache URI is stable, versioned and contains no source URL or credential', () => {
		const url = new URL('https://image.tmdb.org/t/p/original/photo.jpg');
		expect(artworkCacheUri(url, 'posterUrl')).toBe(artworkCacheUri(url, 'posterUrl'));
		expect(artworkCacheUri(url, 'posterUrl')).not.toBe(artworkCacheUri(url, 'backdropUrl'));
		expect(artworkCacheUri(url, 'posterUrl')).not.toContain('photo.jpg');
	});

	test('preserves original and converts a bounded non-upscaled WebP', async () => {
		const original = await sharp({ create: { width: 1200, height: 1800, channels: 4, background: { r: 120, g: 80, b: 20, alpha: 0.5 } } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
		const result = await downloadImportArtwork(new URL('https://image.tmdb.org/t/p/original/photo.png'), 'posterUrl');
		expect(result.original).toEqual(original);
		expect(result.extension).toBe('png');
		expect(await sharp(result.webp).metadata()).toMatchObject({ format: 'webp', width: 780, height: 1170, hasAlpha: true });
		expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', size: 8 * 1024 * 1024 });
	});

	test('rejects SVG and fake MIME image data, strips network exception messages', async () => {
		const url = new URL('https://image.tmdb.org/t/p/original/photo.jpg');
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/svg+xml' }), arrayBuffer: vi.fn() });
		await expect(downloadImportArtwork(url, 'logoUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => Buffer.from('<script>fixture-secret</script>') });
		await expect(downloadImportArtwork(url, 'logoUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		mockedFetch.mockRejectedValue(new Error('fixture-secret-api-url'));
		await expect(downloadImportArtwork(url, 'logoUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
	});
});
