/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type ZalipPlaybackProviderSetting = { source: 'alloha' | 'collaps' | 'kodik' | 'vibix'; label: string; enabled: boolean; position: number };

export function defaultPlaybackSettings(): ZalipPlaybackProviderSetting[] {
	return [
		{ source: 'alloha', label: 'ALLOHA', enabled: true, position: 0 },
		{ source: 'collaps', label: 'COLLAPS', enabled: true, position: 1 },
		{ source: 'kodik', label: 'KODIK', enabled: true, position: 2 },
		{ source: 'vibix', label: 'VIBIX', enabled: false, position: 3 },
	];
}

/** Only display policy: no keys, URLs, provider IDs or availability state can be edited. */
export function normalizePlaybackSettings(value: unknown): ZalipPlaybackProviderSetting[] {
	if (!Array.isArray(value) || ![2, 3, 4].includes(value.length)) throw new Error('INVALID_PLAYBACK_SETTINGS');
	const sources = defaultPlaybackSettings().slice(0, value.length).map(row => row.source);
	const providers = value.map((row: unknown): ZalipPlaybackProviderSetting => {
		if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('INVALID_PLAYBACK_SETTINGS');
		const item = row as Record<string, unknown>;
		if (Object.keys(item).some(key => !['source', 'label', 'enabled', 'position'].includes(key))) throw new Error('INVALID_PLAYBACK_SETTINGS');
		if (!sources.includes(item.source as ZalipPlaybackProviderSetting['source']) || typeof item.source !== 'string' || typeof item.label !== 'string' || typeof item.enabled !== 'boolean') throw new Error('INVALID_PLAYBACK_SETTINGS');
		const label = item.label.trim();
		if (!label || label.length > 40 || /[\u0000-\u001f\u007f-\u009f]/u.test(label) || typeof item.position !== 'number' || !Number.isInteger(item.position) || item.position < 0 || item.position >= value.length) throw new Error('INVALID_PLAYBACK_SETTINGS');
		return { source: item.source as ZalipPlaybackProviderSetting['source'], label, enabled: item.enabled, position: item.position };
	});
	if (new Set(providers.map(item => item.source)).size !== value.length || new Set(providers.map(item => item.position)).size !== value.length) throw new Error('INVALID_PLAYBACK_SETTINGS');
	providers.push(...defaultPlaybackSettings().slice(value.length));
	return providers.sort((a, b) => a.position - b.position);
}
