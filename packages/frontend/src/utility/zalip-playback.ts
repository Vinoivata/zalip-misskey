/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type PlaybackProvider = 'alloha' | 'collaps' | 'kodik';
export type PlaybackEpisode = { seasonNumber: number; episodeNumber: number };
export type PlaybackTranslation = { id: string; name: string; type?: 'voice' | 'subtitles'; providerTranslationId?: string; iframe?: string; quality?: string | null; resolutions?: string[]; episodes?: PlaybackEpisode[] };
export type PlaybackSource = { source: PlaybackProvider; label: string; iframe: string; quality: string | null; translations: PlaybackTranslation[]; episodes: PlaybackEpisode[] };
export type PlaybackProviderSetting = { source: PlaybackProvider; label: string; enabled: boolean; position: number };
export type LegacyAllohaPlayback = {
	label?: string;
	available: boolean;
	iframe: string | null;
	translations: Array<{ id: number | string; name: string; quality: string | null; resolutions: string[]; iframe: string }>;
	lastCheckedAt: string | null;
};

/** Legacy Alloha remains a distinct provider, never a fallback for a selected Collaps source. */
export function workPlaybackSources(sources: PlaybackSource[], legacy: LegacyAllohaPlayback | null, settings?: PlaybackProviderSetting[]): PlaybackSource[] {
	const normalized = sources.filter(source => settings?.find(setting => setting.source === source.source)?.enabled !== false).map(source => ({
		...source,
		translations: source.translations.map(translation => ({ ...translation, id: String(translation.id) })),
	}));
	const allohaSetting = settings?.find(setting => setting.source === 'alloha');
	if (legacy?.available && allohaSetting?.enabled !== false) {
		const translations = legacy.translations.map(translation => ({ ...translation, id: String(translation.id) }));
		const iframe = legacy.iframe ?? translations[0]?.iframe;
		if (iframe) {
			const existing = normalized.find(source => source.source === 'alloha');
			if (existing) {
				// Old imported rows can lack per-voice URLs while the legacy cache still has them.
				existing.translations = existing.translations.map(translation => {
					if (translation.iframe) return translation;
					const cached = translations.find(candidate => candidate.id === translation.id);
					return cached ? { ...cached, ...translation, iframe: cached.iframe } : translation;
				});
				if (!existing.translations.length) existing.translations = translations;
			} else {
				normalized.push({ source: 'alloha', label: allohaSetting?.label ?? legacy.label ?? 'Alloha', iframe, quality: null, translations, episodes: [] });
			}
		}
	}
	return settings ? normalized.sort((left, right) => (settings.find(setting => setting.source === left.source)?.position ?? settings.length) - (settings.find(setting => setting.source === right.source)?.position ?? settings.length)) : normalized;
}

export function selectablePlaybackTranslations(source: PlaybackSource | null): PlaybackTranslation[] {
	return source?.translations.filter(translation => !!translation.iframe) ?? [];
}

/** The provider's edition name remains intact; label explicit subtitles without duplicating it. */
export function playbackTranslationLabel(translation: PlaybackTranslation, subtitlesLabel: string): string {
	return translation.type === 'subtitles' && !/субтитр|subtitles?/iu.test(translation.name) ? `${translation.name} · ${subtitlesLabel}` : translation.name;
}

/** Unknown legacy coverage stays playable; a known Kodik voice never silently opens another episode. */
export function playbackEpisodeAvailable(source: PlaybackSource | null, translationId: string | null, seasonNumber: number | null, episodeNumber: number | null): boolean {
	if (!source) return false;
	if (source.source !== 'kodik' || seasonNumber == null || episodeNumber == null) return true;
	const episodes = selectablePlaybackTranslations(source).find(translation => translation.id === translationId)?.episodes;
	return episodes === undefined || episodes.some(episode => episode.seasonNumber === seasonNumber && episode.episodeNumber === episodeNumber);
}

/** Provider-specific voice selectors are supplied by the server; the page owns only season/episode. */
export function workPlaybackIframe(source: PlaybackSource | null, translationId: string | null, seasonNumber: number | null, episodeNumber: number | null): string | null {
	if (!source || !playbackEpisodeAvailable(source, translationId, seasonNumber, episodeNumber)) return null;
	const iframe = selectablePlaybackTranslations(source).find(translation => translation.id === translationId)?.iframe ?? source.iframe;
	try {
		const url = new URL(iframe);
		if (url.protocol !== 'https:' || url.username || url.password) return null;
		if (seasonNumber != null && episodeNumber != null) {
			url.searchParams.set('season', String(seasonNumber));
			url.searchParams.set('episode', String(episodeNumber));
			// A concrete episode disables internal selectors/auto-next, keeping JSAPI time bound to our canonical ID.
			if (source.source === 'kodik') url.searchParams.set('only_episode', 'true');
		}
		return url.toString();
	} catch {
		return null;
	}
}
