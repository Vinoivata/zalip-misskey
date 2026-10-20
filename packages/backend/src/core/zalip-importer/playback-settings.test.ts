/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test } from 'vitest';
import { defaultPlaybackSettings, normalizePlaybackSettings } from './playback-settings.js';

describe('four-provider playback settings normalization', () => {
	test('legacy upgrade preserves disabled providers, labels and custom order without mutating input', () => {
		const input = [{ source: 'alloha', label: 'Alloha HD', enabled: false, position: 1 }, { source: 'collaps', label: 'Backup', enabled: false, position: 0 }];
		const before = structuredClone(input);
		expect(normalizePlaybackSettings(input)).toEqual([input[1], input[0], ...defaultPlaybackSettings().slice(2)]);
		expect(input).toEqual(before);
	});

	test('a complete three-row policy retains customized Kodik settings and detached rows', () => {
		const input = [{ source: 'alloha', label: ' Legacy ', enabled: false, position: 2 }, { source: 'collaps', label: 'Backup', enabled: false, position: 1 }, { source: 'kodik', label: 'Anime', enabled: false, position: 0 }];
		const result = normalizePlaybackSettings(input);
		expect(result).toEqual([input[2], input[1], { ...input[0], label: 'Legacy' }, defaultPlaybackSettings()[3]]);
		result[0].label = 'Detached';
		expect(input[2].label).toBe('Anime');
		expect(defaultPlaybackSettings()).toHaveLength(4);
		expect(defaultPlaybackSettings()[3]).toEqual({ source: 'vibix', label: 'VIBIX', enabled: false, position: 3 });
	});

	test('a complete four-row policy retains customized Vibix policy, including explicit enabling', () => {
		const input = defaultPlaybackSettings().map((row, index) => ({ ...row, label: `Custom ${row.source}`, enabled: row.source === 'vibix', position: 3 - index }));
		const before = structuredClone(input);
		expect(normalizePlaybackSettings(input)).toEqual([...input].reverse());
		expect(input).toEqual(before);
		expect(normalizePlaybackSettings(defaultPlaybackSettings().slice(0, 3))[3].enabled).toBe(false);
	});

	test.each([
		[defaultPlaybackSettings()[0], defaultPlaybackSettings()[2]],
		[defaultPlaybackSettings()[1], { ...defaultPlaybackSettings()[2], position: 0 }],
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, source: 'collaps' } : row),
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, position: 1 } : row),
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, position: 3 } : row),
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, position: 1.5 } : row),
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, position: '2' } : row),
		defaultPlaybackSettings().map(row => row.source === 'kodik' ? { ...row, iframe: 'https://player.provider.org' } : row),
	].map(value => ({ value })))('rejects incomplete, duplicate or unsafe policies: %#', ({ value }) => {
		expect(() => normalizePlaybackSettings(value)).toThrow('INVALID_PLAYBACK_SETTINGS');
	});
});
