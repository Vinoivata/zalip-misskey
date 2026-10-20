/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export const importSources = ['tmdb', 'kinopoisk', 'alloha', 'collaps', 'kodik', 'vibix'] as const;
export type ImportSource = typeof importSources[number];
export type ImportMediaType = 'movie' | 'tv';
export type ImportRef = { source: ImportSource; externalId: string; mediaType: ImportMediaType };
/** Kodik uses stable material references; raw movie-/serial- edition IDs remain accepted inputs. */
export const importRefIdPattern = '^(?:[1-9][0-9]{0,15}|tmdb:(?:movie|tv):[1-9][0-9]{0,15}|imdb:tt[0-9]{5,12}|(?:movie|serial|shikimori|kinopoisk)-[1-9][0-9]{0,15}|imdb-tt[0-9]{5,12})$';
export function validImportRef(value: unknown): value is ImportRef {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const ref = value as Partial<ImportRef>;
	if (!ref.source || !importSources.includes(ref.source) || !ref.mediaType || !['movie', 'tv'].includes(ref.mediaType) || typeof ref.externalId !== 'string') return false;
	if (ref.source === 'kodik') return /^(?:(?:shikimori|kinopoisk)-[1-9][0-9]{0,15}|imdb-tt[0-9]{5,12})$/u.test(ref.externalId) || (ref.mediaType === 'movie' ? /^movie-[1-9][0-9]{0,15}$/u : /^serial-[1-9][0-9]{0,15}$/u).test(ref.externalId);
	// Vibix has no documented own-video-ID lookup: a numeric ref is explicitly a KP ID.
	if (ref.source === 'vibix') return /^imdb:tt[0-9]{5,12}$/u.test(ref.externalId) || /^[1-9][0-9]{0,15}$/u.test(ref.externalId) && Number.isSafeInteger(Number(ref.externalId));
	return /^(?:[1-9][0-9]{0,15}|tmdb:(?:movie|tv):[1-9][0-9]{0,15}|imdb:tt[0-9]{5,12})$/u.test(ref.externalId);
}
export type ExternalIdentity = { provider: string; externalId: string; entityType: ImportMediaType };
export type ImportCredit = { externalId: string | null; source: ImportSource; name: string; role: string; character: string | null; imageUrl: string | null };
export type ImportCompany = { externalId: string | null; source: ImportSource; name: string; imageUrl: string | null };
export type ImportCollection = { externalId: string; source: ImportSource; name: string; description?: string | null; imageUrl?: string | null };
export type ImportEpisode = { episodeNumber: number; title: string; originalTitle?: string | null; description?: string | null; airDate?: string | null; stillUrl?: string | null; runtimeMinutes?: number | null; tmdbEpisodeId?: number | null };
export type ImportSeason = { seasonNumber: number; title: string; description?: string | null; posterUrl?: string | null; airDate?: string | null; episodeCount?: number | null; episodes: ImportEpisode[] };
/** Public SDK attributes, not API authentication and not the publisher API's video-ID namespace. */
export type ImportVibixEmbed = { publisherId: string; type: 'movie' | 'series'; id: string };
export type ImportPlayer = { source: 'alloha' | 'collaps' | 'kodik' | 'vibix'; externalId: string; iframeUrl: string; vibixEmbed?: ImportVibixEmbed; translations: { id: string; name: string; providerTranslationId?: string; type?: 'voice' | 'subtitles'; iframe?: string; quality?: string | null; resolutions?: string[]; episodes?: { seasonNumber: number; episodeNumber: number }[] }[]; quality: string | null; episodes: { seasonNumber: number; episodeNumber: number }[] };
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
	/** Bounded provider-normalized alternatives, never supplied as arbitrary download URLs by clients. */
	artworkCandidates?: ImportArtworkCandidate[];
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
/** Maintenance resources have their own IDs and never masquerade as movie/TV references. */
export type ImportCollectionDictionaryPage = { items: { externalId: string; name: string }[]; page: number; hasMore: boolean; warnings: string[] };
export type ImportCollectionMembersPage = { items: { externalId: string; identities: ExternalIdentity[]; mediaType: ImportMediaType }[]; page: number; hasMore: boolean };
export type ImportProviderStatus = { source: ImportSource; configured: boolean; capabilities: { search: boolean; collections: boolean; updates: boolean }; dailyLimit: number | null };
export interface ImportProvider {
	status(): ImportProviderStatus;
	check?(): Promise<void>;
	search(query: string, page?: number, mediaType?: ImportMediaType): Promise<ImportSearchPage>;
	fetch(ref: ImportRef, fields?: readonly ImportField[]): Promise<ImportRecord>;
	lookup?(identities: ExternalIdentity[], mediaType: ImportMediaType, fields?: readonly ImportField[]): Promise<ImportRecord | null>;
	collection?(externalId: string, page?: number): Promise<ImportSearchPage>;
	updates?(page?: number): Promise<ImportSearchPage>;
	collectionDictionary?(page?: number, limit?: number): Promise<ImportCollectionDictionaryPage>;
	collectionMembers?(externalId: string, page?: number, limit?: number): Promise<ImportCollectionMembersPage>;
}
export const importFields = ['title', 'originalTitle', 'description', 'releaseYear', 'runtimeMinutes', 'kind', 'genres', 'countries', 'posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'ratings', 'ageRating', 'credits', 'companies', 'collections', 'seasons', 'players'] as const;
export type ImportField = typeof importFields[number];
export const importArtworkFields = ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'] as const;
export type ImportArtworkField = typeof importArtworkFields[number];
export type ImportArtworkFormat = 'original' | 'webp' | 'avif' | 'jpeg' | 'png';
export type ImportArtworkSize = { width: number; height: number; fit: 'inside' | 'cover' };
export type ImportArtworkSettings = { format: ImportArtworkFormat; quality: number; keepOriginal: boolean; galleryLimit: number; sizes: Record<ImportArtworkField, ImportArtworkSize> };
export type ImportArtworkSettingsInput = Partial<Omit<ImportArtworkSettings, 'sizes'>> & { sizes?: Partial<Record<ImportArtworkField, Partial<ImportArtworkSize>>> };
export type ImportArtworkCandidate = { id: string; source: ImportSource; field: ImportArtworkField; url: string; previewUrl: string; width: number | null; height: number | null; language: string | null };
export type ImportArtworkChoices = Partial<Record<Exclude<ImportArtworkField, 'galleryUrls'>, string>> & { galleryUrls?: string[] };
export type ImportArtworkSelection = { ref: ImportRef; choices: ImportArtworkChoices };
export type ImportArtworkExpected = Partial<{ posterUrl: string | null; backdropUrl: string | null; logoUrl: string | null; galleryUrls: string[] }>;
export type PreparedImportRecord = ImportRecord & { artworkExpected?: ImportArtworkExpected };
export type ImportFilters = {
	mediaTypes?: ImportMediaType[];
	kinds?: ImportRecord['kind'][];
	yearFrom?: number;
	yearTo?: number;
	genres?: string[];
	countries?: string[];
	ratingMin?: number;
	/** Applies only when creating a new work, not when refreshing an existing one. */
	requirePlayer?: boolean;
};
/** A persisted job policy contains no credentials or arbitrary provider parameters. */
export type ImportOptions = { sources?: ImportSource[]; fields?: ImportField[]; fieldSources?: Partial<Record<ImportField, ImportSource>>; filters?: ImportFilters; artwork?: 'remote' | 'local-webp' | 'local'; artworkSettings?: ImportArtworkSettingsInput; artworkSelections?: ImportArtworkSelection[] };
export type ImportWorkState = { locks: string[]; values: Record<string, unknown>; sources: Record<string, string>; countries: string[]; ratings: ImportRecord['ratings']; ageRating: string | null };
export type ImportPreview = { record: ImportRecord; workId: string | null; options: ImportOptions; locks: string[]; matchesFilters: boolean; changes: { field: string; before: unknown; after: unknown; protected: boolean; selected: boolean }[]; warnings: string[] };

export const maintenanceKinds = ['collections-dictionary', 'collection-backfill', 'person-enrichment'] as const;
export type MaintenanceKind = typeof maintenanceKinds[number];
export type MaintenanceSource = 'collaps' | 'tmdb' | 'kinopoisk';
export type MaintenanceState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type MaintenanceOptions = { collectionIds?: string[] };
export type MaintenanceCursor = { page: number; offset: number; entryAfterId: string | null; activeEntryId: string | null; collectionIndex: number };
export type MaintenanceStats = { processed: number; created: number; updated: number; linked: number; skipped: number; failed: number };
