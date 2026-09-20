/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipEpisodeNoteContext } from '@/models/ZalipEpisodeNoteContext.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipNoteContext } from '@/models/ZalipNoteContext.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipSharedNote } from '@/models/ZalipSharedNote.js';
import { MiZalipWork } from '@/models/ZalipWork.js';

describe('ZalipCatalogService', () => {
	it('creates a normal local note and stores its canonical Zalip work card', async () => {
		const work = { id: 'work-1', publicationState: 'published' };
		const worksRepository = {
			findOneBy: vi.fn().mockResolvedValue(work),
		};
		const sharedNotesRepository = {
			create: vi.fn((input) => input),
			save: vi.fn().mockResolvedValue(null),
		};
		const dataSource = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				if (model === MiZalipSharedNote) return sharedNotesRepository;
				throw new Error('Unexpected repository');
			},
		};
		const noteCreateService = {
			fetchAndCreate: vi.fn().mockResolvedValue({ id: 'note-1' }),
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			noteCreateService as never,
			{} as never,
		);

		await expect(service.createShare({ id: 'user-1' } as never, work.id, {
			text: null,
			cw: null,
			visibility: 'public',
			localOnly: true,
			visibleUserIds: [],
			replyId: 'reply-1',
			renoteId: null,
			channelId: 'channel-1',
			reactionAcceptance: 'likeOnly',
		})).resolves.toEqual({ id: 'note-1' });

		expect(noteCreateService.fetchAndCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), expect.objectContaining({
			text: null,
			visibility: 'public',
			localOnly: true,
			fileIds: [],
			replyId: 'reply-1',
			channelId: 'channel-1',
			reactionAcceptance: 'likeOnly',
		}));
		expect(sharedNotesRepository.save).toHaveBeenCalledWith(expect.objectContaining({
			noteId: 'note-1',
			workId: work.id,
		}));
	});

	it('does not create a share for an unpublished or missing work', async () => {
		const worksRepository = {
			findOneBy: vi.fn().mockResolvedValue(null),
		};
		const dataSource = {
			getRepository: () => worksRepository,
		};
		const noteCreateService = { fetchAndCreate: vi.fn() };
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			noteCreateService as never,
			{} as never,
		);

		await expect(service.createShare({ id: 'user-1' } as never, 'missing-work', {
			text: 'Не должно публиковаться',
			cw: null,
			visibility: 'public',
			localOnly: true,
			visibleUserIds: [],
			replyId: null,
			renoteId: null,
			channelId: null,
			reactionAcceptance: null,
		})).resolves.toBeNull();
		expect(noteCreateService.fetchAndCreate).not.toHaveBeenCalled();
	});

	it('locks a title before creating its first discussion root', async () => {
		const work = { id: 'work-1', title: 'Example series' };
		const workQuery = {
			setLock: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			getOne: vi.fn().mockResolvedValue(work),
		};
		const worksRepository = { createQueryBuilder: vi.fn().mockReturnValue(workQuery) };
		const contextsRepository = {
			findOneBy: vi.fn().mockResolvedValue(null),
			create: vi.fn((input) => input),
			save: vi.fn().mockResolvedValue(null),
		};
		const manager = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				if (model === MiZalipNoteContext) return contextsRepository;
				throw new Error('Unexpected repository');
			},
		};
		const dataSource = {
			transaction: async (callback: (transactionManager: typeof manager) => Promise<unknown>) => await callback(manager),
		};
		const noteCreateService = { fetchAndCreate: vi.fn().mockResolvedValue({ id: 'note-1' }) };
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			noteCreateService as never,
			{} as never,
		);

		await expect(service.createDiscussion({ id: 'user-1' } as never, work.id, null)).resolves.toEqual({ noteId: 'note-1', created: true });

		expect(workQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(noteCreateService.fetchAndCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), expect.objectContaining({
			name: 'zalip:discussion-root',
			visibility: 'home',
			localOnly: true,
		}));
		expect(contextsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ workId: work.id, noteId: 'note-1' }));
	});

	it('locks an episode before creating its first discussion root', async () => {
		const episode = {
			id: 'episode-1',
			episodeNumber: 1,
			season: { work: { title: 'Example series' } },
		};
		const episodeQuery = {
			setLock: vi.fn().mockReturnThis(),
			innerJoinAndSelect: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			getOne: vi.fn().mockResolvedValue(episode),
		};
		const episodesRepository = { createQueryBuilder: vi.fn().mockReturnValue(episodeQuery) };
		const contextsRepository = {
			findOneBy: vi.fn().mockResolvedValue(null),
			create: vi.fn((input) => input),
			save: vi.fn().mockResolvedValue(null),
		};
		const manager = {
			getRepository: (model: unknown) => {
				if (model === MiZalipEpisode) return episodesRepository;
				if (model === MiZalipEpisodeNoteContext) return contextsRepository;
				throw new Error('Unexpected repository');
			},
		};
		const dataSource = {
			transaction: async (callback: (transactionManager: typeof manager) => Promise<unknown>) => await callback(manager),
		};
		const noteCreateService = { fetchAndCreate: vi.fn().mockResolvedValue({ id: 'note-1' }) };
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			noteCreateService as never,
			{} as never,
		);

		await expect(service.createEpisodeDiscussion({ id: 'user-1' } as never, episode.id, null)).resolves.toEqual({ noteId: 'note-1', created: true });

		expect(episodeQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
		expect(contextsRepository.save).toHaveBeenCalledWith(expect.objectContaining({ episodeId: episode.id, noteId: 'note-1' }));
	});

	it('filters the public catalogue by an exact normalized genre tag in PostgreSQL', async () => {
		const query = {
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([{
				id: 'work-1',
				slug: 'example-series',
				kind: 'series',
				title: 'Example Series',
				originalTitle: null,
				description: null,
				releaseYear: 2026,
				genres: ['Драма'],
				runtimeMinutes: 44,
				posterPath: null,
				backdropPath: null,
				trailerYoutubeKey: null,
			}]),
		};
		const worksRepository = { createQueryBuilder: vi.fn().mockReturnValue(query) };
		const dataSource = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				throw new Error('Unexpected repository');
			},
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(service.listPublished(12, '  Драма  ', 'series')).resolves.toEqual([expect.objectContaining({
			id: 'work-1',
			genres: ['Драма'],
		})]);
		expect(query.andWhere).toHaveBeenCalledWith('work.genres @> CAST(:genre AS jsonb)', { genre: '["Драма"]' });
		expect(query.andWhere).toHaveBeenCalledWith('work.kind = :kind', { kind: 'series' });
		expect(query.take).toHaveBeenCalledWith(12);
	});

	it('limits a title search to the requested catalogue kind', async () => {
		const query = {
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([{
				id: 'work-2',
				slug: 'example-movie',
				kind: 'movie',
				title: 'Example Movie',
				originalTitle: null,
				description: null,
				releaseYear: 2026,
				genres: ['Драма'],
				runtimeMinutes: 120,
				posterPath: null,
				backdropPath: null,
				trailerYoutubeKey: null,
			}]),
		};
		const worksRepository = { createQueryBuilder: vi.fn().mockReturnValue(query) };
		const dataSource = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				throw new Error('Unexpected repository');
			},
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(service.searchPublished('  Example  ', 8, 'movie')).resolves.toEqual([expect.objectContaining({
			id: 'work-2',
			kind: 'movie',
		})]);
		expect(query.andWhere).toHaveBeenCalledWith('work.kind = :kind', { kind: 'movie' });
		expect(query.take).toHaveBeenCalledWith(8);
	});

	it('lists every published genre facet independently of the catalogue page size', async () => {
		const dataSource = {
			query: vi.fn().mockResolvedValue([
				{ genre: 'Комедия' },
				{ genre: 'Драма' },
				{ genre: 'Триллер' },
			]),
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{} as never,
			{} as never,
			{} as never,
		);

		await expect(service.listPublishedGenres()).resolves.toEqual(['Драма', 'Комедия', 'Триллер']);
		await expect(service.listPublishedGenres()).resolves.toEqual(['Драма', 'Комедия', 'Триллер']);
		expect(dataSource.query).toHaveBeenCalledTimes(1);
		expect(dataSource.query).toHaveBeenCalledWith(
			expect.stringContaining('jsonb_array_elements_text'),
			['published'],
		);
	});

	it('returns only TMDB-backed works for a bounded explicit metadata refresh', async () => {
		const worksRepository = {
			find: vi.fn().mockResolvedValue([
				{ id: 'movie-1', tmdbMediaType: 'movie', tmdbId: 11 },
				{ id: 'manual-1', tmdbMediaType: null, tmdbId: null },
				{ id: 'series-1', tmdbMediaType: 'tv', tmdbId: 22 },
			]),
		};
		const dataSource = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				throw new Error('Unexpected repository');
			},
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{ gen: vi.fn() } as never,
			{} as never,
			{} as never,
		);

		await expect(service.listTmdbMediaSyncTargets(100)).resolves.toEqual([
			{ workId: 'movie-1', tmdbMediaType: 'movie', tmdbId: 11 },
			{ workId: 'series-1', tmdbMediaType: 'tv', tmdbId: 22 },
		]);
		expect(worksRepository.find).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
	});

	it('delivers a committed episode arrival to every title subscriber and marks its outbox event', async () => {
		const work = {
			id: 'work-1',
			slug: 'example-series',
			title: 'Example Series',
			publicationState: 'published',
		};
		const season = {
			id: 'season-1',
			workId: work.id,
			seasonNumber: 1,
			episodeCount: 1,
		};
		const firstEpisode = {
			id: 'episode-1',
			seasonId: season.id,
			episodeNumber: 1,
			tmdbEpisodeId: 1001,
			title: 'Episode 1',
		};
		const secondEpisode = {
			id: 'episode-2',
			seasonId: season.id,
			episodeNumber: 2,
			tmdbEpisodeId: 1002,
			title: 'Episode 2',
		};
		const releaseEvent = {
			id: 'release-2',
			work,
			season,
			episode: secondEpisode,
		};

		const seasonsRepository = {
			findOneBy: vi.fn().mockResolvedValue(season),
			save: vi.fn().mockResolvedValue(season),
		};
		const worksRepository = {
			findOneBy: vi.fn().mockResolvedValue(work),
		};
		const episodesRepository = {
			findBy: vi.fn().mockResolvedValue([firstEpisode]),
			create: vi.fn((input) => ({ ...input, id: secondEpisode.id })),
			save: vi.fn().mockResolvedValue([firstEpisode, secondEpisode]),
		};
		const transactionEventsRepository = {
			create: vi.fn((input) => input),
			save: vi.fn().mockResolvedValue([releaseEvent]),
		};
		const eventQuery = {
			innerJoinAndSelect: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([releaseEvent]),
		};
		const releaseEventsRepository = {
			createQueryBuilder: vi.fn().mockReturnValue(eventQuery),
			update: vi.fn().mockResolvedValue({ affected: 1 }),
		};
		const libraryRepository = {
			find: vi.fn().mockResolvedValue([{ userId: 'viewer-1' }, { userId: 'viewer-2' }]),
		};
		const manager = {
			getRepository: (model: unknown) => {
				if (model === MiZalipSeason) return seasonsRepository;
				if (model === MiZalipWork) return worksRepository;
				if (model === MiZalipEpisode) return episodesRepository;
				if (model === MiZalipReleaseEvent) return transactionEventsRepository;
				throw new Error('Unexpected transaction repository');
			},
		};
		const dataSource = {
			transaction: async (callback: (transactionManager: typeof manager) => Promise<unknown>) => await callback(manager),
			getRepository: (model: unknown) => {
				if (model === MiZalipReleaseEvent) return releaseEventsRepository;
				if (model === MiZalipLibraryEntry) return libraryRepository;
				throw new Error('Unexpected data source repository');
			},
		};
		const notificationService = {
			createNotificationAndWait: vi.fn().mockResolvedValue(null),
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{ gen: vi.fn().mockReturnValue('generated-id') } as never,
			{} as never,
			notificationService as never,
		);

		await expect(service.syncSeasonEpisodes(season.id, [{
			tmdbEpisodeId: 1002,
			episodeNumber: 2,
			title: 'Episode 2',
			originalTitle: null,
			description: null,
			airDate: null,
			stillPath: null,
			runtimeMinutes: null,
		}])).resolves.toEqual({ added: 1, updated: 0, total: 1 });

		expect(transactionEventsRepository.save).toHaveBeenCalledWith([expect.objectContaining({
			workId: work.id,
			seasonId: season.id,
			episodeId: secondEpisode.id,
		})]);
		expect(notificationService.createNotificationAndWait).toHaveBeenNthCalledWith(1, 'viewer-1', 'zalipEpisodeReleased', {
			workId: work.id,
			workSlug: work.slug,
			workTitle: work.title,
			seasonNumber: 1,
			episodeNumber: 2,
			episodeTitle: 'Episode 2',
		});
		expect(notificationService.createNotificationAndWait).toHaveBeenNthCalledWith(2, 'viewer-2', 'zalipEpisodeReleased', expect.anything());
		expect(releaseEventsRepository.update).toHaveBeenCalledWith(releaseEvent.id, {
			notificationDeliveredAt: expect.any(Date),
		});
	});

	it('creates the same release event and native notification for a later manually curated episode', async () => {
		const work = {
			id: 'work-1',
			slug: 'manual-series',
			title: 'Manual Series',
			publicationState: 'published',
		};
		const season = {
			id: 'season-1',
			workId: work.id,
			seasonNumber: 1,
			episodeCount: 1,
		};
		const episode = {
			id: 'episode-2',
			seasonId: season.id,
			episodeNumber: 2,
			title: 'Manual episode 2',
		};
		const releaseEvent = {
			id: 'release-2',
			work,
			season,
			episode,
		};

		const worksRepository = {
			findOneBy: vi.fn().mockResolvedValue(work),
			save: vi.fn().mockResolvedValue(work),
		};
		const seasonsRepository = {
			findOneBy: vi.fn().mockResolvedValue(season),
			save: vi.fn().mockResolvedValue(season),
		};
		const episodesRepository = {
			existsBy: vi.fn().mockResolvedValue(false),
			create: vi.fn((input) => ({ ...input, id: episode.id })),
			save: vi.fn().mockResolvedValue(episode),
		};
		const transactionEventsRepository = {
			create: vi.fn((input) => input),
			save: vi.fn().mockResolvedValue(releaseEvent),
		};
		const eventQuery = {
			innerJoinAndSelect: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([releaseEvent]),
		};
		const releaseEventsRepository = {
			createQueryBuilder: vi.fn().mockReturnValue(eventQuery),
			update: vi.fn().mockResolvedValue({ affected: 1 }),
		};
		const libraryRepository = {
			find: vi.fn().mockResolvedValue([{ userId: 'viewer-1' }]),
		};
		const manager = {
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				if (model === MiZalipSeason) return seasonsRepository;
				if (model === MiZalipEpisode) return episodesRepository;
				if (model === MiZalipReleaseEvent) return transactionEventsRepository;
				throw new Error('Unexpected transaction repository');
			},
		};
		const dataSource = {
			transaction: async (callback: (transactionManager: typeof manager) => Promise<unknown>) => await callback(manager),
			getRepository: (model: unknown) => {
				if (model === MiZalipReleaseEvent) return releaseEventsRepository;
				if (model === MiZalipLibraryEntry) return libraryRepository;
				throw new Error('Unexpected data source repository');
			},
		};
		const notificationService = {
			createNotificationAndWait: vi.fn().mockResolvedValue(null),
		};
		const service = new ZalipCatalogService(
			dataSource as never,
			{ gen: vi.fn().mockReturnValue('generated-id') } as never,
			{} as never,
			notificationService as never,
		);

		await expect(service.createManualEpisode(work.id, season.seasonNumber, {
			episodeNumber: 2,
			title: episode.title,
			originalTitle: null,
			description: null,
			airDate: null,
			runtimeMinutes: null,
		})).resolves.toEqual(episode);

		expect(transactionEventsRepository.save).toHaveBeenCalledWith(expect.objectContaining({
			workId: work.id,
			seasonId: season.id,
			episodeId: episode.id,
		}));
		expect(notificationService.createNotificationAndWait).toHaveBeenCalledWith('viewer-1', 'zalipEpisodeReleased', {
			workId: work.id,
			workSlug: work.slug,
			workTitle: work.title,
			seasonNumber: 1,
			episodeNumber: 2,
			episodeTitle: episode.title,
		});
		expect(releaseEventsRepository.update).toHaveBeenCalledWith(releaseEvent.id, {
			notificationDeliveredAt: expect.any(Date),
		});
	});
});
