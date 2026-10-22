/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { normalizeVibixRecord } from './providers.js';
import { normalizeVibixCatalogMap, normalizeVibixEpisodeMap, publicVibixEpisodeMap, retainVibixEpisodeMap, vibixAccountHash } from './vibix-map.js';
import type { ImportPlayer } from './types.js';

// Entirely synthetic: API record ID, parent SDK ID and individual video IDs differ.
const embed = { publisherId: '10', type: 'series' as const, id: '30' };
const item = { seasonNumber: 1, episodeNumber: 1, translationId: '5', movieId: '701' };
const map = () => ({ publisherId: '10', seriesId: '30', items: [item, { ...item, translationId: '6', movieId: '702' }, { ...item, episodeNumber: 2, movieId: '703' }] });

function record() {
	return normalizeVibixRecord({ id: 200, name: 'Synthetic serial', type: 'serial', kp_id: 100, imdb_id: 'tt1234567', voiceovers: [{ id: 5, name: 'First' }, { id: 6, name: 'Second' }], embed_code: '<ins data-publisher-id="10" data-type="series" data-id="30"></ins>' });
}

function catalogue(patch: Record<string, unknown> = {}) {
	return { data: [{ id: 200, type: 'serial', kp_id: 100, imdb_id: 'tt1234567', voiceovers: [{ id: 5 }, { id: 6 }], episodes: { s1: { e1: { v5: 701, v6: 702 }, e2: { v5: 703 } } }, ...patch }] };
}

const player = (): ImportPlayer => ({ ...record().players[0], vibixAccountHash: vibixAccountHash('fixture')!, vibixEpisodeMap: map() });

describe('Vibix catalogue SDK mapping', () => {
	test('projects exact episode/voice SDK movie IDs, never API row IDs or raw metadata', () => {
		expect(normalizeVibixCatalogMap(catalogue({ secret: 'private', embed_code: '<script>private</script>' }), record())).toEqual(map());
		expect(JSON.stringify(normalizeVibixCatalogMap(catalogue(), record()))).not.toContain('200');
		expect(record().players[0].episodes).toEqual([]);
	});
	test('requires every authoritative identity, API row and serial type without fuzzy title matching', () => {
		for (const patch of [{ id: 30 }, { id: 201 }, { type: 'movie' }, { kp_id: 101 }, { imdb_id: 'tt7654321' }, { imdb_id: undefined }, { kinopoisk_id: 101 }]) expect(normalizeVibixCatalogMap(catalogue(patch), record())).toBeNull();
		const duplicate = catalogue(); duplicate.data.push(duplicate.data[0]); expect(normalizeVibixCatalogMap(duplicate, record())).toBeNull();
		expect(normalizeVibixCatalogMap({ data: [] }, record())).toBeNull();
		expect(normalizeVibixCatalogMap({ success: false, ...catalogue() }, record())).toBeNull();
	});
	test('rejects unknown voices, noncanonical coordinates, malformed IDs and excessive coverage as wholly unknown', () => {
		for (const episodes of [{ s1: { e1: { v7: 701 } } }, { s01: { e1: { v5: 701 } } }, { s1: { e01: { v5: 701 } } }, { s1: { e1: { v5: '01' } } }, { s1: { e1: { v5: '9007199254740992' } } }, { s1001: { e1: { v5: 701 } } }, { s1: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [`e${index}`, { v5: 701 }])) }]) expect(normalizeVibixCatalogMap(catalogue({ episodes }), record())).toBeNull();
		expect(normalizeVibixCatalogMap(catalogue({ episodes: {} }), record())).toBeNull();
		expect(normalizeVibixCatalogMap(catalogue({ voiceovers: [{ id: 5 }, { id: 5 }] }), record())).toBeNull();
	});
	test('strict inert DTO validation rejects accessors, injected fields, inherited data and duplicate/conflicting pairs', () => {
		const getter = vi.fn(() => [item]); const accessor = Object.defineProperty({ publisherId: '10', seriesId: '30' }, 'items', { get: getter, enumerable: true });
		for (const value of [accessor, Object.create(map()), { ...map(), raw: '<script>' }, { ...map(), publisherId: '11' }, { ...map(), seriesId: '200' }, { ...map(), items: [{ ...item, token: 'bad' }] }, { ...map(), items: [item, { ...item, movieId: '999' }] }, { ...map(), items: [{ ...item, movieId: 701 }] }, { ...map(), items: Array.from({ length: 1001 }, () => item) }]) expect(normalizeVibixEpisodeMap(value, embed)).toBeNull();
		expect(getter).not.toHaveBeenCalled();
		expect(normalizeVibixEpisodeMap(map(), embed)).toEqual(map());
	});
	test('keeps cached mapping on empty/error enrichment only within the same account, publisher and parent SDK ID', () => {
		const old = player(); const incoming = { ...old }; delete incoming.vibixEpisodeMap;
		expect(retainVibixEpisodeMap(old, incoming).vibixEpisodeMap).toEqual(map());
		expect(retainVibixEpisodeMap({ ...old, vibixEmbed: { ...embed, id: '31' } }, incoming).vibixEpisodeMap).toBeUndefined();
		for (const changed of [{ ...incoming, vibixAccountHash: vibixAccountHash('different')! }, { ...incoming, vibixAccountHash: undefined }, { ...incoming, vibixEmbed: { ...embed, publisherId: '11' } }, { ...incoming, vibixEmbed: { ...embed, id: '31' } }, { ...incoming, translations: [{ id: '5', name: 'First' }] }]) expect(retainVibixEpisodeMap(old, changed).vibixEpisodeMap).toBeUndefined();
	});
	test('public projection binds private account provenance and emits only the numeric public DTO', () => {
		expect(publicVibixEpisodeMap(player(), 'fixture')).toEqual(map());
		for (const token of [undefined, 'different']) expect(publicVibixEpisodeMap(player(), token)).toBeNull();
		expect(publicVibixEpisodeMap(player(), 'fixture', 'https://different.example.org')).toBeNull();
		expect(JSON.stringify(publicVibixEpisodeMap(player(), 'fixture'))).not.toContain(vibixAccountHash('fixture'));
	});
});
