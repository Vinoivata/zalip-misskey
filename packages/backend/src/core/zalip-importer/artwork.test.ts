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
	test('retains exact PNG bytes through one known same-origin Kinopoisk placeholder hop only for original storage', async () => {
		const original = await sharp({ create: { width: 208, height: 304, channels: 4, background: '#789abc' } }).png().toBuffer();
		const destroy = vi.fn();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: '/images/no-poster.gif' }), body: { destroy } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif', 'content-length': String(original.length) }), arrayBuffer: async () => original });
		const agent = {} as never;
		const result = await downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/actor_iphone/chosen.jpg'), agent);
		expect(result).toMatchObject({ original, originalExtension: 'png', format: 'png', width: 208, height: 304 });
		expect(destroy).toHaveBeenCalledOnce();
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(mockedFetch.mock.calls[0]).toEqual(['https://st.kp.yandex.net/images/actor_iphone/chosen.jpg', expect.objectContaining({ redirect: 'manual', agent, size: importArtworkLimits.inputBytes })]);
		expect(mockedFetch.mock.calls[1]).toEqual(['https://st.kp.yandex.net/images/no-poster.gif', expect.objectContaining({ redirect: 'error', agent, size: importArtworkLimits.inputBytes })]);
		expect(mockedFetch.mock.calls[0][1].signal).toBe(mockedFetch.mock.calls[1][1].signal);
	});

	test('accepts the direct known PNG placeholder MIME exception only in original mode', async () => {
		const original = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#789abc' } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif' }), arrayBuffer: async () => original });
		const url = new URL('https://st.kp.yandex.net/images/no-poster.gif');
		expect((await downloadOriginalImportArtwork(url)).original).toEqual(original);
		expect(mockedFetch.mock.calls[0][1].redirect).toBe('error');
		await expect(downloadImportArtwork(url, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
	});

	test.each([
		'https://evil.example.org/images/no-poster.gif',
		'https://image.tmdb.org/images/no-poster.gif',
		'https://st.kp.yandex.net.evil.example.org/images/no-poster.gif',
		'http://st.kp.yandex.net/images/no-poster.gif',
		'https://st.kp.yandex.net:8443/images/no-poster.gif',
		'https://user:private@st.kp.yandex.net/images/no-poster.gif',
		'/images/other.gif', '/other/no-poster.gif', '/images/no-poster.gif?cache=1',
		'/images/no-poster.gif?token=private', '/images/no-poster.gif#fragment',
		'//127.0.0.1/images/no-poster.gif',
	])('never follows an unapproved placeholder redirect destination %s', async location => {
		const destroy = vi.fn();
		mockedFetch.mockResolvedValue({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy } });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledOnce();
	});

	test.each([
		'https://image.tmdb.org/images/person.jpg',
		'https://avatars.mds.yandex.net/images/person.jpg',
		'https://st.kp.yandex.net/other/person.jpg',
		'https://st.kp.yandex.net/images/person.jpg?cache=1',
	])('does not enable redirect following for another original source %s', async source => {
		mockedFetch.mockResolvedValue({ ok: false, status: 302, headers: new Headers({ location: 'https://st.kp.yandex.net/images/no-poster.gif' }) });
		await expect(downloadOriginalImportArtwork(new URL(source))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
		expect(mockedFetch.mock.calls[0][1].redirect).toBe('error');
	});

	test('rejects second-hop redirects, loops and all redirects in the conversion pipeline', async () => {
		const redirect = { ok: false, status: 302, headers: new Headers({ location: '/images/no-poster.gif' }), body: { destroy: vi.fn() } };
		mockedFetch.mockResolvedValue(redirect);
		const source = new URL('https://st.kp.yandex.net/images/person.jpg');
		await expect(downloadOriginalImportArtwork(source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(mockedFetch.mock.calls[1][1].redirect).toBe('error');
		mockedFetch.mockClear();
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/no-poster.gif'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
		mockedFetch.mockClear();
		await expect(downloadImportArtwork(source, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
		expect(mockedFetch.mock.calls[0][1].redirect).toBe('error');
	});

	test('MIME exception never admits actual GIF pixels or GIF-labelled PNG at another URL', async () => {
		const gif = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#789abc' } }).gif().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif' }), arrayBuffer: async () => gif });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/no-poster.gif'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#789abc' } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif' }), arrayBuffer: async () => png });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/other.gif'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
	});

	test('placeholder exception retains byte/pixel limits and cannot extend the existing request deadline', async () => {
		const placeholder = new URL('https://st.kp.yandex.net/images/no-poster.gif');
		const body = vi.fn();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif', 'content-length': String(importArtworkLimits.inputBytes + 1) }), arrayBuffer: body });
		await expect(downloadOriginalImportArtwork(placeholder)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(body).not.toHaveBeenCalled();
		const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif' }), arrayBuffer: async () => bomb });
		await expect(downloadOriginalImportArtwork(placeholder)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		mockedFetch.mockClear();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		mockedFetch.mockImplementationOnce(async () => { clock.mockReturnValue(2001); return { ok: false, status: 302, headers: new Headers({ location: '/images/no-poster.gif' }), body: { destroy: vi.fn() } }; });
		try {
			await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'), undefined, 2000)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledOnce();
		} finally { clock.mockRestore(); }
	});

	test('both placeholder requests share one twelve-second timeout instead of resetting the clock per hop', async () => {
		vi.useFakeTimers();
		mockedFetch.mockImplementationOnce(async () => await new Promise(resolve => setTimeout(() => resolve({ ok: false, status: 302, headers: new Headers({ location: '/images/no-poster.gif' }), body: { destroy: vi.fn() } }), 7000)));
		mockedFetch.mockImplementationOnce(async (_url, options: { signal: AbortSignal }) => await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture-aborted')), { once: true })));
		try {
			const operation = downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'));
			const rejected = expect(operation).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			await vi.advanceTimersByTimeAsync(7000);
			expect(mockedFetch).toHaveBeenCalledTimes(2);
			const signal = mockedFetch.mock.calls[1][1].signal as AbortSignal;
			await vi.advanceTimersByTimeAsync(4999);
			expect(signal.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await rejected;
			expect(signal.aborted).toBe(true);
		} finally { vi.useRealTimers(); }
	});

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
