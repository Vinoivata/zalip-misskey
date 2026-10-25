/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ModuleRef } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import type { ExistingProvider, Provider } from '@nestjs/common';
import { CoreModule } from '@/core/CoreModule.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { NotificationEntityService } from '@/core/entities/NotificationEntityService.js';
import { MiZalipWork } from '@/models/ZalipWork.js';

describe('native notification catalogue dependency registration', () => {
	it('resolves the actual exported CoreModule alias through Nest ModuleRef without a constructor dependency cycle', async () => {
		const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CoreModule) as Provider[];
		const alias = providers.find((provider): provider is ExistingProvider => typeof provider === 'object' && 'provide' in provider && provider.provide === 'ZalipCatalogService');
		expect(alias).toEqual({ provide: 'ZalipCatalogService', useExisting: ZalipCatalogService });
		expect(Reflect.getMetadata(MODULE_METADATA.EXPORTS, CoreModule)).toContain(alias);
		if (!alias) throw new Error('The native notification catalogue alias must be registered');
		const work = { id: 'work', publicationState: 'published', posterPath: '/current.jpg' } as MiZalipWork;
		const catalogue = { nativePosterThumbnails: vi.fn(async () => new Map<string, string>()) };
		const db = { getRepository: vi.fn(() => ({ find: vi.fn(async () => [work]) })) };
		const cache = { userMutingsCache: { fetch: async () => new Set() }, userProfileCache: { fetch: async () => ({ mutedInstances: [] }) } };
		const app = await Test.createTestingModule({
			providers: [
				{ provide: ZalipCatalogService, useValue: catalogue },
				alias,
				...['UserEntityService', 'NoteEntityService', 'RoleEntityService', 'ChatEntityService'].map(provide => ({ provide, useValue: {} })),
				{ provide: NotificationEntityService, inject: [ModuleRef], useFactory: (moduleRef: ModuleRef) => new NotificationEntityService(moduleRef, {} as never, {} as never, {} as never, cache as never, db as never) },
			],
		}).compile();
		try {
			await app.init();
			expect(app.get<ModuleRef>(ModuleRef).get('ZalipCatalogService')).toBe(catalogue);
			const service = app.get(NotificationEntityService);
			await expect(service.pack({ type: 'zalipEpisodeReleased', id: 'release', createdAt: '2026-10-26T00:00:00Z', workId: 'work', workSlug: 'work', workTitle: 'Work', seasonNumber: 1, episodeNumber: 1, episodeTitle: 'First' }, 'owner', {})).resolves.toMatchObject({ posterPath: '/current.jpg' });
			expect(catalogue.nativePosterThumbnails).toHaveBeenCalledExactlyOnceWith([work]);
		} finally {
			await app.close();
		}
	});
});
