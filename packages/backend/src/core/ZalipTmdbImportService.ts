/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { StatusError } from '@/misc/status-error.js';
import {
	ZalipCatalogService,
	type ZalipTmdbMediaSyncTarget,
	type ZalipTmdbSeasonSyncTarget,
} from '@/core/ZalipCatalogService.js';
import type { MiZalipWork } from '@/models/ZalipWork.js';

type TmdbMediaType = 'movie' | 'tv';

type TmdbVideo = {
	key?: unknown;
	site?: unknown;
	type?: unknown;
	iso_639_1?: unknown;
};

type TmdbImage = {
	file_path?: unknown;
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
	images?: { backdrops?: unknown };
	seasons?: unknown;
};

type TmdbSeason = {
	season_number?: unknown;
	name?: unknown;
	overview?: unknown;
	poster_path?: unknown;
	air_date?: unknown;
	episode_count?: unknown;
};

type TmdbSeasonDetails = {
	season_number?: unknown;
	episodes?: unknown;
};

type TmdbEpisode = {
	id?: unknown;
	episode_number?: unknown;
	name?: unknown;
	overview?: unknown;
	air_date?: unknown;
	still_path?: unknown;
	runtime?: unknown;
};

export type TmdbImportResult =
	| { kind: 'created'; work: MiZalipWork; }
	| { kind: 'duplicate'; }
	| { kind: 'not-configured'; }
	| { kind: 'not-found'; }
	| { kind: 'upstream-failure'; };

export type TmdbSeasonEpisodeImportResult =
	| { kind: 'synced'; added: number; updated: number; total: number; }
	| { kind: 'not-configured'; }
	| { kind: 'not-found'; }
	| { kind: 'upstream-failure'; };

export type TmdbMediaRefreshResult =
	| { kind: 'updated'; }
	| { kind: 'not-configured'; }
	| { kind: 'not-found'; }
	| { kind: 'upstream-failure'; };

