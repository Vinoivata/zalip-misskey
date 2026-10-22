/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type { ImportPlayer, ImportRecord, ImportVibixEmbed, ImportVibixEpisodeMap } from './types.js';

const MAX_PAIRS = 1000;
const MAX_VOICES = 100;
const MAX_SEASONS = 50;

/** Never evaluate a provider/cached accessor or inherit a selector. */
function dataObject(value: unknown, keys?: readonly string[]): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.some(key => typeof key !== 'string') || (keys && (ownKeys.length !== keys.length || ownKeys.some(key => !keys.includes(key as string))))) return null;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return null;
	return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
}

function boundedArray(value: unknown, maximum: number): unknown[] | null {
	if (!Array.isArray(value) || value.length > maximum || Reflect.ownKeys(value).length !== value.length + 1) return null;
	const descriptors = Object.getOwnPropertyDescriptors(value);
	if (Object.values(descriptors).some(descriptor => !('value' in descriptor))) return null;
	return Array.from({ length: value.length }, (_, index) => descriptors[index]?.value);
}

function numericId(value: unknown): string | null {
	const id = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
	return typeof id === 'string' && /^[1-9][0-9]{0,15}$/u.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

function coordinate(value: unknown, maximum: number): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum;
}

export function vibixAccountHash(token: string | undefined, origin = 'https://vibix.org'): string | null {
	return token?.trim() ? createHash('sha256').update(JSON.stringify(['vibix-catalog-v1', origin, token.trim()])).digest('hex') : null;
}

