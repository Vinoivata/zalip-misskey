/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipWork } from '@/models/ZalipWork.js';

describe('ZalipCatalogService', () => {
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
});