function nullableString(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function tmdbImagePath(value: unknown): string | null {
	const path = nullableString(value, 512);
	return path != null && /^\/[A-Za-z0-9._-]+$/.test(path) ? path : null;
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

function tmdbGalleryPaths(details: TmdbDetails): string[] {
	const backdrops = details.images?.backdrops;
	if (!Array.isArray(backdrops)) return [];

	const paths = new Set<string>();
	for (const value of backdrops) {
		if (typeof value !== 'object' || value == null) continue;
		const path = tmdbImagePath((value as TmdbImage).file_path);
		if (path == null) continue;
		paths.add(path);
		if (paths.size >= 18) break;
	}
	return [...paths];
}

function tmdbMedia(details: TmdbDetails) {
	return {
		posterPath: tmdbImagePath(details.poster_path),
		backdropPath: tmdbImagePath(details.backdrop_path),
		galleryPaths: tmdbGalleryPaths(details),
		trailerYoutubeKey: youtubeTrailer(details),
	};
}

function tmdbSeasons(details: TmdbDetails, tmdbMediaType: TmdbMediaType) {
	if (tmdbMediaType !== 'tv' || !Array.isArray(details.seasons)) return [];

	return details.seasons
		.filter((season): season is TmdbSeason => typeof season === 'object' && season != null)
		.map(season => {
			const seasonNumber = typeof season.season_number === 'number' && Number.isInteger(season.season_number) && season.season_number >= 0
				? season.season_number
				: null;
			if (seasonNumber == null) return null;
			const episodeCount = typeof season.episode_count === 'number' && Number.isInteger(season.episode_count) && season.episode_count >= 0
				? season.episode_count
				: null;
			return {
				seasonNumber,
				title: nullableString(season.name, 256) ?? (seasonNumber === 0 ? 'Спецэпизоды' : `Сезон ${seasonNumber}`),
				originalTitle: null,
				description: nullableString(season.overview, 8192),
				posterPath: nullableString(season.poster_path, 512),
				airDate: typeof season.air_date === 'string' && releaseYear(season.air_date) != null ? season.air_date : null,
				episodeCount,
			};
		})
		.filter((season): season is NonNullable<typeof season> => season != null)
		.sort((a, b) => a.seasonNumber - b.seasonNumber);
}

function tmdbSeasonEpisodes(details: TmdbSeasonDetails) {
	if (!Array.isArray(details.episodes)) return [];

	const byEpisodeNumber = new Map<number, {
		tmdbEpisodeId: number;
		episodeNumber: number;
		title: string;
		originalTitle: null;
		description: string | null;
		airDate: string | null;
		stillPath: string | null;
		runtimeMinutes: number | null;
	}>();
	for (const value of details.episodes) {
		if (typeof value !== 'object' || value == null) continue;
		const episode = value as TmdbEpisode;
		const tmdbEpisodeId = typeof episode.id === 'number' && Number.isInteger(episode.id) && episode.id > 0 ? episode.id : null;
		const episodeNumber = typeof episode.episode_number === 'number' && Number.isInteger(episode.episode_number) && episode.episode_number >= 0
			? episode.episode_number
			: null;
		if (tmdbEpisodeId == null || episodeNumber == null || byEpisodeNumber.has(episodeNumber)) continue;

		byEpisodeNumber.set(episodeNumber, {
			tmdbEpisodeId,
			episodeNumber,
			title: nullableString(episode.name, 256) ?? `Эпизод ${episodeNumber}`,
			originalTitle: null,
			description: nullableString(episode.overview, 8192),
			airDate: typeof episode.air_date === 'string' && releaseYear(episode.air_date) != null ? episode.air_date : null,
			stillPath: nullableString(episode.still_path, 512),
			runtimeMinutes: typeof episode.runtime === 'number' && Number.isInteger(episode.runtime) && episode.runtime > 0 ? episode.runtime : null,
		});
	}

	return [...byEpisodeNumber.values()].sort((a, b) => a.episodeNumber - b.episodeNumber);
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
		url.searchParams.set('append_to_response', 'videos,images');

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
			...tmdbMedia(details),
			seasons: tmdbSeasons(details, tmdbMediaType),
		});

		return work === 'duplicate' ? { kind: 'duplicate' } : { kind: 'created', work };
	}

	/** Re-fetches only TMDB-provided visuals for an existing title; editorial text is preserved. */
	public async refreshMedia(target: ZalipTmdbMediaSyncTarget): Promise<TmdbMediaRefreshResult> {
		const apiKey = process.env.ZALIP_TMDB_API_KEY?.trim();
		if (apiKey == null || apiKey === '') return { kind: 'not-configured' };

		const url = new URL(`https://api.themoviedb.org/3/${target.tmdbMediaType}/${target.tmdbId}`);
		url.searchParams.set('api_key', apiKey);
		url.searchParams.set('language', 'ru-RU');
		url.searchParams.set('append_to_response', 'videos,images');

		let details: TmdbDetails;
		try {
			details = await this.httpRequestService.getJson<TmdbDetails>(url.toString());
		} catch (err) {
			if (err instanceof StatusError && err.statusCode === 404) return { kind: 'not-found' };
			return { kind: 'upstream-failure' };
		}

		if (details.id !== target.tmdbId) return { kind: 'upstream-failure' };
		const work = await this.zalipCatalogService.updateTmdbMedia(target.workId, tmdbMedia(details));
		return work == null ? { kind: 'upstream-failure' } : { kind: 'updated' };
	}

	/** Imports one full season only on an editor action; it has no public playback side effect. */
	public async importSeasonEpisodes(target: ZalipTmdbSeasonSyncTarget): Promise<TmdbSeasonEpisodeImportResult> {
		const apiKey = process.env.ZALIP_TMDB_API_KEY?.trim();
		if (apiKey == null || apiKey === '') return { kind: 'not-configured' };

		const url = new URL(`https://api.themoviedb.org/3/tv/${target.tmdbId}/season/${target.seasonNumber}`);
		url.searchParams.set('api_key', apiKey);
		url.searchParams.set('language', 'ru-RU');

		let details: TmdbSeasonDetails;
		try {
			details = await this.httpRequestService.getJson<TmdbSeasonDetails>(url.toString());
		} catch (err) {
			if (err instanceof StatusError && err.statusCode === 404) return { kind: 'not-found' };
			return { kind: 'upstream-failure' };
		}

		if (details.season_number !== target.seasonNumber) return { kind: 'upstream-failure' };
		const result = await this.zalipCatalogService.syncSeasonEpisodes(target.seasonId, tmdbSeasonEpisodes(details));
		return { kind: 'synced', ...result };
	}
}
