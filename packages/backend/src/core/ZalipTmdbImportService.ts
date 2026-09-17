/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { StatusError } from '@/misc/status-error.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import type { MiZalipWork } from '@/models/ZalipWork.js';

type TmdbMediaType = 'movie' | 'tv';

type TmdbVideo = {
	key?: unknown;
	site?: unknown;
	type?: unknown;
	iso_639_1?: unknown;
};

type TmdbDetails = {
	id?: unknown;
	title?: unknown;
	name?: unknown;
	original_title?: unknown;
	original_name?: unknown;
	overview?: unknown;
	release_date?: unknown;
	first_air_date?: unknown;
	poster_path?: unknown;
	backdrop_path?: unknown;
	videos?: { results?: unknown };
};

export type TmdbImportResult =
	| { kind: 'created'; work: MiZalipWork; }
	| { kind: 'duplicate'; }
	| { kind: 'not-configured'; }
	| { kind: 'not-found'; }
	| { kind: 'upstream-failure'; };

function nullableString(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function releaseYear(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
	if (match == null) return null;
	const year = Number(match[1]);
	return year >= 1888 && year <= 3000 ? year : null;
}

function youtubeTrailer(details: TmdbDetails): string | null {
	const videos = details.videos?.results;
	if (!Array.isArray(videos)) return null;

	const candidates = videos.filter((video): video is TmdbVideo => typeof video === 'object' && video != null)
		.filter(video => video.site === 'YouTube' && typeof video.key === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(video.key))
		.sort((a, b) => {
			const score = (video: TmdbVideo) => (video.type === 'Trailer' ? 4 : video.type === 'Teaser' ? 2 : 0) + (video.iso_639_1 === 'ru' ? 1 : 0);
			return score(b) - score(a);
		});

	return candidates[0] != null && typeof candidates[0].key === 'string' ? candidates[0].key : null;
}

/**
 * Server-only import boundary. The browser submits only a TMDB media type and numeric ID;
 * its credential stays in the deployment environment and is never returned or logged.
 */
@Injectable()
export class ZalipTmdbImportService {
	constructor(
		private httpRequestService: HttpRequestService,
		private zalipCatalogService: ZalipCatalogService,
	) {
	}

	public async importDraft(tmdbMediaType: TmdbMediaType, tmdbId: number): Promise<TmdbImportResult> {
		const apiKey = process.env.ZALIP_TMDB_API_KEY?.trim();
		if (apiKey == null || apiKey === '') return { kind: 'not-configured' };

		const url = new URL(`https://api.themoviedb.org/3/${tmdbMediaType}/${tmdbId}`);
		url.searchParams.set('api_key', apiKey);
		url.searchParams.set('language', 'ru-RU');
		url.searchParams.set('append_to_response', 'videos');

		let details: TmdbDetails;
		try {
			details = await this.httpRequestService.getJson<TmdbDetails>(url.toString());
		} catch (err) {
			if (err instanceof StatusError && err.statusCode === 404) return { kind: 'not-found' };
			return { kind: 'upstream-failure' };
		}

		if (details.id !== tmdbId) return { kind: 'upstream-failure' };
		const title = nullableString(tmdbMediaType === 'movie' ? details.title : details.name, 256);
		if (title == null) return { kind: 'upstream-failure' };

		const work = await this.zalipCatalogService.createTmdbDraft({
			tmdbMediaType,
			tmdbId,
			title,
			originalTitle: nullableString(tmdbMediaType === 'movie' ? details.original_title : details.original_name, 256),
			description: nullableString(details.overview, 8192),
			releaseYear: releaseYear(tmdbMediaType === 'movie' ? details.release_date : details.first_air_date),
			posterPath: nullableString(details.poster_path, 512),
			backdropPath: nullableString(details.backdrop_path, 512),
			trailerYoutubeKey: youtubeTrailer(details),
		});

		return work === 'duplicate' ? { kind: 'duplicate' } : { kind: 'created', work };
	}
}
