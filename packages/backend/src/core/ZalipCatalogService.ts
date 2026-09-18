/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { MiNote } from '@/models/Note.js';
import type { MiLocalUser, MiUser } from '@/models/User.js';
import {
	MiZalipLibraryEntry,
	type ZalipLibraryStatus,
} from '@/models/ZalipLibraryEntry.js';
import {
	MiZalipWork,
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
	backdropPath: string | null;
	trailerYoutubeKey: string | null;
};

export type PackedZalipLibraryEntry = {
	status: ZalipLibraryStatus;
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
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
		private noteCreateService: NoteCreateService,
		private notificationService: NotificationService,
	) {
	}

	public packWork(work: MiZalipWork): PackedZalipWork {
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
			backdropPath: work.backdropPath,
			trailerYoutubeKey: work.trailerYoutubeKey,
		};
	}

	public async listPublished(limit: number): Promise<PackedZalipWork[]> {
		const works = await this.db.getRepository(MiZalipWork).find({
			where: { publicationState: 'published' },
			order: { publishedAt: 'DESC', createdAt: 'DESC' },
			take: limit,
		});

		return works.map(work => this.packWork(work));
	}

	/** Bounded literal title search over published works. Wildcards are escaped rather than exposed. */
	public async searchPublished(query: string, limit: number): Promise<PackedZalipWork[]> {
		const normalized = query.trim();
		if (normalized.length < 2) return [];
		const pattern = `%${normalized.replace(/[\\%_]/g, '\\$&')}%`;
		const works = await this.db.getRepository(MiZalipWork).createQueryBuilder('work')
			.where('work.publicationState = :publicationState', { publicationState: 'published' })
			.andWhere("(work.title ILIKE :pattern ESCAPE '\\' OR work.originalTitle ILIKE :pattern ESCAPE '\\')", { pattern })
			.orderBy('work.publishedAt', 'DESC')
			.addOrderBy('work.createdAt', 'DESC')
			.take(limit)
			.getMany();
		return works.map(work => this.packWork(work));
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
			...this.packWork(work),
			galleryPaths: work.galleryPaths,
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

		return this.packReleaseEvents(events);
	}

	/** Signed-in updates page: only events from titles the current Misskey user follows. */
	public async listSubscribedReleaseEvents(me: MiLocalUser, limit: number): Promise<PackedZalipReleaseEvent[]> {
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
		return this.packReleaseEvents(events);
	}

	private packReleaseEvents(events: MiZalipReleaseEvent[]): PackedZalipReleaseEvent[] {
		return events.flatMap(event => {
			if (event.work == null || event.season == null || event.episode == null) return [];
			return [{
				id: event.id,
				createdAt: event.createdAt.toISOString(),
				work: this.packWork(event.work),
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

		return entries.map(entry => ({
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			isReleaseSubscribed: entry.isReleaseSubscribed,
			work: this.packWork(entry.work!),
		}));
	}

	public async updateLibrary(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		input: {
			status: ZalipLibraryStatus;
			episodesWatched?: number;
			personalRating?: number | null;
			isFavorite?: boolean;
			isReleaseSubscribed?: boolean;
		},
	): Promise<PackedZalipLibraryEntry | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const repository = this.db.getRepository(MiZalipLibraryEntry);
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

		return {
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			isReleaseSubscribed: entry.isReleaseSubscribed,
			work: this.packWork(work),
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
		return await this.listTmdbMediaSyncTargets(Math.max(1, Math.min(limit, 100)));
	}

	/** Records a validated Alloha response without exposing the source mapping on catalogue endpoints. */
	public async upsertAllohaSource(input: {
		workId: MiZalipWork['id'];
		category: string;
		isAvailable: boolean;
		iframe: string | null;
		translations: ZalipAllohaTranslation[];
	}): Promise<{ created: boolean }> {
		const repository = this.db.getRepository(MiZalipAllohaSource);
		const existing = await repository.findOneBy({ workId: input.workId });
		const now = new Date();
		if (existing != null) {
			existing.category = input.category;
			existing.isAvailable = input.isAvailable;
			existing.iframe = input.iframe;
			existing.translations = input.translations;
			existing.lastCheckedAt = now;
			existing.updatedAt = now;
			await repository.save(existing);
			return { created: false };
		}

		await repository.save(repository.create({
			id: this.idService.gen(),
			workId: input.workId,
			category: input.category,
			isAvailable: input.isAvailable,
			iframe: input.iframe,
			translations: input.translations,
			lastCheckedAt: now,
			createdAt: now,
			updatedAt: now,
		}));
		return { created: true };
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
			if (event.work == null) continue;
			const entries = await this.db.getRepository(MiZalipLibraryEntry).find({
				select: { userId: true },
				where: { workId: event.work.id, isReleaseSubscribed: true },
			});
			await Promise.all(entries.map(entry => this.notificationService.createNotificationAndWait(
				entry.userId,
				'zalipAllohaAvailable',
				{
					workId: event.work!.id,
					workSlug: event.work!.slug,
					workTitle: event.work!.title,
					seasonNumber: event.seasonNumber,
					episodeNumber: event.episodeNumber,
					translationCount: event.translationCount,
				} satisfies ZalipAllohaAvailabilityNotificationPayload,
			)));
			await this.db.getRepository(MiZalipAllohaAvailabilityEvent).update(event.id, {
				notificationDeliveredAt: new Date(),
			});
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
			galleryPaths: string[];
			trailerYoutubeKey: string | null;
		},
	): Promise<MiZalipWork | null> {
		const repository = this.db.getRepository(MiZalipWork);
		const work = await repository.findOneBy({ id: workId });
		if (work == null) return null;

		work.posterPath = input.posterPath;
		work.backdropPath = input.backdropPath;
		work.genres = input.genres;
		work.runtimeMinutes = input.runtimeMinutes;
		work.galleryPaths = input.galleryPaths;
		work.trailerYoutubeKey = input.trailerYoutubeKey;
		work.updatedAt = new Date();
		return await repository.save(work);
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
			const work = await manager.getRepository(MiZalipWork).findOneBy({ id: season.workId });
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
				episode.stillPath = input.stillPath;
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
	 * A durable release-event outbox. A failed Redis/Web Push operation leaves its marker empty,
	 * allowing the next catalogue sync to retry without duplicating a database release event.
	 */
	private async dispatchPendingReleaseNotifications(): Promise<void> {
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
			if (event.work == null || event.season == null || event.episode == null) continue;
			await this.notifyEpisodeReleaseSubscribers(event, {
				workId: event.work.id,
				workSlug: event.work.slug,
				workTitle: event.work.title,
				seasonNumber: event.season.seasonNumber,
				episodeNumber: event.episode.episodeNumber,
				episodeTitle: event.episode.title,
			});
		}
	}

	/** Delivers one committed catalogue arrival before marking its release event as complete. */
	private async notifyEpisodeReleaseSubscribers(
		event: MiZalipReleaseEvent,
		notification: ZalipEpisodeReleaseNotificationPayload,
	): Promise<void> {
		const entries = await this.db.getRepository(MiZalipLibraryEntry).find({
			select: { userId: true },
			where: {
				workId: notification.workId,
				isReleaseSubscribed: true,
			},
		});

		await Promise.all(entries.map(entry => this.notificationService.createNotificationAndWait(
			entry.userId,
			'zalipEpisodeReleased',
			notification,
		)));

		await this.db.getRepository(MiZalipReleaseEvent).update(event.id, {
			notificationDeliveredAt: new Date(),
		});
	}

	public packAdminWork(work: MiZalipWork, seasons: MiZalipSeason[] = []): PackedZalipAdminWork {
		return {
			...this.packWork(work),
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

		return works.map(work => this.packAdminWork(work, seasonsByWorkId.get(work.id)));
	}

	public async setPublicationState(
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

		return this.packAdminWork(work);
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
		return this.packAdminWork(work);
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
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const contexts = this.db.getRepository(MiZalipNoteContext);
		const existing = await contexts.findOneBy({ workId: work.id });
		if (existing != null) return { noteId: existing.noteId, created: false };

		const note = await this.noteCreateService.fetchAndCreate(me, {
			createdAt: new Date(),
			replyId: null,
			renoteId: null,
			fileIds: [],
			text: text ?? `Обсуждение: ${work.title}`,
			cw: null,
			visibility: 'public',
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
	}

	public async createEpisodeDiscussion(
		me: MiLocalUser,
		episodeId: MiZalipEpisode['id'],
		text: string | null,
	): Promise<PackedZalipDiscussion | null> {
		const episode = await this.db.getRepository(MiZalipEpisode).createQueryBuilder('episode')
			.innerJoinAndSelect('episode.season', 'season')
			.innerJoinAndSelect('season.work', 'work')
			.where('episode.id = :episodeId', { episodeId })
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.getOne();
		if (episode?.season?.work == null) return null;

		const contexts = this.db.getRepository(MiZalipEpisodeNoteContext);
		const existing = await contexts.findOneBy({ episodeId: episode.id });
		if (existing != null) return { noteId: existing.noteId, created: false };

		const note = await this.noteCreateService.fetchAndCreate(me, {
			createdAt: new Date(),
			replyId: null,
			renoteId: null,
			fileIds: [],
			text: text ?? `Обсуждение: ${episode.season.work.title} — серия ${episode.episodeNumber}`,
			cw: null,
			visibility: 'public',
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
		},
	): Promise<MiNote | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const note = await this.noteCreateService.fetchAndCreate(me, {
			createdAt: new Date(),
			replyId: null,
			renoteId: null,
			fileIds: [],
			text: input.text,
			cw: input.cw,
			visibility: input.visibility,
			visibleUserIds: input.visibleUserIds,
			channelId: null,
			localOnly: input.localOnly,
			reactionAcceptance: null,
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
