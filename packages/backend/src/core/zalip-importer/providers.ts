/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import fetch from 'node-fetch';
import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { Agent as HttpsAgent } from 'node:https';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { artworkCandidate } from './artwork-candidates.js';
import { validImportRef, type ExternalIdentity, type ImportCredit, type ImportEpisode, type ImportField, type ImportMediaType, type ImportPlayer, type ImportProvider, type ImportProviderStatus, type ImportRecord, type ImportRef, type ImportSearchPage, type ImportSearchResult, type ImportSource, type ImportVibixEmbed } from './types.js';

export type ImportProviderErrorCode = 'not-configured' | 'not-found' | 'quota-exceeded' | 'rate-limited' | 'upstream-failure' | 'invalid-ref' | 'unsupported' | 'malformed-response';

/** Only these safe codes leave the provider boundary; upstream messages and URLs can contain credentials. */
export class ImportProviderError extends Error {
	constructor(public readonly code: ImportProviderErrorCode, public readonly retryAfterMs?: number) {
		super(code);
		this.name = 'ImportProviderError';
	}
}

export type ImportTransportOptions = { method: 'POST' };
export type ImportTransport = (url: string, headers: Record<string, string>, options?: ImportTransportOptions) => Promise<unknown>;
export type ImportProviderConfig = {
	tmdbApiKey?: string;
	allohaApiToken?: string;
	/** Explicitly approved browser-facing embed token, separate from API authentication. */
	allohaPlayerToken?: string;
	kinopoiskApiKey?: string;
	collapsApiToken?: string;
	kodikApiToken?: string;
	vibixApiToken?: string;
	allohaIframeHosts?: string[];
	collapsIframeHosts?: string[];
	kodikIframeHosts?: string[];
	vibixIframeHosts?: string[];
	apiOrigins?: Partial<Record<ImportSource, string>>;
	allohaPlayerOrigin?: string;
	collapsPlayerOrigin?: string;
	kodikPlayerOrigin?: string;
	vibixPlayerOrigin?: string;
};

const origins: Record<ImportSource, string> = {
	tmdb: 'https://api.themoviedb.org',
	kinopoisk: 'https://kinopoiskapiunofficial.tech',
	alloha: 'https://apbugall.org',
	collaps: 'https://api.bhcesh.me',
	kodik: 'https://kodik-api.com',
	vibix: 'https://vibix.org',
};
export const defaultImportApiOrigins: Readonly<Record<ImportSource, string>> = Object.freeze({ ...origins });

export function normalizeImportApiOrigin(value: string): string {
	try {
		const url = new URL(value);
		if (value.length > 1024 || !/^https:\/\/[^\s/:@?#]+\/?$/iu.test(value) || url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || isIP(url.hostname) || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u.test(url.hostname) || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/u.test(url.hostname)) throw new Error();
		return url.origin;
	} catch { throw new ImportProviderError('invalid-ref'); }
}

export function importAddressOrigins(config: ImportProviderConfig): Record<ImportSource, string> {
	return Object.fromEntries(Object.entries(origins).map(([source, fallback]) => [source, normalizeImportApiOrigin(config.apiOrigins?.[source as ImportSource] ?? fallback)])) as Record<ImportSource, string>;
}

/** Resolve and pin the very addresses used by the socket; never connect to local/reserved networks. */
const importerHttpsAgent = new HttpsAgent({
	keepAlive: true, maxSockets: 16,
	lookup: (hostname, options, callback) => {
		void lookup(hostname, { all: true, verbatim: true }).then(addresses => {
			if (!addresses.length || addresses.some(row => ipaddr.process(row.address).range() !== 'unicast')) throw new Error('IMPORT_ADDRESS_REJECTED');
			const family = typeof options === 'number' ? options : options.family;
			const candidates = family ? addresses.filter(row => row.family === Number(family)) : addresses;
			if (!candidates.length) throw new Error('IMPORT_ADDRESS_REJECTED');
			if (typeof options === 'object' && options.all) callback(null, candidates);
			else callback(null, candidates[0].address, candidates[0].family);
		}).catch(() => callback(new Error('IMPORT_ADDRESS_REJECTED'), '', 4));
	},
});
const MAX_SEASONS = 50;
const MAX_EPISODES = 1000;
const MAX_RESULTS = 100;
const sensitiveQuery = /^(?:token|key|api[-_]?key|api[-_]?token|authorization|access[-_]?token)$/i;
const requestGates = new Map<string, { pending: Promise<void>; nextAt: number }>();
type JsonObject = Record<string, unknown>;

/** Process-wide pacing also covers simultaneous UI searches; distributed daily quotas remain in the runner. */
export function pacedImportTransport(transport: ImportTransport, intervalMs = 250): ImportTransport {
	return async (url, headers, options) => {
		const origin = new URL(url).origin;
		const gate = requestGates.get(origin) ?? { pending: Promise.resolve(), nextAt: 0 };
		requestGates.set(origin, gate);
		const turn = gate.pending.then(async () => {
			const wait = Math.max(0, gate.nextAt - Date.now());
			if (wait > 0) await new Promise<void>(resolve => setTimeout(resolve, wait));
			gate.nextAt = Date.now() + intervalMs;
		});
		gate.pending = turn.catch(() => {});
		await turn;
		return options ? transport(url, headers, options) : transport(url, headers);
	};
}

function object(value: unknown): JsonObject {
	return value != null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}

function array(value: unknown, limit = MAX_RESULTS): unknown[] {
	return Array.isArray(value) ? value.slice(0, limit) : [];
}

function text(value: unknown, limit = 256): string | null {
	if (typeof value !== 'string') return null;
	const result = value.replace(/<[^>]*>/g, '').trim();
	return result.length > 0 && result.length <= limit ? result : null;
}

function firstText(...values: unknown[]): string | null {
	for (const value of values) {
		const result = text(value);
		if (result != null) return result;
	}
	return null;
}

function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER): number | null {
	if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d{1,16}$/.test(value))) return null;
	const result = Number(value);
	return Number.isSafeInteger(result) && result >= min && result <= max ? result : null;
}

function externalId(value: unknown): string | null {
	const result = integer(value);
	return result == null ? null : String(result);
}

function imdbId(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const match = /^(?:tt)?(\d{5,12})$/.exec(value.trim());
	return match == null ? null : `tt${match[1]}`;
}

function date(value: unknown): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function year(value: unknown): number | null {
	return typeof value === 'string' && date(value) != null ? integer(value.slice(0, 4), 1888, 3000) : integer(value, 1888, 3000);
}

/** URL fields are not fetched here. Restrict browser-facing URLs and reject leaked API credentials. */
export function safeImportUrl(value: unknown, allowedHosts?: readonly string[]): string | null {
	const candidate = text(value, 2048);
	if (candidate == null) return null;
	try {
		const url = new URL(candidate);
		if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return null;
		const host = url.hostname.toLowerCase();
		if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || !host.includes('.') || /^\d+(?:\.\d+){3}$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
		if (allowedHosts != null && !allowedHosts.includes(host)) return null;
		for (const key of url.searchParams.keys()) if (sensitiveQuery.test(key)) return null;
		return url.toString();
	} catch {
		return null;
	}
}

/** Alloha requires a browser-visible embed token. Only explicit server configuration permits it. */
export function safeAllohaPlayerUrl(value: unknown, allowedHosts: readonly string[], playerToken?: string): string | null {
	if (!playerToken || !/^[A-Za-z0-9_-]{8,512}$/.test(playerToken)) return safeImportUrl(value, allowedHosts);
	if (typeof value !== 'string') return null;
	try {
		const candidate = new URL(value);
		// Never allow other credential query parameters or ambiguous duplicate token fields.
		const tokenKeys = [...candidate.searchParams.keys()].filter(key => sensitiveQuery.test(key));
		if (tokenKeys.some(key => key !== 'token') || tokenKeys.length > 1) return null;
		candidate.searchParams.delete('token');
		const safe = safeImportUrl(candidate.toString(), allowedHosts);
		if (!safe) return null;
		const result = new URL(safe);
		// Rewrite, never forward the API response's credential; token_movie remains title-specific.
		if (tokenKeys.length === 1 || result.searchParams.has('token_movie')) result.searchParams.set('token', playerToken);
		return result.toString();
	} catch {
		return null;
	}
}

export function rewriteImportPlayerOrigin(value: string, origin?: string): string {
	if (!origin) return value;
	const target = new URL(normalizeImportApiOrigin(origin));
	const result = new URL(value);
	result.protocol = target.protocol;
	result.host = target.host;
	return result.toString();
}

/** Cached player choices also adopt token/mirror changes without exposing server API credentials. */
export function configuredImportPlayerUrl(value: unknown, source: ImportPlayer['source'], config: ImportProviderConfig): string | null {
	const origin = source === 'alloha' ? config.allohaPlayerOrigin : source === 'collaps' ? config.collapsPlayerOrigin : source === 'kodik' ? config.kodikPlayerOrigin : config.vibixPlayerOrigin;
	const extraHosts = source === 'alloha' ? config.allohaIframeHosts : source === 'collaps' ? config.collapsIframeHosts : source === 'kodik' ? config.kodikIframeHosts : config.vibixIframeHosts;
	// Vibix's API can supply an empty iframe_url and an SDK tag. Do not invent an iframe host.
	const hosts = source === 'vibix' ? [...extraHosts ?? []] : configuredIframeHosts(extraHosts, source === 'alloha' ? 'ascorbic-as.stravers.live' : source === 'collaps' ? 'api.nextembed.ws' : 'kodikplayer.com');
	if (origin) hosts.push(new URL(normalizeImportApiOrigin(origin)).hostname);
	const safe = source === 'alloha' ? safeAllohaPlayerUrl(value, hosts, config.allohaPlayerToken) : safeImportUrl(value, hosts);
	return safe ? rewriteImportPlayerOrigin(safe, origin) : null;
}

function collapsTranslationName(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	// oneSound matches the provider's full name: do not rewrite its case or inner spacing.
	const name = value.trim();
	return !name || name.length > 256 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(name) ? null : name;
}

/** The caller supplies an already validated iframe, never a direct media URL. */
export function importPlayerTranslationUrl(iframe: string, source: ImportPlayer['source'], translation: Pick<ImportPlayer['translations'][number], 'id' | 'name'>): string | null {
	try {
		const url = new URL(iframe);
		if (source === 'alloha') {
			// Older importer snapshots kept IDs but lost the upstream per-voice iframe.
			if (!/^[1-9]\d{0,15}$/u.test(translation.id) || !Number.isSafeInteger(Number(translation.id))) return null;
			url.searchParams.set('translation', translation.id);
		} else if (source === 'collaps') {
			// Collaps documents oneSound as the full voice name, not its catalogue ID.
			const name = collapsTranslationName(translation.name);
			if (name == null) return null;
			url.searchParams.set('oneSound', name);
		} else {
			// Kodik voices are different edition resources; an ID cannot be substituted
			// into a signed/hash-bearing resource path. Only its validated iframe is selectable.
			return null;
		}
		return url.toString();
	} catch {
		return null;
	}
}

function imagePath(value: unknown): string | null {
	return typeof value === 'string' && /^\/[A-Za-z0-9._-]{1,256}$/.test(value) ? value : null;
}

function tmdbImage(value: unknown): string | null {
	const path = imagePath(value);
	return path == null ? null : `https://image.tmdb.org/t/p/original${path}`;
}

