/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipCatalogEntry } from '@/models/ZalipCatalogEntry.js';
import { mergeZalipCatalogEntry, packZalipCatalogFacts } from '@/misc/zalip-taxonomy.js';
import { ZalipArtworkLocalizationService } from './ZalipArtworkLocalizationService.js';
import { artworkLocalizationRevision, existingArtworkSource, localizeArtworkOwnership } from './zalip-importer/localization.js';
import type { ArtworkLocalizationField, ArtworkLocalizationKind } from './zalip-importer/localization.js';

vi.mock('@/core/ZalipImporterArtworkService.js', () => ({ ZalipImporterArtworkService: class {} }));

const poster = 'https://image.tmdb.org/t/p/w500/chosen.jpg';
const local = 'https://zalip.example.org/files/native.jpg';
const originalLogo = 'https://image.tmdb.org/t/p/original/chosen-logo.png';
const boundedLogo = 'https://image.tmdb.org/t/p/w1280/chosen-logo.png';
const lockedMetadata = { locks: ['posterUrl', 'title'], values: { posterUrl: poster, title: 'Original' }, sources: { posterUrl: 'kinopoisk' }, custom: { untouched: true } };

function fixture(kind: ArtworkLocalizationKind = 'work', additions: Record<string, unknown> = {}) {
	const row: Record<string, unknown> = { id: 'row01', updatedAt: new Date(0), tmdbId: 1, tmdbMediaType: 'tv', posterPath: poster, backdropPath: null, logoPath: null, galleryPaths: [], importData: structuredClone(lockedMetadata), workId: 'work01', seasonId: 'season01', stillPath: poster, imageUrl: poster, importValues: { posterPath: poster, stillPath: poster }, data: { biography: 'Kept', _zalip: { manualFields: ['imageUrl'], fieldSources: { imageUrl: 'manual' } } }, ...additions };
	const owner = { id: 'work01', tmdbId: 1, tmdbMediaType: 'tv' };
	const repositories = new Map<unknown, { find: ReturnType<typeof vi.fn>; findOneBy: ReturnType<typeof vi.fn>; findOne: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> }>();
	const entity = { work: MiZalipWork, season: MiZalipSeason, episode: MiZalipEpisode, catalog: MiZalipCatalogEntry }[kind];
	for (const model of [MiZalipWork, MiZalipSeason, MiZalipEpisode, MiZalipCatalogEntry]) repositories.set(model, {
		find: vi.fn(async () => model === entity ? [structuredClone(row)] : []),
		findOneBy: vi.fn(async () => model === entity ? structuredClone(row) : model === MiZalipSeason ? { id: 'season01', workId: 'work01' } : owner),
		findOne: vi.fn(async () => model === entity ? structuredClone(row) : owner),
		update: vi.fn(async (_where, values) => { Object.assign(row, structuredClone(values)); return { affected: 1 }; }),
	});
	const nativeFiles = new Set<string>();
	const drive = { findOne: vi.fn(async ({ where }: { where: Record<string, unknown>[] }) => where.some(condition => Object.values(condition).some(value => typeof value === 'string' && nativeFiles.has(value))) ? { url: local, isLink: false } : null) };
	const getRepository = (model: unknown) => model === MiDriveFile ? drive : repositories.get(model)!;
	const manager = { getRepository, query: vi.fn().mockResolvedValue([]) };
	const connection = { connect: vi.fn(), release: vi.fn(), query: vi.fn().mockResolvedValue([{ locked: true }]) };
	const db = { manager, getRepository, createQueryRunner: () => connection, transaction: vi.fn(async action => action(manager)) };
	const artwork = { cacheOriginal: vi.fn(async (_value: string, _budget: { deadlineAt: number; remainingBytes: number }) => { nativeFiles.add(local); return local; }) };
	const service = new ZalipArtworkLocalizationService(db as never, artwork as never);
	const field: ArtworkLocalizationField = kind === 'episode' ? 'stillPath' : kind === 'catalog' ? 'imageUrl' : 'posterPath';
	const expected = () => artworkLocalizationRevision(kind, 'row01', field, row[field] as string);
	return { service, row, repositories, repository: repositories.get(entity)!, drive, nativeFiles, db, manager, connection, artwork, field, expected };
}

