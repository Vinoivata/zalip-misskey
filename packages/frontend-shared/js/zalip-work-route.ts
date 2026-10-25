/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const playbackProviders = ['alloha', 'collaps', 'kodik', 'vibix'] as const;
export type ZalipWatchProvider = typeof playbackProviders[number];
export type ZalipWatchQuery = {
	initialSeason?: string;
	initialEpisode?: string;
	initialProvider?: ZalipWatchProvider;
	initialTranslation?: string;
};

function watchProvider(value: unknown): value is ZalipWatchProvider {
	return typeof value === 'string' && playbackProviders.includes(value as ZalipWatchProvider);
}

function watchTranslation(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Title information remains distinct from the playback route, including legacy episode links. */
export function zalipWorkRoute(slug: string, season?: number | null, episode?: number | null): string {
	const path = `/zalip/${encodeURIComponent(slug)}`;
	if (!Number.isSafeInteger(season) || season == null || season < 0 || !Number.isSafeInteger(episode) || episode == null || episode < 0) return path;
	return `${path}?season=${season}&episode=${episode}`;
}

/** Select only an episode and edition. Playback/time offsets always remain an explicit player action. */
export function zalipWatchRoute(slug: string, season?: number | null, episode?: number | null, provider?: string | null, translationId?: string | null): string {
	const path = `/zalip/${encodeURIComponent(slug)}/watch`;
	const query = new URLSearchParams();
	if (Number.isSafeInteger(season) && season != null && season >= 0 && season <= 99_999_999 && Number.isSafeInteger(episode) && episode != null && episode >= 0 && episode <= 99_999_999) {
		query.set('season', String(season));
		query.set('episode', String(episode));
	}
	if (watchProvider(provider)) {
		query.set('provider', provider);
		if (watchTranslation(translationId)) query.set('translation', translationId);
	}
	return query.size ? `${path}?${query}` : path;
}

/** Preserve bad numeric input so the work view can show an unavailable-episode error. */
export function parseZalipWatchQuery(fullPath: string): ZalipWatchQuery {
	const start = fullPath.indexOf('?');
	const hash = fullPath.indexOf('#');
	if (start < 0 || (hash >= 0 && hash < start)) return {};
	const query = new URLSearchParams(fullPath.slice(start + 1, hash >= 0 ? hash : undefined));
	const rawNumber = (name: string): string | undefined => {
		const values = query.getAll(name);
		// Repeated numeric selectors are intentionally malformed, rather than silently picking a value.
		return values.length > 1 ? values.join(',') : values[0];
	};
	const providers = query.getAll('provider');
	const translations = query.getAll('translation');
	return {
		initialSeason: rawNumber('season'),
		initialEpisode: rawNumber('episode'),
		initialProvider: providers.length === 1 && watchProvider(providers[0]) ? providers[0] : undefined,
		initialTranslation: translations.length === 1 && watchTranslation(translations[0]) ? translations[0] : undefined,
	};
}

export function zalipEpisodeQuery(value: string | undefined, minimum: 0 | 1): number | null {
	if (value == null || !/^\d{1,8}$/.test(value)) return null;
	const number = Number(value);
	return Number.isSafeInteger(number) && number >= minimum ? number : null;
}