function names(value: unknown, key: string): string[] {
	const result = new Set<string>();
	const items = typeof value === 'string' ? value.split(',').slice(0, 50) : array(value, 50);
	for (const item of items) {
		const name = text(typeof item === 'string' ? item : object(item)[key], 128);
		if (name != null) result.add(name);
	}
	return [...result];
}

function identity(provider: string, value: unknown, entityType: ImportMediaType, imdb = false): ExternalIdentity[] {
	const id = imdb ? imdbId(value) : externalId(value);
	return id == null ? [] : [{ provider, externalId: id, entityType }];
}

function rating(source: string, value: unknown, votes: unknown = null): ImportRecord['ratings'] {
	const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
	return Number.isFinite(number) && number > 0 && number <= 10 ? [{ source, value: number, votes: integer(votes, 0) }] : [];
}

function mediaKind(mediaType: ImportMediaType, genres: string[], countries: string[], providerKind?: unknown): ImportRecord['kind'] {
	const kind = typeof providerKind === 'string' ? providerKind.toLowerCase() : '';
	if (kind.includes('anime') || genres.some(genre => /^(?:anime|аниме)$/i.test(genre))) return 'anime';
	if (kind.includes('cartoon') || genres.some(genre => /^(?:animation|анимация|мультфильм)$/i.test(genre))) {
		return countries.some(country => /^(?:japan|япония|jp)$/i.test(country)) ? 'anime' : 'animation';
	}
	return mediaType === 'tv' ? 'series' : 'movie';
}

function blankRecord(ref: ImportRef, title: string): ImportRecord {
	return {
		ref, title, identities: [{ provider: ref.source, externalId: ref.externalId, entityType: ref.mediaType }],
		originalTitle: null, description: null, releaseYear: null, runtimeMinutes: null,
		kind: ref.mediaType === 'movie' ? 'movie' : 'series', genres: [], countries: [],
		posterUrl: null, backdropUrl: null, logoUrl: null, galleryUrls: [], trailerYoutubeKey: null,
		ratings: [], ageRating: null, credits: [], companies: [], collections: [], seasons: [], players: [], complete: true, warnings: [],
	};
}

function requireTitle(value: unknown): string {
	const title = text(value);
	if (title == null) throw new ImportProviderError('malformed-response');
	return title;
}

function role(value: unknown): string {
	const result = text(value, 64)?.toLowerCase() ?? 'unknown';
	if (['actor', 'himself', 'herself', 'voice_male', 'voice_female'].includes(result)) return 'actor';
	if (result === 'director') return 'director';
	if (['writer', 'screenplay', 'screenwriter', 'writing', 'story'].includes(result)) return 'writer';
	if (['producer', 'executive producer', 'producer_ussr'].includes(result)) return 'producer';
	if (['composer', 'original music composer', 'music'].includes(result)) return 'composer';
	if (['operator', 'director of photography', 'cinematography'].includes(result)) return 'cinematographer';
	return result;
}

function uniqueCredits(credits: ImportCredit[]): ImportCredit[] {
	const seen = new Set<string>();
	return credits.filter(credit => {
		const key = JSON.stringify([credit.source, credit.externalId ?? credit.name.toLowerCase(), credit.role, credit.character]);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	}).slice(0, 300);
}

function youtubeKey(value: unknown): string | null {
	return typeof value === 'string' && /^[A-Za-z0-9_-]{6,32}$/.test(value) ? value : null;
}

export function normalizeTmdbRecord(value: unknown, mediaType: ImportMediaType, seasonDetails: unknown[] = []): ImportRecord {
	const item = object(value);
	const id = externalId(item.id);
	if (id == null) throw new ImportProviderError('malformed-response');
	const record = blankRecord({ source: 'tmdb', externalId: id, mediaType }, requireTitle(mediaType === 'movie' ? item.title : item.name));
	record.identities.push(...identity('imdb', object(item.external_ids).imdb_id ?? item.imdb_id, mediaType, true));
	record.originalTitle = text(mediaType === 'movie' ? item.original_title : item.original_name);
	record.description = text(item.overview, 8192);
	record.releaseYear = year(mediaType === 'movie' ? item.release_date : item.first_air_date);
	record.runtimeMinutes = integer(mediaType === 'movie' ? item.runtime : array(item.episode_run_time)[0], 1, 1440);
	record.genres = names(item.genres, 'name');
	record.countries = names(item.production_countries, 'name');
	if (record.countries.length === 0) record.countries = names(item.origin_country, 'name');
	record.kind = mediaKind(mediaType, record.genres, record.countries);
	record.posterUrl = tmdbImage(item.poster_path);
	record.backdropUrl = tmdbImage(item.backdrop_path);
	const images = object(item.images);
	const languageScore = (value: unknown) => value === 'ru' ? 0 : value === 'en' ? 1 : value == null ? 2 : 3;
	const logos = array(images.logos).map(object).filter(logo => imagePath(logo.file_path) != null).sort((a, b) => languageScore(a.iso_639_1) - languageScore(b.iso_639_1));
	record.logoUrl = tmdbImage(logos[0]?.file_path);
	record.galleryUrls = [...new Set(array(images.backdrops).map(item => tmdbImage(object(item).file_path)).filter((url): url is string => url != null))].slice(0, 18);
	record.artworkCandidates = [];
	for (const [field, values] of [['posterUrl', images.posters], ['backdropUrl', images.backdrops], ['logoUrl', logos], ['galleryUrls', images.backdrops]] as const) {
		for (const raw of array(values, 18)) {
			const image = object(raw);
			const url = tmdbImage(image.file_path);
			if (!url) continue;
			record.artworkCandidates.push(artworkCandidate({ source: 'tmdb', field, url, previewUrl: url.replace('/t/p/original/', field === 'posterUrl' ? '/t/p/w342/' : '/t/p/w300/'), width: integer(image.width, 1, 100000), height: integer(image.height, 1, 100000), language: text(image.iso_639_1, 16) }));
		}
	}
	const videos = array(object(item.videos).results).map(object).filter(video => video.site === 'YouTube' && youtubeKey(video.key) != null)
		.sort((a, b) => (b.type === 'Trailer' ? 2 : 0) + (b.iso_639_1 === 'ru' ? 1 : 0) - (a.type === 'Trailer' ? 2 : 0) - (a.iso_639_1 === 'ru' ? 1 : 0));
	record.trailerYoutubeKey = youtubeKey(videos[0]?.key);
	record.ratings = rating('tmdb', item.vote_average, item.vote_count);
	const credits = object(item.credits ?? item.aggregate_credits);
	const parsedCredits: ImportCredit[] = [];
	for (const [values, defaultRole] of [[credits.cast, 'actor'], [credits.crew, 'unknown']] as const) {
		for (const raw of array(values, 300)) {
			const credit = object(raw);
			const name = text(credit.name);
			if (name == null) continue;
			parsedCredits.push({ source: 'tmdb', externalId: externalId(credit.id), name, role: defaultRole === 'actor' ? 'actor' : role(credit.job ?? credit.department), character: text(credit.character), imageUrl: tmdbImage(credit.profile_path) });
		}
	}
	record.credits = uniqueCredits(parsedCredits);
	record.companies = array(item.production_companies).map(object).flatMap(company => {
		const name = text(company.name);
		return name == null ? [] : [{ source: 'tmdb' as const, externalId: externalId(company.id), name, imageUrl: tmdbImage(company.logo_path) }];
	});
	const collection = object(item.belongs_to_collection);
	const collectionId = externalId(collection.id);
	const collectionName = text(collection.name);
	if (collectionId != null && collectionName != null) record.collections.push({ source: 'tmdb', externalId: collectionId, name: collectionName, imageUrl: tmdbImage(collection.poster_path) });
	if (mediaType === 'tv') {
		let remaining = MAX_EPISODES;
		const uniqueSeasons = new Set<number>();
		if (Array.isArray(item.seasons) && item.seasons.length > MAX_SEASONS) record.warnings.push('tmdb-season-limit');
		for (const raw of array(item.seasons, MAX_SEASONS)) {
			const season = object(raw);
			const seasonNumber = integer(season.season_number, 0, 1000);
			if (seasonNumber == null || uniqueSeasons.has(seasonNumber)) continue;
			uniqueSeasons.add(seasonNumber);
			const detail = seasonDetails.map(object).find(value => value.season_number === seasonNumber);
			if (Array.isArray(detail?.episodes) && detail.episodes.length > remaining) record.warnings.push('tmdb-episode-limit');
			const numbers = new Set<number>();
			const episodes: ImportEpisode[] = [];
			for (const value of array(detail?.episodes, remaining)) {
				const episode = object(value);
				const episodeNumber = integer(episode.episode_number, 0, 100000);
				if (episodeNumber == null || numbers.has(episodeNumber)) continue;
				numbers.add(episodeNumber);
				episodes.push({ episodeNumber, title: text(episode.name) ?? `Эпизод ${episodeNumber}`, description: text(episode.overview, 8192), airDate: date(episode.air_date), stillUrl: tmdbImage(episode.still_path), runtimeMinutes: integer(episode.runtime, 1, 1440), tmdbEpisodeId: integer(episode.id) });
			}
			remaining -= episodes.length;
			record.seasons.push({ seasonNumber, title: text(season.name) ?? `Сезон ${seasonNumber}`, description: text(season.overview, 8192), posterUrl: tmdbImage(season.poster_path), airDate: date(season.air_date), episodeCount: integer(season.episode_count, 0, 100000), episodes: episodes.sort((a, b) => a.episodeNumber - b.episodeNumber) });
		}
	}
	record.complete = record.warnings.length === 0;
	return record;
}

function kpMediaType(item: JsonObject): ImportMediaType {
	return item.serial === true || ['TV_SERIES', 'MINI_SERIES', 'TV_SHOW'].includes(String(item.type)) ? 'tv' : 'movie';
}

