/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const importSources = ['tmdb', 'kinopoisk', 'alloha', 'collaps'] as const;
export type ImportSource = typeof importSources[number];
export type ImportMediaType = 'movie' | 'tv';
export type ImportRef = { source: ImportSource; externalId: string; mediaType: ImportMediaType };
export type ExternalIdentity = { provider: string; externalId: string; entityType: ImportMediaType };
export type ImportCredit = { externalId: string | null; source: ImportSource; name: string; role: string; character: string | null; imageUrl: string | null };
export type ImportCompany = { externalId: string | null; source: ImportSource; name: string; imageUrl: string | null };
export type ImportCollection = { externalId: string; source: ImportSource; name: string; description?: string | null; imageUrl?: string | null };
export type ImportEpisode = { episodeNumber: number; title: string; originalTitle?: string | null; description?: string | null; airDate?: string | null; stillUrl?: string | null; runtimeMinutes?: number | null; tmdbEpisodeId?: number | null };
export type ImportSeason = { seasonNumber: number; title: string; description?: string | null; posterUrl?: string | null; airDate?: string | null; episodeCount?: number | null; episodes: ImportEpisode[] };
export type ImportPlayer = { source: 'alloha' | 'collaps'; externalId: string; iframeUrl: string; translations: { id: string; name: string }[]; quality: string | null; episodes: { seasonNumber: number; episodeNumber: number }[] };
export type ImportRecord = {
	ref: ImportRef;
	identities: ExternalIdentity[];
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	runtimeMinutes: number | null;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	genres: string[];
	countries: string[];
	posterUrl: string | null;
	backdropUrl: string | null;
	logoUrl: string | null;
	galleryUrls: string[];
	trailerYoutubeKey: string | null;
	ratings: { source: string; value: number; votes: number | null }[];
	ageRating: string | null;
	credits: ImportCredit[];
	companies: ImportCompany[];
	collections: ImportCollection[];
	seasons: ImportSeason[];
	players: ImportPlayer[];
	complete: boolean;
	warnings: string[];
};
export type ImportSearchResult = { ref: ImportRef; title: string; originalTitle: string | null; releaseYear: number | null; posterUrl: string | null };
export type ImportSearchPage = { items: ImportSearchResult[]; page: number; hasMore: boolean };
export type ImportProviderStatus = { source: ImportSource; configured: boolean; capabilities: { search: boolean; collections: boolean; updates: boolean }; dailyLimit: number | null };
export interface ImportProvider {
	status(): ImportProviderStatus;
	search(query: string, page?: number, mediaType?: ImportMediaType): Promise<ImportSearchPage>;
	fetch(ref: ImportRef): Promise<ImportRecord>;
	lookup?(identities: ExternalIdentity[], mediaType: ImportMediaType): Promise<ImportRecord | null>;
	collection?(externalId: string, page?: number): Promise<ImportSearchPage>;
	updates?(page?: number): Promise<ImportSearchPage>;
}
export const importFields = ['title', 'originalTitle', 'description', 'releaseYear', 'runtimeMinutes', 'kind', 'genres', 'countries', 'posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'ratings', 'ageRating', 'credits', 'companies', 'collections', 'seasons', 'players'] as const;
export type ImportField = typeof importFields[number];
export type ImportWorkState = { locks: string[]; values: Record<string, unknown>; sources: Record<string, string>; countries: string[]; ratings: ImportRecord['ratings']; ageRating: string | null };
export type ImportPreview = { record: ImportRecord; workId: string | null; changes: { field: string; before: unknown; after: unknown; protected: boolean }[]; warnings: string[] };