export function validVibixAccountHash(value: unknown): value is string {
	return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

/** Strict bounded public DTO, bound to the authoritative publisher and SDK series namespace. */
export function normalizeVibixEpisodeMap(value: unknown, embed: ImportVibixEmbed | undefined): ImportVibixEpisodeMap | null {
	const parent = dataObject(embed, ['publisherId', 'type', 'id']);
	if (!parent || parent.type !== 'series' || typeof parent.publisherId !== 'string' || typeof parent.id !== 'string' || !numericId(parent.publisherId) || !numericId(parent.id)) return null;
	const map = dataObject(value, ['publisherId', 'seriesId', 'items']);
	if (!map || map.publisherId !== parent.publisherId || map.seriesId !== parent.id) return null;
	const rawItems = boundedArray(map.items, MAX_PAIRS);
	if (!rawItems?.length) return null;
	const items: ImportVibixEpisodeMap['items'] = [];
	const keys = new Set<string>(); const voices = new Set<string>(); const seasons = new Set<number>();
	for (const raw of rawItems) {
		const item = dataObject(raw, ['seasonNumber', 'episodeNumber', 'translationId', 'movieId']);
		if (!item || !coordinate(item.seasonNumber, 1000) || !coordinate(item.episodeNumber, 100000) || typeof item.translationId !== 'string' || !numericId(item.translationId) || typeof item.movieId !== 'string' || !numericId(item.movieId)) return null;
		const key = `${item.seasonNumber}:${item.episodeNumber}:${item.translationId}`;
		if (keys.has(key)) return null;
		keys.add(key); voices.add(item.translationId); seasons.add(item.seasonNumber);
		if (voices.size > MAX_VOICES || seasons.size > MAX_SEASONS) return null;
		items.push({ seasonNumber: item.seasonNumber, episodeNumber: item.episodeNumber, translationId: item.translationId, movieId: item.movieId });
	}
	return { publisherId: parent.publisherId, seriesId: parent.id, items };
}

/** No fuzzy matching: every identity and API row ID must agree with the already fetched record. */
export function normalizeVibixCatalogMap(value: unknown, record: ImportRecord): ImportVibixEpisodeMap | null {
	const player = record.players.find(candidate => candidate.source === 'vibix');
	const embed = player?.vibixEmbed;
	if (record.ref.mediaType !== 'tv' || !player || embed?.type !== 'series') return null;
	const response = dataObject(value); const rows = response && response.success !== false ? boundedArray(response.data, 30) : null;
	if (!rows) return null;
	const expected = record.identities.filter(identity => identity.entityType === 'tv' && ['kinopoisk', 'imdb'].includes(identity.provider));
	if (!expected.length) return null;
	const matches = rows.flatMap(raw => {
		const row = dataObject(raw);
		if (!row || numericId(row.id) !== player.externalId || row.type !== 'serial') return [];
		const kp = numericId(row.kp_id ?? row.kinopoisk_id);
		if (row.kp_id != null && row.kinopoisk_id != null && numericId(row.kp_id) !== numericId(row.kinopoisk_id)) return [];
		if (!expected.every(identity => identity.provider === 'kinopoisk' ? kp === identity.externalId : row.imdb_id === identity.externalId)) return [];
		return [row];
	});
	if (matches.length !== 1) return null;
	const row = matches[0]; const voices = boundedArray(row.voiceovers, MAX_VOICES); const seasons = dataObject(row.episodes);
	if (!voices || !seasons || Object.keys(seasons).length > MAX_SEASONS) return null;
	const voiceIds = new Set<string>();
	for (const raw of voices) {
		const voice = dataObject(raw); const id = voice && numericId(voice.id);
		if (!id || voiceIds.has(id) || !player.translations.some(translation => translation.id === id)) return null;
		voiceIds.add(id);
	}
	const items: ImportVibixEpisodeMap['items'] = [];
	for (const [seasonKey, rawSeason] of Object.entries(seasons)) {
		if (!/^s(?:0|[1-9][0-9]{0,3})$/u.test(seasonKey)) return null;
		const season = dataObject(rawSeason);
		if (!season || Object.keys(season).length > MAX_PAIRS) return null;
		for (const [episodeKey, rawVoices] of Object.entries(season)) {
			if (!/^e(?:0|[1-9][0-9]{0,5})$/u.test(episodeKey)) return null;
			const episodeVoices = dataObject(rawVoices);
			if (!episodeVoices || Object.keys(episodeVoices).length > MAX_VOICES) return null;
			for (const [voiceKey, rawMovieId] of Object.entries(episodeVoices)) {
				const translationId = /^v([1-9][0-9]{0,15})$/u.exec(voiceKey)?.[1]; const movieId = numericId(rawMovieId);
				if (!translationId || !voiceIds.has(translationId) || !movieId || items.length >= MAX_PAIRS) return null;
				items.push({ seasonNumber: Number(seasonKey.slice(1)), episodeNumber: Number(episodeKey.slice(1)), translationId, movieId });
			}
		}
	}
	return normalizeVibixEpisodeMap({ publisherId: embed.publisherId, seriesId: embed.id, items }, embed);
}

/** The map is private-account scoped; rotating credentials cannot mix two publishers' resources. */
export function publicVibixEpisodeMap(player: ImportPlayer, token: string | undefined, origin?: string): ImportVibixEpisodeMap | null {
	if (!validVibixAccountHash(player.vibixAccountHash) || player.vibixAccountHash !== vibixAccountHash(token, origin)) return null;
	const map = normalizeVibixEpisodeMap(player.vibixEpisodeMap, player.vibixEmbed);
	return map && Array.isArray(player.translations) && map.items.every(item => player.translations.some(voice => voice?.id === item.translationId)) ? map : null;
}

/** Failed/empty enrichment cannot erase a working map within the exact same account and SDK parent. */
export function retainVibixEpisodeMap(previous: ImportPlayer | undefined, incoming: ImportPlayer): ImportPlayer {
	if (incoming.source !== 'vibix' || incoming.vibixEpisodeMap || !previous || !validVibixAccountHash(incoming.vibixAccountHash) || incoming.vibixAccountHash !== previous.vibixAccountHash) return incoming;
	const before = dataObject(previous.vibixEmbed, ['publisherId', 'type', 'id']); const after = dataObject(incoming.vibixEmbed, ['publisherId', 'type', 'id']);
	if (!before || !after || ['publisherId', 'type', 'id'].some(key => before[key] !== after[key])) return incoming;
	const map = normalizeVibixEpisodeMap(previous.vibixEpisodeMap, incoming.vibixEmbed);
	return map && map.items.every(item => incoming.translations.some(voice => voice.id === item.translationId)) ? { ...incoming, vibixEpisodeMap: map } : incoming;
}
