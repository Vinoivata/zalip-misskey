/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusError } from '@/misc/status-error.js';
import { ZalipTmdbImportService } from '@/core/ZalipTmdbImportService.js';

const savedKey = process.env.ZALIP_TMDB_API_KEY;

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
		const service = new ZalipTmdbImportService(httpRequestService as never, zalipCatalogService as never);

		await expect(service.importDraft('movie', 11)).resolves.toEqual({ kind: 'not-configured' });
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
				poster_path: '/poster.jpg',
				backdrop_path: '/backdrop.jpg',
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
		const service = new ZalipTmdbImportService(httpRequestService as never, zalipCatalogService as never);

		await expect(service.importDraft('movie', 11)).resolves.toEqual({ kind: 'created', work });
		expect(zalipCatalogService.createTmdbDraft).toHaveBeenCalledWith({
			tmdbMediaType: 'movie',
			tmdbId: 11,
			title: 'Тестовый фильм',
			originalTitle: 'Test Movie',
			description: 'Описание для проверки.',
			releaseYear: 2025,
			posterPath: '/poster.jpg',
			backdropPath: '/backdrop.jpg',
			trailerYoutubeKey: 'russian001',
			seasons: [],
		});

		const requestUrl = new URL(httpRequestService.getJson.mock.calls[0][0]);
		expect(requestUrl.pathname).toBe('/3/movie/11');
		expect(requestUrl.searchParams.get('language')).toBe('ru-RU');
		expect(requestUrl.searchParams.get('append_to_response')).toBe('videos');
	});

	it('maps a TMDB 404 to a safe editor-facing result', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = { getJson: vi.fn().mockRejectedValue(new StatusError('not found', 404)) };
		const zalipCatalogService = { createTmdbDraft: vi.fn() };
		const service = new ZalipTmdbImportService(httpRequestService as never, zalipCatalogService as never);

		await expect(service.importDraft('tv', 999)).resolves.toEqual({ kind: 'not-found' });
		expect(zalipCatalogService.createTmdbDraft).not.toHaveBeenCalled();
	});

	it('adds normalized season metadata only for TV imports', async () => {
		process.env.ZALIP_TMDB_API_KEY = 'test-only-key';
		const httpRequestService = {
			getJson: vi.fn().mockResolvedValue({
				id: 77,
				name: 'Тестовый сериал',
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
		const service = new ZalipTmdbImportService(httpRequestService as never, zalipCatalogService as never);

		await expect(service.importDraft('tv', 77)).resolves.toEqual({ kind: 'created', work });
		expect(zalipCatalogService.createTmdbDraft).toHaveBeenCalledWith(expect.objectContaining({
			tmdbMediaType: 'tv',
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
		const service = new ZalipTmdbImportService(httpRequestService as never, zalipCatalogService as never);
		const target = { tmdbId: 77, seasonId: 'test-season', seasonNumber: 1 };

		await expect(service.importSeasonEpisodes(target)).resolves.toEqual({ kind: 'synced', added: 2, updated: 0, total: 2 });
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
});