export function normalizeKinopoiskRecord(value: unknown, staff: unknown = [], seasonData: unknown = {}): ImportRecord {
	const item = object(value);
	const id = externalId(item.kinopoiskId ?? item.filmId);
	if (id == null) throw new ImportProviderError('malformed-response');
	const mediaType = kpMediaType(item);
	const record = blankRecord({ source: 'kinopoisk', externalId: id, mediaType }, requireTitle(firstText(item.nameRu, item.nameOriginal, item.nameEn)));
	record.identities.push(...identity('imdb', item.imdbId, mediaType, true));
	record.originalTitle = text(item.nameOriginal ?? item.nameEn);
	record.description = text(item.description ?? item.shortDescription, 8192);
	record.releaseYear = year(item.year ?? item.startYear);
	record.runtimeMinutes = integer(item.filmLength, 1, 1440);
	record.genres = names(item.genres, 'genre');
	record.countries = names(item.countries, 'country');
	record.kind = mediaKind(mediaType, record.genres, record.countries);
	record.posterUrl = safeImportUrl(item.posterUrl);
	record.backdropUrl = safeImportUrl(item.coverUrl);
	record.logoUrl = safeImportUrl(item.logoUrl);
	record.ratings = [...rating('kinopoisk', item.ratingKinopoisk, item.ratingKinopoiskVoteCount), ...rating('imdb', item.ratingImdb, item.ratingImdbVoteCount)];
	record.ageRating = text(item.ratingAgeLimits ?? item.ratingMpaa, 32);
	record.credits = uniqueCredits(array(staff, 300).map(object).flatMap(credit => {
		const name = firstText(credit.nameRu, credit.nameEn);
		return name == null ? [] : [{ source: 'kinopoisk' as const, externalId: externalId(credit.staffId), name, role: role(credit.professionKey), character: text(credit.description), imageUrl: safeImportUrl(credit.posterUrl) }];
	}));
	let remaining = MAX_EPISODES;
	const seenSeasons = new Set<number>();
	if (Array.isArray(object(seasonData).items) && (object(seasonData).items as unknown[]).length > MAX_SEASONS) record.warnings.push('kinopoisk-season-limit');
	for (const raw of array(object(seasonData).items, MAX_SEASONS)) {
		const season = object(raw);
		const seasonNumber = integer(season.number, 0, 1000);
		if (seasonNumber == null || seenSeasons.has(seasonNumber)) continue;
		seenSeasons.add(seasonNumber);
		if (Array.isArray(season.episodes) && season.episodes.length > remaining) record.warnings.push('kinopoisk-episode-limit');
		const seenEpisodes = new Set<number>();
		const episodes: ImportEpisode[] = [];
		for (const raw of array(season.episodes, remaining)) {
			const episode = object(raw);
			const episodeNumber = integer(episode.episodeNumber, 0, 100000);
			if (episodeNumber == null || seenEpisodes.has(episodeNumber)) continue;
			seenEpisodes.add(episodeNumber);
			episodes.push({ episodeNumber, title: text(episode.nameRu ?? episode.nameEn) ?? `Эпизод ${episodeNumber}`, originalTitle: text(episode.nameEn), description: text(episode.synopsis, 8192), airDate: date(episode.releaseDate) });
		}
		remaining -= episodes.length;
		record.seasons.push({ seasonNumber, title: `Сезон ${seasonNumber}`, episodeCount: episodes.length, episodes: episodes.sort((a, b) => a.episodeNumber - b.episodeNumber) });
	}
	record.complete = record.warnings.length === 0;
	return record;
}

function collapsMediaType(item: JsonObject): ImportMediaType {
	return /serial|series|show/.test(String(item.type).toLowerCase()) || array(item.seasons, 1).length > 0 ? 'tv' : 'movie';
}

function maintenancePage(value: unknown, limit: number): { rows: unknown[]; hasMore: boolean } {
	const response = object(value);
	if (!Array.isArray(response.results) || response.results.length > limit) throw new ImportProviderError('malformed-response');
	// Upstream next_page may contain a token. It is a boolean signal only, never a URL to follow/store.
	return { rows: response.results, hasMore: response.next_page != null && response.next_page !== '' && response.next_page !== false };
}

function maintenanceLimit(limit: number): void {
	if (!Number.isInteger(limit) || limit < 20 || limit > 50) throw new ImportProviderError('invalid-ref');
}

/** Collaps detail responses use full voice-name strings; older adapters can also return ID/name objects. */
function collapsTranslations(value: unknown, iframeUrl: string | null): ImportPlayer['translations'] {
	const names = new Set<string>();
	const ids = new Set<string>();
	return array(value).flatMap(raw => {
		const voice = object(raw);
		const name = collapsTranslationName(typeof raw === 'string' ? raw : voice.name);
		if (name == null) return [];
		const id = externalId(voice.id) ?? `name:${createHash('sha256').update(name).digest('hex')}`;
		if (names.has(name) || ids.has(id)) return [];
		names.add(name);
		ids.add(id);
		const iframe = iframeUrl == null ? null : importPlayerTranslationUrl(iframeUrl, 'collaps', { id, name });
		return [{ id, name, ...(iframe == null ? {} : { iframe }) }];
	});
}

/** A truncated or malformed list cannot prove the unique substring match used by Collaps oneSound. */
function collapsCoverageNames(value: unknown): string[] | null {
	if (!Array.isArray(value) || !value.length || value.length > MAX_RESULTS) return null;
	const names = value.map(raw => collapsTranslationName(typeof raw === 'string' ? raw : object(raw).name));
	return names.every((name): name is string => name != null) ? names : null;
}

function collapsUniqueCoverageName(names: string[] | null, selected: string): boolean {
	if (!names) return false;
	const fullName = selected.toLowerCase();
	const matches = names.filter(name => name.toLowerCase().includes(fullName));
	return matches.length === 1 && matches[0].toLowerCase() === fullName;
}

/** Do not infer episode coverage from arbitrary links or query values that disagree with the canonical API row. */
function collapsEpisodeIframe(value: unknown, parentIframe: string | null, iframeHosts: readonly string[], season: number, episode: number): boolean {
	const safe = safeImportUrl(value, iframeHosts);
	if (!safe || !parentIframe) return false;
	const url = new URL(safe);
	const parent = new URL(parentIframe);
	return url.origin === parent.origin && url.pathname === parent.pathname
		&& url.searchParams.getAll('season').length === 1 && url.searchParams.get('season') === String(season)
		&& url.searchParams.getAll('episode').length === 1 && url.searchParams.get('episode') === String(episode);
}

export function normalizeCollapsRecord(value: unknown, iframeHosts: readonly string[] = ['api.nextembed.ws']): ImportRecord {
	const payload = object(value);
	const item = object(payload.result ?? payload.data ?? value);
	const id = externalId(item.id);
	if (id == null) throw new ImportProviderError('malformed-response');
	const mediaType = collapsMediaType(item);
	const record = blankRecord({ source: 'collaps', externalId: id, mediaType }, requireTitle(item.name));
	record.identities.push(...identity('kinopoisk', item.kinopoisk_id, mediaType), ...identity('imdb', item.imdb_id, mediaType, true));
	record.originalTitle = text(item.name_eng ?? item.origin_name);
	record.description = text(item.description, 8192);
	record.releaseYear = year(item.year);
	record.runtimeMinutes = integer(item.time, 1, 1440);
	record.genres = names(item.genre ?? item.genres, 'name');
	record.countries = names(item.country ?? item.countries, 'name');
	record.kind = mediaKind(mediaType, record.genres, record.countries, item.type);
	record.posterUrl = safeImportUrl(item.poster);
	record.backdropUrl = safeImportUrl(item.iframe_poster);
	record.ratings = [...rating('kinopoisk', item.kinopoisk), ...rating('imdb', item.imdb)];
	record.ageRating = text(item.age ?? item.rate_mpaa, 32);
	const credits: ImportCredit[] = [];
	for (const [field, creditRole] of [['actors', 'actor'], ['director', 'director'], ['screenwriter', 'writer'], ['producer', 'producer'], ['operator', 'cinematographer'], ['editor', 'editor'], ['design', 'design']] as const) {
		for (const raw of array(item[field], 150)) {
			const credit = object(raw);
			const name = text(typeof raw === 'string' ? raw : credit.name);
			if (name != null) credits.push({ source: 'collaps', externalId: externalId(credit.id), name, role: creditRole, character: null, imageUrl: safeImportUrl(credit.photo ?? credit.poster) });
		}
	}
	record.credits = uniqueCredits(credits);
	const iframeUrl = safeImportUrl(item.iframe_url, iframeHosts);
	const episodes: ImportPlayer['episodes'] = [];
	const coverage: { seasonNumber: number; episodeNumber: number; names: string[] }[] = [];
	const ambiguousSeasons = new Set<number>();
	const ambiguousEpisodes = new Set<string>();
	let remaining = MAX_EPISODES;
	const seenSeasons = new Set<number>();
	if (Array.isArray(item.seasons) && item.seasons.length > MAX_SEASONS) record.warnings.push('collaps-season-limit');
	for (const raw of array(item.seasons, MAX_SEASONS)) {
		const season = object(raw);
		const seasonNumber = integer(season.season ?? season.number, 0, 1000);
		if (seasonNumber == null) continue;
		if (seenSeasons.has(seasonNumber)) { ambiguousSeasons.add(seasonNumber); continue; }
		seenSeasons.add(seasonNumber);
		if (Array.isArray(season.episodes) && season.episodes.length > remaining) {
			record.warnings.push('collaps-episode-limit');
			ambiguousSeasons.add(seasonNumber);
		}
		const seenEpisodes = new Set<number>();
		const normalizedEpisodes: ImportEpisode[] = [];
		for (const raw of array(season.episodes, remaining)) {
			const episode = object(raw);
			const episodeNumber = integer(episode.episode ?? episode.number, 0, 100000);
			if (episodeNumber == null) continue;
			if (seenEpisodes.has(episodeNumber)) { ambiguousEpisodes.add(`${seasonNumber}:${episodeNumber}`); continue; }
			seenEpisodes.add(episodeNumber);
			normalizedEpisodes.push({ episodeNumber, title: text(episode.name) ?? `Эпизод ${episodeNumber}`, stillUrl: safeImportUrl(episode.poster), airDate: date(episode.release_date) });
			episodes.push({ seasonNumber, episodeNumber });
			const names = collapsCoverageNames(episode.voiceActing ?? episode.voice_acting);
			if (names && episode.availability !== false && collapsEpisodeIframe(episode.iframe_url, iframeUrl, iframeHosts, seasonNumber, episodeNumber)) coverage.push({ seasonNumber, episodeNumber, names });
		}
		remaining -= normalizedEpisodes.length;
		record.seasons.push({ seasonNumber, title: text(season.name) ?? `Сезон ${seasonNumber}`, posterUrl: safeImportUrl(season.poster), episodeCount: normalizedEpisodes.length, episodes: normalizedEpisodes.sort((a, b) => a.episodeNumber - b.episodeNumber) });
	}
	const translations = collapsTranslations(item.voiceActing ?? item.voice_acting, iframeUrl);
	if (mediaType === 'tv') {
		const parentNames = collapsCoverageNames(item.voiceActing ?? item.voice_acting);
		const completeSeasons = !Array.isArray(item.seasons) || item.seasons.length <= MAX_SEASONS;
		for (const translation of translations) {
			translation.episodes = completeSeasons && collapsUniqueCoverageName(parentNames, translation.name)
				? coverage.filter(episode => !ambiguousSeasons.has(episode.seasonNumber) && !ambiguousEpisodes.has(`${episode.seasonNumber}:${episode.episodeNumber}`) && collapsUniqueCoverageName(episode.names, translation.name))
					.map(({ seasonNumber, episodeNumber }) => ({ seasonNumber, episodeNumber }))
					.sort((left, right) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber)
				: [];
		}
	}
	if (iframeUrl != null) record.players.push({ source: 'collaps', externalId: id, iframeUrl, quality: text(item.quality, 64) ?? (integer(item.quality, 0, 4) == null ? null : String(item.quality)), translations, episodes });
	if (item.iframe_url != null && iframeUrl == null) record.warnings.push('collaps-player-url-rejected');
	record.complete = record.warnings.length === 0;
	return record;
}

