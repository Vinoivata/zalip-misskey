/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { SystemAccountService } from '@/core/SystemAccountService.js';
import { zalipDiscussionRootMarker } from '@/misc/zalip-discussion-root.js';
import { MiNote } from '@/models/Note.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import type { Config } from '@/config.js';
import type { MiLocalUser, MiUser } from '@/models/User.js';
import {
	MiZalipLibraryEntry,
	type ZalipLibraryStatus,
} from '@/models/ZalipLibraryEntry.js';
import {
	MiZalipWork,
	zalipWorkKinds,
	type ZalipPublicationState,
	type ZalipWorkKind,
} from '@/models/ZalipWork.js';
import { MiZalipNoteContext } from '@/models/ZalipNoteContext.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipEpisodeNoteContext } from '@/models/ZalipEpisodeNoteContext.js';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipAllohaSource, type ZalipAllohaTranslation } from '@/models/ZalipAllohaSource.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipSharedNote } from '@/models/ZalipSharedNote.js';
import { NotificationService } from '@/core/NotificationService.js';
import { MemorySingleCache } from '@/misc/cache.js';
import { cataloguePageScope, decodeCataloguePageCursor, encodeCataloguePageCursor, zalipCatalogueSorts, type ZalipCatalogueSort } from '@/misc/zalip-catalogue-page.js';
import { readImportState } from './zalip-importer/policy.js';

// A wide multi-select makes it possible to build genuinely narrow cinema shelves
// without turning the filter into an arbitrary UI-only limit.
export const zalipCatalogueGenreLimit = 40;

type ZalipEpisodeReleaseNotificationPayload = {
	workId: MiZalipWork['id'];
	workSlug: string;
	workTitle: string;
	seasonNumber: number;
	episodeNumber: number;
	episodeTitle: string;
};

type ZalipAllohaAvailabilityNotificationPayload = {
	workId: MiZalipWork['id'];
	workSlug: string;
	workTitle: string;
	seasonNumber: number | null;
	episodeNumber: number | null;
	translationCount: number;
};

export type PackedZalipWork = {
	id: string;
	slug: string;
	kind: ZalipWorkKind;
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	genres: string[];
	runtimeMinutes: number | null;
	posterPath: string | null;
	/** Existing native Drive rendition for small cards; the selected original remains unchanged. */
	posterThumbnailUrl?: string | null;
	backdropPath: string | null;
	logoPath: string | null;
	trailerYoutubeKey: string | null;
	/** Rounded average of public personal ratings, without identifying voters. */
	communityRating: number | null;
	ratingCount: number;
};

/** Public catalogue facets. Every provided facet narrows the result set. */
export type ZalipPublishedCatalogueFilters = {
	genres?: string[];
	kinds?: ZalipWorkKind[];
	query?: string;
	yearFrom?: number;
	yearTo?: number;
};

export type PackedZalipLibraryEntry = {
	status: ZalipLibraryStatus | null;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	isReleaseSubscribed: boolean;
	work: PackedZalipWork;
};

export type PackedZalipSeason = {
	id: string;
	seasonNumber: number;
	title: string;
	originalTitle: string | null;
	description: string | null;
	posterPath: string | null;
	airDate: string | null;
	episodeCount: number | null;
};

export type PackedZalipWorkDetail = PackedZalipWork & {
	galleryPaths: string[];
	seasons: PackedZalipSeason[];
	countries?: string[];
	externalRatings?: { source: string; value: number; votes: number | null }[];
	ageRating?: string | null;
};

export type PackedZalipEpisode = {
	id: string;
	episodeNumber: number;
	title: string;
	originalTitle: string | null;
	description: string | null;
	airDate: string | null;
	stillPath: string | null;
	runtimeMinutes: number | null;
	discussionNoteId: string | null;
};

export type ZalipTmdbSeasonSyncTarget = {
	tmdbId: number;
	seasonId: string;
	seasonNumber: number;
};

export type ZalipTmdbMediaSyncTarget = {
	workId: string;
	tmdbMediaType: 'movie' | 'tv';
	tmdbId: number;
};

/** Private provider mapping used only by the server-side Alloha sync service. */
export type ZalipAllohaSyncTarget = ZalipTmdbMediaSyncTarget;

/** Safe, authenticated playback response. Provider IDs and API credentials stay server-side. */
export type PackedZalipAllohaPlayback = {
	available: boolean;
	iframe: string | null;
	translations: ZalipAllohaTranslation[];
	lastCheckedAt: string | null;
};

export type PackedZalipReleaseEvent = {
	id: string;
	createdAt: string;
	work: PackedZalipWork;
	season: Pick<PackedZalipSeason, 'seasonNumber' | 'title'>;
	episode: Pick<PackedZalipEpisode, 'episodeNumber' | 'title'>;
};

export type PackedZalipSubscribedReleaseEvent = Omit<PackedZalipReleaseEvent, 'season' | 'episode'> & {
	source: 'catalogue' | 'playback';
	season: PackedZalipReleaseEvent['season'] | null;
	episode: PackedZalipReleaseEvent['episode'] | null;
};

export type PackedZalipAdminWork = PackedZalipWork & {
	publicationState: ZalipPublicationState;
	publishedAt: string | null;
	tmdbMediaType: 'movie' | 'tv' | null;
	tmdbId: number | null;
	seasons: PackedZalipSeason[];
};

export type PackedZalipDiscussion = {
	noteId: string;
	created: boolean;
};

