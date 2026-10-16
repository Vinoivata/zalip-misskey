/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { artworkCacheUri, artworkOriginalCacheUri, downloadImportArtwork, downloadOriginalImportArtwork, equivalentImportArtwork, importArtworkLimits, importArtworkUrl } from './artwork.js';

const mockedFetch = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockedFetch }));
afterEach(() => mockedFetch.mockReset());

describe('bounded local importer artwork', () => {
	test('exact localization validates full pixels without re-encoding the chosen original bytes', async () => {
		const original = await sharp({ create: { width: 37, height: 53, channels: 4, background: { r: 120, g: 80, b: 20, alpha: 0.5 } } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
		const result = await downloadOriginalImportArtwork(new URL('https://image.tmdb.org/t/p/w500/chosen.png'));
		expect(result.original).toEqual(original);
		expect(result).toMatchObject({ originalExtension: 'png', format: 'png', width: 37, height: 53 });
		expect(result).not.toHaveProperty('processed');
		expect(mockedFetch.mock.calls[0][0]).toBe('https://image.tmdb.org/t/p/w500/chosen.png');
		expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', size: importArtworkLimits.inputBytes });
	});
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
		expect(result.originalExtension).toBe('png');
		expect(result.extension).toBe('webp');
		expect(await sharp(result.processed).metadata()).toMatchObject({ format: 'webp', width: 780, height: 1170, hasAlpha: true });
		expect(mockedFetch.mock.calls[0][1]).toMatchObject({ redirect: 'error', size: 8 * 1024 * 1024 });
	});

	test('cache identity includes actual conversion policy but originals are shared across sizes and roles', () => {
		const url = new URL('https://image.tmdb.org/t/p/original/photo.jpg');
		const first = artworkCacheUri(url, 'posterUrl', { quality: 75 }, false);
		expect(first).toContain(':v2:');
		expect(first).not.toBe(artworkCacheUri(url, 'posterUrl', { quality: 76 }, false));
		expect(first).not.toBe(artworkCacheUri(url, 'posterUrl', { format: 'png', quality: 75 }, false));
		expect(first).not.toBe(artworkCacheUri(url, 'posterUrl', { quality: 75, sizes: { posterUrl: { width: 500 } } }, false));
		expect(first).toBe(artworkCacheUri(url, 'posterUrl', { quality: 75, keepOriginal: false }, false));
		expect(artworkOriginalCacheUri(url)).toBe(artworkOriginalCacheUri(url));
		expect(artworkOriginalCacheUri(url)).not.toBe(artworkOriginalCacheUri(new URL('https://image.tmdb.org/t/p/original/other.jpg')));
	});

	test('recognizes only exact legacy provider artwork, never local paths or unrelated images', () => {
		const url = 'https://image.tmdb.org/t/p/original/old.jpg';
		expect(equivalentImportArtwork('/old.jpg', url, true)).toBe(true);
		expect(equivalentImportArtwork('/old.jpg', url)).toBe(false);
		expect(equivalentImportArtwork('/old.jpg', 'https://image.tmdb.org/t/p/w780/old.jpg', true)).toBe(true);
		expect(equivalentImportArtwork(['/old.jpg'], [url], true)).toBe(true);
		for (const current of ['/files/old.jpg', '//image.tmdb.org/old.jpg', '/other.jpg', '/old.jpg?token=fixture']) expect(equivalentImportArtwork(current, url, true)).toBe(false);
		expect(equivalentImportArtwork('/old.jpg', `${url}?token=fixture`, true)).toBe(false);
		expect(equivalentImportArtwork(['/old.jpg', '/other.jpg'], [url], true)).toBe(false);
	});

	test.each(['webp', 'avif', 'jpeg', 'png', 'original'] as const)('supports %s output with bounded user dimensions and no enlargement', async format => {
		const original = await sharp({ create: { width: 160, height: 240, channels: 3, background: '#4f7c91' } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
		const result = await downloadImportArtwork(new URL('https://image.tmdb.org/photo.png'), 'posterUrl', undefined, { format, quality: 65, sizes: { posterUrl: { width: 80, height: 80, fit: 'cover' } } }, false);
		expect(await sharp(result.processed).metadata()).toMatchObject({ format: format === 'original' ? 'png' : format === 'avif' ? 'heif' : format, width: 80, height: 80 });
		const nonUpscaled = await downloadImportArtwork(new URL('https://image.tmdb.org/photo.png'), 'posterUrl', undefined, { format, sizes: { posterUrl: { width: 500, height: 500, fit: 'inside' } } }, false);
		expect(nonUpscaled).toMatchObject({ width: 160, height: 240 });
	});

	test('zero axes keep aspect ratio or leave dimensions unchanged', async () => {
		const original = await sharp({ create: { width: 160, height: 240, channels: 3, background: '#4f7c91' } }).jpeg().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => original });
		const width = await downloadImportArtwork(new URL('https://image.tmdb.org/photo.jpg'), 'posterUrl', undefined, { sizes: { posterUrl: { width: 80, height: 0 } } }, false);
		expect(width).toMatchObject({ width: 80, height: 120 });
		const height = await downloadImportArtwork(new URL('https://image.tmdb.org/photo.jpg'), 'posterUrl', undefined, { sizes: { posterUrl: { width: 0, height: 120 } } }, false);
		expect(height).toMatchObject({ width: 80, height: 120 });
		const untouched = await downloadImportArtwork(new URL('https://image.tmdb.org/photo.jpg'), 'posterUrl', undefined, { format: 'original', sizes: { posterUrl: { width: 0, height: 0 } } }, false);
		expect(untouched).toMatchObject({ format: 'jpeg', extension: 'jpg', width: 160, height: 240 });
	});

	test('transparent logos stay transparent when JPEG was requested', async () => {
		const original = await sharp({ create: { width: 30, height: 20, channels: 4, background: { r: 40, g: 90, b: 130, alpha: 0.25 } } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
		const result = await downloadImportArtwork(new URL('https://image.tmdb.org/logo.png'), 'logoUrl', undefined, { format: 'jpeg' }, false);
		expect(result).toMatchObject({ format: 'png', extension: 'png' });
		expect(await sharp(result.processed).metadata()).toMatchObject({ format: 'png', hasAlpha: true });
	});

	test('rejects oversized declared bodies, decoder bombs, empty or excessive bodies and expired budgets', async () => {
		const url = new URL('https://image.tmdb.org/photo.png');
		const body = vi.fn();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png', 'content-length': String(importArtworkLimits.inputBytes + 1) }), arrayBuffer: body });
		await expect(downloadImportArtwork(url, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(body).not.toHaveBeenCalled();
		for (const buffer of [Buffer.alloc(0), Buffer.alloc(importArtworkLimits.inputBytes + 1)]) {
			mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => buffer });
			await expect(downloadImportArtwork(url, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		}
		const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => bomb });
		await expect(downloadImportArtwork(url, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		mockedFetch.mockClear();
		await expect(downloadImportArtwork(url, 'posterUrl', undefined, undefined, true, Date.now() - 1)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).not.toHaveBeenCalled();
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