describe('exact existing catalogue image localization', () => {
	test('successful original logos stay byte-preserving without requesting a resized variant', async () => {
		const f = fixture('work', { logoPath: originalLogo });
		const expected = artworkLocalizationRevision('work', 'row01', 'logoPath', originalLogo);
		expect((await f.service.step('work', 'row01', 'logoPath', expected)).status).toBe('localized');
		expect(f.artwork.cacheOriginal).toHaveBeenCalledExactlyOnceWith(originalLogo, expect.any(Object));
	});

	test('a rejected canonical original work logo retries only its same-basename bounded variant, retaining exact CAS and locks', async () => {
		const metadata = { locks: ['logoUrl', 'title'], values: { logoUrl: originalLogo, title: 'Keep' }, sources: { logoUrl: 'tmdb' } };
		const f = fixture('work', { logoPath: originalLogo, importData: metadata });
		f.artwork.cacheOriginal.mockRejectedValueOnce(new Error('IMPORT_ARTWORK_UNAVAILABLE'));
		const expected = artworkLocalizationRevision('work', 'row01', 'logoPath', originalLogo);
		expect((await f.service.step('work', 'row01', 'logoPath', expected)).status).toBe('localized');
		expect(f.artwork.cacheOriginal.mock.calls.map(args => args[0])).toEqual([originalLogo, boundedLogo]);
		expect(f.artwork.cacheOriginal.mock.calls[0][1]).toBe(f.artwork.cacheOriginal.mock.calls[1][1]);
		expect(f.row.logoPath).toBe(local);
		expect(f.row.importData).toEqual({ ...metadata, values: { ...metadata.values, logoUrl: local }, localArtwork: { logoUrl: local } });
	});

	test.each([
		['work', 'posterPath', originalLogo],
		['catalog', 'imageUrl', originalLogo],
		['work', 'logoPath', 'https://st.kp.yandex.net/images/logo.png'],
		['work', 'logoPath', 'https://image.tmdb.org/t/p/w500/chosen-logo.png'],
		['work', 'logoPath', 'https://image.tmdb.org/t/p/original/nested/chosen-logo.png'],
		['work', 'logoPath', 'https://image.tmdb.org/t/p/original/chosen-logo.png?language=ru'],
	] as const)('never derives logo variants for an ineligible %s/%s source', async (kind, field, value) => {
		const f = fixture(kind, { [field]: value });
		f.artwork.cacheOriginal.mockRejectedValue(new Error('IMPORT_ARTWORK_UNAVAILABLE'));
		const expected = artworkLocalizationRevision(kind, 'row01', field, value);
		expect((await f.service.step(kind, 'row01', field, expected)).status).toBe('unavailable');
		expect(f.artwork.cacheOriginal).toHaveBeenCalledExactlyOnceWith(value, expect.any(Object));
		expect(f.row[field]).toBe(value);
		expect(f.repository.update).not.toHaveBeenCalled();
	});

	test('a failed bounded logo leaves the exact selected URL, manual baseline and locks intact', async () => {
		const metadata = { locks: ['logoUrl'], values: { logoUrl: 'https://manual.example.org/earlier.png' }, sources: { logoUrl: 'manual' } };
		const f = fixture('work', { logoPath: originalLogo, importData: metadata });
		f.artwork.cacheOriginal.mockRejectedValue(new Error('IMPORT_ARTWORK_UNAVAILABLE'));
		const expected = artworkLocalizationRevision('work', 'row01', 'logoPath', originalLogo);
		expect((await f.service.step('work', 'row01', 'logoPath', expected)).status).toBe('unavailable');
		expect(f.artwork.cacheOriginal.mock.calls.map(args => args[0])).toEqual([originalLogo, boundedLogo]);
		expect(f.row.logoPath).toBe(originalLogo);
		expect(f.row.importData).toEqual(metadata);
		expect(f.repository.update).not.toHaveBeenCalled();
	});

	test('a newer editor logo during the bounded retry wins CAS without changing the newer metadata', async () => {
		const f = fixture('work', { logoPath: originalLogo });
		f.artwork.cacheOriginal.mockRejectedValueOnce(new Error('IMPORT_ARTWORK_UNAVAILABLE')).mockImplementationOnce(async () => {
			f.row.logoPath = 'https://manual.example.org/newer.png';
			f.row.importData = { locks: ['logoUrl'], values: { title: 'Newer' } };
			return local;
		});
		const expected = artworkLocalizationRevision('work', 'row01', 'logoPath', originalLogo);
		expect((await f.service.step('work', 'row01', 'logoPath', expected)).status).toBe('stale');
		expect(f.row.logoPath).toBe('https://manual.example.org/newer.png');
		expect(f.row.importData).toEqual({ locks: ['logoUrl'], values: { title: 'Newer' } });
		expect(f.repository.update).not.toHaveBeenCalled();
	});

	test('the bounded logo retry cannot extend the original field deadline', async () => {
		const f = fixture('work', { logoPath: originalLogo });
		const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
		f.artwork.cacheOriginal.mockImplementationOnce(async () => { clock.mockReturnValue(46001); throw new Error('IMPORT_ARTWORK_UNAVAILABLE'); });
		try {
			const expected = artworkLocalizationRevision('work', 'row01', 'logoPath', originalLogo);
			expect((await f.service.step('work', 'row01', 'logoPath', expected)).status).toBe('unavailable');
			expect(f.artwork.cacheOriginal).toHaveBeenCalledOnce();
		} finally { clock.mockRestore(); }
	});
	test('taxonomy refresh preserves localized photos, manual edits can replace them, and private aliases never pack publicly', () => {
		const entry = { name: 'Person', slug: 'person', description: 'Original', imageUrl: local, externalIds: { tmdb: '10' }, parentId: null, data: { biography: 'Biography', _zalip: { manualFields: [], fieldSources: { imageUrl: 'tmdb' }, localArtwork: { imageUrl: local } } } };
		const refreshed = mergeZalipCatalogEntry(entry, { type: 'person', name: 'New name', description: 'New description', imageUrl: poster }, 'tmdb');
		expect(refreshed).toMatchObject({ name: 'New name', description: 'New description', imageUrl: local, data: { _zalip: { localArtwork: { imageUrl: local } } } });
		expect(packZalipCatalogFacts(refreshed.data)).toEqual({ biography: 'Biography' });
		const manual = mergeZalipCatalogEntry(refreshed, { type: 'person', name: 'New name', imageUrl: poster }, 'manual');
		expect(manual).toMatchObject({ imageUrl: poster, data: { _zalip: { localArtwork: {}, manualFields: expect.arrayContaining(['imageUrl']) } } });
	});
	test('inspection exposes only hashed exact targets and bounded provider counts, without writes or source URLs', async () => {
		const f = fixture();
		const result = await f.service.inspect('work', undefined, 1);
		expect(result).toMatchObject({ nextId: 'row01', targets: [{ kind: 'work', id: 'row01', field: 'posterPath', images: 1, local: 0, eligible: 1, unsupported: 0, hosts: { 'image.tmdb.org': 1 } }] });
		expect(result.targets[0].expected).toMatch(/^[a-f0-9]{64}$/u);
		expect(JSON.stringify(result)).not.toContain('chosen.jpg');
		expect(f.repository.update).not.toHaveBeenCalled();
		expect(f.artwork.cacheOriginal).not.toHaveBeenCalled();
		expect(f.repository.find).toHaveBeenCalledWith({ where: {}, order: { id: 'ASC' }, take: 1 });
	});

	test('localizes the exact chosen URL even if manually locked and preserves every non-image field/source/lock', async () => {
		const f = fixture();
		const baseline = structuredClone(f.row);
		expect(await f.service.step('work', 'row01', 'posterPath', f.expected())).toMatchObject({ status: 'localized', images: 1 });
		expect(f.artwork.cacheOriginal).toHaveBeenCalledWith(poster, expect.objectContaining({ remainingBytes: 96 * 1024 * 1024 }));
		expect(f.row.posterPath).toBe(local);
		expect(f.row.importData).toEqual({ ...lockedMetadata, values: { ...lockedMetadata.values, posterUrl: local }, localArtwork: { posterUrl: local } });
		for (const [key, value] of Object.entries(baseline)) if (!['posterPath', 'updatedAt', 'importData'].includes(key)) expect(f.row[key]).toEqual(value);
		expect(f.repository.findOne).toHaveBeenCalledWith({ where: { id: 'row01' }, lock: { mode: 'pessimistic_write' } });
		expect(f.connection.release).toHaveBeenCalled();
		const replay = await f.service.step('work', 'row01', 'posterPath', f.expected());
		expect(replay.status).toBe('already-local');
		expect(f.artwork.cacheOriginal).toHaveBeenCalledTimes(1);
	});

	test.each(['season', 'episode', 'catalog'] as const)('localizes %s images without claiming unrelated manual metadata', async kind => {
		const f = fixture(kind);
		expect((await f.service.step(kind, 'row01', f.field, f.expected())).status).toBe('localized');
		if (kind === 'catalog') {
			expect(f.manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-catalog-directories']);
			expect(f.row.data).toEqual({ biography: 'Kept', _zalip: { manualFields: ['imageUrl'], fieldSources: { imageUrl: 'manual' }, localArtwork: { imageUrl: local } } });
		} else {
			expect(f.repositories.get(MiZalipWork)!.findOne).toHaveBeenCalledWith({ where: { id: 'work01' }, lock: { mode: 'pessimistic_write' } });
			expect(f.row.importValues).toMatchObject({ [f.field]: local, _zalipLocalArtwork: { [f.field]: local } });
		}
	});

	test('a changed image during network work fails CAS and retains the newer editor image and metadata', async () => {
		const f = fixture();
		f.artwork.cacheOriginal.mockImplementation(async () => { f.row.posterPath = 'https://manual.example.org/newer.jpg'; f.row.importData = { locks: ['posterUrl'], values: { title: 'Newer' } }; return local; });
		expect((await f.service.step('work', 'row01', 'posterPath', f.expected())).status).toBe('stale');
		expect(f.repository.update).not.toHaveBeenCalled();
		expect(f.row.posterPath).toContain('newer.jpg');
		expect(f.row.importData).toEqual({ locks: ['posterUrl'], values: { title: 'Newer' } });
	});

	test('foreign manifests, unsupported hosts and inappropriate kind/field combinations never trigger downloads', async () => {
		const f = fixture();
		expect((await f.service.step('work', 'row01', 'posterPath', '0'.repeat(64))).status).toBe('stale');
		f.row.posterPath = 'https://manual.example.org/chosen.jpg';
		expect((await f.service.step('work', 'row01', 'posterPath', f.expected())).status).toBe('unsupported');
		await expect(f.service.step('episode', 'row01', 'imageUrl', f.expected())).rejects.toThrow('INVALID_IMPORT_OPTIONS');
		expect(f.artwork.cacheOriginal).not.toHaveBeenCalled();
		expect(f.repository.update).not.toHaveBeenCalled();
	});

	test('gallery storage preserves ordering and duplicates, while a partial failure never alters its URL array', async () => {
		const gallery = [poster, 'https://image.tmdb.org/t/p/original/second.jpg', poster];
		const f = fixture('work', { galleryPaths: gallery, importData: { locks: ['galleryUrls'], values: { galleryUrls: gallery } } });
		const expected = artworkLocalizationRevision('work', 'row01', 'galleryPaths', gallery);
		f.artwork.cacheOriginal.mockResolvedValueOnce(local).mockRejectedValueOnce(new Error('fixture-private-url-token'));
		expect(await f.service.step('work', 'row01', 'galleryPaths', expected)).toMatchObject({ status: 'unavailable', images: 3 });
		expect(f.row.galleryPaths).toEqual(gallery);
		expect(f.repository.update).not.toHaveBeenCalled();
		f.artwork.cacheOriginal.mockReset().mockResolvedValue(local);
		expect((await f.service.step('work', 'row01', 'galleryPaths', expected)).status).toBe('localized');
		expect(f.row.galleryPaths).toEqual([local, local, local]);
		expect(f.row.importData).toEqual({ locks: ['galleryUrls'], values: { galleryUrls: [local, local, local] }, localArtwork: { galleryUrls: [local, local, local] } });
	});

	test('contention fails promptly without unlocking another process or altering catalogue data', async () => {
		const f = fixture();
		f.connection.query.mockResolvedValueOnce([{ locked: false }]);
		expect((await f.service.step('work', 'row01', 'posterPath', f.expected())).status).toBe('busy');
		expect(f.connection.query).toHaveBeenCalledTimes(1);
		expect(f.artwork.cacheOriginal).not.toHaveBeenCalled();
		expect(f.connection.release).toHaveBeenCalled();
	});

	test('parallel administrator steps fail busy before retaining pool slots and the gate releases after failure', async () => {
		const f = fixture();
		let rejectDownload: (error: Error) => void = () => {};
		let started: () => void = () => {};
		const downloading = new Promise<void>(resolve => { started = resolve; });
		f.artwork.cacheOriginal.mockImplementationOnce(async () => {
			started();
			return await new Promise<string>((_resolve, reject) => { rejectDownload = reject; });
		});
		const first = f.service.step('work', 'row01', 'posterPath', f.expected());
		await downloading;
		const concurrent = await f.service.step('catalog', 'other01', 'imageUrl', 'a'.repeat(64));
		expect(concurrent).toMatchObject({ status: 'busy', images: 0 });
		expect(f.connection.connect).toHaveBeenCalledOnce();
		rejectDownload(new Error('temporary storage failure'));
		expect((await first).status).toBe('unavailable');
		expect((await f.service.step('work', 'row01', 'posterPath', f.expected())).status).toBe('localized');
		expect(f.connection.connect).toHaveBeenCalledTimes(2);
	});

	test('ownership helpers change only exact owned baselines and never reinterpret arbitrary relative paths', () => {
		const metadata = { locks: ['posterUrl'], values: { posterUrl: 'https://image.tmdb.org/older.jpg' }, sources: { posterUrl: 'manual' } };
		expect(localizeArtworkOwnership('work', metadata, 'posterPath', poster, local)).toEqual({ ...metadata, localArtwork: { posterUrl: local } });
		expect(localizeArtworkOwnership('season', { posterPath: 'editorial-baseline', keep: 1 }, 'posterPath', poster, local)).toEqual({ posterPath: 'editorial-baseline', keep: 1, _zalipLocalArtwork: { posterPath: local } });
		expect(existingArtworkSource('/chosen.jpg', true)?.href).toBe('https://image.tmdb.org/t/p/original/chosen.jpg');
		for (const value of ['/chosen.jpg', '/files/chosen.jpg', '//evil.example.org/chosen.jpg']) expect(existingArtworkSource(value, false)).toBeNull();
		expect(existingArtworkSource('/files/chosen.jpg', true)).toBeNull();
	});
});
