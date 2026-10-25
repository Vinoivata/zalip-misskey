/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NotificationEntityService } from '@/core/entities/NotificationEntityService.js';
import type { MiNotification } from '@/models/Notification.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { packedNotificationSchema } from '@/models/json-schema/notification.js';

type ReleaseNotification = Extract<MiNotification, { type: 'zalipEpisodeReleased' | 'zalipAllohaAvailable' }>;
type WorkLookup = { where: { id: { value: string[] }; publicationState: string }; select: Record<string, boolean> };

function release(type: ReleaseNotification['type'] = 'zalipEpisodeReleased', workId = 'work'): ReleaseNotification {
	const common = { id: `event-${workId}-${type}`, createdAt: '2026-10-26T10:00:00.000Z', workId, workSlug: `title-${workId}`, workTitle: 'Original notification title', seasonNumber: 0, episodeNumber: 1 };
	return type === 'zalipEpisodeReleased'
		? { ...common, type, episodeTitle: 'Special' }
		: { ...common, type, translationCount: 4 };
}

function work(id = 'work', publicationState: MiZalipWork['publicationState'] = 'published', posterPath: string | null = '/current.jpg'): MiZalipWork {
	return { id, publicationState, posterPath } as MiZalipWork;
}

function fixture(works: MiZalipWork[] = [work()]) {
	const find = vi.fn(async (options: WorkLookup) => works.filter(value => options.where.id.value.includes(value.id) && value.publicationState === options.where.publicationState));
	const db = { getRepository: vi.fn((model: unknown) => {
		expect(model).toBe(MiZalipWork);
		return { find };
	}) };
	const catalogue = { nativePosterThumbnails: vi.fn(async (_works: readonly MiZalipWork[]) => new Map<string, string>()) };
	const userEntityService = { packMany: vi.fn(async () => []) };
	const noteEntityService = { packMany: vi.fn(async () => []) };
	const services = { UserEntityService: userEntityService, NoteEntityService: noteEntityService, RoleEntityService: {}, ChatEntityService: {}, ZalipCatalogService: catalogue };
	const moduleRef = { get: (name: keyof typeof services) => services[name] };
	const cache = { userMutingsCache: { fetch: vi.fn(async () => new Set<string>()) }, userProfileCache: { fetch: vi.fn(async () => ({ mutedInstances: [] })) } };
	const service = new NotificationEntityService(moduleRef as never, {} as never, {} as never, {} as never, cache as never, db as never);
	service.onModuleInit();
	return { service, find, db, catalogue };
}

