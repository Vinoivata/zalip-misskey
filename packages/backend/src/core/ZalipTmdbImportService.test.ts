/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportProviderError, type ImportProviderConfig } from '@/core/zalip-importer/providers.js';
import { ZalipTmdbImportService } from '@/core/ZalipTmdbImportService.js';

const savedKey = process.env.ZALIP_TMDB_API_KEY;
const isolated = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('@/core/zalip-importer/providers.js', async original => ({ ...await original<typeof import('@/core/zalip-importer/providers.js')>(), createConfiguredImportTransport: () => isolated.transport }));

function service(httpRequestService: { getJson: (url: string) => Promise<unknown> }, catalog: unknown) {
	isolated.transport.mockImplementation((url: string) => httpRequestService.getJson(url));
	const settings = { getRuntime: vi.fn<() => Promise<ImportProviderConfig>>().mockImplementation(async () => ({ tmdbApiKey: process.env.ZALIP_TMDB_API_KEY })) };
	return { instance: new ZalipTmdbImportService(httpRequestService as never, catalog as never, settings as never), settings };
}

afterEach(() => {
	if (savedKey == null) {
		delete process.env.ZALIP_TMDB_API_KEY;
	} else {
		process.env.ZALIP_TMDB_API_KEY = savedKey;
	}
});

