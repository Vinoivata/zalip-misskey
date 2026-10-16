/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntitySchema } from 'typeorm';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipEpisodeNoteContext } from '@/models/ZalipEpisodeNoteContext.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipNoteContext } from '@/models/ZalipNoteContext.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipSharedNote } from '@/models/ZalipSharedNote.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipAllohaSource } from '@/models/ZalipAllohaSource.js';

describe('ZalipCatalogService', () => {
	const mediaRefresh = { genres: ['Provider genre'], runtimeMinutes: 90, posterPath: '/remote.jpg', backdropPath: '/remote-backdrop.jpg', logoPath: '/remote-logo.png', galleryPaths: ['/remote-frame.jpg'], trailerYoutubeKey: 'trailer01' };

	it.each(['values', 'localArtwork'] as const)('legacy media refresh re-reads %s ownership after acquiring the importer work lock', async ownership => {
		let grantLock!: () => void;
		const lock = new Promise<void>(resolve => { grantLock = resolve; });
		let persisted: Partial<MiZalipWork> = { id: 'work', posterPath: '/legacy.jpg', importData: {} };
		const repository = { findOne: vi.fn().mockImplementation(async () => { await lock; return structuredClone(persisted); }), save: vi.fn() };
		const manager = { getRepository: (model: unknown) => { expect(model).toBe(MiZalipWork); return repository; } };
		const db = { transaction: vi.fn(async action => action(manager)) };
		const service = new ZalipCatalogService(db as never, {} as never, {} as never, {} as never);
		const pending = service.updateTmdbMedia('work', mediaRefresh);
		// The provenance-aware importer commits while the legacy worker is waiting for its row lock.
		persisted = { ...persisted, posterPath: '/files/processed.webp', description: 'Editorial description', importData: { [ownership]: { posterUrl: '/files/processed.webp' }, preserved: true } };
		grantLock();
		const result = await pending;
		expect(repository.findOne).toHaveBeenCalledExactlyOnceWith({ where: { id: 'work' }, lock: { mode: 'pessimistic_write' } });
		expect(db.transaction).toHaveBeenCalledOnce();
		expect(repository.save).not.toHaveBeenCalled();
		expect(result).toMatchObject({ posterPath: '/files/processed.webp', description: 'Editorial description', importData: { preserved: true } });
	});

	it('legacy media refresh still updates unowned titles inside the work transaction', async () => {
		const work = { id: 'work', publicationState: 'published', title: 'Editorial title', description: 'Editorial description', importData: {} };
		const repository = { findOne: vi.fn().mockResolvedValue(work), save: vi.fn().mockImplementation(async value => value) };
		const manager = { getRepository: () => repository };
		const service = new ZalipCatalogService({ transaction: async (action: (value: typeof manager) => Promise<unknown>) => action(manager) } as never, {} as never, {} as never, {} as never);
		expect(await service.updateTmdbMedia('work', mediaRefresh)).toMatchObject({ ...mediaRefresh, title: 'Editorial title', description: 'Editorial description', importData: {} });
		expect(repository.findOne).toHaveBeenCalledWith({ where: { id: 'work' }, lock: { mode: 'pessimistic_write' } });
		expect(repository.save).toHaveBeenCalledOnce();
	});

	it('public work cards and details expose processed assets but no import ownership or originals', async () => {
		const work = { id: 'work', slug: 'title', title: 'Title', kind: 'movie', posterPath: '/files/processed.webp', galleryPaths: ['/files/frame.webp'], importData: { localArtwork: { posterUrl: '/files/processed.webp' }, values: { posterUrl: 'https://original.private.invalid/poster.jpg' }, artworkOriginals: ['https://original.private.invalid/frame.jpg'], countries: ['Россия'], ratings: [] } };
		const works = { findOneBy: vi.fn().mockResolvedValue(work) };
		const seasons = { find: vi.fn().mockResolvedValue([]) };
		const db = { getRepository: (model: unknown) => model === MiZalipWork ? works : seasons, query: vi.fn().mockResolvedValue([]) };
		const service = new ZalipCatalogService(db as never, {} as never, {} as never, {} as never);
		const card = service.packWork(work as never);
		const detail = await service.showPublished('title');
		for (const result of [card, detail]) {
			expect(result).toMatchObject({ posterPath: '/files/processed.webp' });
			expect(result).not.toHaveProperty('importData');
			expect(result).not.toHaveProperty('localArtwork');
			expect(JSON.stringify(result)).not.toContain('original.private.invalid');
		}
		expect(detail?.galleryPaths).toEqual(['/files/frame.webp']);
	});

	it('legacy season refresh checks importer ownership under the same work row lock', async () => {
		const season = { id: 'season', workId: 'work' };
		const seasons = { findOneBy: vi.fn().mockResolvedValue(season), save: vi.fn() };
		const works = { findOne: vi.fn().mockResolvedValue({ id: 'work', importData: { localArtwork: { posterUrl: '/files/processed.webp' } } }) };
		const episodes = { countBy: vi.fn().mockResolvedValue(7), findBy: vi.fn(), save: vi.fn() };
		const manager = { getRepository: (model: unknown) => model === MiZalipWork ? works : model === MiZalipSeason ? seasons : episodes };
		const service = new ZalipCatalogService({ transaction: async (action: (value: typeof manager) => Promise<unknown>) => action(manager) } as never, {} as never, {} as never, {} as never);
		vi.spyOn(service as unknown as { dispatchPendingReleaseNotifications: () => Promise<void> }, 'dispatchPendingReleaseNotifications').mockResolvedValue();
		expect(await service.syncSeasonEpisodes('season', [])).toEqual({ added: 0, updated: 0, total: 7 });
		expect(works.findOne).toHaveBeenCalledWith({ where: { id: 'work' }, lock: { mode: 'pessimistic_write' } });
		expect(episodes.findBy).not.toHaveBeenCalled();
		expect(episodes.save).not.toHaveBeenCalled();
		expect(seasons.save).not.toHaveBeenCalled();
	});

	it('selects the joined ordering column inside real TypeORM pagination', async () => {
		class MetadataOnlyDataSource extends DataSource {
			async prepare() { await this.buildMetadatas(); }
		}
		const db = new MetadataOnlyDataSource({
			type: 'postgres',
			entities: [
				new EntitySchema({ name: 'MiZalipWork', target: MiZalipWork, columns: { id: { type: String, primary: true }, tmdbMediaType: { type: String }, tmdbId: { type: Number } } }),
				new EntitySchema({ name: 'MiZalipAllohaSource', target: MiZalipAllohaSource, columns: { id: { type: String, primary: true }, workId: { type: String }, lastCheckedAt: { type: Date } } }),
			],
		});
		await db.prepare();
		const runner = db.createQueryRunner();
		const query = vi.spyOn(runner, 'query').mockResolvedValue({ records: [], raw: [] });
		vi.spyOn(runner, 'release').mockResolvedValue();
		vi.spyOn(db, 'createQueryRunner').mockReturnValue(runner);
		const service = new ZalipCatalogService(db, {} as never, {} as never, {} as never);
		await service.listAllohaSyncTargets(100);
		const sql = query.mock.calls[0][0];
		expect(sql).toContain('SELECT DISTINCT');
		expect(sql).toContain('"source"."lastCheckedAt" AS "source_lastCheckedAt"');
		expect(sql).toContain('LIMIT 100');
	});

	it.each([null, false, true])('atomically saves movie availability and outbox under a work lock (previous=%s)', async previous => {
		const sources = { findOneBy: vi.fn().mockResolvedValue(previous == null ? null : { id: 'source', isAvailable: previous, createdAt: new Date() }), create: vi.fn(value => value), save: vi.fn() };
		const events = { existsBy: vi.fn().mockResolvedValue(false), create: vi.fn(value => value), save: vi.fn() };
		const works = { findOneOrFail: vi.fn().mockResolvedValue({ id: 'movie' }) };
		const manager = { getRepository: (model: unknown) => model === MiZalipWork ? works : model === MiZalipAllohaSource ? sources : events };
		const db = { transaction: vi.fn(async action => await action(manager)) };
		const service = new ZalipCatalogService(db as never, { gen: () => 'generated' } as never, {} as never, {} as never);
		const input = { workId: 'movie', category: 'movie', isAvailable: true, iframe: 'https://example.test/player', translations: [], recordMovieAvailability: true };
		await expect(service.upsertAllohaSource(input)).resolves.toEqual({ created: previous == null, movieEventCreated: true });
		expect(works.findOneOrFail).toHaveBeenCalledWith({ where: { id: 'movie' }, lock: { mode: 'pessimistic_write' } });
		expect(events.save).toHaveBeenCalledWith(expect.objectContaining({ availabilityKey: 'movie', notificationDeliveredAt: previous === false ? null : expect.any(Date) }));
		expect(sources.save).toHaveBeenCalledWith(expect.objectContaining({ isAvailable: true }));
		sources.save.mockClear();
		events.save.mockRejectedValueOnce(new Error('Database failure'));
		await expect(service.upsertAllohaSource(input)).rejects.toThrow('Database failure');
		expect(sources.save).not.toHaveBeenCalled();
	});
	it('merges only the viewers subscribed published catalogue and playback events, ordered and bounded', async () => {
		const work = { id: 'movie', slug: 'movie', title: 'Movie' };
		const availability = [{ id: 'new', createdAt: new Date('2026-09-28'), work, seasonNumber: null, episodeNumber: null }];

		function builder(rows: unknown[]) {
			const query = { innerJoinAndSelect: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), take: vi.fn(), getMany: vi.fn().mockResolvedValue(rows) };
			for (const name of ['innerJoinAndSelect', 'innerJoin', 'where', 'andWhere', 'orderBy', 'take'] as const) query[name].mockReturnValue(query);
			return query;
		}

		const catalogQuery = builder([]);
		const playbackQuery = builder(availability);
		const db = { getRepository: (model: unknown) => ({ createQueryBuilder: () => model === MiZalipReleaseEvent ? catalogQuery : playbackQuery }) };
		const service = new ZalipCatalogService(db as never, {} as never, {} as never, {} as never);
		const packing = service as unknown as { packReleaseEvents: () => Promise<unknown[]>; getCommunityRatings: () => Promise<Map<string, unknown>>; packWork: () => unknown };
		vi.spyOn(packing, 'packReleaseEvents').mockResolvedValue([{ id: 'old', createdAt: '2026-09-27T00:00:00.000Z', work, season: { seasonNumber: 1, title: 'Season' }, episode: { episodeNumber: 2, title: 'Episode' } }]);
		vi.spyOn(packing, 'getCommunityRatings').mockResolvedValue(new Map());
		vi.spyOn(packing, 'packWork').mockReturnValue(work);
		const result = await service.listSubscribedReleaseEvents({ id: 'viewer' } as never, 1);
		expect(result).toEqual([{ id: 'new', createdAt: '2026-09-28T00:00:00.000Z', source: 'playback', work, season: null, episode: null }]);
		for (const query of [catalogQuery, playbackQuery]) {
			expect(query.where).toHaveBeenCalledWith('library.userId = :userId', { userId: 'viewer' });
			expect(query.andWhere).toHaveBeenCalledWith('library.isReleaseSubscribed = true');
			expect(query.andWhere).toHaveBeenCalledWith('work.publicationState = :publicationState', { publicationState: 'published' });
			expect(query.take).toHaveBeenCalledWith(1);
		}
	});

	it('delivers playback events only to active subscribers and leaves failed delivery retryable', async () => {
		const event = { id: 'event', work: { id: 'movie', slug: 'movie', title: 'Movie' }, seasonNumber: null, episodeNumber: null, translationCount: 2 };
		const query = { innerJoinAndSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), take: vi.fn(), getMany: vi.fn().mockResolvedValue([event]) };
		for (const key of ['innerJoinAndSelect', 'where', 'andWhere', 'orderBy', 'take'] as const) query[key].mockReturnValue(query);
		const events = { createQueryBuilder: () => query, update: vi.fn().mockResolvedValue(undefined) };
		const library = { find: vi.fn().mockResolvedValue([{ userId: 'subscriber' }]) };
		const notification = { createNotificationAndWait: vi.fn().mockRejectedValueOnce(new Error('Redis down')).mockResolvedValue(undefined) };
		const service = new ZalipCatalogService({ getRepository: (model: unknown) => model === MiZalipAllohaAvailabilityEvent ? events : library } as never, {} as never, {} as never, notification as never);
		await expect(service.dispatchPendingAllohaAvailabilityNotifications()).rejects.toThrow('Redis down');
		expect(events.update).not.toHaveBeenCalled();
		await service.dispatchPendingAllohaAvailabilityNotifications();
		expect(library.find).toHaveBeenCalledWith({ select: { userId: true }, where: { workId: 'movie', isReleaseSubscribed: true } });
		expect(notification.createNotificationAndWait).toHaveBeenCalledWith('subscriber', 'zalipAllohaAvailable', { workId: 'movie', workSlug: 'movie', workTitle: 'Movie', seasonNumber: null, episodeNumber: null, translationCount: 2 });
		expect(events.update).toHaveBeenCalledExactlyOnceWith('event', { notificationDeliveredAt: expect.any(Date) });
	});

	it('deduplicates movie availability independently of translation changes', async () => {
		const repository = { existsBy: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true), create: vi.fn(value => value), save: vi.fn() };
		const service = new ZalipCatalogService({ getRepository: () => repository } as never, { gen: () => 'event' } as never, {} as never, {} as never);
		const input = { workId: 'movie', seasonNumber: null, episodeNumber: null, translationCount: 1, suppressNotification: false };
		expect(await service.recordAllohaAvailability(input)).toBe(true);
		expect(await service.recordAllohaAvailability({ ...input, translationCount: 3 })).toBe(false);
		expect(repository.save).toHaveBeenCalledOnce();
		expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ availabilityKey: 'movie', notificationDeliveredAt: null }));
	});
	it('clears only the list status, preserving ratings, progress, favorites and subscriptions', async () => {
		const work = { id: 'work-1', publicationState: 'published' };
		const entry = { userId: 'viewer', workId: work.id, status: 'watching', episodesWatched: 4, personalRating: 8, isFavorite: true, isReleaseSubscribed: true };
		const library = { findOneBy: vi.fn().mockResolvedValue(entry), save: vi.fn().mockImplementation(async value => value) };
		const works = { findOneBy: vi.fn().mockResolvedValue(work) };
		const db = { getRepository: (model: unknown) => model === MiZalipWork ? works : library };
		const service = new ZalipCatalogService(db as never, {} as never, {} as never, {} as never);
		vi.spyOn(service as unknown as { packWorksWithCommunityRatings: () => Promise<unknown[]> }, 'packWorksWithCommunityRatings').mockResolvedValue([work]);

		const result = await service.updateLibrary({ id: 'viewer' } as never, work.id, { status: null });
		expect(library.findOneBy).toHaveBeenCalledWith({ userId: 'viewer', workId: work.id });
		expect(result).toMatchObject({ status: null, episodesWatched: 4, personalRating: 8, isFavorite: true, isReleaseSubscribed: true });
		expect(library.save).toHaveBeenCalledWith(expect.objectContaining({ status: null, personalRating: 8 }));
	});

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
			query: vi.fn().mockResolvedValue([{ workId: 'work-1', communityRating: 8.4, ratingCount: 7 }]),
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

		await expect(service.listPublished(12, { genres: ['  Драма  ', 'Криминал'], kinds: ['series'], query: 'Example', yearFrom: 2020, yearTo: 2030 })).resolves.toEqual([expect.objectContaining({
			id: 'work-1',
			genres: ['Драма'],
			communityRating: 8.4,
			ratingCount: 7,
		})]);
		expect(query.andWhere).toHaveBeenCalledWith('work.genres @> CAST(:genres AS jsonb)', { genres: '["Драма","Криминал"]' });
		expect(query.andWhere).toHaveBeenCalledWith('work.kind IN (:...kinds)', { kinds: ['series'] });
		expect(query.andWhere).toHaveBeenCalledWith('work.releaseYear >= :yearFrom', { yearFrom: 2020 });
		expect(query.andWhere).toHaveBeenCalledWith('work.releaseYear <= :yearTo', { yearTo: 2030 });
		expect(query.take).toHaveBeenCalledWith(12);
	});

	it('accepts up to 40 catalogue genres and rejects a larger set', async () => {
		const query = {
			where: vi.fn().mockReturnThis(),
			andWhere: vi.fn().mockReturnThis(),
			orderBy: vi.fn().mockReturnThis(),
			addOrderBy: vi.fn().mockReturnThis(),
			take: vi.fn().mockReturnThis(),
			getMany: vi.fn().mockResolvedValue([]),
		};
		const worksRepository = { createQueryBuilder: vi.fn().mockReturnValue(query) };
		const service = new ZalipCatalogService({
			getRepository: (model: unknown) => {
				if (model === MiZalipWork) return worksRepository;
				throw new Error('Unexpected repository');
			},
		} as never, {} as never, {} as never, {} as never);
		const genres = Array.from({ length: 40 }, (_, index) => `Жанр ${index + 1}`);

		await expect(service.listPublished(12, { genres })).resolves.toEqual([]);
		expect(query.andWhere).toHaveBeenCalledWith('work.genres @> CAST(:genres AS jsonb)', { genres: JSON.stringify(genres) });
		await expect(service.listPublished(12, { genres: [...genres, 'Лишний жанр'] })).resolves.toEqual([]);
		expect(worksRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
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
			query: vi.fn().mockResolvedValue([{ workId: 'work-2', communityRating: '7.5', ratingCount: '2' }]),
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
			communityRating: 7.5,
			ratingCount: 2,
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
			findOne: vi.fn().mockResolvedValue(work),
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
