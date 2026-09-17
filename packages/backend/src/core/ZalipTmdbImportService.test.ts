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
});
