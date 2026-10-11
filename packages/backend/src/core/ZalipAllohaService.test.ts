/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZalipAllohaService } from '@/core/ZalipAllohaService.js';
import type { ImportProviderConfig } from '@/core/zalip-importer/providers.js';

const isolated = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock('@/core/HttpRequestService.js', () => ({ HttpRequestService: class {} }));
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));
vi.mock('@/core/ZalipImporterSourceSettingsService.js', () => ({ ZalipImporterSourceSettingsService: class {} }));
vi.mock('@/core/zalip-importer/providers.js', async original => ({ ...await original<typeof import('@/core/zalip-importer/providers.js')>(), createConfiguredImportTransport: () => isolated.transport }));

function service(getJson: (url: string, accept?: string, headers?: Record<string, string>) => Promise<unknown>, catalog: unknown, config: ImportProviderConfig = { allohaApiToken: 'test-token' }) {
	isolated.transport.mockImplementation((url, headers) => getJson(url, 'application/json, */*', headers));
	const settings = { getRuntime: vi.fn().mockResolvedValue(config) };
	return { instance: new ZalipAllohaService({ getJson } as never, catalog as never, settings as never), settings };
}

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

		const result = await service(getJson, catalog).instance.sync();

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

		await service(getJson, catalog).instance.sync();

		expect(catalog.upsertAllohaSource).toHaveBeenCalledWith(expect.objectContaining({
			workId: 'work-2', isAvailable: false, iframe: null, translations: [],
		}));
		expect(catalog.recordAllohaAvailability).not.toHaveBeenCalled();
	});

	it('records an available movie atomically with its source even outside the recent feed', async () => {
		process.env.ZALIP_ALLOHA_API_TOKEN = 'test-token';
		const getJson = vi.fn()
			.mockResolvedValueOnce({ data: { category: { slug: 'movie' }, iframe: 'https://ascorbic-as.stravers.live/embed/movie', translations: [] } })
			.mockResolvedValueOnce({ data: [], meta: { has_more: false } });
		const catalog = {
			listAllohaSyncTargets: vi.fn().mockResolvedValue([{ workId: 'movie', tmdbMediaType: 'movie', tmdbId: 2024 }]),
			upsertAllohaSource: vi.fn().mockResolvedValue({ created: false, movieEventCreated: true }),
			recordAllohaAvailability: vi.fn().mockResolvedValue(true),
			dispatchPendingAllohaAvailabilityNotifications: vi.fn().mockResolvedValue(undefined),
		};
		const result = await service(getJson, catalog).instance.sync();
		expect(result).toEqual({ kind: 'synced', checked: 1, available: 1, events: 1 });
		expect(catalog.upsertAllohaSource).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ workId: 'movie', isAvailable: true, recordMovieAvailability: true }));
		expect(catalog.recordAllohaAvailability).not.toHaveBeenCalled();
		expect(catalog.dispatchPendingAllohaAvailabilityNotifications).toHaveBeenCalledOnce();
	});

	it('retries pending deliveries even if the latest upstream feed fails', async () => {
		process.env.ZALIP_ALLOHA_API_TOKEN = 'test-token';
		const catalog = {
			listAllohaSyncTargets: vi.fn().mockResolvedValue([]),
			dispatchPendingAllohaAvailabilityNotifications: vi.fn().mockResolvedValue(undefined),
		};
		await expect(service(vi.fn().mockRejectedValue(new Error('Upstream unavailable')), catalog).instance.sync()).resolves.toEqual({ kind: 'upstream-failure' });
		expect(catalog.dispatchPendingAllohaAvailabilityNotifications).toHaveBeenCalledOnce();
	});

	it('adopts rotated API credentials, origins and explicit public iframe tokens on the next pass', async () => {
		const getJson = vi.fn().mockImplementation(async (url: string) => new URL(url).pathname.endsWith('/latest') ? { data: [], meta: { has_more: false } } : { data: { category: { slug: 'movie' }, iframe: 'https://ascorbic-as.stravers.live/embed/movie?token_movie=title-public&token=provider-placeholder', translations: [] } });
		const catalog = { listAllohaSyncTargets: vi.fn().mockResolvedValue([{ workId: 'movie', tmdbMediaType: 'movie', tmdbId: 42 }]), upsertAllohaSource: vi.fn().mockResolvedValue({ created: false, movieEventCreated: false }), dispatchPendingAllohaAvailabilityNotifications: vi.fn() };
		const { instance, settings } = service(getJson, catalog);
		settings.getRuntime.mockResolvedValueOnce({ allohaApiToken: 'synthetic-api-one', apiOrigins: { alloha: 'https://api-one.zalip.org' }, allohaPlayerOrigin: 'https://player-one.zalip.org', allohaPlayerToken: 'synthetic-public-one' });
		settings.getRuntime.mockResolvedValueOnce({ allohaApiToken: 'synthetic-api-two', apiOrigins: { alloha: 'https://api-two.zalip.org' }, allohaPlayerOrigin: 'https://player-two.zalip.org', allohaPlayerToken: 'synthetic-public-two' });
		await expect(instance.sync()).resolves.toMatchObject({ kind: 'synced', events: 0 });
		await expect(instance.sync()).resolves.toMatchObject({ kind: 'synced', events: 0 });
		expect(settings.getRuntime).toHaveBeenCalledTimes(2);
		for (const [index, suffix] of [[0, 'one'], [2, 'two']] as const) {
			expect(new URL(getJson.mock.calls[index][0]).origin).toBe(`https://api-${suffix}.zalip.org`);
			expect(getJson.mock.calls[index][2]).toEqual({ Authorization: `Bearer synthetic-api-${suffix}` });
			const iframe = new URL(catalog.upsertAllohaSource.mock.calls[index / 2][0].iframe);
			expect(iframe.origin).toBe(`https://player-${suffix}.zalip.org`);
			expect(iframe.searchParams.get('token')).toBe(`synthetic-public-${suffix}`);
			expect(iframe.searchParams.get('token_movie')).toBe('title-public');
		}
	});

	it('makes no request or cache changes when the source is explicitly disabled', async () => {
		const getJson = vi.fn(), catalog = { listAllohaSyncTargets: vi.fn() };
		await expect(service(getJson, catalog, {}).instance.sync()).resolves.toEqual({ kind: 'not-configured' });
		expect(getJson).not.toHaveBeenCalled();
		expect(catalog.listAllohaSyncTargets).not.toHaveBeenCalled();
	});

	it('preserves cached playback when the provider detail belongs to another TMDB namespace', async () => {
		const getJson = vi.fn().mockResolvedValueOnce({ data: { category: { slug: 'serial' }, iframe: 'https://ascorbic-as.stravers.live/embed/other', translations: [] } }).mockResolvedValueOnce({ data: [], meta: { has_more: false } });
		const catalog = { listAllohaSyncTargets: vi.fn().mockResolvedValue([{ workId: 'movie', tmdbMediaType: 'movie', tmdbId: 42 }]), upsertAllohaSource: vi.fn(), dispatchPendingAllohaAvailabilityNotifications: vi.fn() };
		await expect(service(getJson, catalog).instance.sync()).resolves.toMatchObject({ checked: 0, available: 0 });
		expect(catalog.upsertAllohaSource).not.toHaveBeenCalled();
	});
});