describe('current public title artwork on native release notifications', () => {
	it.each(['zalipEpisodeReleased', 'zalipAllohaAvailable'] as const)('projects the current poster and native rendition without changing the %s event', async type => {
		const f = fixture();
		f.catalogue.nativePosterThumbnails.mockResolvedValue(new Map([['work', 'https://local.example/files/thumbnail-current']]));
		const notification = Object.freeze({ ...release(type), posterPath: '/stale-event-poster.jpg' });
		const before = structuredClone(notification);
		const packed = await f.service.pack(notification, 'me', {});
		expect(packed).toMatchObject({ ...release(type), posterPath: '/current.jpg', posterThumbnailUrl: 'https://local.example/files/thumbnail-current' });
		expect(notification).toEqual(before);
		expect(f.find).toHaveBeenCalledOnce();
		expect(f.find.mock.calls[0][0]).toMatchObject({ where: { publicationState: 'published' }, select: { id: true, publicationState: true, posterPath: true } });
		expect(Object.keys(f.find.mock.calls[0][0].select)).toEqual(['id', 'publicationState', 'posterPath']);
	});

	it('re-reads changed and removed artwork instead of keeping an event or service cache', async () => {
		const current = work();
		const f = fixture([current]);
		const notification = release();
		expect(await f.service.pack(notification, 'me', {})).toMatchObject({ posterPath: '/current.jpg' });
		current.posterPath = '/replacement.jpg';
		expect(await f.service.pack(notification, 'me', {})).toMatchObject({ posterPath: '/replacement.jpg' });
		current.posterPath = null;
		const packed = await f.service.pack(notification, 'me', {});
		expect(packed).toMatchObject({ posterPath: null });
		expect(packed).not.toHaveProperty('posterThumbnailUrl');
	});

	it.each(['draft', 'archived', 'deleted'] as const)('does not expose the image of a currently %s title, including a legacy snapshot', async state => {
		const f = fixture(state === 'deleted' ? [] : [work('work', state, '/private.jpg')]);
		const notification = Object.freeze({ ...release(), posterPath: '/stale.jpg', posterThumbnailUrl: '/stale-small.jpg' });
		const packed = await f.service.pack(notification, 'me', {});
		expect(packed).toMatchObject(release());
		expect(packed).not.toHaveProperty('posterPath');
		expect(packed).not.toHaveProperty('posterThumbnailUrl');
		expect(f.catalogue.nativePosterThumbnails).not.toHaveBeenCalled();
	});

	it('loads repeated releases in bounded unique batches, preserving order and episode context', async () => {
		const works = Array.from({ length: 205 }, (_, index) => work(`work${index}`));
		const f = fixture(works);
		const notifications = [...works.map(value => release('zalipEpisodeReleased', value.id)), ...works.slice(0, 10).map(value => release('zalipAllohaAvailable', value.id))];
		const packed = await f.service.packMany(notifications, 'me');
		expect(f.find).toHaveBeenCalledTimes(3);
		expect(f.find.mock.calls.map(([options]) => options.where.id.value.length)).toEqual([100, 100, 5]);
		expect(f.catalogue.nativePosterThumbnails).toHaveBeenCalledExactlyOnceWith(works);
		expect(packed.map(value => value.id)).toEqual(notifications.map(value => value.id));
		for (let index = 0; index < packed.length; index++) {
			expect(packed[index]).toMatchObject({ ...notifications[index], posterPath: '/current.jpg' });
		}
	});

	it('keeps missing batch images absent without falling back to per-notification lookups', async () => {
		const f = fixture([work('visible'), work('hidden', 'draft')]);
		const notifications = [release('zalipEpisodeReleased', 'visible'), release('zalipAllohaAvailable', 'hidden'), release('zalipEpisodeReleased', 'deleted')];
		const packed = await f.service.packGroupedMany(notifications, 'me');
		expect(f.find).toHaveBeenCalledOnce();
		expect(packed).toHaveLength(3);
		expect(packed[0]).toMatchObject({ posterPath: '/current.jpg' });
		for (const value of packed.slice(1)) {
			expect(value).not.toHaveProperty('posterPath');
			expect(value).not.toHaveProperty('posterThumbnailUrl');
		}
	});

	it('does not look up artwork for empty or unrelated notification lists', async () => {
		const f = fixture();
		await expect(f.service.packMany([], 'me')).resolves.toEqual([]);
		const notification: MiNotification = { type: 'test', id: 'test', createdAt: '2026-10-26T10:00:00.000Z' };
		await expect(f.service.pack(notification, 'me', {})).resolves.toEqual(notification);
		await expect(f.service.packMany([notification], 'me')).resolves.toEqual([notification]);
		expect(f.db.getRepository).not.toHaveBeenCalled();
		expect(f.catalogue.nativePosterThumbnails).not.toHaveBeenCalled();
	});

	it('adds optional nullable image fields only to the two existing release variants', () => {
		const withPosters = packedNotificationSchema.oneOf.filter(schema => 'posterPath' in schema.properties);
		expect(withPosters.map(schema => schema.properties.type.enum[0])).toEqual(['zalipEpisodeReleased', 'zalipAllohaAvailable']);
		for (const schema of withPosters) {
			expect(schema.properties).toMatchObject({
				posterPath: { type: 'string', optional: true, nullable: true },
				posterThumbnailUrl: { type: 'string', optional: true, nullable: true },
			});
		}
	});
});
