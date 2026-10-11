/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { ZalipCatalogService, type ZalipAllohaSyncTarget } from '@/core/ZalipCatalogService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { configuredImportPlayerUrl, createConfiguredImportTransport, createImportRequest, ImportProviderError, type ImportProviderConfig } from '@/core/zalip-importer/providers.js';
import type { ZalipAllohaTranslation } from '@/models/ZalipAllohaSource.js';

type AllohaCategory = {
	slug?: unknown;
};

type AllohaTranslationResponse = {
	id?: unknown;
	name?: unknown;
	quality?: unknown;
	resolutions?: unknown;
	iframe?: unknown;
};

type AllohaDetail = {
	category?: AllohaCategory;
	iframe?: unknown;
	translations?: unknown;
};

type AllohaDetailResponse = {
	data?: AllohaDetail;
};

type AllohaLatestItem = {
	season?: unknown;
	episode?: unknown;
	translation?: { id?: unknown };
	ids?: { tmdb?: unknown };
	category?: AllohaCategory;
};

type AllohaLatestResponse = {
	data?: unknown;
	meta?: { has_more?: unknown };
};

type AllohaProviderDetail = {
	category: string;
	iframe: string | null;
	translations: ZalipAllohaTranslation[];
};

export type ZalipAllohaSyncResult =
	| { kind: 'synced'; checked: number; available: number; events: number; }
	| { kind: 'not-configured'; }
	| { kind: 'upstream-failure'; };

const MAX_SYNC_TARGETS = 100;
const MAX_LATEST_PAGES = 10;

function nonEmptyString(value: unknown, maxLength: number): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function positiveInteger(value: unknown): number | null {
	if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
	if (typeof value === 'string' && /^\d+$/.test(value)) {
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
	}
	return null;
}

function episodeNumber(value: unknown): number | null {
	const parsed = positiveInteger(value);
	return parsed != null && parsed <= 100000 ? parsed : null;
}

function providerCategory(target: ZalipAllohaSyncTarget): string {
	return target.tmdbMediaType === 'movie' ? 'movie' : 'serial';
}

function matchesTargetCategory(target: ZalipAllohaSyncTarget, category: unknown): boolean {
	const slug = typeof category === 'object' && category != null
		? nonEmptyString((category as AllohaCategory).slug, 24)
		: null;
	if (target.tmdbMediaType === 'movie') return slug === 'movie';
	return slug != null && slug !== 'movie';
}

function parseTranslations(value: unknown, config: ImportProviderConfig): ZalipAllohaTranslation[] {
	if (!Array.isArray(value)) return [];
	const translations: ZalipAllohaTranslation[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (typeof item !== 'object' || item == null) continue;
		const response = item as AllohaTranslationResponse;
		const id = positiveInteger(response.id);
		const name = nonEmptyString(response.name, 256);
		const iframe = configuredImportPlayerUrl(response.iframe, 'alloha', config);
		if (id == null || name == null || iframe == null || seen.has(id)) continue;
		const resolutions = Array.isArray(response.resolutions)
			? [...new Set(response.resolutions.map(value => nonEmptyString(value, 32)).filter((value): value is string => value != null))].slice(0, 12)
			: [];
		translations.push({
			id,
			name,
			quality: nonEmptyString(response.quality, 64),
			resolutions,
			iframe,
		});
		seen.add(id);
		if (translations.length >= 40) break;
	}
	return translations;
}

function parseDetail(response: AllohaDetailResponse, config: ImportProviderConfig): AllohaProviderDetail | null {
	const detail = response.data;
	if (detail == null || typeof detail !== 'object') return null;
	const category = nonEmptyString(detail.category?.slug, 24);
	if (category == null) return null;
	return {
		category,
		iframe: configuredImportPlayerUrl(detail.iframe, 'alloha', config),
		translations: parseTranslations(detail.translations, config),
	};
}

@Injectable()
export class ZalipAllohaService {
	constructor(
		_httpRequestService: HttpRequestService,
		private zalipCatalogService: ZalipCatalogService,
		private sourceSettings: ZalipImporterSourceSettingsService,
	) {
	}

