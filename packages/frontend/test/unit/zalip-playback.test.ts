/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { playbackEpisodeAvailable, playbackTranslationLabel, selectablePlaybackTranslations, workPlaybackIframe, workPlaybackSources } from '@/utility/zalip-playback.js';
import type { LegacyAllohaPlayback, PlaybackSource } from '@/utility/zalip-playback.js';

const alloha: PlaybackSource = { source: 'alloha', label: 'Alloha', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture', quality: null, translations: [{ id: '246', name: 'Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=246' }], episodes: [] };
const legacy: LegacyAllohaPlayback = { available: true, label: 'Legacy', iframe: 'https://legacy.example/?token_movie=fixture', translations: [{ id: 246, name: 'Legacy Studio', iframe: 'https://legacy.example/?translation=246', quality: 'HD', resolutions: ['1080p'] }], lastCheckedAt: null };
const kodik: PlaybackSource = { source: 'kodik', label: 'Kodik', iframe: 'https://kodik.example/serial/123/default/720p', quality: 'HD', translations: [{ id: 'serial-123', name: 'Studio One', iframe: 'https://kodik.example/serial/123/voice-one/720p?min_age=12', episodes: [{ seasonNumber: 0, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] }, { id: 'serial-456', name: 'Studio Two', iframe: 'https://kodik.example/serial/456/voice-two/720p', episodes: [{ seasonNumber: 2, episodeNumber: 1 }] }], episodes: [{ seasonNumber: 0, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 1 }, { seasonNumber: 2, episodeNumber: 3 }] };

describe('work playback helpers', () => {
	it('normalizes legacy numeric IDs without mutating input snapshots', () => {
		const sources = workPlaybackSources([], legacy);
		expect(sources[0].translations[0].id).toBe('246');
		expect(legacy.translations[0].id).toBe(246);
		expect(sources[0].source).toBe('alloha');
	});

	it('retains imported voice URLs and only recovers missing same-provider URLs from the legacy cache', () => {
		const source = { ...alloha, translations: [{ id: '246', name: 'Imported Studio' }] };
		const recovered = workPlaybackSources([source], legacy);
		expect(recovered).toHaveLength(1);
		expect(recovered[0].translations[0]).toMatchObject({ id: '246', name: 'Imported Studio', iframe: legacy.translations[0].iframe });
		expect(source.translations[0]).not.toHaveProperty('iframe');
		expect(workPlaybackSources([alloha], legacy)[0].translations[0].iframe).toBe(alloha.translations[0].iframe);
	});

	it('merges legacy-only providers using the configured label and order without reviving disabled players', () => {
		const collaps: PlaybackSource = { ...alloha, source: 'collaps', label: 'Collaps', iframe: 'https://collaps.example/embed/fixture', translations: [] };
		const settings = [{ source: 'alloha' as const, label: 'Configured Alloha', enabled: true, position: 0 }, { source: 'collaps' as const, label: 'Collaps', enabled: true, position: 1 }];
		expect(workPlaybackSources([collaps], legacy, settings).map(source => source.label)).toEqual(['Configured Alloha', 'Collaps']);
		settings[0].enabled = false;
		expect(workPlaybackSources([alloha, collaps], legacy, settings).map(source => source.source)).toEqual(['collaps']);
	});

	it('keeps metadata-only voices out of the external picker', () => {
		expect(selectablePlaybackTranslations({ ...alloha, translations: [{ id: 'metadata', name: 'Native' }, ...alloha.translations] })).toEqual(alloha.translations);
		expect(selectablePlaybackTranslations(null)).toEqual([]);
	});
	it('exposes numeric SDK-only Vibix voices without fabricating iframe URLs or borrowing another provider', () => {
		const vibix: PlaybackSource = { source: 'vibix', label: 'Vibix', iframe: '', vibixEmbed: { publisherId: '123456789', type: 'series', id: '12345' }, quality: 'HD', translations: [{ id: '26', name: 'Vibix Studio' }, { id: 'unsafe', name: 'Unusable voice' }], episodes: [] };
		expect(selectablePlaybackTranslations(vibix)).toEqual([vibix.translations[0]]);
		expect(workPlaybackIframe(vibix, '26', 2, 3, true)).toBeNull();
		expect(selectablePlaybackTranslations({ ...vibix, vibixEmbed: undefined })).toEqual([]);
		expect(selectablePlaybackTranslations({ ...vibix, vibixEmbed: undefined, translations: [{ id: '26', name: 'Unsafe guessed URL', iframe: 'https://wrong.example/player' }] })).toEqual([]);
		expect(workPlaybackSources([vibix], legacy).map(source => source.source)).toEqual(['vibix', 'alloha']);
		expect(playbackEpisodeAvailable({ ...vibix, translations: [{ ...vibix.translations[0], episodes: [{ seasonNumber: 2, episodeNumber: 1 }] }] }, '26', 2, 3)).toBe(false);
	});
	it('labels explicit subtitle editions without changing source names or duplicating existing markers', () => {
		const translation = { id: 'serial-123', name: 'Studio', type: 'subtitles' as const };
		expect(playbackTranslationLabel(translation, 'Субтитры')).toBe('Studio · Субтитры');
		expect(translation.name).toBe('Studio');
		for (const name of ['Рус. Субтитры', 'English subtitles', 'English Subtitle']) expect(playbackTranslationLabel({ ...translation, name }, 'Субтитры')).toBe(name);
		expect(playbackTranslationLabel({ ...translation, type: 'voice' }, 'Субтитры')).toBe('Studio');
		expect(playbackTranslationLabel({ id: '246', name: 'Legacy' }, 'Субтитры')).toBe('Legacy');
	});

	it('preserves server-provided voice selectors and credentials while updating only the episode', () => {
		const url = new URL(workPlaybackIframe(alloha, '246', 2, 3, true)!);
		expect(url.searchParams.get('token')).toBe('public-fixture');
		expect(url.searchParams.get('translation')).toBe('246');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('episode')).toBe('3');
		expect(url.searchParams.get('hidden')).toBe('episode,season,translation');
		expect(url.searchParams.has('time')).toBe(false);
		const collaps: PlaybackSource = { ...alloha, source: 'collaps', iframe: 'https://collaps.example/embed/fixture', translations: [{ id: 'studio', name: 'Studio', iframe: 'https://collaps.example/embed/fixture?oneSound=Studio' }] };
		expect(new URL(workPlaybackIframe(collaps, 'studio', 2, 3)!).searchParams.get('oneSound')).toBe('Studio');
		expect(new URL(workPlaybackIframe(collaps, 'studio', 2, 3)!).searchParams.has('translation')).toBe(false);
		const collapsUrl = new URL(workPlaybackIframe(collaps, 'studio', 2, 3, true)!);
		expect(collapsUrl.searchParams.get('showMenu')).toBe('false');
		expect(collapsUrl.searchParams.get('showPreNext')).toBe('false');
		expect(collapsUrl.searchParams.has('only_episode')).toBe(false);
		expect(collapsUrl.searchParams.has('time')).toBe(false);
	});

	it('uses the source iframe for unknown voices and does not add partial episode coordinates', () => {
		for (const iframe of [workPlaybackIframe(alloha, 'missing', null, 3), workPlaybackIframe(alloha, null, 2, null)]) {
			const url = new URL(iframe!);
			expect(url.origin).toBe(new URL(alloha.iframe).origin);
			expect(url.searchParams.get('token_movie')).toBe('fixture');
			expect(url.searchParams.has('season')).toBe(false);
			expect(url.searchParams.has('episode')).toBe(false);
			expect(url.searchParams.has('hidden')).toBe(false);
		}
		expect(workPlaybackIframe(null, null, null, null)).toBeNull();
	});
	it('preserves Kodik edition paths without adding another provider voice selector', () => {
		const url = new URL(workPlaybackIframe(kodik, 'serial-123', 2, 3)!);
		expect(url.searchParams.get('only_episode')).toBe('true');
		expect(url.pathname).toBe('/serial/123/voice-one/720p');
		expect(url.searchParams.get('min_age')).toBe('12');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('episode')).toBe('3');
		expect(url.searchParams.has('translation')).toBe(false);
		expect(url.searchParams.has('oneSound')).toBe(false);
		expect(new URL(workPlaybackIframe(kodik, 'serial-456', 2, 1)!).pathname).toBe('/serial/456/voice-two/720p');
		expect(kodik.translations[0].iframe).not.toContain('season=');
		expect(new URL(workPlaybackIframe(kodik, 'serial-123', null, null)!).searchParams.has('only_episode')).toBe(false);
	});
	it('respects known per-voice episode coverage, including specials, without remapping episodes', () => {
		expect(playbackEpisodeAvailable(kodik, 'serial-123', 0, 1)).toBe(true);
		expect(playbackEpisodeAvailable(kodik, 'serial-123', 2, 3)).toBe(true);
		expect(playbackEpisodeAvailable(kodik, 'serial-456', 2, 3)).toBe(false);
		expect(workPlaybackIframe(kodik, 'serial-456', 2, 3)).toBeNull();
		const knownEmpty = { ...kodik, translations: [{ ...kodik.translations[0], episodes: [] }] };
		expect(workPlaybackIframe(knownEmpty, 'serial-123', 2, 1)).toBeNull();
		expect(workPlaybackIframe(knownEmpty, 'serial-123', null, null)).not.toBeNull();
		const unknown = { ...kodik, translations: [{ ...kodik.translations[0], episodes: undefined }] };
		expect(workPlaybackIframe(unknown, 'serial-123', 2, 1)).not.toBeNull();
		expect(workPlaybackIframe({ ...alloha, translations: [{ ...alloha.translations[0], episodes: [] }] }, '246', 2, 3)).toBeNull();
		expect(playbackEpisodeAvailable(null, null, 2, 3)).toBe(false);
	});
	it.each(['alloha', 'collaps'] as const)('honors exact known %s voice coverage and preserves legacy unknown coverage', source => {
		const base: PlaybackSource = { ...alloha, source, translations: [{ ...alloha.translations[0], episodes: [{ seasonNumber: 0, episodeNumber: 1 }] }] };
		expect(playbackEpisodeAvailable(base, '246', 0, 1)).toBe(true);
		expect(playbackEpisodeAvailable(base, '246', 1, 1)).toBe(false);
		expect(workPlaybackIframe(base, '246', 1, 1)).toBeNull();
		expect(playbackEpisodeAvailable({ ...base, translations: [{ ...base.translations[0], episodes: undefined }] }, '246', 1, 1)).toBe(true);
		expect(workPlaybackIframe(base, '246', null, null)).not.toBeNull();
	});
	it('overrides inherited balancer control flags without mutating stored voice URLs', () => {
		const raw = 'https://collaps.example/embed/movie/50?oneSound=Studio&showMenu=true&showPreNext=true';
		const source: PlaybackSource = { ...alloha, source: 'collaps', iframe: raw, translations: [{ id: 'studio', name: 'Studio', iframe: raw }] };
		const url = new URL(workPlaybackIframe(source, 'studio', 0, 1, true)!);
		expect(url.searchParams.get('oneSound')).toBe('Studio');
		expect(url.searchParams.get('showMenu')).toBe('false');
		expect(url.searchParams.get('showPreNext')).toBe('false');
		expect(url.searchParams.get('season')).toBe('0');
		expect(source.translations[0].iframe).toBe(raw);
	});
	it.each(['alloha', 'collaps'] as const)('leaves native-only %s series selectors intact until a canonical clip is known', source => {
		const base: PlaybackSource = { ...alloha, source };
		const url = new URL(workPlaybackIframe(base, '246', null, null)!);
		for (const flag of ['hidden', 'showMenu', 'showPreNext', 'only_episode']) expect(url.searchParams.has(flag)).toBe(false);
	});
	it.each(['alloha', 'collaps'] as const)('strips stale %s offsets before either locked or native iframe is opened', source => {
		const offset = source === 'alloha' ? 'start' : 'time';
		const raw = `https://${source}.example/player?${offset}=120&${offset}=240`;
		const base: PlaybackSource = { ...alloha, source, iframe: raw, translations: [] };
		for (const lock of [false, true]) expect(new URL(workPlaybackIframe(base, null, null, null, lock)!).searchParams.has(offset)).toBe(false);
		expect(base.iframe).toBe(raw);
	});
	it('keeps all three providers isolated and ordered while retaining legacy Alloha support', () => {
		const collaps: PlaybackSource = { ...alloha, source: 'collaps', iframe: 'https://collaps.example/embed/fixture', translations: [] };
		const settings = [{ source: 'kodik' as const, label: 'Kodik', enabled: true, position: 0 }, { source: 'collaps' as const, label: 'Collaps', enabled: true, position: 1 }, { source: 'alloha' as const, label: 'Alloha', enabled: true, position: 2 }];
		const result = workPlaybackSources([collaps, kodik], legacy, settings);
		expect(result.map(source => source.source)).toEqual(['kodik', 'collaps', 'alloha']);
		expect(result[0].translations).toEqual(kodik.translations);
		expect(result[1].translations).toEqual([]);
		settings[0].enabled = false;
		expect(workPlaybackSources([collaps, kodik], legacy, settings).map(source => source.source)).toEqual(['collaps', 'alloha']);
	});

	it.each(['javascript:alert(1)', 'http://player.example/embed', 'https://secret@player.example/embed', 'invalid'])('does not bind malformed or unsafe iframe URL: %s', iframe => {
		expect(workPlaybackIframe({ ...alloha, iframe, translations: [] }, null, null, null)).toBeNull();
	});
});