/** Alloha's verified integration uses a typed TMDB reference, not an undocumented native-ID route. */
export function normalizeAllohaRecord(value: unknown, ref: ImportRef, iframeHosts: readonly string[] = ['ascorbic-as.stravers.live'], playerToken?: string): ImportRecord {
	const item = object(object(value).data);
	const match = /^tmdb:(movie|tv):(\d{1,16})$/.exec(ref.externalId);
	const category = text(object(item.category).slug, 24);
	if (match == null || match[1] !== ref.mediaType || externalId(match[2]) == null || category == null) throw new ImportProviderError('malformed-response');
	if ((ref.mediaType === 'movie') !== (category === 'movie')) throw new ImportProviderError('not-found');
	const record = blankRecord(ref, text(item.name ?? item.title) ?? `TMDB ${match[2]}`);
	record.complete = false;
	record.identities.push(...identity('tmdb', match[2], ref.mediaType), ...identity('kinopoisk', object(item.ids).kinopoisk ?? object(item.ids).kp, ref.mediaType), ...identity('imdb', object(item.ids).imdb, ref.mediaType, true));
	record.originalTitle = text(item.original_name ?? item.original_title);
	record.description = text(item.description, 8192);
	record.releaseYear = year(item.year);
	record.kind = mediaKind(ref.mediaType, [], [], category);
	const iframeUrl = safeAllohaPlayerUrl(item.iframe, iframeHosts, playerToken);
	const translations = array(item.translations, 40).map(object).filter(voice => externalId(voice.id) != null && text(voice.name, 256) != null && safeAllohaPlayerUrl(voice.iframe, iframeHosts, playerToken) != null);
	const fallbackIframe = iframeUrl ?? safeAllohaPlayerUrl(translations[0]?.iframe, iframeHosts, playerToken);
	if (fallbackIframe != null) record.players.push({ source: 'alloha', externalId: ref.externalId, iframeUrl: fallbackIframe, quality: text(translations[0]?.quality, 64), translations: translations.flatMap(voice => {
		const id = externalId(voice.id);
		const name = text(voice.name, 256);
		const iframe = safeAllohaPlayerUrl(voice.iframe, iframeHosts, playerToken);
		return id == null || name == null || iframe == null ? [] : [{ id, name, iframe, quality: text(voice.quality, 64), resolutions: [...new Set(array(voice.resolutions, 12).map(value => text(value, 32)).filter((value): value is string => value != null))] }];
	}), episodes: [] });
	if (item.iframe != null && iframeUrl == null) record.warnings.push('alloha-player-url-rejected');
	return record;
}

function vibixItem(value: unknown): JsonObject {
	const envelope = object(value);
	if (envelope.success === false) throw new ImportProviderError('malformed-response');
	return Object.hasOwn(envelope, 'data') ? object(envelope.data) : envelope;
}

/** The stored/public SDK contract contains only three inert attributes, never markup, URLs or commands. */
export function normalizeVibixEmbed(value: unknown): ImportVibixEmbed | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== 3 || keys.some(key => typeof key !== 'string' || !['publisherId', 'type', 'id'].includes(key)) || Object.values(descriptors).some(descriptor => !descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) return null;
	const item = value as Record<string, unknown>;
	const numericId = (id: unknown): id is string => typeof id === 'string' && /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id));
	return numericId(item.publisherId) && numericId(item.id) && (item.type === 'movie' || item.type === 'series') ? { publisherId: item.publisherId, type: item.type, id: item.id } : null;
}

