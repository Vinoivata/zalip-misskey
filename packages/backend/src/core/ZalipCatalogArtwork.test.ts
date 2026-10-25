/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import type { Config } from '@/config.js';
import { meta as listMeta } from '@/server/api/endpoints/zalip/works/list.js';
import { meta as pageMeta } from '@/server/api/endpoints/zalip/works/page.js';
import { meta as searchMeta } from '@/server/api/endpoints/zalip/works/search.js';
import { meta as showMeta } from '@/server/api/endpoints/zalip/works/show.js';
import { meta as libraryMeta } from '@/server/api/endpoints/zalip/library/list.js';
import { meta as continueMeta } from '@/server/api/endpoints/zalip/progress/continue.js';

const origin = 'https://social.example';
const url = (key = 'native-key') => `${origin}/files/${key}`;
const work = (id = 'work', posterPath: string | null = url(), publicationState: 'published' | 'draft' = 'published') => ({ id, publicationState, posterPath, importData: { locks: ['posterUrl'], localArtwork: { posterUrl: posterPath }, sources: { posterUrl: 'manual' } } }) as unknown as MiZalipWork;
const file = () => ({ accessKey: 'native-key', url: url(), thumbnailAccessKey: 'thumbnail-native-key', thumbnailUrl: url('thumbnail-native-key'), type: 'image/jpeg', isLink: false, storedInternal: true }) as MiDriveFile;
type Lookup = { where: { accessKey: { value: string[] }; isLink: boolean; storedInternal: boolean }; select: Record<string, boolean> };

function fixture(files: MiDriveFile[] = [file()], works: MiZalipWork[] = []) {
	const lookup = vi.fn(async (_options: Lookup) => files);
	const workRepository = { find: vi.fn(async () => works), findOneBy: vi.fn(async () => works[0] ?? null) };
	const seasons = { find: vi.fn(async () => []) };
	const getRepository = vi.fn((model: unknown) => {
		if (model === MiDriveFile) return { find: lookup };
		if (model === MiZalipWork) return workRepository;
		if (model === MiZalipSeason) return seasons;
		if (model === MiZalipExternalIdentity) return { find: vi.fn(async () => []) };
		throw new Error('Only read-only native artwork lookups are allowed');
	});
	const query = vi.fn(async () => []);
	const service = new ZalipCatalogService({ getRepository, query } as never, {} as never, {} as never, {} as never, { url: origin } as Config);
	return { service, lookup, workRepository, getRepository, query };
}

describe('Zalip existing native poster thumbnails', () => {
	it('deduplicates exact public native originals in one indexed batch without changing their provenance', async () => {
		const works = [work('one'), work('two'), work('draft', url(), 'draft'), work('remote', 'https://remote.example/poster.jpg')];
		const before = structuredClone(works);
		const f = fixture();
		expect(await f.service.nativePosterThumbnails(works)).toEqual(new Map([['one', url('thumbnail-native-key')], ['two', url('thumbnail-native-key')]]));
		expect(f.lookup).toHaveBeenCalledOnce();
		expect(f.lookup.mock.calls[0][0].where).toMatchObject({ isLink: false, storedInternal: true });
		expect(f.lookup.mock.calls[0][0].where.accessKey.value).toEqual(['native-key']);
		expect(works).toEqual(before);
		expect(f.query).not.toHaveBeenCalled();
	});

	it.each([
		null, '/files/native-key', '/tmdb-poster.jpg', 'http://social.example/files/native-key', 'https://remote.example/files/native-key',
		`${origin}/files/native-key?size=small`, `${origin}/files/native-key#`, `${origin}/files/%6eative-key`,
		`${origin}/files/../native-key`, `${origin}/files/a/native-key`, `${origin}/files/native\\key`, `${origin}/files/native-key `,
		'https://user@social.example/files/native-key', 'https://social.example:443/files/native-key',
	])('does not query or fetch noncanonical, remote or unsafe image source %s', async source => {
		const f = fixture();
		expect(await f.service.nativePosterThumbnails([work('work', source)])).toEqual(new Map());
		expect(f.getRepository).not.toHaveBeenCalled();
	});

	it.each([
		{ isLink: true }, { storedInternal: false }, { type: 'video/mp4' }, { url: url('different-key') },
		{ url: 'https://remote.example/files/native-key' }, { thumbnailUrl: 'https://remote.example/files/thumbnail-native-key' },
		{ thumbnailUrl: 'https://127.0.0.1/files/thumbnail-native-key' }, { thumbnailUrl: url('wrong-key') },
		{ thumbnailUrl: `${url('thumbnail-native-key')}?url=https://remote.example` }, { thumbnailAccessKey: 'native-key' },
		{ thumbnailAccessKey: null }, { thumbnailUrl: null },
	])('omits unsafe, nonimage, missing or nonlocal stored rendition %j', async changed => {
		const f = fixture([{ ...file(), ...changed }]);
		expect(await f.service.nativePosterThumbnails([work()])).toEqual(new Map());
		expect(f.lookup).toHaveBeenCalledOnce();
	});

	it('bounds every lookup to 100 indexed access keys instead of one query per card', async () => {
		const f = fixture([]);
		await f.service.nativePosterThumbnails(Array.from({ length: 251 }, (_, index) => work(`work${index}`, url(`key-${index}`))));
		expect(f.lookup).toHaveBeenCalledTimes(3);
		expect(f.lookup.mock.calls.map(([options]) => options.where.accessKey.value.length)).toEqual([100, 100, 51]);
	});

	it('omits the optional field for missing thumbnails and preserves the selected original in every response', async () => {
		const works = [work()];
		const f = fixture([file()], works);
		const cards = await f.service.listPublished(20);
		expect(cards[0]).toMatchObject({ posterPath: url(), posterThumbnailUrl: url('thumbnail-native-key') });
		expect(f.lookup).toHaveBeenCalledOnce();
		const detail = await f.service.showPublished('title');
		expect(detail).toMatchObject({ posterPath: url(), posterThumbnailUrl: url('thumbnail-native-key') });
		expect(f.lookup).toHaveBeenCalledTimes(2);
		const missing = fixture([], works);
		expect((await missing.service.listPublished(20))[0]).not.toHaveProperty('posterThumbnailUrl');
		expect(works[0].posterPath).toBe(url());
	});

	it('declares one backward-compatible optional field on existing public/private work response shapes', () => {
		for (const schema of [listMeta.res.items, pageMeta.res.properties.items.items, searchMeta.res.items, showMeta.res, libraryMeta.res.items.properties.work, continueMeta.res.properties.items.items.properties.work]) {
			expect(schema.properties.posterThumbnailUrl).toEqual({ type: 'string', optional: true, nullable: true });
			expect(schema.required).not.toContain('posterThumbnailUrl');
		}
	});
});
