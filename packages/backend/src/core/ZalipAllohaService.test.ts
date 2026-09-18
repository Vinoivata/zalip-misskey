/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZalipAllohaService } from '@/core/ZalipAllohaService.js';

describe('ZalipAllohaService', () => {
	afterEach(() => {
		delete process.env.ZALIP_ALLOHA_API_TOKEN;
		delete process.env.ZALIP_ALLOHA_IFRAME_HOSTS;
	});

	it('records a new provider episode and queues native Zalip delivery after the baseline', async () => {
		process.env.ZALIP_ALLOHA_API_TOKEN = 'test-token';
		const getJson = vi.fn()
			.mockResolvedValueOnce({ data: {
				category: { slug: 'serial' },
				iframe: 'https://ascorbic-as.stravers.live/embed/title',
				translations: [{ id: 2, name: 'Studio', quality: '1080p', resolutions: ['1080p'], iframe: 'https://ascorbic-as.stravers.live/embed/title?translation=2' }],
			} })
			.mockResolvedValueOnce({ data: [{
				season: 1,
				episode: 4,
				translation: { id: 2 },
				ids: { tmdb: 5715 },
				category: { slug: 'serial' },
			}], meta: { has_more: false } });
		const catalog = {
			listAllohaSyncTargets: vi.fn().mockResolvedValue([{ workId: 'work-1', tmdbMediaType: 'tv', tmdbId: 5715 }]),
			upsertAllohaSource: vi.fn().mockResolvedValue({ created: false }),
			recordAllohaAvailability: vi.fn().mockResolvedValue(true),
			dispatchPendingAllohaAvailabilityNotifications: vi.fn().mockResolvedValue(undefined),
		};

		const result = await new ZalipAllohaService({ getJson } as never, catalog as never).sync();

		expect(result).toEqual({ kind: 'synced', checked: 1, available: 1, events: 1 });
		expect(getJson).toHaveBeenCalledTimes(2);
		expect(catalog.upsertAllohaSource).toHaveBeenCalledWith(expect.objectContaining({
			workId: 'work-1',
			isAvailable: true,
			translations: [expect.objectContaining({ id: 2, name: 'Studio' })],
		}));
		expect(catalog.recordAllohaAvailability).toHaveBeenCalledWith({
			workId: 'work-1', seasonNumber: 1, episodeNumber: 4, translationCount: 1, suppressNotification: false,
		});
		expect(catalog.dispatchPendingAllohaAvailabilityNotifications).toHaveBeenCalledOnce();
	});

	it('uses a new provider mapping as a quiet baseline and rejects an unexpected iframe host', async () => {
		process.env.ZALIP_ALLOHA_API_TOKEN = 'test-token';
		const getJson = vi.fn()
			.mockResolvedValueOnce({ data: {
				category: { slug: 'movie' },
				iframe: 'https://unexpected.example/player',
				translations: [],
			} })
			.mockResolvedValueOnce({ data: [{
				season: null,
				episode: null,
				translation: { id: 1 },
				ids: { tmdb: 1101383 },
				category: { slug: 'movie' },
			}], meta: { has_more: false } });
		const catalog = {
			listAllohaSyncTargets: vi.fn().mockResolvedValue([{ workId: 'work-2', tmdbMediaType: 'movie', tmdbId: 1101383 }]),
			upsertAllohaSource: vi.fn().mockResolvedValue({ created: true }),
			recordAllohaAvailability: vi.fn().mockResolvedValue(true),
			dispatchPendingAllohaAvailabilityNotifications: vi.fn().mockResolvedValue(undefined),
		};

		await new ZalipAllohaService({ getJson } as never, catalog as never).sync();

		expect(catalog.upsertAllohaSource).toHaveBeenCalledWith(expect.objectContaining({
			workId: 'work-2', isAvailable: false, iframe: null, translations: [],
		}));
		expect(catalog.recordAllohaAvailability).toHaveBeenCalledWith({
			workId: 'work-2', seasonNumber: null, episodeNumber: null, translationCount: 1, suppressNotification: true,
		});
	});
});
