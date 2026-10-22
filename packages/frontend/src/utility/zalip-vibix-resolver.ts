/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { validVibixEmbed } from '@/utility/zalip-vibix-player.js';
import type { VibixEmbed } from '@/utility/zalip-vibix-player.js';

export type VibixEpisodeMap = { publisherId: string; seriesId: string; items: { seasonNumber: number; episodeNumber: number; translationId: string; movieId: string }[] };
type VibixSource = { source: string; vibixEmbed?: VibixEmbed; vibixEpisodeMap?: VibixEpisodeMap; translations: { id: string }[] };

function inertObject(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null;
	const ownKeys = Reflect.ownKeys(value); const descriptors = Object.getOwnPropertyDescriptors(value);
	return ownKeys.length === keys.length && ownKeys.every(key => typeof key === 'string' && keys.includes(key)) && Object.values(descriptors).every(descriptor => 'value' in descriptor)
		? Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value])) : null;
}

function id(value: unknown): value is string {
	return typeof value === 'string' && /^[1-9][0-9]{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
}

/** Only known exact pairs change SDK type/id; partial or absent maps retain the legacy series player. */
export function resolveVibixPlaybackEmbed(source: VibixSource | null, translationId: string | null, seasonNumber: number | null, episodeNumber: number | null): VibixEmbed | null {
	if (source?.source !== 'vibix' || !validVibixEmbed(source.vibixEmbed)) return null;
	const embed = source.vibixEmbed;
	if (translationId !== null && (!id(translationId) || !source.translations.some(voice => voice.id === translationId))) return null;
	const fallback = { ...embed };
	if (embed.type !== 'series' || seasonNumber === null || episodeNumber === null || translationId === null) return fallback;
	const map = inertObject(source.vibixEpisodeMap, ['publisherId', 'seriesId', 'items']);
	if (!map || map.publisherId !== embed.publisherId || map.seriesId !== embed.id || !Array.isArray(map.items) || !map.items.length || map.items.length > 1000) return fallback;
	const descriptors = Object.getOwnPropertyDescriptors(map.items);
	if (Reflect.ownKeys(map.items).length !== map.items.length + 1 || Object.values(descriptors).some(descriptor => !('value' in descriptor))) return fallback;
	let result = fallback;
	const pairs = new Set<string>(); const voices = new Set<string>(); const seasons = new Set<number>();
	for (let index = 0; index < map.items.length; index++) {
		const item = inertObject(descriptors[index]?.value, ['seasonNumber', 'episodeNumber', 'translationId', 'movieId']);
		if (!item || typeof item.seasonNumber !== 'number' || !Number.isInteger(item.seasonNumber) || item.seasonNumber < 0 || item.seasonNumber > 1000 || typeof item.episodeNumber !== 'number' || !Number.isInteger(item.episodeNumber) || item.episodeNumber < 0 || item.episodeNumber > 100000 || !id(item.translationId) || !id(item.movieId) || !source.translations.some(voice => voice.id === item.translationId)) return fallback;
		const key = `${item.seasonNumber}:${item.episodeNumber}:${item.translationId}`;
		if (pairs.has(key)) return fallback;
		pairs.add(key); voices.add(item.translationId); seasons.add(item.seasonNumber);
		if (voices.size > 100 || seasons.size > 50) return fallback;
		if (item.seasonNumber === seasonNumber && item.episodeNumber === episodeNumber && item.translationId === translationId) result = { publisherId: embed.publisherId, type: 'movie', id: item.movieId };
	}
	return result;
}