	private async getDetail(target: ZalipAllohaSyncTarget, request: ReturnType<typeof createImportRequest>, config: ImportProviderConfig): Promise<AllohaProviderDetail | 'not-found' | 'failure'> {
		try {
			const response = await request(`/v2/movies/tmdb/${target.tmdbId}`, { category: providerCategory(target) }) as AllohaDetailResponse;
			const detail = parseDetail(response, config);
			return detail && matchesTargetCategory(target, { slug: detail.category }) ? detail : 'failure';
		} catch (err) {
			return err instanceof ImportProviderError && err.code === 'not-found' ? 'not-found' : 'failure';
		}
	}

	private async getRecentAvailability(request: ReturnType<typeof createImportRequest>): Promise<AllohaLatestItem[] | null> {
		const result: AllohaLatestItem[] = [];
		for (let page = 1; page <= MAX_LATEST_PAGES; page++) {
			let response: AllohaLatestResponse;
			try {
				response = await request('/v2/movies/latest', { days: '1', page: page.toString() }) as AllohaLatestResponse;
			} catch {
				return null;
			}
			if (response == null || typeof response !== 'object' || !Array.isArray(response.data)) return null;
			for (const item of response.data) {
				if (typeof item === 'object' && item != null) result.push(item as AllohaLatestItem);
			}
			if (response.meta?.has_more !== true) break;
		}
		return result;
	}

	/**
	 * Refreshes the local provider cache and uses Alloha's recent-file feed as the notification
	 * source. The first cache pass establishes a silent baseline; only later provider arrivals
	 * notify people already following the title in their single Zalip library.
	 */
	public async sync(): Promise<ZalipAllohaSyncResult> {
		// One immutable snapshot per pass: configuration changes take effect on the next sync.
		let config: ImportProviderConfig;
		let request: ReturnType<typeof createImportRequest>;
		try {
			config = await this.sourceSettings.getRuntime();
			if (!config.allohaApiToken?.trim()) return { kind: 'not-configured' };
			request = createImportRequest('alloha', config.allohaApiToken, createConfiguredImportTransport(config), config.apiOrigins?.alloha);
		} catch {
			return { kind: 'upstream-failure' };
		}

		const targets = await this.zalipCatalogService.listAllohaSyncTargets(MAX_SYNC_TARGETS);
		const newlyMappedWorkIds = new Set<string>();
		const availableWorkIds = new Set<string>();
		let available = 0;
		let detailFailures = 0;
		let events = 0;
		for (const target of targets) {
			const detail = await this.getDetail(target, request, config);
			// A broken response for one title must not prevent availability events for
			// every other title from reaching subscribers.
			if (detail === 'failure') {
				detailFailures++;
				continue;
			}
			const source = detail === 'not-found'
				? { category: providerCategory(target), isAvailable: false, iframe: null, translations: [] }
				: {
					category: detail.category,
					isAvailable: detail.iframe != null || detail.translations.length > 0,
					iframe: detail.iframe,
					translations: detail.translations,
				};
			if (source.isAvailable) {
				available++;
				availableWorkIds.add(target.workId);
			}
			const result = await this.zalipCatalogService.upsertAllohaSource({ workId: target.workId, ...source, recordMovieAvailability: target.tmdbMediaType === 'movie' });
			if (result.created) newlyMappedWorkIds.add(target.workId);
			if (result.movieEventCreated) events++;
		}

		const latest = await this.getRecentAvailability(request);
		if (latest == null) {
			// Retrying durable deliveries must not depend on the current upstream feed.
			await this.zalipCatalogService.dispatchPendingAllohaAvailabilityNotifications();
			return { kind: 'upstream-failure' };
		}

		for (const item of latest) {
			const tmdbId = positiveInteger(item.ids?.tmdb);
			if (tmdbId == null) continue;
			for (const target of targets) {
				if (target.tmdbMediaType === 'movie' || !availableWorkIds.has(target.workId)) continue;
				if (target.tmdbId !== tmdbId || !matchesTargetCategory(target, item.category)) continue;
				const recorded = await this.zalipCatalogService.recordAllohaAvailability({
					workId: target.workId,
					seasonNumber: episodeNumber(item.season),
					episodeNumber: episodeNumber(item.episode),
					translationCount: positiveInteger(item.translation?.id) == null ? 0 : 1,
					suppressNotification: newlyMappedWorkIds.has(target.workId),
				});
				if (recorded) events++;
			}
		}

		await this.zalipCatalogService.dispatchPendingAllohaAvailabilityNotifications();
		return { kind: 'synced', checked: targets.length - detailFailures, available, events };
	}
}