@Injectable()
export class ZalipCatalogService {
	private readonly publishedGenreCache = new MemorySingleCache<string[]>(1000 * 60); // 1m

	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
		private noteCreateService: NoteCreateService,
		private notificationService: NotificationService,
		@Inject(DI.config) private config?: Config,
		private systemAccountService?: SystemAccountService,
	) {
	}

	public packWork(work: MiZalipWork, rating: Pick<PackedZalipWork, 'communityRating' | 'ratingCount'> = { communityRating: null, ratingCount: 0 }, posterThumbnailUrl?: string): PackedZalipWork {
		return {
			id: work.id,
			slug: work.slug,
			kind: work.kind,
			title: work.title,
			originalTitle: work.originalTitle,
			description: work.description,
			releaseYear: work.releaseYear,
			genres: work.genres,
			runtimeMinutes: work.runtimeMinutes,
			posterPath: work.posterPath,
			...(posterThumbnailUrl ? { posterThumbnailUrl } : {}),
			backdropPath: work.backdropPath,
			logoPath: work.logoPath,
			trailerYoutubeKey: work.trailerYoutubeKey,
			communityRating: rating.communityRating,
			ratingCount: rating.ratingCount,
		};
	}

	/** Resolve existing public, locally stored image renditions in finite indexed batches, never by fetching a URL. */
	public async nativePosterThumbnails(works: readonly MiZalipWork[]): Promise<Map<string, string>> {
		const result = new Map<string, string>();
		if (!this.config?.url) return result;
		const origin = new URL(this.config.url).origin;
		const localKey = (value: string | null | undefined): string | null => {
			if (typeof value !== 'string' || value.length > 512 || /[%\\\s?#]/u.test(value)) return null;
			try {
				const url = new URL(value);
				const key = /^\/files\/([A-Za-z0-9-]{1,200})$/u.exec(url.pathname)?.[1];
				return key && !url.username && !url.password && url.origin === origin && value === `${origin}/files/${key}` ? key : null;
			} catch { return null; }
		};
		const candidates = works.flatMap(work => {
			const key = work.publicationState === 'published' ? localKey(work.posterPath) : null;
			return key ? [{ workId: work.id, url: work.posterPath!, key }] : [];
		});
		const keys = [...new Set(candidates.map(candidate => candidate.key))];
		const thumbnails = new Map<string, string>();
		for (let start = 0; start < keys.length; start += 100) {
			const files = await this.db.getRepository(MiDriveFile).find({
				where: { accessKey: In(keys.slice(start, start + 100)), isLink: false, storedInternal: true },
				select: { accessKey: true, url: true, thumbnailAccessKey: true, thumbnailUrl: true, type: true, isLink: true, storedInternal: true },
			});
			for (const file of files) {
				if (file.isLink || !file.storedInternal || !file.type.startsWith('image/') || localKey(file.url) !== file.accessKey || !file.thumbnailAccessKey?.startsWith('thumbnail-') || localKey(file.thumbnailUrl) !== file.thumbnailAccessKey) continue;
				thumbnails.set(file.url, file.thumbnailUrl!);
			}
		}
		for (const candidate of candidates) {
			const thumbnail = thumbnails.get(candidate.url);
			if (thumbnail) result.set(candidate.workId, thumbnail);
		}
		return result;
	}

	/**
	 * Ratings are deliberately aggregated here rather than exposing individual library entries.
	 * One batch query keeps rails, catalogue and search from producing an N+1 query.
	 */
	private async getCommunityRatings(works: MiZalipWork[]): Promise<Map<string, Pick<PackedZalipWork, 'communityRating' | 'ratingCount'>>> {
		if (works.length === 0) return new Map();

		const rows = await this.db.query<Array<{
			workId: string;
			communityRating: string | number;
			ratingCount: string | number;
		}>>(
			`SELECT "workId", ROUND(AVG("personalRating")::numeric, 1)::float8 AS "communityRating", COUNT("personalRating")::int AS "ratingCount"
			 FROM "zalip_library_entry"
			 WHERE "workId" = ANY($1) AND "personalRating" IS NOT NULL
			 GROUP BY "workId"`,
			[works.map(work => work.id)],
		);
		return new Map(rows.map(row => [row.workId, {
			communityRating: Number(row.communityRating),
			ratingCount: Number(row.ratingCount),
		}]));
	}

	private async packWorksWithCommunityRatings(works: MiZalipWork[]): Promise<PackedZalipWork[]> {
		const [ratings, thumbnails] = await Promise.all([this.getCommunityRatings(works), this.nativePosterThumbnails(works)]);
		return works.map(work => this.packWork(work, ratings.get(work.id), thumbnails.get(work.id)));
	}

	public async listPublished(limit: number, filters: ZalipPublishedCatalogueFilters = {}): Promise<PackedZalipWork[]> {
		const genres = Array.from(new Set((filters.genres ?? []).map(genre => genre.trim()).filter(genre => genre.length > 0)));
		const kinds = Array.from(new Set(filters.kinds ?? []));
		const normalizedQuery = filters.query?.trim() ?? '';
		const yearFrom = filters.yearFrom;
		const yearTo = filters.yearTo;

		if (genres.length > zalipCatalogueGenreLimit || kinds.length > zalipWorkKinds.length || kinds.some(kind => !zalipWorkKinds.includes(kind))) return [];
		if (normalizedQuery.length > 100 || (yearFrom != null && yearTo != null && yearFrom > yearTo)) return [];

		let works: MiZalipWork[];
		if (genres.length === 0 && kinds.length === 0 && normalizedQuery === '' && yearFrom == null && yearTo == null) {
			works = await this.db.getRepository(MiZalipWork).find({
				where: { publicationState: 'published' },
				order: { publishedAt: 'DESC', createdAt: 'DESC' },
				take: limit,
			});
		} else {
			const query = this.db.getRepository(MiZalipWork).createQueryBuilder('work')
				.where('work.publicationState = :publicationState', { publicationState: 'published' });
			if (genres.length > 0) query.andWhere('work.genres @> CAST(:genres AS jsonb)', { genres: JSON.stringify(genres) });
			if (kinds.length > 0) query.andWhere('work.kind IN (:...kinds)', { kinds });
			if (normalizedQuery !== '') {
				const pattern = `%${normalizedQuery.replace(/[\\%_]/g, '\\$&')}%`;
				query.andWhere('(work.title ILIKE :pattern ESCAPE \'\\\' OR work.originalTitle ILIKE :pattern ESCAPE \'\\\')', { pattern });
			}
			if (yearFrom != null) query.andWhere('work.releaseYear >= :yearFrom', { yearFrom });
			if (yearTo != null) query.andWhere('work.releaseYear <= :yearTo', { yearTo });
			works = await query
				.orderBy('work.publishedAt', 'DESC')
				.addOrderBy('work.createdAt', 'DESC')
				.take(limit)
				.getMany();
		}

		return await this.packWorksWithCommunityRatings(works);
	}

	/** Keyset paging and ordering are applied to the entire filtered catalogue, not one UI slice. */
	public async pagePublished(limit: number, filters: ZalipPublishedCatalogueFilters = {}, sort: ZalipCatalogueSort = 'newest', cursor?: string): Promise<{ items: PackedZalipWork[]; total: number; nextCursor: string | null }> {
		if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !zalipCatalogueSorts.includes(sort)) throw new Error('INVALID_CATALOG_LOOKUP');
		const genres = [...new Set((filters.genres ?? []).map(genre => genre.trim()).filter(Boolean))];
		const kinds = [...new Set(filters.kinds ?? [])];
		const normalizedQuery = filters.query?.trim() ?? '';
		if (genres.length > zalipCatalogueGenreLimit || kinds.length > zalipWorkKinds.length || kinds.some(kind => !zalipWorkKinds.includes(kind)) || normalizedQuery.length > 100 || (filters.yearFrom != null && filters.yearTo != null && filters.yearFrom > filters.yearTo)) return { items: [], total: 0, nextCursor: null };
		const scope = cataloguePageScope({ genres, kinds, query: normalizedQuery, yearFrom: filters.yearFrom, yearTo: filters.yearTo });
		const anchor = cursor ? decodeCataloguePageCursor(cursor, scope, sort) : null;
		const query = this.db.getRepository(MiZalipWork).createQueryBuilder('work')
			.where('work.publicationState = :publicationState', { publicationState: 'published' });
		if (genres.length) query.andWhere('work.genres @> CAST(:genres AS jsonb)', { genres: JSON.stringify(genres) });
		if (kinds.length) query.andWhere('work.kind IN (:...kinds)', { kinds });
		if (normalizedQuery) query.andWhere('(work.title ILIKE :pattern ESCAPE \'\\\' OR work.originalTitle ILIKE :pattern ESCAPE \'\\\')', { pattern: `%${normalizedQuery.replace(/[\\%_]/g, '\\$&')}%` });
		if (filters.yearFrom != null) query.andWhere('work.releaseYear >= :yearFrom', { yearFrom: filters.yearFrom });
		if (filters.yearTo != null) query.andWhere('work.releaseYear <= :yearTo', { yearTo: filters.yearTo });
		// Count before adding the keyset boundary: total always describes all matching titles.
		const total = await query.clone().getCount();
		const direction = sort === 'newest' || sort === 'year-desc' ? 'DESC' : 'ASC';
		const comparison = direction === 'DESC' ? '<' : '>';
		const dateExpression = 'DATE_TRUNC(\'milliseconds\', COALESCE(work.publishedAt, work.createdAt))';
		const expression = sort === 'title' ? 'LOWER(work.title)' : sort.startsWith('year-') ? 'work.releaseYear' : dateExpression;
		if (anchor) {
			if (sort.startsWith('year-') && anchor.value === null) {
				query.andWhere(`(work.releaseYear IS NULL AND work.id ${comparison} :cursorId)`, { cursorId: anchor.id });
			} else {
				const value = sort === 'title' ? 'LOWER(CAST(:cursorValue AS text))' : sort.startsWith('year-') ? ':cursorValue' : 'CAST(:cursorValue AS timestamptz)';
				query.andWhere(`((${expression} ${comparison} ${value}) OR (${expression} = ${value} AND work.id ${comparison} :cursorId)${sort.startsWith('year-') ? ' OR work.releaseYear IS NULL' : ''})`, { cursorValue: anchor.value, cursorId: anchor.id });
			}
		}
		const found = await query.orderBy(expression, direction, 'NULLS LAST').addOrderBy('work.id', direction).take(limit + 1).getMany();
		const works = found.slice(0, limit);
		const last = works.at(-1);
		const value = last ? sort === 'title' ? last.title : sort.startsWith('year-') ? last.releaseYear : (last.publishedAt ?? last.createdAt).toISOString() : null;
		return {
			items: await this.packWorksWithCommunityRatings(works), total,
			nextCursor: found.length > limit && last ? encodeCataloguePageCursor(scope, sort, { id: last.id, value }) : null,
		};
	}

	/** All normalized genre facets used by published catalogue titles, independent of paging. */
	public async listPublishedGenres(): Promise<string[]> {
		return await this.publishedGenreCache.fetch(async () => {
			const rows = await this.db.query<Array<{ genre: string }>>(
				'SELECT DISTINCT jsonb_array_elements_text("genres") AS "genre" FROM "zalip_work" WHERE "publicationState" = $1',
				['published'],
			);
			return rows.map(row => row.genre).sort((left, right) => left.localeCompare(right, 'ru'));
		});
	}

	/** Bounded literal title search over published works. Wildcards are escaped rather than exposed. */
	public async searchPublished(query: string, limit: number, kind?: ZalipWorkKind): Promise<PackedZalipWork[]> {
		const normalized = query.trim();
		if (normalized.length < 2) return [];
		if (kind != null && !zalipWorkKinds.includes(kind)) return [];
		const pattern = `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
		const queryBuilder = this.db.getRepository(MiZalipWork).createQueryBuilder('work')
			.where('work.publicationState = :publicationState', { publicationState: 'published' })
			.andWhere('(work.title ILIKE :pattern ESCAPE \'\\\' OR work.originalTitle ILIKE :pattern ESCAPE \'\\\')', { pattern });
		if (kind != null) queryBuilder.andWhere('work.kind = :kind', { kind });
		const works = await queryBuilder
			.orderBy('work.publishedAt', 'DESC')
			.addOrderBy('work.createdAt', 'DESC')
			.take(limit)
			.getMany();
		return await this.packWorksWithCommunityRatings(works);
	}

	public async showPublished(slug: string): Promise<PackedZalipWorkDetail | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			slug,
			publicationState: 'published',
		});

		if (work == null) return null;

		const seasons = await this.db.getRepository(MiZalipSeason).find({
			where: { workId: work.id },
			order: { seasonNumber: 'ASC' },
		});
		return {
			...(await this.packWorksWithCommunityRatings([work]))[0]!,
			galleryPaths: work.galleryPaths,
			countries: readImportState(work.importData).countries,
			externalRatings: readImportState(work.importData).ratings,
			ageRating: readImportState(work.importData).ageRating,
			seasons: seasons.map(season => this.packSeason(season)),
		};
	}

	/** Lists only editor-approved episode metadata belonging to a published canonical work. */
	public async listPublishedSeasonEpisodes(
		slug: string,
		seasonNumber: number,
	): Promise<PackedZalipEpisode[] | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			slug,
			publicationState: 'published',
		});
		if (work == null) return null;

		const season = await this.db.getRepository(MiZalipSeason).findOneBy({
			workId: work.id,
			seasonNumber,
		});
		if (season == null) return null;

		const episodes = await this.db.getRepository(MiZalipEpisode).find({
			where: { seasonId: season.id },
			order: { episodeNumber: 'ASC' },
		});
		const contexts = episodes.length === 0 ? [] : await this.db.getRepository(MiZalipEpisodeNoteContext).find({
			where: { episodeId: In(episodes.map(episode => episode.id)) },
		});
		const discussionByEpisodeId = new Map(contexts.map(context => [context.episodeId, context.noteId]));
		return episodes.map(episode => this.packEpisode(episode, discussionByEpisodeId.get(episode.id) ?? null));
	}

	/** Recent episode arrivals, limited to works that are publicly available in the catalogue. */
	public async listPublishedReleaseEvents(limit: number): Promise<PackedZalipReleaseEvent[]> {
		const events = await this.db.getRepository(MiZalipReleaseEvent).createQueryBuilder('event')
			.innerJoinAndSelect('event.work', 'work')
			.innerJoinAndSelect('event.season', 'season')
			.innerJoinAndSelect('event.episode', 'episode')
			.where('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('event.createdAt', 'DESC')
			.take(limit)
			.getMany();

		return await this.packReleaseEvents(events);
	}

	/** Signed-in updates page: only events from titles the current Misskey user follows. */
	public async listSubscribedReleaseEvents(me: MiLocalUser, limit: number): Promise<PackedZalipSubscribedReleaseEvent[]> {
		const events = await this.db.getRepository(MiZalipReleaseEvent).createQueryBuilder('event')
			.innerJoinAndSelect('event.work', 'work')
			.innerJoinAndSelect('event.season', 'season')
			.innerJoinAndSelect('event.episode', 'episode')
			.innerJoin(MiZalipLibraryEntry, 'library', 'library.workId = work.id')
			.where('library.userId = :userId', { userId: me.id })
			.andWhere('library.isReleaseSubscribed = true')
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('event.createdAt', 'DESC')
			.take(limit)
			.getMany();
		const availability = await this.db.getRepository(MiZalipAllohaAvailabilityEvent).createQueryBuilder('event')
			.innerJoinAndSelect('event.work', 'work')
			.innerJoin(MiZalipLibraryEntry, 'library', 'library.workId = work.id')
			.where('library.userId = :userId', { userId: me.id })
			.andWhere('library.isReleaseSubscribed = true')
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('event.createdAt', 'DESC')
			.take(limit)
			.getMany();
		const availabilityWorks = availability.flatMap(event => event.work ? [event.work] : []);
		const [ratings, thumbnails] = await Promise.all([this.getCommunityRatings(availabilityWorks), this.nativePosterThumbnails(availabilityWorks)]);
		const combined: PackedZalipSubscribedReleaseEvent[] = [
			...(await this.packReleaseEvents(events)).map(event => ({ ...event, source: 'catalogue' as const })),
			...availability.flatMap(event => event.work == null ? [] : [{
				id: event.id,
				createdAt: event.createdAt.toISOString(),
				work: this.packWork(event.work, ratings.get(event.work.id), thumbnails.get(event.work.id)),
				source: 'playback' as const,
				season: event.seasonNumber == null ? null : { seasonNumber: event.seasonNumber, title: '' },
				episode: event.episodeNumber == null ? null : { episodeNumber: event.episodeNumber, title: '' },
			}]),
		];
		return combined.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
	}

	private async packReleaseEvents(events: MiZalipReleaseEvent[]): Promise<PackedZalipReleaseEvent[]> {
		const works = events.flatMap(event => event.work == null ? [] : [event.work]);
		const [ratings, thumbnails] = await Promise.all([this.getCommunityRatings(works), this.nativePosterThumbnails(works)]);
		return events.flatMap(event => {
			if (event.work == null || event.season == null || event.episode == null) return [];
			return [{
				id: event.id,
				createdAt: event.createdAt.toISOString(),
				work: this.packWork(event.work, ratings.get(event.work.id), thumbnails.get(event.work.id)),
				season: { seasonNumber: event.season.seasonNumber, title: event.season.title },
				episode: { episodeNumber: event.episode.episodeNumber, title: event.episode.title },
			}];
		});
	}

	public async listLibrary(me: MiLocalUser): Promise<PackedZalipLibraryEntry[]> {
		const entries = await this.db.getRepository(MiZalipLibraryEntry).createQueryBuilder('entry')
			.innerJoinAndSelect('entry.work', 'work')
			.where('entry.userId = :userId', { userId: me.id })
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('entry.updatedAt', 'DESC')
			.getMany();

		const works = entries.flatMap(entry => entry.work == null ? [] : [entry.work]);
		const [ratings, thumbnails] = await Promise.all([this.getCommunityRatings(works), this.nativePosterThumbnails(works)]);
		return entries.map(entry => ({
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			isReleaseSubscribed: entry.isReleaseSubscribed,
			work: this.packWork(entry.work!, ratings.get(entry.work!.id), thumbnails.get(entry.work!.id)),
		}));
	}

	public async updateLibrary(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		input: {
			status: ZalipLibraryStatus | null;
			episodesWatched?: number;
			personalRating?: number | null;
			isFavorite?: boolean;
			isReleaseSubscribed?: boolean;
		},
	): Promise<PackedZalipLibraryEntry | null> {
		const updated = await this.db.transaction(async manager => {
			const work = await manager.getRepository(MiZalipWork).findOne({
				where: { id: workId, publicationState: 'published' },
				lock: { mode: 'pessimistic_read' },
			});
			if (work == null) return null;
			// Reviews use this same lock when changing a personal rating. Re-read after acquiring it,
			// never save an old list/progress snapshot over a concurrent review rating (or vice versa).
			await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-library:${me.id}:${work.id}`]);
			const repository = manager.getRepository(MiZalipLibraryEntry);
			const existing = await repository.findOneBy({ userId: me.id, workId: work.id });
			const now = new Date();
			const entry = existing ?? repository.create({
				userId: me.id,
				workId: work.id,
				createdAt: now,
			});

			entry.status = input.status;
			entry.episodesWatched = input.episodesWatched ?? existing?.episodesWatched ?? 0;
			entry.personalRating = input.personalRating === undefined ? (existing?.personalRating ?? null) : input.personalRating;
			entry.isFavorite = input.isFavorite ?? existing?.isFavorite ?? false;
			entry.isReleaseSubscribed = input.isReleaseSubscribed ?? existing?.isReleaseSubscribed ?? false;
			entry.updatedAt = now;
			await repository.save(entry);
			return { entry, work };
		});
		if (updated == null) return null;
		const { entry, work } = updated;

		const [packedWork] = await this.packWorksWithCommunityRatings([work]);
		return {
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			isReleaseSubscribed: entry.isReleaseSubscribed,
			work: packedWork!,
		};
	}

	public async createManualDraft(input: {
		slug: string;
		kind: ZalipWorkKind;
		title: string;
		originalTitle?: string | null;
		description?: string | null;
		releaseYear?: number | null;
	}): Promise<MiZalipWork | 'duplicate'> {
		const repository = this.db.getRepository(MiZalipWork);
		const conflict = await repository.existsBy({ slug: input.slug });
		if (conflict) return 'duplicate';

		const now = new Date();
		return await repository.save(repository.create({
			id: this.idService.gen(),
			createdAt: now,
			updatedAt: now,
			publishedAt: null,
			slug: input.slug,
			kind: input.kind,
			publicationState: 'draft',
			title: input.title,
			originalTitle: input.originalTitle ?? null,
			description: input.description ?? null,
			releaseYear: input.releaseYear ?? null,
			genres: [],
			runtimeMinutes: null,
			tmdbMediaType: null,
			tmdbId: null,
			posterPath: null,
			backdropPath: null,
			logoPath: null,
			galleryPaths: [],
			trailerYoutubeKey: null,
		}));
	}

	public async createTmdbDraft(input: {
		tmdbMediaType: 'movie' | 'tv';
		tmdbId: number;
		title: string;
		originalTitle: string | null;
		description: string | null;
		releaseYear: number | null;
		genres: string[];
		runtimeMinutes: number | null;
		posterPath: string | null;
		backdropPath: string | null;
		logoPath: string | null;
		galleryPaths: string[];
		trailerYoutubeKey: string | null;
		seasons: Array<{
			seasonNumber: number;
			title: string;
			originalTitle: string | null;
			description: string | null;
			posterPath: string | null;
			airDate: string | null;
			episodeCount: number | null;
		}>;
	}): Promise<MiZalipWork | 'duplicate'> {
		return await this.db.transaction(async manager => {
			const works = manager.getRepository(MiZalipWork);
			const slug = `tmdb-${input.tmdbMediaType}-${input.tmdbId}`;
			const hasTmdbMapping = await works.existsBy({
				tmdbMediaType: input.tmdbMediaType,
				tmdbId: input.tmdbId,
			});
			const hasSlug = await works.existsBy({ slug });
			if (hasTmdbMapping || hasSlug) return 'duplicate';

			const now = new Date();
			const work = await works.save(works.create({
				id: this.idService.gen(),
				createdAt: now,
				updatedAt: now,
				publishedAt: null,
				slug,
				kind: input.tmdbMediaType === 'movie' ? 'movie' : 'series',
				publicationState: 'draft',
				title: input.title,
				originalTitle: input.originalTitle,
				description: input.description,
				releaseYear: input.releaseYear,
				genres: input.genres,
				runtimeMinutes: input.runtimeMinutes,
				tmdbMediaType: input.tmdbMediaType,
				tmdbId: input.tmdbId,
				posterPath: input.posterPath,
				backdropPath: input.backdropPath,
				logoPath: input.logoPath,
				galleryPaths: input.galleryPaths,
				trailerYoutubeKey: input.trailerYoutubeKey,
			}));

			if (input.seasons.length > 0) {
				const seasons = manager.getRepository(MiZalipSeason);
				await seasons.save(input.seasons.map(season => seasons.create({
					id: this.idService.gen(),
					workId: work.id,
					seasonNumber: season.seasonNumber,
					title: season.title,
					originalTitle: season.originalTitle,
					description: season.description,
					posterPath: season.posterPath,
					airDate: season.airDate,
					episodeCount: season.episodeCount,
					createdAt: now,
					updatedAt: now,
				})));
			}

			return work;
		});
	}

	public packSeason(season: MiZalipSeason): PackedZalipSeason {
		return {
			id: season.id,
			seasonNumber: season.seasonNumber,
			title: season.title,
			originalTitle: season.originalTitle,
			description: season.description,
			posterPath: season.posterPath,
			airDate: season.airDate,
			episodeCount: season.episodeCount,
		};
	}

	public packEpisode(episode: MiZalipEpisode, discussionNoteId: string | null = null): PackedZalipEpisode {
		return {
			id: episode.id,
			episodeNumber: episode.episodeNumber,
			title: episode.title,
			originalTitle: episode.originalTitle,
			description: episode.description,
			airDate: episode.airDate,
			stillPath: episode.stillPath,
			runtimeMinutes: episode.runtimeMinutes,
			discussionNoteId,
		};
	}

	/** Resolves a private editor sync target without exposing TMDB mappings in public APIs. */
	public async getTmdbSeasonSyncTarget(
		workId: MiZalipWork['id'],
		seasonNumber: number,
	): Promise<ZalipTmdbSeasonSyncTarget | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			tmdbMediaType: 'tv',
		});
		if (work?.tmdbId == null) return null;

		const season = await this.db.getRepository(MiZalipSeason).findOneBy({ workId, seasonNumber });
		if (season == null) return null;

		return {
			tmdbId: work.tmdbId,
			seasonId: season.id,
			seasonNumber: season.seasonNumber,
		};
	}

	/** Source mapping for an editor-triggered artwork refresh. It is never exposed publicly. */
	public async getTmdbMediaSyncTarget(workId: MiZalipWork['id']): Promise<ZalipTmdbMediaSyncTarget | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({ id: workId });
		if (work?.tmdbMediaType == null || work.tmdbId == null) return null;

		return {
			workId: work.id,
			tmdbMediaType: work.tmdbMediaType,
			tmdbId: work.tmdbId,
		};
	}

	/** Bounded admin-only source list for an explicit bulk refresh; it is never returned by public catalogue APIs. */
	public async listTmdbMediaSyncTargets(limit: number): Promise<ZalipTmdbMediaSyncTarget[]> {
		const works = await this.db.getRepository(MiZalipWork).find({
			where: {
				tmdbMediaType: Not(IsNull()),
				tmdbId: Not(IsNull()),
			},
			order: { updatedAt: 'ASC' },
			take: limit,
		});
		return works.flatMap(work => work.tmdbMediaType != null && work.tmdbId != null ? [{
			workId: work.id,
			tmdbMediaType: work.tmdbMediaType,
			tmdbId: work.tmdbId,
		}] : []);
	}

	/** Bounded provider source list. TMDB IDs are intentionally kept at this server-only boundary. */
	public async listAllohaSyncTargets(limit: number): Promise<ZalipAllohaSyncTarget[]> {
		// Rotate by provider check time, not metadata update time, so catalogues over 100
		// titles do not keep polling the same first page forever.
		const works = await this.db.getRepository(MiZalipWork).createQueryBuilder('work')
			.leftJoin(MiZalipAllohaSource, 'source', 'source.workId = work.id')
			.addSelect('source.lastCheckedAt')
			.where('work.tmdbMediaType IS NOT NULL')
			.andWhere('work.tmdbId IS NOT NULL')
			.orderBy('source.lastCheckedAt', 'ASC', 'NULLS FIRST')
			.addOrderBy('work.id', 'ASC')
			.take(Math.max(1, Math.min(limit, 100)))
			.getMany();
		return works.map(work => ({ workId: work.id, tmdbMediaType: work.tmdbMediaType!, tmdbId: work.tmdbId! }));
	}

	/** Records a validated Alloha response without exposing the source mapping on catalogue endpoints. */
	public async upsertAllohaSource(input: {
		workId: MiZalipWork['id'];
		category: string;
		isAvailable: boolean;
		iframe: string | null;
		translations: ZalipAllohaTranslation[];
		recordMovieAvailability?: boolean;
	}): Promise<{ created: boolean; movieEventCreated: boolean }> {
		return await this.db.transaction(async manager => {
			// Serialize first-time mappings as well as refreshes, and atomically commit the
			// availability transition with its outbox row. A retry cannot lose a premiere.
			await manager.getRepository(MiZalipWork).findOneOrFail({ where: { id: input.workId }, lock: { mode: 'pessimistic_write' } });
			const repository = manager.getRepository(MiZalipAllohaSource);
			const existing = await repository.findOneBy({ workId: input.workId });
			const now = new Date();
			let movieEventCreated = false;
			if (input.recordMovieAvailability && input.isAvailable) {
				const events = manager.getRepository(MiZalipAllohaAvailabilityEvent);
				if (!await events.existsBy({ workId: input.workId, availabilityKey: 'movie' })) {
					await events.save(events.create({
						id: this.idService.gen(), workId: input.workId, availabilityKey: 'movie',
						seasonNumber: null, episodeNumber: null, translationCount: input.translations.length,
						createdAt: now, notificationDeliveredAt: existing == null || existing.isAvailable ? now : null,
					}));
					movieEventCreated = true;
				}
			}
			await repository.save(repository.create({
				id: existing?.id ?? this.idService.gen(),
				workId: input.workId,
				category: input.category,
				isAvailable: input.isAvailable,
				iframe: input.iframe,
				translations: input.translations,
				lastCheckedAt: now,
				createdAt: existing?.createdAt ?? now,
				updatedAt: now,
			}));
			return { created: existing == null, movieEventCreated };
		});
	}

	/** Player data is only available for a published work after a normal Zalip login. */
	public async getAllohaPlayback(slug: string): Promise<PackedZalipAllohaPlayback | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			slug,
			publicationState: 'published',
		});
		if (work == null) return null;

		const source = await this.db.getRepository(MiZalipAllohaSource).findOneBy({ workId: work.id });
		if (source == null) {
			return {
				available: false,
				iframe: null,
				translations: [],
				lastCheckedAt: null,
			};
		}

		return {
			available: source.isAvailable && (source.iframe != null || source.translations.length > 0),
			iframe: source.iframe,
			translations: source.translations,
			lastCheckedAt: source.lastCheckedAt.toISOString(),
		};
	}

	/** Creates at most one availability event per provider film or episode. */
	public async recordAllohaAvailability(input: {
		workId: MiZalipWork['id'];
		seasonNumber: number | null;
		episodeNumber: number | null;
		translationCount: number;
		suppressNotification: boolean;
	}): Promise<boolean> {
		const availabilityKey = input.seasonNumber != null && input.episodeNumber != null
			? `s${input.seasonNumber}e${input.episodeNumber}`
			: 'movie';
		const repository = this.db.getRepository(MiZalipAllohaAvailabilityEvent);
		if (await repository.existsBy({ workId: input.workId, availabilityKey })) return false;

		const now = new Date();
		try {
			await repository.save(repository.create({
				id: this.idService.gen(),
				workId: input.workId,
				availabilityKey,
				seasonNumber: input.seasonNumber,
				episodeNumber: input.episodeNumber,
				translationCount: input.translationCount,
				createdAt: now,
				notificationDeliveredAt: input.suppressNotification ? now : null,
			}));
			return true;
		} catch (err) {
			// Another process may have inserted the same unique availability event after existsBy.
			if (await repository.existsBy({ workId: input.workId, availabilityKey })) return false;
			throw err;
		}
	}

	/** Delivers the persistent Alloha availability outbox to the existing Zalip subscription list. */
	public async dispatchPendingAllohaAvailabilityNotifications(): Promise<void> {
		const events = await this.db.getRepository(MiZalipAllohaAvailabilityEvent).createQueryBuilder('event')
			.innerJoinAndSelect('event.work', 'work')
			.where('event.notificationDeliveredAt IS NULL')
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('event.createdAt', 'ASC')
			.take(100)
			.getMany();

		for (const event of events) {
			const dispatched = await this.db.transaction(async manager => {
				// Do not fill the connection pool with lock waiters while the winner packs users.
				const [globalClaim] = await manager.query<Array<{ locked: boolean }>>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', ['zalip-notification-dispatch']);
				if (!globalClaim?.locked) return false;
				const [claim] = await manager.query<Array<{ locked: boolean }>>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`zalip-notification:availability:${event.id}`]);
				if (!claim?.locked) return false;
				const repository = manager.getRepository(MiZalipAllohaAvailabilityEvent);
				const pending = await repository.findOne({ where: { id: event.id, notificationDeliveredAt: IsNull() }, relations: { work: true } });
				if (pending?.work?.publicationState !== 'published') return true;
				const entries = await manager.getRepository(MiZalipLibraryEntry).find({ select: { userId: true }, where: { workId: pending.work.id, isReleaseSubscribed: true } });
				for (const entry of entries) await this.notificationService.createNotificationOnceAndWait(
					`zalip:availability:${pending.id}`, entry.userId, 'zalipAllohaAvailable', {
						workId: pending.work.id, workSlug: pending.work.slug, workTitle: pending.work.title,
						seasonNumber: pending.seasonNumber, episodeNumber: pending.episodeNumber,
						translationCount: pending.translationCount,
					} satisfies ZalipAllohaAvailabilityNotificationPayload,
				);
				await repository.update(pending.id, { notificationDeliveredAt: new Date() });
				return true;
			});
			if (!dispatched) break; // A concurrent dispatcher owns this batch; retry next tick.
		}
	}

	/** Refreshes provider-owned facts and visual media, leaving editor-written metadata untouched. */
	public async updateTmdbMedia(
		workId: MiZalipWork['id'],
		input: {
			genres: string[];
			runtimeMinutes: number | null;
			posterPath: string | null;
			backdropPath: string | null;
			logoPath: string | null;
			galleryPaths: string[];
			trailerYoutubeKey: string | null;
		},
	): Promise<MiZalipWork | null> {
		const result = await this.db.transaction(async manager => {
			const repository = manager.getRepository(MiZalipWork);
			// The importer uses the same work lock: never save a pre-import snapshot over its commit.
			const work = await repository.findOne({ where: { id: workId }, lock: { mode: 'pessimistic_write' } });
			if (work == null) return { work: null, updated: false };
			// Imported titles are refreshed through the provenance-aware importer, not the legacy cron.
			if ((work.importData?.values && Object.keys(work.importData.values).length > 0) || (work.importData?.localArtwork && typeof work.importData.localArtwork === 'object' && Object.keys(work.importData.localArtwork).length > 0)) return { work, updated: false };
			work.posterPath = input.posterPath;
			work.backdropPath = input.backdropPath;
			work.logoPath = input.logoPath;
			work.genres = input.genres;
			work.runtimeMinutes = input.runtimeMinutes;
			work.galleryPaths = input.galleryPaths;
			work.trailerYoutubeKey = input.trailerYoutubeKey;
			work.updatedAt = new Date();
			return { work: await repository.save(work), updated: true };
		});
		if (result.updated && result.work?.publicationState === 'published') this.publishedGenreCache.delete();
		return result.work;
	}

	/**
	 * Upserts a full TMDB season response. It intentionally never deletes rows: manual
	 * editorial fixes survive a partial or temporarily inconsistent upstream response.
	 */
	public async syncSeasonEpisodes(
		seasonId: MiZalipSeason['id'],
		episodes: Array<{
			tmdbEpisodeId: number;
			episodeNumber: number;
			title: string;
			originalTitle: string | null;
			description: string | null;
			airDate: string | null;
			stillPath: string | null;
			runtimeMinutes: number | null;
		}>,
	): Promise<{ added: number; updated: number; total: number }> {
		const result = await this.db.transaction(async manager => {
			const seasons = manager.getRepository(MiZalipSeason);
			const season = await seasons.findOneBy({ id: seasonId });
			if (season == null) return { added: 0, updated: 0, total: 0 };
			const work = await manager.getRepository(MiZalipWork).findOne({ where: { id: season.workId }, lock: { mode: 'pessimistic_write' } });
			if ((work?.importData?.values && Object.keys(work.importData.values).length > 0) || (work?.importData?.localArtwork && typeof work.importData.localArtwork === 'object' && Object.keys(work.importData.localArtwork).length > 0)) {
				return { added: 0, updated: 0, total: await manager.getRepository(MiZalipEpisode).countBy({ seasonId }) };
			}
			const previousEpisodeCount = season.episodeCount;

			const repository = manager.getRepository(MiZalipEpisode);
			const existing = await repository.findBy({ seasonId });
			const byEpisodeNumber = new Map(existing.map(episode => [episode.episodeNumber, episode]));
			const now = new Date();
			let added = 0;
			let updated = 0;
			const addedEpisodes: MiZalipEpisode[] = [];
			const saved = episodes.map(input => {
				const episode = byEpisodeNumber.get(input.episodeNumber);
				if (episode == null) {
					added++;
					const created = repository.create({
						id: this.idService.gen(),
						seasonId,
						...input,
						createdAt: now,
						updatedAt: now,
					});
					addedEpisodes.push(created);
					return created;
				}

				updated++;
				episode.tmdbEpisodeId = input.tmdbEpisodeId;
				episode.title = input.title;
				episode.originalTitle = input.originalTitle;
				episode.description = input.description;
				episode.airDate = input.airDate;
				const localArtwork = episode.importValues?._zalipLocalArtwork;
				if (!localArtwork || typeof localArtwork !== 'object' || Array.isArray(localArtwork) || (localArtwork as Record<string, unknown>).stillPath !== episode.stillPath) episode.stillPath = input.stillPath;
				episode.runtimeMinutes = input.runtimeMinutes;
				episode.updatedAt = now;
				return episode;
			});
			if (saved.length > 0) await repository.save(saved);

			season.episodeCount = episodes.length;
			season.updatedAt = now;
			await seasons.save(season);

			// The initial sync establishes a baseline. Only later additions to an already published
			// work become public "new episode" events, preventing a historical season from flooding
			// the release feed when it is first imported.
			if (work?.publicationState === 'published' && previousEpisodeCount != null && addedEpisodes.length > 0) {
				const releasedEpisodes = addedEpisodes.filter(episode => episode.episodeNumber > previousEpisodeCount);
				const events = manager.getRepository(MiZalipReleaseEvent);
				await events.save(releasedEpisodes
					.map(episode => events.create({
						id: this.idService.gen(),
						workId: season.workId,
						seasonId: season.id,
						episodeId: episode.id,
						createdAt: now,
					})));
			}
			return { added, updated, total: episodes.length };
		});

		await this.dispatchPendingReleaseNotifications();
		return result;
	}

	/**
	 * Persistent event outbox with per-event PostgreSQL serialization and per-recipient native
	 * Redis receipts. A lost database acknowledgement never inserts a second native notice.
	 */
	public async dispatchPendingReleaseNotifications(): Promise<void> {
		const events = await this.db.getRepository(MiZalipReleaseEvent).createQueryBuilder('event')
			.innerJoinAndSelect('event.work', 'work')
			.innerJoinAndSelect('event.season', 'season')
			.innerJoinAndSelect('event.episode', 'episode')
			.where('event.notificationDeliveredAt IS NULL')
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('event.createdAt', 'ASC')
			.take(100)
			.getMany();

		for (const event of events) {
			const dispatched = await this.db.transaction(async manager => {
				const [globalClaim] = await manager.query<Array<{ locked: boolean }>>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', ['zalip-notification-dispatch']);
				if (!globalClaim?.locked) return false;
				const [claim] = await manager.query<Array<{ locked: boolean }>>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`zalip-notification:release:${event.id}`]);
				if (!claim?.locked) return false;
				const repository = manager.getRepository(MiZalipReleaseEvent);
				const pending = await repository.findOne({ where: { id: event.id, notificationDeliveredAt: IsNull() }, relations: { work: true, season: true, episode: true } });
				if (pending?.work?.publicationState !== 'published' || !pending.season || !pending.episode) return true;
				const entries = await manager.getRepository(MiZalipLibraryEntry).find({ select: { userId: true }, where: { workId: pending.work.id, isReleaseSubscribed: true } });
				const notification: ZalipEpisodeReleaseNotificationPayload = {
					workId: pending.work.id, workSlug: pending.work.slug, workTitle: pending.work.title,
					seasonNumber: pending.season.seasonNumber, episodeNumber: pending.episode.episodeNumber,
					episodeTitle: pending.episode.title,
				};
				for (const entry of entries) await this.notificationService.createNotificationOnceAndWait(
					`zalip:release:${pending.id}`, entry.userId, 'zalipEpisodeReleased', notification,
				);
				await repository.update(pending.id, { notificationDeliveredAt: new Date() });
				return true;
			});
			if (!dispatched) break;
		}
	}

	public packAdminWork(work: MiZalipWork, seasons: MiZalipSeason[] = [], rating?: Pick<PackedZalipWork, 'communityRating' | 'ratingCount'>): PackedZalipAdminWork {
		return {
			...this.packWork(work, rating),
			publicationState: work.publicationState,
			publishedAt: work.publishedAt?.toISOString() ?? null,
			tmdbMediaType: work.tmdbMediaType,
			tmdbId: work.tmdbId,
			seasons: seasons.map(season => this.packSeason(season)),
		};
	}

	public async listAdminWorks(limit: number): Promise<PackedZalipAdminWork[]> {
		const works = await this.db.getRepository(MiZalipWork).find({
			order: { updatedAt: 'DESC' },
			take: limit,
		});
		const seasons = works.length === 0 ? [] : await this.db.getRepository(MiZalipSeason).find({
			where: { workId: In(works.map(work => work.id)) },
			order: { seasonNumber: 'ASC' },
		});
		const seasonsByWorkId = new Map<string, MiZalipSeason[]>();
		for (const season of seasons) {
			const collection = seasonsByWorkId.get(season.workId) ?? [];
			collection.push(season);
			seasonsByWorkId.set(season.workId, collection);
		}

		const ratings = await this.getCommunityRatings(works);
		return works.map(work => this.packAdminWork(work, seasonsByWorkId.get(work.id), ratings.get(work.id)));
	}

	public async setPublicationState(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		publicationState: ZalipPublicationState,
	): Promise<PackedZalipAdminWork | null> {
		const repository = this.db.getRepository(MiZalipWork);
		const work = await repository.findOneBy({ id: workId });
		if (work == null) return null;

		const now = new Date();
		work.publicationState = publicationState;
		work.updatedAt = now;
		if (publicationState === 'published' && work.publishedAt == null) {
			work.publishedAt = now;
		}
		await repository.save(work);
		this.publishedGenreCache.delete();

		// Every published title owns one native Misskey discussion branch. "home"
		// visibility lets the title page show it without turning it into a feed post.
		if (publicationState === 'published') {
			await this.createDiscussion(me, work.id, null);
		}

		const ratings = await this.getCommunityRatings([work]);
		return this.packAdminWork(work, [], ratings.get(work.id));
	}

	/** Updates editor-owned descriptive metadata only; source mappings and publication state stay separate. */
	public async updateAdminWork(
		workId: MiZalipWork['id'],
		input: {
			title: string;
			originalTitle: string | null;
			description: string | null;
			releaseYear: number | null;
		},
	): Promise<PackedZalipAdminWork | null> {
		const repository = this.db.getRepository(MiZalipWork);
		const work = await repository.findOneBy({ id: workId });
		if (work == null) return null;

		work.title = input.title;
		work.originalTitle = input.originalTitle;
		work.description = input.description;
		work.releaseYear = input.releaseYear;
		work.updatedAt = new Date();
		await repository.save(work);
		const ratings = await this.getCommunityRatings([work]);
		return this.packAdminWork(work, [], ratings.get(work.id));
	}

	/** Adds a local-only season to a draft or published catalogue work. */
	public async createManualSeason(
		workId: MiZalipWork['id'],
		input: {
			seasonNumber: number;
			title: string;
			originalTitle: string | null;
			description: string | null;
			airDate: string | null;
		},
	): Promise<MiZalipSeason | 'no-such-work' | 'duplicate'> {
		return await this.db.transaction(async manager => {
			const works = manager.getRepository(MiZalipWork);
			const work = await works.findOneBy({ id: workId });
			if (work == null) return 'no-such-work';

			const seasons = manager.getRepository(MiZalipSeason);
			if (await seasons.existsBy({ workId, seasonNumber: input.seasonNumber })) return 'duplicate';

			const now = new Date();
			const season = await seasons.save(seasons.create({
				id: this.idService.gen(),
				workId,
				seasonNumber: input.seasonNumber,
				title: input.title,
				originalTitle: input.originalTitle,
				description: input.description,
				posterPath: null,
				airDate: input.airDate,
				episodeCount: null,
				createdAt: now,
				updatedAt: now,
			}));
			work.updatedAt = now;
			await works.save(work);
			return season;
		});
	}

	/**
	 * Adds one locally curated episode. The first episode establishes a season baseline; a later
	 * episode on a published work creates the same durable release event used by TMDB syncs.
	 */
	public async createManualEpisode(
		workId: MiZalipWork['id'],
		seasonNumber: number,
		input: {
			episodeNumber: number;
			title: string;
			originalTitle: string | null;
			description: string | null;
			airDate: string | null;
			runtimeMinutes: number | null;
		},
	): Promise<MiZalipEpisode | 'no-such-season' | 'duplicate'> {
		const result = await this.db.transaction(async manager => {
			const works = manager.getRepository(MiZalipWork);
			const work = await works.findOneBy({ id: workId });
			if (work == null) return 'no-such-season' as const;

			const seasons = manager.getRepository(MiZalipSeason);
			const season = await seasons.findOneBy({ workId, seasonNumber });
			if (season == null) return 'no-such-season' as const;

			const episodes = manager.getRepository(MiZalipEpisode);
			if (await episodes.existsBy({ seasonId: season.id, episodeNumber: input.episodeNumber })) return 'duplicate' as const;

			const now = new Date();
			const previousEpisodeCount = season.episodeCount;
			const episode = await episodes.save(episodes.create({
				id: this.idService.gen(),
				tmdbEpisodeId: null,
				seasonId: season.id,
				episodeNumber: input.episodeNumber,
				title: input.title,
				originalTitle: input.originalTitle,
				description: input.description,
				airDate: input.airDate,
				stillPath: null,
				runtimeMinutes: input.runtimeMinutes,
				createdAt: now,
				updatedAt: now,
			}));

			season.episodeCount = Math.max(previousEpisodeCount ?? 0, episode.episodeNumber);
			season.updatedAt = now;
			await seasons.save(season);
			work.updatedAt = now;
			await works.save(work);

			if (work.publicationState === 'published' && previousEpisodeCount != null && episode.episodeNumber > previousEpisodeCount) {
				const events = manager.getRepository(MiZalipReleaseEvent);
				await events.save(events.create({
					id: this.idService.gen(),
					workId: work.id,
					seasonId: season.id,
					episodeId: episode.id,
					createdAt: now,
				}));
			}

			return episode;
		});

		await this.dispatchPendingReleaseNotifications();
		return result;
	}

	public async showDiscussion(workId: MiZalipWork['id']): Promise<string | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const context = await this.db.getRepository(MiZalipNoteContext).findOneBy({ workId: work.id });
		return context?.noteId ?? null;
	}

	public async createDiscussion(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		text: string | null,
	): Promise<PackedZalipDiscussion | null> {
		return await this.db.transaction(async manager => {
			const work = await manager.getRepository(MiZalipWork).createQueryBuilder('work')
				.setLock('pessimistic_write')
				.where('work.id = :workId', { workId })
				.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
				.getOne();
			if (work == null) return null;

			const contexts = manager.getRepository(MiZalipNoteContext);
			const existing = await contexts.findOneBy({ workId: work.id });
			if (existing != null) return { noteId: existing.noteId, created: false };

			if (this.systemAccountService == null) throw new Error('System account service is required for catalogue discussions.');
			const actor = await this.systemAccountService.fetch('actor');
			const note = await this.noteCreateService.fetchAndCreate(actor, {
				createdAt: new Date(),
				name: zalipDiscussionRootMarker,
				replyId: null,
				renoteId: null,
				fileIds: [],
				text: text ?? `Обсуждение: ${work.title}`,
				cw: null,
				visibility: 'home',
				visibleUserIds: [],
				channelId: null,
				localOnly: true,
				reactionAcceptance: null,
				poll: null,
			});

			await contexts.save(contexts.create({
				workId: work.id,
				noteId: note.id,
				createdById: me.id,
				createdAt: new Date(),
			}));

			return { noteId: note.id, created: true };
		});
	}

	public async createEpisodeDiscussion(
		me: MiLocalUser,
		episodeId: MiZalipEpisode['id'],
		text: string | null,
	): Promise<PackedZalipDiscussion | null> {
		return await this.db.transaction(async manager => {
			const episode = await manager.getRepository(MiZalipEpisode).createQueryBuilder('episode')
				.setLock('pessimistic_write')
				.innerJoinAndSelect('episode.season', 'season')
				.innerJoinAndSelect('season.work', 'work')
				.where('episode.id = :episodeId', { episodeId })
				.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
				.getOne();
			if (episode?.season?.work == null) return null;

			const contexts = manager.getRepository(MiZalipEpisodeNoteContext);
			const existing = await contexts.findOneBy({ episodeId: episode.id });
			if (existing != null) return { noteId: existing.noteId, created: false };

			if (this.systemAccountService == null) throw new Error('System account service is required for catalogue discussions.');
			const actor = await this.systemAccountService.fetch('actor');
			const note = await this.noteCreateService.fetchAndCreate(actor, {
				createdAt: new Date(),
				name: zalipDiscussionRootMarker,
				replyId: null,
				renoteId: null,
				fileIds: [],
				text: text ?? `Обсуждение: ${episode.season.work.title} — серия ${episode.episodeNumber}`,
				cw: null,
				visibility: 'home',
				visibleUserIds: [],
				channelId: null,
				localOnly: true,
				reactionAcceptance: null,
				poll: null,
			});

			await contexts.save(contexts.create({
				episodeId: episode.id,
				noteId: note.id,
				createdById: me.id,
				createdAt: new Date(),
			}));

			return { noteId: note.id, created: true };
		});
	}

	/** Creates an ordinary local Misskey post and attaches the canonical Zalip work as structured UI context. */
	public async createShare(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		input: {
			text: string | null;
			cw: string | null;
			visibility: MiNote['visibility'];
			localOnly: boolean;
			visibleUserIds: MiUser['id'][];
			replyId: MiNote['id'] | null;
			renoteId: MiNote['id'] | null;
			channelId: MiNote['channelId'];
			reactionAcceptance: MiNote['reactionAcceptance'];
		},
	): Promise<MiNote | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const note = await this.noteCreateService.fetchAndCreate(me, {
			createdAt: new Date(),
			replyId: input.replyId,
			renoteId: input.renoteId,
			fileIds: [],
			text: input.text,
			cw: input.cw,
			visibility: input.visibility,
			visibleUserIds: input.visibleUserIds,
			channelId: input.channelId,
			localOnly: input.localOnly,
			reactionAcceptance: input.reactionAcceptance,
			poll: null,
		});

		const shares = this.db.getRepository(MiZalipSharedNote);
		await shares.save(shares.create({
			noteId: note.id,
			workId: work.id,
			createdAt: new Date(),
		}));
		return note;
	}
}
