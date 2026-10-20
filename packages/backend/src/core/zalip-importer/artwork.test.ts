/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ZalipImporterArtworkService } from '@/core/ZalipImporterArtworkService.js';
import { artworkCacheUri, artworkOriginalCacheUri, downloadImportArtwork, downloadOriginalImportArtwork, equivalentImportArtwork, importArtworkLimits, importArtworkUrl } from './artwork.js';
import { recordArtworkCandidates, selectImportArtwork } from './artwork-candidates.js';
import { normalizeKinopoiskRecord } from './providers.js';

vi.mock('@/core/DriveService.js', () => ({ DriveService: class {} }));
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));

const mockedFetch = vi.hoisted(() => vi.fn());
vi.mock('node-fetch', () => ({ default: mockedFetch }));
afterEach(() => mockedFetch.mockReset());

const redirectModes = ['original', 'transformed'] as const;

function downloadForMode(mode: typeof redirectModes[number], url: URL, agent?: Parameters<typeof downloadImportArtwork>[2], deadlineAt?: number) {
	return mode === 'original' ? downloadOriginalImportArtwork(url, agent, deadlineAt) : downloadImportArtwork(url, 'galleryUrls', agent, undefined, true, deadlineAt);
}

describe('bounded local importer artwork', () => {
	test.each(redirectModes)('follows the verified KP API poster alias and existing image-family hop in %s mode', async mode => {
		const original = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		const source = 'https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg';
		const intermediate = 'https://st.kp.yandex.net/images/film_big/9253376.jpg';
		const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture-chosen/orig';
		const firstDestroy = vi.fn(); const secondDestroy = vi.fn(); const agent = {} as never;
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: intermediate }), body: { destroy: firstDestroy } });
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: secondDestroy } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(original.length) }), arrayBuffer: async () => original });
		const result = await downloadForMode(mode, new URL(source), agent);
		expect(result).toMatchObject({ original, originalExtension: 'jpg', width: 80, height: 120 });
		if ('processed' in result && Buffer.isBuffer(result.processed)) expect(await sharp(result.processed).metadata()).toMatchObject({ format: 'webp', width: 80, height: 120 });
		expect(mockedFetch.mock.calls.map(([url, options]) => [url, options.redirect])).toEqual([[source, 'manual'], [intermediate, 'manual'], [destination, 'error']]);
		const signal = mockedFetch.mock.calls[0][1].signal as AbortSignal;
		for (const [, options] of mockedFetch.mock.calls) expect(options).toMatchObject({ signal, agent, size: importArtworkLimits.inputBytes });
		expect(signal.aborted).toBe(true); expect(firstDestroy).toHaveBeenCalledOnce(); expect(secondDestroy).toHaveBeenCalledOnce();
	});

	test('accepts only literal KP API poster inputs for alias redirects', () => {
		const source = 'https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg';
		expect(importArtworkUrl(source)?.href).toBe(source);
		for (const value of [source.replace('https:', 'http:'), source.replace('.tech/', '.tech:443/'), source.replace('.tech/', '.tech:8443/'), source.replace('https://', 'https://user:password@'), source.replace('.tech/', '.tech.evil.org/'), source.replace('9253376', '0'), source.replace('9253376', '09253376'), source.replace('9253376', '9007199254740992'), `${source}?`, `${source}?size=1`, `${source}#`, `${source}#fragment`, source.replace('9253376', '%39' + '253376'), source.replace('/kp/', '/other/../kp/'), source.replace('/kp/', '/other/%2e%2e/kp/'), ` ${source}`, `${source}\n`]) expect(importArtworkUrl(value)).toBeNull();
	});

	test('rejects any first-hop KP alias destination except the exact same-id HTTPS film_big URL', async () => {
		const source = new URL('https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg');
		const approved = 'https://st.kp.yandex.net/images/film_big/9253376.jpg';
		const invalid = [approved.replace('9253376', '9253377'), approved.replace('film_big', 'film'), approved.replace('https:', 'http:'), approved.replace('https:', ''), approved.replace('.net/', '.net:443/'), approved.replace('.net/', '.net:8443/'), approved.replace('https://', 'https://user:password@'), approved.replace('st.kp.yandex.net', '127.0.0.1'), approved.replace('st.kp.yandex.net', 'st.kp.yandex.net.evil.org'), `${approved}?`, `${approved}?token=fixture`, `${approved}#`, `${approved}#fragment`, approved.replace('9253376', '%39' + '253376'), approved.replace('/film_big/', '/other/../film_big/'), approved.replace('/film_big/', '/other/%2e%2e/film_big/'), approved.replace('/film_big/', '/film_big/%2f'), '/images/film_big/9253376.jpg', 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture/orig'];
		for (const location of invalid) {
			mockedFetch.mockReset(); const destroy = vi.fn(); mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location }), body: { destroy } });
			await expect(downloadImportArtwork(source, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledOnce(); expect(destroy).toHaveBeenCalledOnce();
		}
	});

	test.each([302, 303, 307, 308])('does not expand the first KP alias hop to redirect status %s', async status => {
		mockedFetch.mockResolvedValueOnce({ ok: false, status, headers: new Headers({ location: 'https://st.kp.yandex.net/images/film_big/9253376.jpg' }) });
		await expect(downloadImportArtwork(new URL('https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg'), 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledOnce();
	});

	test('does not follow extra hops or relax the existing KP302 image-family destination', async () => {
		const source = new URL('https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg');
		const intermediate = 'https://st.kp.yandex.net/images/film_big/9253376.jpg'; const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture/orig';
		for (const location of [intermediate, 'https://127.0.0.1/poster.jpg', 'https://avatars.mds.yandex.net.evil.org/get-kinopoisk-image/123/fixture/orig', `${destination}?token=fixture`]) {
			mockedFetch.mockReset(); mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: intermediate }) }); mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location }) });
			await expect(downloadImportArtwork(source, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledTimes(2);
		}
		mockedFetch.mockReset(); mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: intermediate }) }); mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }) }); mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination.replace('fixture', 'another') }) });
		await expect(downloadImportArtwork(source, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledTimes(3); expect(mockedFetch.mock.calls[2][1].redirect).toBe('error');
	});

	test('the KP alias chain retains decoder, byte and original deadline limits', async () => {
		const source = new URL('https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg');
		const intermediate = 'https://st.kp.yandex.net/images/film_big/9253376.jpg'; const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture/orig';
		for (const final of [{ mime: 'image/jpeg', size: importArtworkLimits.inputBytes + 1, bytes: Buffer.from('oversized') }, { mime: 'image/svg+xml', size: 6, bytes: Buffer.from('<svg/>') }, { mime: 'image/jpeg', size: 5, bytes: Buffer.from('fake!') }]) {
			mockedFetch.mockReset(); const body = vi.fn(async () => final.bytes);
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: intermediate }) }); mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }) }); mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': final.mime, 'content-length': String(final.size) }), arrayBuffer: body });
			await expect(downloadImportArtwork(source, 'posterUrl')).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledTimes(3); if (final.size > importArtworkLimits.inputBytes || final.mime === 'image/svg+xml') expect(body).not.toHaveBeenCalled();
		}
		mockedFetch.mockReset(); const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		try { mockedFetch.mockImplementationOnce(async () => { clock.mockReturnValue(2001); return { ok: false, status: 301, headers: new Headers({ location: intermediate }) }; }); await expect(downloadImportArtwork(source, 'posterUrl', undefined, undefined, true, 2000)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(mockedFetch).toHaveBeenCalledOnce(); } finally { clock.mockRestore(); }
	});

	test('a selected KP API poster reaches real preparation, conversion and native storage without mocking cache', async () => {
		const source = 'https://kinopoiskapiunofficial.tech/images/posters/kp/9253376.jpg';
		const original = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 301, headers: new Headers({ location: 'https://st.kp.yandex.net/images/film_big/9253376.jpg' }) }); mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture/orig' }) }); mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => original });
		const record = normalizeKinopoiskRecord({ kinopoiskId: 9253376, type: 'TV_SERIES', nameRu: 'Fixture series', posterUrl: source }); record.artworkCandidates = recordArtworkCandidates(record);
		const candidate = record.artworkCandidates.find(value => value.field === 'posterUrl')!;
		const options = { fields: ['posterUrl'] as const, artworkSelections: [{ ref: record.ref, choices: { posterUrl: candidate.id } }] };
		const selected = selectImportArtwork(record, record.ref, { ...options, fields: [...options.fields] }, { posterUrl: 'kinopoisk' });
		const files = new Map<string, { url: string }>(); const stored: { uri: string; bytes: Buffer }[] = [];
		const repository = { findOneBy: vi.fn(async ({ uri }: { uri: string }) => files.get(uri) ?? null) };
		const connection = { connect: vi.fn(), release: vi.fn(), query: vi.fn(async () => [{ locked: true }]) };
		const drive = { addFile: vi.fn(async ({ path, uri, name }: { path: string; uri: string; name: string }) => { stored.push({ uri, bytes: await readFile(path) }); const file = { url: `/files/${name}` }; files.set(uri, file); return file; }) };
		const service = new ZalipImporterArtworkService({ createQueryRunner: () => connection, getRepository: () => repository } as never, drive as never, { getAgentForHttps: () => undefined } as never);
		const result = await service.prepare(selected.record, null, [...options.fields], [], { format: 'webp' }, 'local', selected.selectedFields);
		expect(result.posterUrl).toMatch(/^\/files\/zalip-artwork-[a-f0-9]{16}\.webp$/u); expect(result.warnings).not.toContain('artwork-local-unavailable:posterUrl'); expect(selected.sources.posterUrl).toBe('kinopoisk');
		expect(drive.addFile).toHaveBeenCalledTimes(2); expect(stored.find(file => file.uri === artworkOriginalCacheUri(new URL(source)))?.bytes).toEqual(original);
		const processed = stored.find(file => file.uri === artworkCacheUri(new URL(source), 'posterUrl', { format: 'webp' }, false))!.bytes; expect(await sharp(processed).metadata()).toMatchObject({ format: 'webp', width: 80, height: 120 });
		expect(connection.release).toHaveBeenCalledOnce(); expect(mockedFetch).toHaveBeenCalledTimes(3);
	});

	test('Kodik artwork admits only verified public screenshot and Shikimori image families', () => {
		for (const value of ['https://i.kodikres.com/screenshots/seria/123/hash/1.jpg', 'https://i.kodikres.com/screenshots/video/123/hash/2.jpg', 'https://shikimori.io/uploads/poster/animes/123/hash.jpg', 'https://shikimori.io/system/screenshots/original/123.jpg', 'https://shikimori.io/system/animes/original/123.jpg']) expect(importArtworkUrl(value)?.href).toBe(value);
		for (const value of ['https://i.kodikres.com/private/file.jpg', 'https://i.kodikres.com/screenshots/seria/0/hash/1.jpg', 'https://i.kodikres.com/screenshots/season/123/hash/1.jpg', 'https://i.kodikres.com.evil.org/screenshots/seria/123/hash/1.jpg', 'https://cdn.kodikres.com/screenshots/seria/123/hash/1.jpg', 'https://i.kodikres.com/screenshots/seria/123/hash/1.jpg?cache=1', 'https://shikimori.io/api/animes/123', 'https://shikimori.io/uploads/poster/animes/123/hash.jpg?cache=1', 'https://shikimori.io/uploads/poster/animes/../../secret.jpg', 'https://shikimori.io/system/animes/%2fprivate.jpg', 'http://shikimori.io/system/animes/original/123.jpg']) expect(importArtworkUrl(value)).toBeNull();
	});
	test.each(redirectModes)('supports the verified Kinopoisk poster image-family hop in %s mode', async mode => {
		const original = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture-chosen/x1000';
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => original });
		const result = await downloadForMode(mode, new URL('https://st.kp.yandex.net/images/film_big/123.jpg'));
		expect(result).toMatchObject({ original, originalExtension: 'jpg', width: 80, height: 120 });
		if ('processed' in result && Buffer.isBuffer(result.processed)) expect(await sharp(result.processed).metadata()).toMatchObject({ format: 'webp', width: 80, height: 120 });
		expect(mockedFetch.mock.calls[1][1].redirect).toBe('error');
	});

	test.each(redirectModes)('follows one verified redirect-only Kodik screenshot CDN hop in %s mode', async mode => {
		const original = await sharp({ create: { width: 80, height: 45, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const agent = {} as never;
		for (const location of [destination, destination.replace('https:', '')]) {
			mockedFetch.mockReset();
			const destroy = vi.fn();
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy } });
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(original.length) }), arrayBuffer: async () => original });
			expect(await downloadForMode(mode, source, agent)).toMatchObject({ original, originalExtension: 'jpg', width: 80, height: 45 });
			expect(destroy).toHaveBeenCalledOnce();
			expect(mockedFetch.mock.calls[0]).toEqual([source.href, expect.objectContaining({ redirect: 'manual', agent, size: importArtworkLimits.inputBytes })]);
			expect(mockedFetch.mock.calls[1]).toEqual([destination, expect.objectContaining({ redirect: 'manual', agent, size: importArtworkLimits.inputBytes })]);
			expect(mockedFetch.mock.calls[0][1].signal).toBe(mockedFetch.mock.calls[1][1].signal);
		}
		mockedFetch.mockReset();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg' }), arrayBuffer: async () => original });
		expect(await downloadForMode(mode, new URL('https://i.kodikres.com/screenshots/seria/103120/1.jpg'), agent)).toMatchObject({ original, width: 80, height: 45 });
		expect(importArtworkUrl(destination)).toBeNull();
		mockedFetch.mockClear();
		await expect(downloadForMode(mode, new URL(destination))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).not.toHaveBeenCalled();
	});

	test.each(redirectModes)('follows only one bounded Kodik edge for the exact signed image in %s mode', async mode => {
		const original = await sharp({ create: { width: 80, height: 45, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		const agent = {} as never;
		for (const [index, label] of ['nirvana', 'limbo', 'radium', 'monoceros', 'a', 'a'.repeat(63)].entries()) {
			mockedFetch.mockReset();
			const suffix = `/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb00${index + 1}.jpg`;
			const destination = `https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803${suffix}`;
			const edge = `https://${label}.cloud.solodcdn.com/fedcba9876543210fedcba9876543210:2026101804${suffix}`;
			const firstDestroy = vi.fn(); const secondDestroy = vi.fn();
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination.replace('https:', '') }), body: { destroy: firstDestroy } });
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: index % 2 ? edge.replace('https:', '') : edge }), body: { destroy: secondDestroy } });
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(original.length) }), arrayBuffer: async () => original });
			const result = await downloadForMode(mode, new URL(`https://i.kodikres.com/screenshots/${index % 2 ? 'seria' : 'video'}/103120/${index + 1}.jpg`), agent);
			expect(result).toMatchObject({ original, originalExtension: 'jpg', width: 80, height: 45 });
			if ('processed' in result && Buffer.isBuffer(result.processed)) expect(await sharp(result.processed).metadata()).toMatchObject({ format: 'webp', width: 80, height: 45 });
			expect(firstDestroy).toHaveBeenCalledOnce(); expect(secondDestroy).toHaveBeenCalledOnce();
			expect(mockedFetch).toHaveBeenCalledTimes(3);
			expect(mockedFetch.mock.calls[1]).toEqual([destination, expect.objectContaining({ redirect: 'manual', agent, size: importArtworkLimits.inputBytes })]);
			expect(mockedFetch.mock.calls[2]).toEqual([edge, expect.objectContaining({ redirect: 'error', agent, size: importArtworkLimits.inputBytes })]);
			const signal = mockedFetch.mock.calls[0][1].signal as AbortSignal;
			expect(mockedFetch.mock.calls[1][1].signal).toBe(signal); expect(mockedFetch.mock.calls[2][1].signal).toBe(signal);
			expect(signal.aborted).toBe(true);
			expect(importArtworkUrl(edge)).toBeNull();
			mockedFetch.mockClear();
			await expect(downloadForMode(mode, new URL(edge))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).not.toHaveBeenCalled();
		}
	});

	test.each(redirectModes)('rejects unapproved, changed-image and noncanonical Kodik edge destinations in %s mode', async mode => {
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const approved = destination.replace('cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com');
		const invalid = [
			approved.replace('https:', 'http:'), approved.replace('nirvana.cloud.solodcdn.com', '127.0.0.1'), destination,
			approved.replace('nirvana.cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com.evil.example.org'), approved.replace('nirvana.cloud.solodcdn.com', 'nested.nirvana.cloud.solodcdn.com'),
			approved.replace('nirvana', '-nirvana'), approved.replace('nirvana', 'nirvana-'), approved.replace('nirvana', 'bad_label'), approved.replace('nirvana', 'a'.repeat(64)),
			approved.replace('nirvana.cloud.solodcdn.com', 'user:private@nirvana.cloud.solodcdn.com'), approved.replace('nirvana.cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com:443'), approved.replace('nirvana.cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com:8443'),
			`${approved}?token=fixture`, `${approved}?`, `${approved}#fragment`, `${approved}#`,
			approved.replace('0123456789abcdef0123456789abcdef:', 'unsigned:'), approved.replace(':2026101803/', ':2026101803000/'),
			approved.replace('747f3071-354a-471d-b4c1-38dcd651e5d4', '847f3071-354a-471d-b4c1-38dcd651e5d4'), approved.replace('thumb001.jpg', 'thumb002.jpg'),
			approved.replace('thumb001.jpg', 'thumb1.jpg'), approved.replace('thumb001.jpg', 'thumb001.png'), approved.replace('/useruploads/', '/%75seruploads/'),
			approved.replace('/thumb001.jpg', '/%2fthumb001.jpg'), approved.replace('/thumb001.jpg', '/../thumb001.jpg'), approved.replace('/useruploads/', '/./useruploads/'),
			approved.replace('nirvana.cloud.solodcdn.com', 'nirvana\\.cloud.solodcdn.com'), `/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg`,
			'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig', `${approved}/`,
		];
		for (const location of invalid) {
			mockedFetch.mockReset();
			const destroy = vi.fn();
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy } });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledTimes(2); expect(destroy).toHaveBeenCalledOnce();
		}
	});

	test.each(redirectModes)('never follows a third Kodik hop or extends Kinopoisk redirect permissions in %s mode', async mode => {
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const edge = destination.replace('cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com');
		for (const status of [301, 303, 307, 308]) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			mockedFetch.mockResolvedValueOnce({ ok: false, status, headers: new Headers({ location: edge }), body: { destroy: vi.fn() } });
			await expect(downloadForMode(mode, new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledTimes(2);
		}
		mockedFetch.mockReset();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: edge }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: edge.replace('nirvana', 'limbo') }), body: { destroy: vi.fn() } });
		await expect(downloadForMode(mode, new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledTimes(3); expect(mockedFetch.mock.calls[2][1].redirect).toBe('error');
		mockedFetch.mockReset();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig' }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: edge }), body: { destroy: vi.fn() } });
		await expect(downloadForMode(mode, new URL('https://st.kp.yandex.net/images/film_big/123.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledTimes(2); expect(mockedFetch.mock.calls[1][1].redirect).toBe('error');
	});

	test.each(redirectModes)('all three Kodik requests share the same deadline and abort clock in %s mode', async mode => {
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const edge = destination.replace('cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com');
		const first = { ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } };
		const second = { ok: false, status: 302, headers: new Headers({ location: edge }), body: { destroy: vi.fn() } };
		vi.useFakeTimers();
		mockedFetch.mockImplementationOnce(async () => await new Promise(resolve => setTimeout(() => resolve(first), 4000)));
		mockedFetch.mockImplementationOnce(async () => await new Promise(resolve => setTimeout(() => resolve(second), 4000)));
		mockedFetch.mockImplementationOnce(async (_url, options: { signal: AbortSignal }) => await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture-aborted')), { once: true })));
		try {
			const rejected = expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			await vi.advanceTimersByTimeAsync(8000);
			expect(mockedFetch).toHaveBeenCalledTimes(3);
			const signal = mockedFetch.mock.calls[2][1].signal as AbortSignal;
			expect(signal).toBe(mockedFetch.mock.calls[0][1].signal);
			await vi.advanceTimersByTimeAsync(3999); expect(signal.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1); await rejected; expect(signal.aborted).toBe(true);
		} finally { vi.useRealTimers(); }
		mockedFetch.mockReset();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		mockedFetch.mockResolvedValueOnce(first);
		mockedFetch.mockImplementationOnce(async () => { clock.mockReturnValue(2001); return second; });
		try {
			await expect(downloadForMode(mode, source, undefined, 2000)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledTimes(2);
		} finally { clock.mockRestore(); }
	});

	test.each(redirectModes)('validates final Kodik edge MIME, bytes and pixels without widening limits in %s mode', async mode => {
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const enqueueRedirects = () => {
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination.replace('cloud.solodcdn.com', 'nirvana.cloud.solodcdn.com') }), body: { destroy: vi.fn() } });
		};
		for (const headers of [{ 'content-type': 'image/svg+xml' }, { 'content-type': 'image/gif' }, { 'content-type': 'image/jpeg', 'content-length': String(importArtworkLimits.inputBytes + 1) }]) {
			mockedFetch.mockReset(); enqueueRedirects();
			const body = vi.fn();
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(headers), arrayBuffer: body });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE'); expect(body).not.toHaveBeenCalled();
		}
		const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
		for (const original of [Buffer.alloc(0), Buffer.alloc(importArtworkLimits.inputBytes + 1), Buffer.from('not-image-pixels'), bomb]) {
			mockedFetch.mockReset(); enqueueRedirects();
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		}
	});

	test.each(redirectModes)('Kodik screenshot requests share one timeout and never refresh an expired deadline in %s mode', async mode => {
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const location = '//cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const redirect = { ok: false, status: 302, headers: new Headers({ location }), body: { destroy: vi.fn() } };
		vi.useFakeTimers();
		mockedFetch.mockImplementationOnce(async () => await new Promise(resolve => setTimeout(() => resolve(redirect), 7000)));
		mockedFetch.mockImplementationOnce(async (_url, options: { signal: AbortSignal }) => await new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('fixture-aborted')), { once: true })));
		try {
			const rejected = expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			await vi.advanceTimersByTimeAsync(7000);
			expect(mockedFetch).toHaveBeenCalledTimes(2);
			const signal = mockedFetch.mock.calls[1][1].signal as AbortSignal;
			await vi.advanceTimersByTimeAsync(4999);
			expect(signal.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await rejected;
			expect(signal.aborted).toBe(true);
		} finally { vi.useRealTimers(); }
		mockedFetch.mockReset();
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		mockedFetch.mockImplementationOnce(async () => { clock.mockReturnValue(2001); return redirect; });
		try {
			await expect(downloadForMode(mode, source, undefined, 2000)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledOnce();
		} finally { clock.mockRestore(); }
	});

	test.each(redirectModes)('rejects all unapproved Kodik image destinations before another request in %s mode', async mode => {
		const approved = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const invalid = [
			approved.replace('https:', 'http:'), approved.replace('cloud.solodcdn.com', '127.0.0.1'),
			approved.replace('cloud.solodcdn.com', 'cloud.solodcdn.com.evil.example.org'), approved.replace('cloud.solodcdn.com', 'sub.cloud.solodcdn.com'),
			approved.replace('cloud.solodcdn.com', 'user:private@cloud.solodcdn.com'), approved.replace('cloud.solodcdn.com', 'cloud.solodcdn.com:443'), approved.replace('cloud.solodcdn.com', 'cloud.solodcdn.com:8443'),
			`${approved}?token=fixture`, `${approved}?`, `${approved}#fragment`, `${approved}#`,
			approved.replace('0123456789abcdef0123456789abcdef:', 'unsigned:'), approved.replace(':2026101803/', ':2026101803000/'),
			approved.replace('/useruploads/', '/uploads/'), approved.replace('747f3071-354a-471d-b4c1-38dcd651e5d4', 'arbitrary-upload'),
			approved.replace('thumb001.jpg', 'original.jpg'), approved.replace('thumb001.jpg', 'thumb1.jpg'), approved.replace('thumb001.jpg', 'thumb001.png'),
			approved.replace('/useruploads/', '/%75seruploads/'), approved.replace('/thumb001.jpg', '/%2fthumb001.jpg'), approved.replace('/thumb001.jpg', '/../thumb001.jpg'),
			'/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg',
			'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig',
		];
		for (const location of invalid) {
			mockedFetch.mockReset();
			const destroy = vi.fn();
			mockedFetch.mockResolvedValue({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy } });
			await expect(downloadForMode(mode, new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledOnce();
			expect(destroy).toHaveBeenCalledOnce();
		}
	});

	test.each(redirectModes)('does not allow Kodik CDN redirects from unverified source paths or non-302 statuses in %s mode', async mode => {
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		for (const source of ['https://image.tmdb.org/photo.jpg', 'https://st.kp.yandex.net/images/film_big/123.jpg', 'https://i.kodikres.com/screenshots/video/103120/hash/1.jpg', 'https://i.kodikres.com/screenshots/video/103120/thumb001.jpg', 'https://i.kodikres.com/screenshots/video/103120/0.jpg', 'https://i.kodikres.com/screenshots/video/103120/1.jpg?', 'https://i.kodikres.com/screenshots/video/103120/1.jpg#']) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValue({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			await expect(downloadForMode(mode, new URL(source))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledOnce();
		}
		for (const status of [301, 303, 307, 308]) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValue({ ok: false, status, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			await expect(downloadForMode(mode, new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledOnce();
		}
	});

	test.each(redirectModes)('Kodik screenshot hop retains MIME, byte, decoder and approved-hop bounds in %s mode', async mode => {
		const source = new URL('https://i.kodikres.com/screenshots/video/103120/1.jpg');
		const destination = 'https://cloud.solodcdn.com/0123456789abcdef0123456789abcdef:2026101803/useruploads/747f3071-354a-471d-b4c1-38dcd651e5d4/thumb001.jpg';
		const redirect = { ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } };
		for (const location of [source.href, destination, 'https://evil.example.org/image.jpg']) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValueOnce(redirect);
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy: vi.fn() } });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledTimes(2);
			expect(mockedFetch.mock.calls[1][1].redirect).toBe('manual');
		}
		for (const headers of [{ 'content-type': 'image/svg+xml' }, { 'content-type': 'image/gif' }, { 'content-type': 'image/jpeg', 'content-length': String(importArtworkLimits.inputBytes + 1) }]) {
			mockedFetch.mockReset();
			const body = vi.fn();
			mockedFetch.mockResolvedValueOnce(redirect);
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(headers), arrayBuffer: body });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(body).not.toHaveBeenCalled();
		}
		const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#ffffff' } }).png().toBuffer();
		for (const original of [Buffer.alloc(0), Buffer.alloc(importArtworkLimits.inputBytes + 1), Buffer.from('not-image-pixels'), bomb]) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValueOnce(redirect);
			mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => original });
			await expect(downloadForMode(mode, source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		}
	});

	test('localizes a Kodik screenshot with the same protected request and conversion bounds', async () => {
		const original = await sharp({ create: { width: 80, height: 45, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		mockedFetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(original.length) }), arrayBuffer: async () => original });
		const agent = {} as never;
		const url = new URL('https://i.kodikres.com/screenshots/seria/123/hash/1.jpg');
		const result = await downloadImportArtwork(url, 'galleryUrls', agent);
		expect(result).toMatchObject({ original, originalExtension: 'jpg', extension: 'webp', width: 80, height: 45 });
		expect(mockedFetch).toHaveBeenCalledWith(url.href, expect.objectContaining({ redirect: 'error', agent, size: importArtworkLimits.inputBytes }));
	});
	test.each(['https:', ''])('retains exact JPEG bytes through one approved Kinopoisk image-family hop (%s)', async scheme => {
		const original = await sharp({ create: { width: 225, height: 350, channels: 3, background: '#789abc' } }).jpeg().toBuffer();
		const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/fixture-chosen/orig';
		const destroy = vi.fn();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination.replace('https:', scheme) }), body: { destroy } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(original.length) }), arrayBuffer: async () => original });
		const agent = {} as never;
		expect(await downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/actor_iphone/chosen.jpg'), agent)).toMatchObject({ original, originalExtension: 'jpg', format: 'jpeg', width: 225, height: 350 });
		expect(destroy).toHaveBeenCalledOnce();
		expect(mockedFetch).toHaveBeenCalledTimes(2);
		expect(mockedFetch.mock.calls[1]).toEqual([destination, expect.objectContaining({ redirect: 'error', agent, size: importArtworkLimits.inputBytes })]);
		expect(mockedFetch.mock.calls[0][1].signal).toBe(mockedFetch.mock.calls[1][1].signal);
	});

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
		'https://avatars.mds.yandex.net.evil.example.org/get-kinopoisk-image/123/chosen/orig',
		'https://evil.avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig',
		'http://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig',
		'https://avatars.mds.yandex.net:443/get-kinopoisk-image/123/chosen/orig',
		'https://avatars.mds.yandex.net:8443/get-kinopoisk-image/123/chosen/orig',
		'https://user:private@avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig?cache=1',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig?',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig#',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig#fragment',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/',
		'https://avatars.mds.yandex.net/get-other-image/123/chosen/orig',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/../get-other-image/123/chosen/orig',
		'https://avatars.mds.yandex.net/get-kinopoisk-image/%2f../get-other-image/123/chosen/orig',
	])('never follows an unapproved Kinopoisk image redirect destination %s', async location => {
		const destroy = vi.fn();
		mockedFetch.mockResolvedValue({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy } });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
		expect(destroy).toHaveBeenCalledOnce();
	});

	test.each([301, 303, 307, 308])('does not follow a Kinopoisk image-family redirect with status %s', async status => {
		mockedFetch.mockResolvedValue({ ok: false, status, headers: new Headers({ location: 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig' }), body: { destroy: vi.fn() } });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(mockedFetch).toHaveBeenCalledOnce();
	});

	test('image-family hop cannot redirect back, chain onward or use the placeholder GIF MIME exception', async () => {
		const destination = 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig';
		const source = new URL('https://st.kp.yandex.net/images/person.jpg');
		for (const next of [source.href, 'https://avatars.mds.yandex.net/get-kinopoisk-image/456/other/orig']) {
			mockedFetch.mockReset();
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
			mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: next }), body: { destroy: vi.fn() } });
			await expect(downloadOriginalImportArtwork(source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
			expect(mockedFetch).toHaveBeenCalledTimes(2);
			expect(mockedFetch.mock.calls[1][1].redirect).toBe('error');
		}
		mockedFetch.mockReset();
		const body = vi.fn();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: destination }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/gif' }), arrayBuffer: body });
		await expect(downloadOriginalImportArtwork(source)).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(body).not.toHaveBeenCalled();
	});

	test('image-family hop retains the original byte cap', async () => {
		const body = vi.fn();
		mockedFetch.mockResolvedValueOnce({ ok: false, status: 302, headers: new Headers({ location: 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig' }), body: { destroy: vi.fn() } });
		mockedFetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'image/jpeg', 'content-length': String(importArtworkLimits.inputBytes + 1) }), arrayBuffer: body });
		await expect(downloadOriginalImportArtwork(new URL('https://st.kp.yandex.net/images/person.jpg'))).rejects.toThrow('IMPORT_ARTWORK_UNAVAILABLE');
		expect(body).not.toHaveBeenCalled();
		expect(mockedFetch.mock.calls[1][1].size).toBe(importArtworkLimits.inputBytes);
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

	test('rejects second-hop redirects, loops and the placeholder hop in the conversion pipeline', async () => {
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
		expect(mockedFetch.mock.calls[0][1].redirect).toBe('manual');
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

	test.each(['/images/no-poster.gif', 'https://avatars.mds.yandex.net/get-kinopoisk-image/123/chosen/orig'])('both requests share one twelve-second timeout instead of resetting the clock per hop (%s)', async location => {
		vi.useFakeTimers();
		mockedFetch.mockImplementationOnce(async () => await new Promise(resolve => setTimeout(() => resolve({ ok: false, status: 302, headers: new Headers({ location }), body: { destroy: vi.fn() } }), 7000)));
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