function vibixEmbedCode(value: unknown): ImportVibixEmbed | null {
	if (typeof value !== 'string' || value.length > 4096) return null;
	const input = value.trim();
	const tag = /^<ins\s+([^<>]*)>\s*<\/ins>$/iu.exec(input);
	const fragment = tag?.[1] ?? (!/[<>]/u.test(input) ? input : null);
	if (fragment == null) return null;
	const attributes = new Map<string, string>();
	const pattern = /\s*([a-z][a-z0-9-]*)\s*=\s*(["'])([^"'<>]*)\2/iy;
	let offset = 0;
	while (offset < fragment.trimEnd().length) {
		pattern.lastIndex = offset;
		const attribute = pattern.exec(fragment);
		if (!attribute) return null;
		const key = attribute[1].toLowerCase();
		if (!['data-publisher-id', 'data-type', 'data-id'].includes(key) || attributes.has(key)) return null;
		attributes.set(key, attribute[3]); offset = pattern.lastIndex;
		if (offset < fragment.trimEnd().length && !/\s/u.test(fragment[offset])) return null;
	}
	const type = attributes.get('data-type');
	return normalizeVibixEmbed({ publisherId: attributes.get('data-publisher-id'), type: type === 'serial' ? 'series' : type, id: attributes.get('data-id') });
}

function vibixIdentities(item: JsonObject, mediaType: ImportMediaType): ExternalIdentity[] {
	const kp = item.kp_id == null ? null : externalId(item.kp_id);
	const legacyKp = item.kinopoisk_id == null ? null : externalId(item.kinopoisk_id);
	const imdb = typeof item.imdb_id === 'string' && /^tt[0-9]{5,12}$/u.test(item.imdb_id) ? item.imdb_id : null;
	if ((item.kp_id != null && kp == null) || (item.kinopoisk_id != null && legacyKp == null) || (kp && legacyKp && kp !== legacyKp) || (item.imdb_id != null && imdb == null)) throw new ImportProviderError('malformed-response');
	return [...identity('kinopoisk', kp ?? legacyKp, mediaType), ...identity('imdb', imdb, mediaType, true)];
}

/** Numeric Vibix references mean KP, never the unrelated publisher video ID. */
function vibixReference(identities: ExternalIdentity[], mediaType: ImportMediaType): ImportRef {
	const kp = keyFor(identities, 'kinopoisk', mediaType);
	const imdb = keyFor(identities, 'imdb', mediaType);
	if (!kp && !imdb) throw new ImportProviderError('malformed-response');
	return { source: 'vibix', externalId: kp ?? `imdb:${imdb}`, mediaType };
}

function assertVibixIdentities(record: ImportRecord, expected: ExternalIdentity[], mediaType: ImportMediaType): void {
	if (record.ref.mediaType !== mediaType) throw new ImportProviderError('malformed-response');
	for (const binding of expected.filter(item => item.entityType === mediaType && ['kinopoisk', 'imdb'].includes(item.provider))) {
		if (!record.identities.some(actual => actual.provider === binding.provider && actual.externalId === binding.externalId && actual.entityType === mediaType)) throw new ImportProviderError('malformed-response');
	}
}

/** Only documented metadata is projected. An SDK tag is never executed or treated as an iframe URL. */
export function normalizeVibixRecord(value: unknown, iframeHosts: readonly string[] = [], requestedRef?: ImportRef): ImportRecord {
	const item = vibixItem(value);
	const id = externalId(item.id);
	const mediaType = item.type === 'movie' ? 'movie' : item.type === 'serial' ? 'tv' : null;
	if (!id || !mediaType) throw new ImportProviderError('malformed-response');
	const identities = vibixIdentities(item, mediaType);
	const canonical = vibixReference(identities, mediaType);
	if (requestedRef && (requestedRef.source !== 'vibix' || !validImportRef(requestedRef) || requestedRef.mediaType !== mediaType)) throw new ImportProviderError('malformed-response');
	const ref = requestedRef ?? canonical;
	const record = blankRecord(ref, requireTitle(firstText(item.name_rus, item.name, item.name_original, item.name_eng)));
	record.identities.push(...identities);
	const requestedIdentity: ExternalIdentity = ref.externalId.startsWith('imdb:')
		? { provider: 'imdb', externalId: ref.externalId.slice(5), entityType: mediaType }
		: { provider: 'kinopoisk', externalId: ref.externalId, entityType: mediaType };
	assertVibixIdentities(record, [requestedIdentity], mediaType);
	record.originalTitle = firstText(item.name_original, item.name_eng);
	record.description = text(item.description, 8192) ?? text(item.description_short, 8192);
	record.releaseYear = year(item.year);
	record.runtimeMinutes = integer(item.duration, 1, 1440);
	record.genres = names(item.genre, 'name');
	record.countries = names(item.country, 'name');
	record.kind = mediaKind(mediaType, record.genres, record.countries);
	record.posterUrl = safeImportUrl(item.poster_url);
	record.backdropUrl = safeImportUrl(item.backdrop_url);
	record.ratings = [...rating('kinopoisk', item.kp_rating, item.kp_votes), ...rating('imdb', item.imdb_rating, item.imdb_votes)];
	// Publisher responses do not document studios, collections, logos or a complete episode catalogue.
	record.warnings.push('vibix-metadata-partial');
	if (Array.isArray(item.persons) && item.persons.length > 300) record.warnings.push('vibix-person-limit');
	record.credits = uniqueCredits(array(item.persons, 300).flatMap(raw => {
		const person = object(raw);
		const personId = externalId(person.id); const name = firstText(person.name, person.name_anyway, person.name_eng);
		if (!personId || !name) { record.warnings.push('vibix-people-without-identities'); return []; }
		return [{ source: 'vibix' as const, externalId: personId, name, role: role(person.occupation), character: null, imageUrl: null }];
	}));
	if (Array.isArray(item.voiceovers) && item.voiceovers.length > MAX_RESULTS) record.warnings.push('vibix-voice-limit');
	const translations: ImportPlayer['translations'] = [];
	for (const raw of array(item.voiceovers)) {
		const voice = object(raw); const voiceId = externalId(voice.id); const name = text(voice.name);
		if (!voiceId || !name) continue;
		const previous = translations.find(translation => translation.id === voiceId);
		if (previous && previous.name !== name) throw new ImportProviderError('malformed-response');
		if (!previous) translations.push({ id: voiceId, name });
	}
	if (mediaType === 'tv') record.warnings.push('vibix-episode-data-unavailable');
	const iframe = safeImportUrl(item.iframe_url, iframeHosts);
	const embed = vibixEmbedCode(item.embed_code);
	const matchingEmbed = embed?.type === (mediaType === 'movie' ? 'movie' : 'series') ? embed : null;
	if (typeof item.embed_code === 'string' && item.embed_code.trim() && !matchingEmbed) record.warnings.push('vibix-embed-rejected');
	if (translations.length && !matchingEmbed) record.warnings.push('vibix-voice-control-unavailable');
	// Only the documented SDK integration is supported; an iframe URL alone is metadata-only.
	if (matchingEmbed) record.players.push({ source: 'vibix', externalId: id, iframeUrl: '', vibixEmbed: matchingEmbed, translations, quality: text(item.quality, 64), episodes: [] });
	if (typeof item.iframe_url === 'string' && item.iframe_url.trim() && !iframe) record.warnings.push('vibix-player-url-rejected');
	if (!matchingEmbed) record.warnings.push('vibix-player-url-missing');
	record.warnings = [...new Set(record.warnings)];
	record.complete = false;
	return record;
}

function vibixSearchPage(value: unknown, page: number, iframeHosts: readonly string[], mediaType?: ImportMediaType): ImportSearchPage {
	const response = object(value);
	if (response.success === false || !Array.isArray(response.data)) throw new ImportProviderError('malformed-response');
	const pagination = object(response.meta);
	const currentPage = integer(pagination.current_page, 1, 1000); const lastPage = integer(pagination.last_page, 1, 1000);
	if ((pagination.current_page != null && currentPage !== page) || (pagination.last_page != null && (lastPage == null || lastPage < page))) throw new ImportProviderError('malformed-response');
	// Follow only our bounded integer page, never an upstream links.next URL containing credentials.
	const hasMore = page < 1000 && (lastPage != null ? page < lastPage : response.data.length >= 20);
	const result = searchPage(response.data.slice(0, 20), page, hasMore, row => normalizeVibixRecord(row, iframeHosts));
	result.items = result.items.filter((item, index, items) => (mediaType == null || item.ref.mediaType === mediaType) && items.findIndex(other => other.ref.externalId === item.ref.externalId && other.ref.mediaType === item.ref.mediaType) === index);
	return result;
}

function kodikId(value: unknown): string | null {
	return typeof value === 'string' && /^(?:movie|serial)-[1-9][0-9]{0,15}$/u.test(value) ? value : null;
}

function kodikMediaType(value: JsonObject): ImportMediaType | null {
	const id = kodikId(value.id);
	return id == null ? null : id.startsWith('movie-') ? 'movie' : 'tv';
}

function kodikIdentities(item: JsonObject, mediaType: ImportMediaType): ExternalIdentity[] {
	return [...identity('kinopoisk', item.kinopoisk_id, mediaType), ...identity('imdb', item.imdb_id, mediaType, true), ...identity('shikimori', item.shikimori_id, mediaType)];
}

function kodikKind(item: JsonObject, mediaType: ImportMediaType): ImportRecord['kind'] {
	const material = object(item.material_data);
	if (externalId(item.shikimori_id)) return 'anime';
	return mediaKind(mediaType, names(material.all_genres ?? material.genres, 'name'), names(material.countries, 'name'), item.type);
}

function canonicalKodikRef(item: JsonObject): ImportRef {
	const mediaType = kodikMediaType(item);
	const rawId = kodikId(item.id);
	if (!mediaType || !rawId) throw new ImportProviderError('malformed-response');
	const shikimori = externalId(item.shikimori_id);
	if (shikimori) return { source: 'kodik', externalId: `shikimori-${shikimori}`, mediaType };
	if (kodikKind(item, mediaType) !== 'anime') {
		const kp = externalId(item.kinopoisk_id);
		const imdb = imdbId(item.imdb_id);
		if (kp) return { source: 'kodik', externalId: `kinopoisk-${kp}`, mediaType };
		if (imdb) return { source: 'kodik', externalId: `imdb-${imdb}`, mediaType };
	}
	return { source: 'kodik', externalId: rawId, mediaType };
}

/** A protocol-relative provider link is HTTPS, never a general URL to be fetched by the server. */
function kodikPlayerUrl(value: unknown, hosts: readonly string[], rawId?: string): string | null {
	const safe = safeImportUrl(typeof value === 'string' && value.startsWith('//') ? `https:${value}` : value, hosts);
	if (!safe) return null;
	const path = new URL(safe).pathname;
	if (rawId) {
		const resource = /^(movie|serial)-([1-9][0-9]{0,15})$/u.exec(rawId);
		const parent = /^\/(video|serial)\/([1-9][0-9]{0,15})\/[A-Za-z0-9_-]{1,128}\/[1-9][0-9]{1,3}p\/?$/u.exec(path);
		if (!resource || !parent || parent[1] !== (resource[1] === 'movie' ? 'video' : 'serial') || parent[2] !== resource[2]) return null;
	} else if (!/^\/seria\/[1-9][0-9]{0,15}\/[A-Za-z0-9_-]{1,128}\/[1-9][0-9]{1,3}p\/?$/u.test(path)) return null;
	return safe;
}

function sameKodikMaterial(anchor: JsonObject, candidate: JsonObject): boolean {
	const mediaType = kodikMediaType(anchor);
	if (mediaType == null || kodikMediaType(candidate) !== mediaType) return false;
	const expected = kodikIdentities(anchor, mediaType);
	const actual = kodikIdentities(candidate, mediaType);
	if (expected.some(left => actual.some(right => left.provider === right.provider && left.externalId !== right.externalId))) return false;
	const shikimori = expected.find(value => value.provider === 'shikimori');
	const actualShikimori = actual.find(value => value.provider === 'shikimori');
	if (shikimori || actualShikimori) return shikimori?.externalId === actualShikimori?.externalId;
	if (kodikKind(anchor, mediaType) === 'anime') return false;
	return expected.some(left => actual.some(right => left.provider === right.provider && left.externalId === right.externalId));
}

/** One stable material reference binds the work; editions are voices, not competing work identities. */
export function normalizeKodikRecord(value: unknown, variants: unknown[] = [], iframeHosts: readonly string[] = ['kodikplayer.com']): ImportRecord {
	const anchor = object(value);
	const id = kodikId(anchor.id);
	const mediaType = kodikMediaType(anchor);
	if (!id || !mediaType) throw new ImportProviderError('malformed-response');
	const material = object(anchor.material_data);
	const record = blankRecord(canonicalKodikRef(anchor), requireTitle(firstText(material.title, anchor.title)));
	const kind = kodikKind(anchor, mediaType);
	// A Shikimori anime season is not the whole-series KP/IMDb entity. Those IDs
	// remain useful for provider consistency checks but cannot own a work binding.
	record.identities.push(...kodikIdentities(anchor, mediaType).filter(value => mediaType !== 'tv' || kind !== 'anime' ? true : value.provider === 'shikimori'));
	record.originalTitle = firstText(material.title_en, material.title_original, anchor.title_orig);
	record.description = text(material.description, 8192);
	record.releaseYear = year(anchor.year ?? material.year ?? material.premiere_world ?? material.aired_at);
	record.runtimeMinutes = integer(material.duration, 1, 1440);
	record.genres = names(material.all_genres ?? material.genres, 'name');
	record.countries = names(material.countries, 'name');
	record.kind = kind;
	record.posterUrl = safeImportUrl(material.poster_url) ?? safeImportUrl(material.anime_poster_url);
	record.galleryUrls = [...new Set([...array(material.screenshots, 18), ...array(anchor.screenshots, 18)].map(value => safeImportUrl(value)).filter((value): value is string => value != null))].slice(0, 18);
	record.ratings = [...rating('kinopoisk', material.kinopoisk_rating, material.kinopoisk_votes), ...rating('imdb', material.imdb_rating, material.imdb_votes), ...rating('shikimori', material.shikimori_rating, material.shikimori_votes)];
	const age = integer(material.minimal_age, 0, 21);
	record.ageRating = age == null ? null : `${age}+`;
	// Names without stable identities must not create or cross-merge a different real person's card.
	if (['actors', 'directors', 'writers', 'producers', 'composers', 'operators', 'editors', 'designers'].some(field => array(material[field], 1).length)) record.warnings.push('kodik-people-without-identities');
	if (array(material.anime_studios, 1).length) record.warnings.push('kodik-studios-without-identities');
	if (!Object.keys(material).length) record.warnings.push('kodik-metadata-partial');
	if (kind === 'anime' && !externalId(anchor.shikimori_id)) record.warnings.push('kodik-anime-identity-partial');
	const editions = [anchor, ...variants.map(object).filter(candidate => candidate.id !== id)];
	if (variants.length > MAX_RESULTS) record.warnings.push('kodik-voice-limit');
	const seenEditions = new Set<string>();
	const shikimoriIds = new Set(record.identities.filter(value => value.provider === 'shikimori').map(value => value.externalId));
	const seasons = new Map<number, Set<number>>();
	const translations: ImportPlayer['translations'] = [];
	let remaining = MAX_EPISODES;
	for (const edition of editions.slice(0, MAX_RESULTS)) {
		const editionId = kodikId(edition.id);
		if (!editionId || seenEditions.has(editionId)) continue;
		if (editionId !== id && !sameKodikMaterial(anchor, edition)) throw new ImportProviderError('malformed-response');
		seenEditions.add(editionId);
		const shikimori = externalId(edition.shikimori_id);
		if (shikimori) shikimoriIds.add(shikimori);
		if (shikimoriIds.size > 1) throw new ImportProviderError('malformed-response');
		const iframe = kodikPlayerUrl(edition.link, iframeHosts, editionId);
		const voice = object(edition.translation);
		const name = text(voice.title);
		const providerTranslationId = externalId(voice.id);
		const voiceEpisodes: ImportPlayer['episodes'] = [];
		if (edition.link != null && !iframe) record.warnings.push('kodik-player-url-rejected');
		const seasonRows = Object.entries(object(edition.seasons));
		if (seasonRows.length > MAX_SEASONS) record.warnings.push('kodik-season-limit');
		for (const [key, raw] of seasonRows.slice(0, MAX_SEASONS)) {
			const seasonNumber = integer(key, 0, 1000);
			if (seasonNumber == null) { record.warnings.push('kodik-episode-data-rejected'); continue; }
			const episodeRows = Object.entries(object(object(raw).episodes));
			const numbers = seasons.get(seasonNumber) ?? new Set<number>();
			if (!seasons.has(seasonNumber) && seasons.size >= MAX_SEASONS) { record.warnings.push('kodik-season-limit'); continue; }
			seasons.set(seasonNumber, numbers);
			for (const [episodeKey, episodeLink] of episodeRows) {
				const episodeNumber = integer(episodeKey, 0, 100000);
				if (episodeNumber == null || !kodikPlayerUrl(episodeLink, iframeHosts)) { record.warnings.push('kodik-episode-data-rejected'); continue; }
				if (voiceEpisodes.length >= MAX_EPISODES) { record.warnings.push('kodik-episode-limit'); break; }
				voiceEpisodes.push({ seasonNumber, episodeNumber });
				if (numbers.has(episodeNumber)) continue;
				if (remaining <= 0) { record.warnings.push('kodik-episode-limit'); break; }
				numbers.add(episodeNumber);
				remaining--;
			}
		}
		if (iframe && name) translations.push({ id: editionId, name, iframe, ...(providerTranslationId ? { providerTranslationId } : {}), ...(voice.type === 'voice' || voice.type === 'subtitles' ? { type: voice.type } : {}), quality: text(edition.quality, 64), ...(edition.seasons != null && typeof edition.seasons === 'object' && !Array.isArray(edition.seasons) ? { episodes: voiceEpisodes.sort((left, right) => left.seasonNumber - right.seasonNumber || left.episodeNumber - right.episodeNumber) } : {}) });
	}
	const iframe = kodikPlayerUrl(anchor.link, iframeHosts, id) ?? translations[0]?.iframe;
	const episodes = [...seasons].sort(([left], [right]) => left - right).flatMap(([seasonNumber, numbers]) => {
		const list = [...numbers].sort((left, right) => left - right);
		record.seasons.push({ seasonNumber, title: `Сезон ${seasonNumber}`, episodeCount: list.length, episodes: list.map(episodeNumber => ({ episodeNumber, title: `Эпизод ${episodeNumber}` })) });
		return list.map(episodeNumber => ({ seasonNumber, episodeNumber }));
	});
	if (iframe) record.players.push({ source: 'kodik', externalId: record.ref.externalId, iframeUrl: iframe, translations, quality: text(anchor.quality, 64), episodes });
	record.warnings = [...new Set(record.warnings)];
	record.complete = record.warnings.length === 0;
	return record;
}

function retryAfter(value: string | null): number | undefined {
	if (value == null) return undefined;
	const seconds = /^\d+$/.test(value) ? Number(value) : (Date.parse(value) - Date.now()) / 1000;
	return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 86400000) : undefined;
}

/** Fixed API origins, no redirects, bounded response size and timeout. Credentials never enter thrown errors. */
export function createConfiguredImportTransport(config: ImportProviderConfig): ImportTransport {
	const allowed = new Set(Object.values(importAddressOrigins(config)));
	return (url, headers, options) => performImportRequest(url, headers, allowed, options);
}

async function performImportRequest(url: string, headers: Record<string, string>, allowedOrigins: ReadonlySet<string>, options?: ImportTransportOptions): Promise<unknown> {
	let parsed: URL;
	try { parsed = new URL(url); } catch { throw new ImportProviderError('invalid-ref'); }
	if (!allowedOrigins.has(parsed.origin) || parsed.username || parsed.password || parsed.hash || (options && options.method !== 'POST')) throw new ImportProviderError('invalid-ref');
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12000);
	try {
		const response = await fetch(url, { headers: { Accept: 'application/json', ...headers }, ...(options ? { method: options.method } : {}), redirect: 'error', size: 2 * 1024 * 1024, signal: controller.signal, agent: importerHttpsAgent });
		if (response.status === 404) throw new ImportProviderError('not-found');
		if (response.status === 401 || response.status === 403) throw new ImportProviderError('not-configured');
		if (response.status === 402) throw new ImportProviderError('quota-exceeded', 86400000);
		if (response.status === 429) throw new ImportProviderError('rate-limited', retryAfter(response.headers.get('retry-after')) ?? 60000);
		if (!response.ok) throw new ImportProviderError('upstream-failure');
		return await response.json();
	} catch (error) {
		if (error instanceof ImportProviderError) throw error;
		throw new ImportProviderError('upstream-failure');
	} finally {
		clearTimeout(timer);
	}
}

