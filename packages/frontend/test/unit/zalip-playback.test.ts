/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { selectablePlaybackTranslations, workPlaybackIframe, workPlaybackSources } from '@/utility/zalip-playback.js';
import type { LegacyAllohaPlayback, PlaybackSource } from '@/utility/zalip-playback.js';

const alloha: PlaybackSource = { source: 'alloha', label: 'Alloha', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture', quality: null, translations: [{ id: '246', name: 'Studio', iframe: 'https://alloha.example/?token_movie=fixture&token=public-fixture&translation=246' }], episodes: [] };
const legacy: LegacyAllohaPlayback = { available: true, label: 'Legacy', iframe: 'https://legacy.example/?token_movie=fixture', translations: [{ id: 246, name: 'Legacy Studio', iframe: 'https://legacy.example/?translation=246', quality: 'HD', resolutions: ['1080p'] }], lastCheckedAt: null };

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

	it('preserves server-provided voice selectors and credentials while updating only the episode', () => {
		const url = new URL(workPlaybackIframe(alloha, '246', 2, 3)!);
		expect(url.searchParams.get('token')).toBe('public-fixture');
		expect(url.searchParams.get('translation')).toBe('246');
		expect(url.searchParams.get('season')).toBe('2');
		expect(url.searchParams.get('episode')).toBe('3');
		const collaps: PlaybackSource = { ...alloha, source: 'collaps', iframe: 'https://collaps.example/embed/fixture', translations: [{ id: 'studio', name: 'Studio', iframe: 'https://collaps.example/embed/fixture?oneSound=Studio' }] };
		expect(new URL(workPlaybackIframe(collaps, 'studio', 2, 3)!).searchParams.get('oneSound')).toBe('Studio');
		expect(new URL(workPlaybackIframe(collaps, 'studio', 2, 3)!).searchParams.has('translation')).toBe(false);
	});

	it('uses the source iframe for unknown voices and does not add partial episode coordinates', () => {
		expect(workPlaybackIframe(alloha, 'missing', null, 3)).toBe(alloha.iframe);
		expect(workPlaybackIframe(alloha, null, 2, null)).toBe(alloha.iframe);
		expect(workPlaybackIframe(null, null, null, null)).toBeNull();
	});

	it.each(['javascript:alert(1)', 'http://player.example/embed', 'https://secret@player.example/embed', 'invalid'])('does not bind malformed or unsafe iframe URL: %s', iframe => {
		expect(workPlaybackIframe({ ...alloha, iframe, translations: [] }, null, null, null)).toBeNull();
	});
});
