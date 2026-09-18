/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { HttpRequestService } from '@/core/HttpRequestService.js';
import { StatusError } from '@/misc/status-error.js';
import { ZalipCatalogService, type ZalipAllohaSyncTarget } from '@/core/ZalipCatalogService.js';
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

const ALLOHA_API_ORIGIN = 'https://apbugall.org';
const DEFAULT_IFRAME_HOSTS = ['ascorbic-as.stravers.live'];
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

function configuredIframeHosts(): Set<string> {
	const configured = process.env.ZALIP_ALLOHA_IFRAME_HOSTS
		?.split(',')
		.map(host => host.trim().toLowerCase())
		.filter(host => /^[a-z0-9.-]+$/.test(host));
	return new Set(configured != null && configured.length > 0 ? configured : DEFAULT_IFRAME_HOSTS);
}

/** Rejects malformed, non-HTTPS and non-configured provider player URLs before caching them. */
function validatedIframe(value: unknown): string | null {
	const iframe = nonEmptyString(value, 2048);
	if (iframe == null) return null;
	try {
		const parsed = new URL(iframe);
		if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '') return null;
		return configuredIframeHosts().has(parsed.hostname.toLowerCase()) ? parsed.toString() : null;
	} catch {
		return null;
	}
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

function parseTranslations(value: unknown): ZalipAllohaTranslation[] {
	if (!Array.isArray(value)) return [];
	const translations: ZalipAllohaTranslation[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (typeof item !== 'object' || item == null) continue;
		const response = item as AllohaTranslationResponse;
		const id = positiveInteger(response.id);
		const name = nonEmptyString(response.name, 256);
		const iframe = validatedIframe(response.iframe);
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

function parseDetail(response: AllohaDetailResponse): AllohaProviderDetail | null {
	const detail = response.data;
	if (detail == null || typeof detail !== 'object') return null;
	const category = nonEmptyString(detail.category?.slug, 24);
	if (category == null) return null;
	return {
		category,
		iframe: validatedIframe(detail.iframe),
		translations: parseTranslations(detail.translations),
	};
}

@Injectable()
export class ZalipAllohaService {
	constructor(
		private httpRequestService: HttpRequestService,
		private zalipCatalogService: ZalipCatalogService,
	) {
	}

	private get accessToken(): string | null {
		const token = process.env.ZALIP_ALLOHA_API_TOKEN?.trim();
		return token != null && token !== '' ? token : null;
	}

	private async getDetail(target: ZalipAllohaSyncTarget, token: string): Promise<AllohaProviderDetail | 'not-found' | 'failure'> {
		const url = new URL(`/v2/movies/tmdb/${target.tmdbId}`, ALLOHA_API_ORIGIN);
		url.searchParams.set('category', providerCategory(target));
		try {
			const response = await this.httpRequestService.getJson<AllohaDetailResponse>(url.toString(), 'application/json, */*', {
				Authorization: `Bearer ${token}`,
			});
			const detail = parseDetail(response);
			return detail ?? 'failure';
		} catch (err) {
			return err instanceof StatusError && err.statusCode === 404 ? 'not-found' : 'failure';
		}
	}

	private async getRecentAvailability(token: string): Promise<AllohaLatestItem[] | null> {
		const result: AllohaLatestItem[] = [];
		for (let page = 1; page <= MAX_LATEST_PAGES; page++) {
			const url = new URL('/v2/movies/latest', ALLOHA_API_ORIGIN);
			url.searchParams.set('days', '1');
			url.searchParams.set('page', page.toString());
			let response: AllohaLatestResponse;
			try {
				response = await this.httpRequestService.getJson<AllohaLatestResponse>(url.toString(), 'application/json, */*', {
					Authorization: `Bearer ${token}`,
				});
			} catch {
				return null;
			}
			if (!Array.isArray(response.data)) return null;
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
		const token = this.accessToken;
		if (token == null) return { kind: 'not-configured' };

		const targets = await this.zalipCatalogService.listAllohaSyncTargets(MAX_SYNC_TARGETS);
		const newlyMappedWorkIds = new Set<string>();
		let available = 0;
		let detailFailures = 0;
		for (const target of targets) {
			const detail = await this.getDetail(target, token);
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
			if (source.isAvailable) available++;
			const result = await this.zalipCatalogService.upsertAllohaSource({ workId: target.workId, ...source });
			if (result.created) newlyMappedWorkIds.add(target.workId);
		}

		const latest = await this.getRecentAvailability(token);
		if (latest == null) return { kind: 'upstream-failure' };

		let events = 0;
		for (const item of latest) {
			const tmdbId = positiveInteger(item.ids?.tmdb);
			if (tmdbId == null) continue;
			for (const target of targets) {
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