export const defaultImportTransport: ImportTransport = (url, headers, options) => performImportRequest(url, headers, new Set(Object.values(origins)), options);

function pageNumber(value = 1, maximum = 1000): number {
	if (!Number.isInteger(value) || value < 1 || value > maximum) throw new ImportProviderError('invalid-ref');
	return value;
}

function validRef(ref: ImportRef, source: ImportSource): void {
	if (ref.source !== source || !['movie', 'tv'].includes(ref.mediaType) || externalId(ref.externalId) !== ref.externalId) throw new ImportProviderError('invalid-ref');
}

function searchResult(record: ImportRecord): ImportSearchResult {
	return { ref: record.ref, title: record.title, originalTitle: record.originalTitle, releaseYear: record.releaseYear, posterUrl: record.posterUrl };
}

function searchPage(values: unknown, page: number, hasMore: boolean, normalize: (value: unknown) => ImportRecord): ImportSearchPage {
	const items: ImportSearchResult[] = [];
	for (const raw of array(values)) {
		try { items.push(searchResult(normalize(raw))); } catch (error) {
			if (!(error instanceof ImportProviderError && error.code === 'malformed-response')) throw error;
		}
	}
	return { items, page, hasMore };
}

function status(source: ImportSource, credential: string | undefined, search: boolean, collections: boolean, updates: boolean): ImportProviderStatus {
	// Account-specific quotas come from the budget service, not a guessed provider plan.
	return { source, configured: !!credential?.trim(), capabilities: { search, collections, updates }, dailyLimit: null };
}

export function createImportRequest(source: ImportSource, credential: string | undefined, transport: ImportTransport, apiOrigin = origins[source]) {
	const origin = normalizeImportApiOrigin(apiOrigin);
	return async (path: string, parameters: Record<string, string> = {}, options?: ImportTransportOptions): Promise<unknown> => {
		if (!credential?.trim()) throw new ImportProviderError('not-configured');
		const url = new URL(path, origin);
		if (url.origin !== origin || !path.startsWith('/') || path.startsWith('//')) throw new ImportProviderError('invalid-ref');
		for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
		const headers: Record<string, string> = {};
		if (source === 'kinopoisk') headers['X-API-KEY'] = credential.trim();
		if (source === 'alloha' || source === 'vibix') headers.Authorization = `Bearer ${credential.trim()}`;
		if (source === 'tmdb') url.searchParams.set('api_key', credential.trim());
		if (source === 'collaps') url.searchParams.set('token', credential.trim());
		if (source === 'kodik') url.searchParams.set('token', credential.trim());
		try {
			return await (options ? transport(url.toString(), headers, options) : transport(url.toString(), headers));
		} catch (error) {
			if (error instanceof ImportProviderError) throw error;
			throw new ImportProviderError('upstream-failure');
		}
	};
}

function keyFor(identities: ExternalIdentity[], provider: string, mediaType: ImportMediaType): string | null {
	const value = identities.find(identity => identity.provider === provider && identity.entityType === mediaType)?.externalId;
	return provider === 'imdb' ? imdbId(value) : externalId(value);
}

async function fetchImdbReference(provider: ImportProvider, ref: ImportRef, fields?: readonly ImportField[]): Promise<ImportRecord> {
	const match = /^imdb:(tt\d{5,12})$/u.exec(ref.externalId);
	if (!match || ref.source !== provider.status().source || !['movie', 'tv'].includes(ref.mediaType)) throw new ImportProviderError('invalid-ref');
	const record = await provider.lookup?.([{ provider: 'imdb', externalId: match[1], entityType: ref.mediaType }], ref.mediaType, fields);
	if (!record) throw new ImportProviderError('not-found');
	if (record.ref.mediaType !== ref.mediaType || !record.identities.some(identity => identity.provider === 'imdb' && identity.externalId === match[1] && identity.entityType === ref.mediaType)) throw new ImportProviderError('malformed-response');
	return record;
}

function configuredIframeHosts(values: readonly string[] | undefined, fallback: string): string[] {
	const hosts = values?.map(value => value.trim().toLowerCase()).filter(Boolean);
	return hosts != null && hosts.length > 0 ? hosts : [fallback];
}

function kodikRows(value: unknown): JsonObject[] {
	const response = object(value);
	if (!Array.isArray(response.results) || response.results.length > MAX_RESULTS) throw new ImportProviderError('malformed-response');
	return response.results.map(object);
}

function kodikGrouping(identities: ExternalIdentity[], mediaType: ImportMediaType): { provider: string; externalId: string; parameter: string } | null {
	for (const [provider, parameter] of [['shikimori', 'shikimori_id'], ['kinopoisk', 'kinopoisk_id'], ['imdb', 'imdb_id']] as const) {
		const id = keyFor(identities, provider, mediaType);
		if (id) return { provider, externalId: id, parameter };
	}
	return null;
}

function matchingKodikRows(rows: JsonObject[], identities: ExternalIdentity[], mediaType: ImportMediaType): JsonObject[] {
	const grouping = kodikGrouping(identities, mediaType);
	if (!grouping) return [];
	const results = rows.filter(row => {
		if (kodikMediaType(row) !== mediaType) return false;
		const actual = kodikIdentities(row, mediaType);
		if (!actual.some(value => value.provider === grouping.provider && value.externalId === grouping.externalId)) return false;
		if (identities.some(expected => expected.entityType === mediaType && actual.some(value => value.provider === expected.provider && value.externalId !== expected.externalId))) throw new ImportProviderError('malformed-response');
		return true;
	});
	// One KP catalogue ID can cover different anime cours. Never guess which Shikimori work was intended.
	if (new Set(results.map(row => externalId(row.shikimori_id)).filter(Boolean)).size > 1) throw new ImportProviderError('malformed-response');
	return results;
}