describe('ZalipTmdbImportService', () => {
	it('does not make an external request while the deployment secret is absent', async () => {
		delete process.env.ZALIP_TMDB_API_KEY;
		const httpRequestService = { getJson: vi.fn() };
		const zalipCatalogService = { createTmdbDraft: vi.fn() };
		const { instance } = service(httpRequestService, zalipCatalogService);

		await expect(instance.importDraft('movie', 11)).resolves.toEqual({ kind: 'not-configured' });
		expect(httpRequestService.getJson).not.toHaveBeenCalled();
	});

	it('normalizes a Russian movie response into a non-public Zalip draft', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = {
			getJson: vi.fn().mockResolvedValue({
				id: 11,
				title: 'Тестовый фильм',
				original_title: 'Test Movie',
				overview: 'Описание для проверки.',
				release_date: '2025-04-12',
				runtime: 118,
				genres: [{ name: 'Драма' }, { name: 'Триллер' }, { name: 'Драма' }, { name: '' }],
				poster_path: '/poster.jpg',
				backdrop_path: '/backdrop.jpg',
				images: { logos: [{ file_path: '/fallback-logo.png', iso_639_1: null }, { file_path: '/english-logo.png', iso_639_1: 'en' }, { file_path: '/russian-logo.png', iso_639_1: 'ru' }] },
				seasons: [{
					season_number: 1,
					name: 'Первый сезон',
					overview: 'Описание сезона.',
					poster_path: '/season.jpg',
					air_date: '2025-04-12',
					episode_count: 12,
				}],
				videos: {
					results: [
						{ site: 'YouTube', type: 'Trailer', iso_639_1: 'en', key: 'english001' },
						{ site: 'YouTube', type: 'Trailer', iso_639_1: 'ru', key: 'russian001' },
					],
				},
			}),
		};
		const work = { id: 'test-work', slug: 'tmdb-movie-11', title: 'Тестовый фильм' };
		const zalipCatalogService = { createTmdbDraft: vi.fn().mockResolvedValue(work) };
		const { instance } = service(httpRequestService, zalipCatalogService);

		await expect(instance.importDraft('movie', 11)).resolves.toEqual({ kind: 'created', work });
		expect(zalipCatalogService.createTmdbDraft).toHaveBeenCalledWith({
			tmdbMediaType: 'movie',
			tmdbId: 11,
			title: 'Тестовый фильм',
			originalTitle: 'Test Movie',
			description: 'Описание для проверки.',
			releaseYear: 2025,
			genres: ['Драма', 'Триллер'],
			runtimeMinutes: 118,
			posterPath: '/poster.jpg',
			backdropPath: '/backdrop.jpg',
			logoPath: '/russian-logo.png',
			galleryPaths: [],
			trailerYoutubeKey: 'russian001',
			seasons: [],
		});

		const requestUrl = new URL(httpRequestService.getJson.mock.calls[0][0]);
		expect(requestUrl.pathname).toBe('/3/movie/11');
		expect(requestUrl.searchParams.get('language')).toBe('ru-RU');
		expect(requestUrl.searchParams.get('append_to_response')).toBe('videos,images');
		expect(requestUrl.searchParams.get('include_image_language')).toBe('ru,en,null');
	});

	it('refreshes only TMDB-provided artwork for an existing title', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = {
			getJson: vi.fn().mockResolvedValue({
				id: 11,
				runtime: 0,
				genres: [{ name: 'Боевик' }, { name: 12 }],
				poster_path: '/poster.jpg',
				backdrop_path: '/hero.jpg',
				images: { backdrops: [{ file_path: '/hero.jpg' }, { file_path: '/frame.jpg' }, { file_path: '/frame.jpg' }, { file_path: 'not-a-path' }], logos: [{ file_path: '/fallback-logo.png', iso_639_1: null }, { file_path: '/english-logo.png', iso_639_1: 'en' }] },
				videos: { results: [{ site: 'YouTube', type: 'Trailer', iso_639_1: 'ru', key: 'trailer001' }] },
			}),
		};
		const zalipCatalogService = { updateTmdbMedia: vi.fn().mockResolvedValue({ id: 'test-work' }) };
		const { instance } = service(httpRequestService, zalipCatalogService);

		await expect(instance.refreshMedia({ workId: 'test-work', tmdbMediaType: 'movie', tmdbId: 11 })).resolves.toEqual({ kind: 'updated' });
		expect(zalipCatalogService.updateTmdbMedia).toHaveBeenCalledWith('test-work', {
			genres: ['Боевик'],
			runtimeMinutes: null,
			posterPath: '/poster.jpg',
			backdropPath: '/hero.jpg',
			logoPath: '/english-logo.png',
			galleryPaths: ['/hero.jpg', '/frame.jpg'],
			trailerYoutubeKey: 'trailer001',
		});

		const requestUrl = new URL(httpRequestService.getJson.mock.calls[0][0]);
		expect(requestUrl.searchParams.get('append_to_response')).toBe('videos,images');
		expect(requestUrl.searchParams.get('include_image_language')).toBe('ru,en,null');
	});

	it('maps a TMDB 404 to a safe editor-facing result', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = { getJson: vi.fn().mockRejectedValue(new ImportProviderError('not-found')) };
		const zalipCatalogService = { createTmdbDraft: vi.fn() };
		const { instance } = service(httpRequestService, zalipCatalogService);

		await expect(instance.importDraft('tv', 999)).resolves.toEqual({ kind: 'not-found' });
		expect(zalipCatalogService.createTmdbDraft).not.toHaveBeenCalled();
	});

	it('adds normalized season metadata only for TV imports', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = {
			getJson: vi.fn().mockResolvedValue({
				id: 77,
				name: 'Тестовый сериал',
				episode_run_time: [25, 45],
				genres: [{ name: 'Анимация' }],
				seasons: [{
					season_number: 0,
					name: '',
					overview: 'Спецэпизоды.',
					air_date: '2026-01-01',
					episode_count: 2,
				}],
			}),
		};
		const work = { id: 'test-tv-work' };
		const zalipCatalogService = { createTmdbDraft: vi.fn().mockResolvedValue(work) };
		const { instance } = service(httpRequestService, zalipCatalogService);

		await expect(instance.importDraft('tv', 77)).resolves.toEqual({ kind: 'created', work });
		expect(zalipCatalogService.createTmdbDraft).toHaveBeenCalledWith(expect.objectContaining({
			tmdbMediaType: 'tv',
			genres: ['Анимация'],
			runtimeMinutes: 25,
			seasons: [{
				seasonNumber: 0,
				title: 'Спецэпизоды',
				originalTitle: null,
				description: 'Спецэпизоды.',
				posterPath: null,
				airDate: '2026-01-01',
				episodeCount: 2,
			}],
		}));
	});

	it('syncs only validated episode metadata from a requested TMDB season', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = {
			getJson: vi.fn().mockResolvedValue({
				season_number: 1,
				episodes: [
					{ id: 301, episode_number: 2, name: 'Вторая серия', overview: 'Далее.', air_date: '2026-02-02', still_path: '/still.jpg', runtime: 24 },
					{ id: 300, episode_number: 1, name: '', overview: null, air_date: 'broken', runtime: 0 },
					{ id: 'unsafe', episode_number: 3, name: 'Нельзя импортировать' },
				],
			}),
		};
		const zalipCatalogService = { syncSeasonEpisodes: vi.fn().mockResolvedValue({ added: 2, updated: 0, total: 2 }) };
		const { instance } = service(httpRequestService, zalipCatalogService);
		const target = { tmdbId: 77, seasonId: 'test-season', seasonNumber: 1 };

		await expect(instance.importSeasonEpisodes(target)).resolves.toEqual({ kind: 'synced', added: 2, updated: 0, total: 2 });
		expect(zalipCatalogService.syncSeasonEpisodes).toHaveBeenCalledWith('test-season', [
			{
				tmdbEpisodeId: 300,
				episodeNumber: 1,
				title: 'Эпизод 1',
				originalTitle: null,
				description: null,
				airDate: null,
				stillPath: null,
				runtimeMinutes: null,
			},
			{
				tmdbEpisodeId: 301,
				episodeNumber: 2,
				title: 'Вторая серия',
				originalTitle: null,
				description: 'Далее.',
				airDate: '2026-02-02',
				stillPath: '/still.jpg',
				runtimeMinutes: 24,
			},
		]);

		const requestUrl = new URL(httpRequestService.getJson.mock.calls[0][0]);
		expect(requestUrl.pathname).toBe('/3/tv/77/season/1');
		expect(requestUrl.searchParams.get('language')).toBe('ru-RU');
	});

	it('takes a fresh credential and HTTPS address snapshot for every legacy operation', async () => {
		const http = { getJson: vi.fn().mockResolvedValueOnce({ id: 11, title: 'Synthetic movie' }).mockResolvedValueOnce({ id: 11 }).mockResolvedValueOnce({ season_number: 1, episodes: [] }) };
		const catalog = { createTmdbDraft: vi.fn().mockResolvedValue('duplicate'), updateTmdbMedia: vi.fn().mockResolvedValue({ id: 'work' }), syncSeasonEpisodes: vi.fn().mockResolvedValue({ added: 0, updated: 0, total: 0 }) };
		const { instance, settings } = service(http, catalog);
		for (const suffix of ['one', 'two', 'three']) settings.getRuntime.mockResolvedValueOnce({ tmdbApiKey: `synthetic-key-${suffix}`, apiOrigins: { tmdb: `https://api-${suffix}.zalip.org` } });
		await expect(instance.importDraft('movie', 11)).resolves.toEqual({ kind: 'duplicate' });
		await expect(instance.refreshMedia({ workId: 'work', tmdbMediaType: 'movie', tmdbId: 11 })).resolves.toEqual({ kind: 'updated' });
		await expect(instance.importSeasonEpisodes({ tmdbId: 11, seasonNumber: 1, seasonId: 'season' })).resolves.toMatchObject({ kind: 'synced' });
		expect(settings.getRuntime).toHaveBeenCalledTimes(3);
		for (const [index, suffix] of ['one', 'two', 'three'].entries()) {
			const url = new URL(http.getJson.mock.calls[index][0]);
			expect(url.origin).toBe(`https://api-${suffix}.zalip.org`);
			expect(url.searchParams.get('api_key')).toBe(`synthetic-key-${suffix}`);
		}
	});

	it('malformed upstream payloads cannot write metadata or throw raw exceptions', async () => {
		const http = { getJson: vi.fn().mockResolvedValue(null) };
		const catalog = { createTmdbDraft: vi.fn(), updateTmdbMedia: vi.fn(), syncSeasonEpisodes: vi.fn() };
		const { instance, settings } = service(http, catalog);
		settings.getRuntime.mockResolvedValue({ tmdbApiKey: 'synthetic-key' });
		await expect(instance.importDraft('movie', 11)).resolves.toEqual({ kind: 'upstream-failure' });
		await expect(instance.refreshMedia({ workId: 'work', tmdbMediaType: 'movie', tmdbId: 11 })).resolves.toEqual({ kind: 'upstream-failure' });
		await expect(instance.importSeasonEpisodes({ tmdbId: 11, seasonNumber: 1, seasonId: 'season' })).resolves.toEqual({ kind: 'upstream-failure' });
		for (const method of Object.values(catalog)) expect(method).not.toHaveBeenCalled();
	});
});