/** Creates adapters with process-wide pacing. Persistence, daily budgets and durable retries belong to the runner. */
export function createImportProviders(config: ImportProviderConfig, transport: ImportTransport = defaultImportTransport): Record<ImportSource, ImportProvider> {
	const pacedTransport = pacedImportTransport(transport);
	const addresses = importAddressOrigins(config);
	const tmdbRequest = createImportRequest('tmdb', config.tmdbApiKey, pacedTransport, addresses.tmdb);
	const kpRequest = createImportRequest('kinopoisk', config.kinopoiskApiKey, pacedTransport, addresses.kinopoisk);
	const allohaRequest = createImportRequest('alloha', config.allohaApiToken, pacedTransport, addresses.alloha);
	const collapsRequest = createImportRequest('collaps', config.collapsApiToken, pacedTransport, addresses.collaps);
	const kodikRequest = createImportRequest('kodik', config.kodikApiToken, pacedTransport, addresses.kodik);
	const vibixRequest = createImportRequest('vibix', config.vibixApiToken, pacedTransport, addresses.vibix);
	const allohaHosts = configuredIframeHosts(config.allohaIframeHosts, 'ascorbic-as.stravers.live');
	const collapsHosts = configuredIframeHosts(config.collapsIframeHosts, 'api.nextembed.ws');
	const kodikHosts = configuredIframeHosts(config.kodikIframeHosts, 'kodikplayer.com');
	const vibixHosts = [...config.vibixIframeHosts ?? []];
	if (config.allohaPlayerOrigin) allohaHosts.push(new URL(normalizeImportApiOrigin(config.allohaPlayerOrigin)).hostname);
	if (config.collapsPlayerOrigin) collapsHosts.push(new URL(normalizeImportApiOrigin(config.collapsPlayerOrigin)).hostname);
	if (config.kodikPlayerOrigin) kodikHosts.push(new URL(normalizeImportApiOrigin(config.kodikPlayerOrigin)).hostname);
	if (config.vibixPlayerOrigin) vibixHosts.push(new URL(normalizeImportApiOrigin(config.vibixPlayerOrigin)).hostname);
	const tmdb: ImportProvider = {
		status: () => status('tmdb', config.tmdbApiKey, true, true, false),
		async check() {
			const response = object(await tmdbRequest('/3/configuration'));
			if (!object(response.images).secure_base_url) throw new ImportProviderError('malformed-response');
		},
		async search(query, page = 1, mediaType) {
			const keyword = text(query);
			if (keyword == null) throw new ImportProviderError('invalid-ref');
			pageNumber(page, 500);
			const payload = object(await tmdbRequest(`/3/search/${mediaType ?? 'multi'}`, { query: keyword, page: String(page), language: 'ru-RU', include_adult: 'false' }));
			if (!Array.isArray(payload.results)) throw new ImportProviderError('malformed-response');
			const results = array(payload.results).filter(raw => mediaType != null || ['movie', 'tv'].includes(String(object(raw).media_type)));
			return searchPage(results, page, (integer(payload.total_pages, 0) ?? page) > page, value => normalizeTmdbRecord(value, mediaType ?? object(value).media_type as ImportMediaType));
		},
		async fetch(ref, fields) {
			if (ref.externalId.startsWith('imdb:')) return fetchImdbReference(tmdb, ref, fields);
			validRef(ref, 'tmdb');
			const wants = (field: ImportField) => fields === undefined || fields.includes(field);
			const append = ['external_ids', ...(wants('credits') ? ['credits'] : []), ...(wants('trailerYoutubeKey') ? ['videos'] : []), ...(['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'].some(field => wants(field as ImportField)) ? ['images'] : [])];
			const payload = object(await tmdbRequest(`/3/${ref.mediaType}/${ref.externalId}`, { language: 'ru-RU', append_to_response: append.join(','), include_image_language: 'ru,en,null' }));
			if (externalId(payload.id) !== ref.externalId) throw new ImportProviderError('malformed-response');
			const seasonDetails: unknown[] = [];
			const warnings: string[] = [];
			const credits = object(payload.credits);
			if (!Array.isArray(payload.genres) || !Array.isArray(payload.production_companies) || (wants('credits') && (!Array.isArray(credits.cast) || !Array.isArray(credits.crew)))) warnings.push('tmdb-metadata-partial');
			let remaining = MAX_EPISODES;
			if (ref.mediaType === 'tv' && wants('seasons')) {
				if (!Array.isArray(payload.seasons)) warnings.push('tmdb-seasons-unavailable');
				if (Array.isArray(payload.seasons) && payload.seasons.length > MAX_SEASONS) warnings.push('tmdb-season-limit');
				const seen = new Set<number>();
				for (const raw of array(payload.seasons, MAX_SEASONS)) {
					const number = integer(object(raw).season_number, 0, 1000);
					if (number == null || seen.has(number)) continue;
					seen.add(number);
					if (remaining <= 0) { warnings.push('tmdb-episode-limit'); break; }
					try {
						const season = object(await tmdbRequest(`/3/tv/${ref.externalId}/season/${number}`, { language: 'ru-RU' }));
						if (season.season_number !== number || !Array.isArray(season.episodes)) throw new ImportProviderError('malformed-response');
						if (season.episodes.length > remaining) warnings.push('tmdb-episode-limit');
						seasonDetails.push({ season_number: number, episodes: season.episodes.slice(0, remaining) });
						remaining -= Math.min(season.episodes.length, remaining);
					} catch (error) {
						if (error instanceof ImportProviderError && ['quota-exceeded', 'rate-limited', 'not-configured'].includes(error.code)) throw error;
						warnings.push(`tmdb-season-${number}-unavailable`);
					}
				}
			}
			const result = normalizeTmdbRecord(payload, ref.mediaType, seasonDetails);
			result.warnings.push(...warnings);
			result.complete = result.warnings.length === 0;
			return result;
		},
		async lookup(identities, mediaType, fields) {
			const ownId = keyFor(identities, 'tmdb', mediaType);
			if (ownId != null) return tmdb.fetch({ source: 'tmdb', externalId: ownId, mediaType }, fields);
			const imdb = keyFor(identities, 'imdb', mediaType);
			if (imdb == null) return null;
			const response = object(await tmdbRequest(`/3/find/${imdb}`, { external_source: 'imdb_id', language: 'ru-RU' }));
			const match = object(array(response[mediaType === 'movie' ? 'movie_results' : 'tv_results'], 1)[0]);
			const id = externalId(match.id);
			return id == null ? null : tmdb.fetch({ source: 'tmdb', externalId: id, mediaType }, fields);
		},
		async collection(externalIdValue, page = 1) {
			pageNumber(page);
			const id = externalId(externalIdValue);
			if (id == null) throw new ImportProviderError('invalid-ref');
			if (page > 1) return { items: [], page, hasMore: false };
			const response = object(await tmdbRequest(`/3/collection/${id}`, { language: 'ru-RU' }));
			if (!Array.isArray(response.parts)) throw new ImportProviderError('malformed-response');
			return searchPage(response.parts, page, false, value => normalizeTmdbRecord(value, 'movie'));
		},
	};
	const kinopoisk: ImportProvider = {
		status: () => status('kinopoisk', config.kinopoiskApiKey, true, true, false),
		async check() {
			const response = object(await kpRequest('/api/v2.2/films/301'));
			if (externalId(response.kinopoiskId) !== '301') throw new ImportProviderError('malformed-response');
		},
		async search(query, page = 1, mediaType) {
			const keyword = text(query);
			if (keyword == null) throw new ImportProviderError('invalid-ref');
			pageNumber(page, 20);
			const response = object(await kpRequest('/api/v2.2/films', { keyword, page: String(page), ...(mediaType == null ? {} : { type: mediaType === 'movie' ? 'FILM' : 'TV_SERIES' }) }));
			if (!Array.isArray(response.items)) throw new ImportProviderError('malformed-response');
			return searchPage(response.items, page, (integer(response.totalPages, 0) ?? page) > page, normalizeKinopoiskRecord);
		},
		async fetch(ref, fields) {
			if (ref.externalId.startsWith('imdb:')) return fetchImdbReference(kinopoisk, ref, fields);
			validRef(ref, 'kinopoisk');
			const wants = (field: ImportField) => fields === undefined || fields.includes(field);
			const details = object(await kpRequest(`/api/v2.2/films/${ref.externalId}`));
			if (externalId(details.kinopoiskId) !== ref.externalId || kpMediaType(details) !== ref.mediaType) throw new ImportProviderError('malformed-response');
			const staff = wants('credits') ? await kpRequest('/api/v1/staff', { filmId: ref.externalId }) : [];
			if (!Array.isArray(staff)) throw new ImportProviderError('malformed-response');
			const seasons = ref.mediaType === 'tv' && wants('seasons') ? await kpRequest(`/api/v2.2/films/${ref.externalId}/seasons`) : {};
			if (ref.mediaType === 'tv' && wants('seasons') && !Array.isArray(object(seasons).items)) throw new ImportProviderError('malformed-response');
			const result = normalizeKinopoiskRecord(details, staff, seasons);
			result.artworkCandidates = [];
			for (const type of [...(wants('posterUrl') ? ['POSTER'] : []), ...(wants('backdropUrl') || wants('galleryUrls') ? ['STILL'] : [])]) {
				try {
					const images = object(await kpRequest(`/api/v2.2/films/${ref.externalId}/images`, { type, page: '1' }));
					if (!Array.isArray(images.items)) throw new ImportProviderError('malformed-response');
					const urls: string[] = [];
					for (const raw of array(images.items, 18)) {
						const image = object(raw);
						const url = safeImportUrl(image.imageUrl);
						if (!url) continue;
						urls.push(url);
						for (const field of type === 'POSTER' ? ['posterUrl'] as const : ['backdropUrl', 'galleryUrls'] as const) {
							if (!wants(field)) continue;
							result.artworkCandidates.push(artworkCandidate({ source: 'kinopoisk', field, url, previewUrl: safeImportUrl(image.previewUrl) ?? url, width: integer(image.width, 1, 100000), height: integer(image.height, 1, 100000), language: null }));
						}
					}
					if (type === 'STILL') {
						if (wants('galleryUrls')) result.galleryUrls = [...new Set(urls)];
						if (!result.backdropUrl && wants('backdropUrl')) result.backdropUrl = urls[0] ?? null;
					}
				} catch (error) {
					if (error instanceof ImportProviderError && ['quota-exceeded', 'rate-limited', 'not-configured'].includes(error.code)) throw error;
					result.warnings.push('kinopoisk-artwork-unavailable');
					result.complete = false;
				}
			}
			if (!Array.isArray(details.genres)) {
				result.warnings.push('kinopoisk-metadata-partial');
				result.complete = false;
			}
			return result;
		},
		async lookup(identities, mediaType, fields) {
			const ownId = keyFor(identities, 'kinopoisk', mediaType);
			if (ownId != null) return kinopoisk.fetch({ source: 'kinopoisk', externalId: ownId, mediaType }, fields);
			const imdb = keyFor(identities, 'imdb', mediaType);
			if (imdb == null) return null;
			const response = object(await kpRequest('/api/v2.2/films', { imdbId: imdb, page: '1' }));
			const match = array(response.items).map(object).find(item => imdbId(item.imdbId) === imdb && kpMediaType(item) === mediaType);
			const id = externalId(match?.kinopoiskId);
			return id == null ? null : kinopoisk.fetch({ source: 'kinopoisk', externalId: id, mediaType }, fields);
		},
		async collection(externalIdValue, page = 1) {
			if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(externalIdValue)) throw new ImportProviderError('invalid-ref');
			pageNumber(page, 50);
			const response = object(await kpRequest('/api/v2.2/films/collections', { type: externalIdValue, page: String(page) }));
			if (!Array.isArray(response.items)) throw new ImportProviderError('malformed-response');
			return searchPage(response.items, page, (integer(response.totalPages, 0) ?? page) > page, normalizeKinopoiskRecord);
		},
	};
	const alloha: ImportProvider = {
		status: () => status('alloha', config.allohaApiToken, false, false, false),
		async check() {
			const response = object(await allohaRequest('/v2/movies/tmdb/278', { category: 'movie' }));
			if (!object(response.data).category) throw new ImportProviderError('malformed-response');
		},
		async search() { throw new ImportProviderError('unsupported'); },
		async fetch(ref) {
			const match = /^tmdb:(movie|tv):(\d{1,16})$/.exec(ref.externalId);
			if (ref.source !== 'alloha' || match == null || match[1] !== ref.mediaType || externalId(match[2]) == null) throw new ImportProviderError('invalid-ref');
			const response = await allohaRequest(`/v2/movies/tmdb/${match[2]}`, { category: ref.mediaType === 'movie' ? 'movie' : 'serial' });
			const record = normalizeAllohaRecord(response, ref, allohaHosts, config.allohaPlayerToken);
			for (const player of record.players) {
				player.iframeUrl = rewriteImportPlayerOrigin(player.iframeUrl, config.allohaPlayerOrigin);
				for (const translation of player.translations) if (translation.iframe) translation.iframe = rewriteImportPlayerOrigin(translation.iframe, config.allohaPlayerOrigin);
			}
			return record;
		},
		async lookup(identities, mediaType) {
			const id = keyFor(identities, 'tmdb', mediaType);
			return id == null ? null : alloha.fetch({ source: 'alloha', externalId: `tmdb:${mediaType}:${id}`, mediaType });
		},
	};
	const collaps: ImportProvider = {
		status: () => status('collaps', config.collapsApiToken, true, true, true),
		async check() {
			const response = object(await collapsRequest('/list', { page: '1', limit: '20', format: 'json' }));
			if (!Array.isArray(response.results)) throw new ImportProviderError('malformed-response');
		},
		async search(query, page = 1, mediaType) {
			const keyword = text(query);
			if (keyword == null) throw new ImportProviderError('invalid-ref');
			pageNumber(page);
			const response = object(await collapsRequest('/list', { name: keyword, page: String(page), limit: '20', format: 'json', ...(mediaType == null ? {} : { type: mediaType === 'movie' ? 'films' : 'serials' }) }));
			if (!Array.isArray(response.results)) throw new ImportProviderError('malformed-response');
			return searchPage(response.results, page, response.next_page != null && response.next_page !== '' && response.next_page !== false, value => normalizeCollapsRecord(value, collapsHosts));
		},
		async fetch(ref, fields) {
			if (ref.externalId.startsWith('imdb:')) return fetchImdbReference(collaps, ref, fields);
			validRef(ref, 'collaps');
			const response = await collapsRequest('/franchise/details', { id: ref.externalId, format: 'json' });
			const result = normalizeCollapsRecord(response, collapsHosts);
			for (const player of result.players) {
				player.iframeUrl = rewriteImportPlayerOrigin(player.iframeUrl, config.collapsPlayerOrigin);
				for (const translation of player.translations) if (translation.iframe) translation.iframe = rewriteImportPlayerOrigin(translation.iframe, config.collapsPlayerOrigin);
			}
			if (result.ref.externalId !== ref.externalId || result.ref.mediaType !== ref.mediaType) throw new ImportProviderError('malformed-response');
			const details = object(object(response).result ?? object(response).data ?? response);
			if (details.genre == null && details.genres == null) {
				result.warnings.push('collaps-metadata-partial');
				result.complete = false;
			}
			return result;
		},
		async lookup(identities, mediaType, fields) {
			const ownId = keyFor(identities, 'collaps', mediaType);
			if (ownId != null) return collaps.fetch({ source: 'collaps', externalId: ownId, mediaType }, fields);
			const kpId = keyFor(identities, 'kinopoisk', mediaType);
			const imdb = keyFor(identities, 'imdb', mediaType);
			if (kpId == null && imdb == null) return null;
			const response = await collapsRequest('/franchise/details', { ...(kpId == null ? {} : { kinopoisk_id: kpId }), ...(imdb == null ? {} : { imdb_id: imdb }), format: 'json' });
			const result = normalizeCollapsRecord(response, collapsHosts);
			for (const player of result.players) {
				player.iframeUrl = rewriteImportPlayerOrigin(player.iframeUrl, config.collapsPlayerOrigin);
				for (const translation of player.translations) if (translation.iframe) translation.iframe = rewriteImportPlayerOrigin(translation.iframe, config.collapsPlayerOrigin);
			}
			if (result.ref.mediaType !== mediaType) return null;
			if (!result.identities.some(identity => (identity.provider === 'kinopoisk' && identity.externalId === kpId) || (identity.provider === 'imdb' && identity.externalId === imdb))) throw new ImportProviderError('malformed-response');
			return result;
		},
		async collection(externalIdValue, page = 1) {
			const id = externalId(externalIdValue);
			if (id == null) throw new ImportProviderError('invalid-ref');
			pageNumber(page);
			const response = object(await collapsRequest('/list', { collection_id: id, page: String(page), limit: '20', format: 'json' }));
			if (!Array.isArray(response.results)) throw new ImportProviderError('malformed-response');
			return searchPage(response.results, page, response.next_page != null && response.next_page !== '' && response.next_page !== false, value => normalizeCollapsRecord(value, collapsHosts));
		},
		async updates(page = 1) {
			pageNumber(page);
			const response = object(await collapsRequest('/video/news', { page: String(page), limit: '20', format: 'json' }));
			if (!Array.isArray(response.results)) throw new ImportProviderError('malformed-response');
			return searchPage(response.results, page, response.next_page != null && response.next_page !== '' && response.next_page !== false, value => normalizeCollapsRecord(value, collapsHosts));
		},
		async collectionDictionary(page = 1, limit = 20) {
			pageNumber(page);
			maintenanceLimit(limit);
			const { rows, hasMore } = maintenancePage(await collapsRequest('/collection', { page: String(page), limit: String(limit), format: 'json' }), limit);
			const items = rows.map(raw => {
				const row = object(raw);
				const id = externalId(row.id);
				if (!id) throw new ImportProviderError('malformed-response');
				return { externalId: id, name: requireTitle(row.name) };
			});
			if (new Set(items.map(item => item.externalId)).size !== items.length || (hasMore && !items.length)) throw new ImportProviderError('malformed-response');
			return { items, page, hasMore, warnings: [] };
		},
		async collectionMembers(externalIdValue, page = 1, limit = 20) {
			const id = externalId(externalIdValue);
			if (!id) throw new ImportProviderError('invalid-ref');
			pageNumber(page);
			maintenanceLimit(limit);
			const { rows, hasMore } = maintenancePage(await collapsRequest('/list', { collection_id: id, page: String(page), limit: String(limit), join_seasons: 'false', format: 'json' }), limit);
			const items = rows.map(raw => {
				const row = object(raw);
				const ownId = externalId(row.id);
				if (!ownId || typeof row.type !== 'string' || !['films', 'movie', 'serials', 'series', 'cartoon', 'cartoon-serials', 'cartoon-series', 'show', 'anime', 'anime-serials', 'anime-series'].includes(row.type)) throw new ImportProviderError('malformed-response');
				const mediaType = collapsMediaType(row);
				return { externalId: ownId, mediaType, identities: [...identity('collaps', ownId, mediaType), ...identity('kinopoisk', row.kinopoisk_id, mediaType), ...identity('imdb', row.imdb_id, mediaType, true)] };
			});
			if (new Set(items.map(item => item.externalId)).size !== items.length || (hasMore && !items.length)) throw new ImportProviderError('malformed-response');
			return { items, page, hasMore };
		},
	};
	const kodik: ImportProvider = {
		status: () => status('kodik', config.kodikApiToken, true, false, false),
		async check() {
			kodikRows(await kodikRequest('/list', { limit: '1' }));
		},
		async search(query, page = 1, mediaType) {
			const keyword = text(query);
			if (!keyword || (mediaType !== undefined && !['movie', 'tv'].includes(mediaType))) throw new ImportProviderError('invalid-ref');
			// Kodik exposes opaque next_page URLs. This first-stage adapter never follows
			// credential-bearing URLs or pretends an integer is a provider cursor.
			if (page !== 1) throw new ImportProviderError('unsupported');
			const response = await kodikRequest('/search', { title: keyword, limit: '100', with_material_data: 'true' });
			const rows = kodikRows(response).filter(row => mediaType === undefined || kodikMediaType(row) === mediaType);
			const pageResult = searchPage(rows, 1, false, value => normalizeKodikRecord(value, [], kodikHosts));
			pageResult.items = pageResult.items.filter((value, index, all) => all.findIndex(other => other.ref.externalId === value.ref.externalId && other.ref.mediaType === value.ref.mediaType) === index);
			return pageResult;
		},
		async fetch(ref, fields) {
			if (ref.source !== 'kodik' || !validImportRef(ref)) throw new ImportProviderError('invalid-ref');
			const wantsEpisodes = !fields || fields.includes('players') || fields.includes('seasons');
			const parameters = { with_material_data: 'true', ...(wantsEpisodes ? { with_seasons: 'true', with_episodes: 'true' } : {}), limit: '100' };
			const canonical = /^(shikimori|kinopoisk)-([1-9][0-9]{0,15})$|^(imdb)-(tt[0-9]{5,12})$/u.exec(ref.externalId);
			const authoritative = canonical ? { provider: canonical[1] ?? canonical[3], externalId: canonical[2] ?? canonical[4], entityType: ref.mediaType } : null;
			const response: unknown = await kodikRequest('/search', { ...parameters, ...(authoritative ? { [`${authoritative.provider}_id`]: authoritative.externalId } : { id: ref.externalId }) });
			const exactRows = kodikRows(response);
			const anchors = authoritative ? matchingKodikRows(exactRows, [authoritative], ref.mediaType).sort((left, right) => String(left.id).localeCompare(String(right.id))) : exactRows.filter(row => row.id === ref.externalId && kodikMediaType(row) === ref.mediaType);
			if (!anchors.length) throw new ImportProviderError('not-found');
			if (!authoritative && anchors.length !== 1) throw new ImportProviderError('malformed-response');
			if (authoritative && (new Set(anchors.map(value => canonicalKodikRef(value).externalId)).size > 1 || (authoritative.provider !== 'shikimori' && object(response).next_page))) throw new ImportProviderError('malformed-response');
			const anchor = anchors[0];
			const canonicalRef = canonicalKodikRef(anchor);
			// Preview and the queued canonical ref must pick the same edition's artwork,
			// not silently substitute screenshots when a different voice was the raw input.
			if (canonicalRef.externalId !== ref.externalId) return kodik.fetch(canonicalRef, fields);
			const result = normalizeKodikRecord(anchor, authoritative ? anchors : [], kodikHosts);
			if (object(response).next_page) { result.warnings.push('kodik-voice-limit'); result.complete = false; }
			for (const player of result.players) {
				player.iframeUrl = rewriteImportPlayerOrigin(player.iframeUrl, config.kodikPlayerOrigin);
				for (const translation of player.translations) if (translation.iframe) translation.iframe = rewriteImportPlayerOrigin(translation.iframe, config.kodikPlayerOrigin);
			}
			return result;
		},
		async lookup(identities, mediaType, fields) {
			if (!['movie', 'tv'].includes(mediaType)) throw new ImportProviderError('invalid-ref');
			const own = identities.find(value => value.provider === 'kodik' && value.entityType === mediaType)?.externalId;
			if (own) return kodik.fetch({ source: 'kodik', externalId: own, mediaType }, fields);
			const grouping = kodikGrouping(identities, mediaType);
			if (!grouping) return null;
			const response = await kodikRequest('/search', { [grouping.parameter]: grouping.externalId, limit: '100', with_material_data: 'true' });
			// An incomplete first page cannot establish an unambiguous identity.
			if (object(response).next_page) throw new ImportProviderError('malformed-response');
			const rows = matchingKodikRows(kodikRows(response), identities, mediaType).sort((left, right) => String(left.id).localeCompare(String(right.id)));
			if (!rows.length) return null;
			return kodik.fetch(canonicalKodikRef(rows[0]), fields);
		},
	};
	const vibix: ImportProvider = {
		status: () => status('vibix', config.vibixApiToken, true, false, false),
		async check() {
			// The live API rejects limit=1 despite the OpenAPI minimum; its default page is supported.
			const response = object(await vibixRequest('/api/v1/publisher/videos/links', { page: '1', limit: '20' }));
			if (response.success === false || !Array.isArray(response.data)) throw new ImportProviderError('malformed-response');
		},
		async search(query, page = 1, mediaType) {
			const keyword = text(query); pageNumber(page);
			if (!keyword || (mediaType != null && !['movie', 'tv'].includes(mediaType))) throw new ImportProviderError('invalid-ref');
			const response = await vibixRequest('/api/v1/publisher/videos/search', { name: keyword, page: String(page), limit: '20' }, { method: 'POST' });
			return vibixSearchPage(response, page, vibixHosts, mediaType);
		},
		async fetch(ref) {
			if (ref.source !== 'vibix' || !validImportRef(ref) || (!ref.externalId.startsWith('imdb:') && externalId(ref.externalId) !== ref.externalId)) throw new ImportProviderError('invalid-ref');
			const path = ref.externalId.startsWith('imdb:') ? `imdb/${ref.externalId.slice(5)}` : `kp/${ref.externalId}`;
			const record = normalizeVibixRecord(await vibixRequest(`/api/v1/publisher/videos/${path}`), vibixHosts, ref);
			for (const player of record.players) if (player.iframeUrl) player.iframeUrl = rewriteImportPlayerOrigin(player.iframeUrl, config.vibixPlayerOrigin);
			return record;
		},
		async lookup(identities, mediaType) {
			if (!['movie', 'tv'].includes(mediaType)) throw new ImportProviderError('invalid-ref');
			const expected = identities.filter(item => item.entityType === mediaType && ['vibix', 'kinopoisk', 'imdb'].includes(item.provider));
			for (const provider of ['vibix', 'kinopoisk', 'imdb']) if (new Set(expected.filter(item => item.provider === provider).map(item => item.externalId)).size > 1) throw new ImportProviderError('malformed-response');
			const own = expected.find(item => item.provider === 'vibix');
			const kp = keyFor(expected, 'kinopoisk', mediaType); const imdb = keyFor(expected, 'imdb', mediaType);
			if (!own && !kp && !imdb) return null;
			const ref: ImportRef = { source: 'vibix', externalId: own?.externalId ?? kp ?? `imdb:${imdb}`, mediaType };
			let record: ImportRecord;
			try { record = await vibix.fetch(ref); } catch (error) {
				if (!(error instanceof ImportProviderError) || error.code !== 'not-found') throw error;
				if (own || !kp || !imdb) return null;
				try { record = await vibix.fetch({ source: 'vibix', externalId: `imdb:${imdb}`, mediaType }); } catch (fallbackError) {
					if (fallbackError instanceof ImportProviderError && fallbackError.code === 'not-found') return null;
					throw fallbackError;
				}
			}
			assertVibixIdentities(record, expected, mediaType);
			return record;
		},
	};
	return { tmdb, kinopoisk, alloha, collaps, kodik, vibix };
}
