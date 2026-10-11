/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import type { IdService } from '@/core/IdService.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { canUpdateField, importFieldSelected, nonEmpty, normalizeImportOptions, readImportState, sameValue } from './policy.js';
import { importFields, type ExternalIdentity, type ImportOptions, type ImportRecord } from './types.js';
import type { DataSource, EntityManager } from 'typeorm';

export type ApplyImportOptions = {
	workId?: string;
	lockedFields?: string[];
	mode?: 'import' | 'sync' | 'availability';
	options?: ImportOptions;
};

export type ApplyImportResult = { work: MiZalipWork; created: boolean; protectedFields: string[] };
type ImportDataSource = Pick<DataSource, 'getRepository'>;

const workColumns = {
	title: 'title', originalTitle: 'originalTitle', description: 'description', releaseYear: 'releaseYear',
	runtimeMinutes: 'runtimeMinutes', kind: 'kind', genres: 'genres', posterUrl: 'posterPath',
	backdropUrl: 'backdropPath', logoUrl: 'logoPath', galleryUrls: 'galleryPaths', trailerYoutubeKey: 'trailerYoutubeKey',
} as const;

/** Provider keys always include media type; a TMDB movie and TV series may share an integer. */
function importIdentities(record: ImportRecord): ExternalIdentity[] {
	const all = [...record.identities, { provider: record.ref.source, externalId: record.ref.externalId, entityType: record.ref.mediaType }];
	const identities = new Map<string, ExternalIdentity>();
	const providerIds = new Map<string, string>();
	for (const value of all) {
		const identity = { provider: value.provider.trim().toLowerCase(), externalId: value.externalId.trim(), entityType: value.entityType };
		if (!/^[a-z0-9_-]{1,16}$/u.test(identity.provider) || !identity.externalId || identity.externalId.length > 100 || !['movie', 'tv'].includes(identity.entityType)) throw new Error('INVALID_IMPORT_IDENTITY');
		if (identity.entityType !== record.ref.mediaType) throw new Error('IMPORT_MEDIA_TYPE_CONFLICT');
		const providerKey = `${identity.provider}:${identity.entityType}`;
		if (providerIds.has(providerKey) && providerIds.get(providerKey) !== identity.externalId) throw new Error('IMPORT_IDENTITY_CONFLICT');
		providerIds.set(providerKey, identity.externalId);
		identities.set(`${providerKey}:${identity.externalId}`, identity);
	}
	return [...identities.values()];
}

function tmdbIdentity(identities: ExternalIdentity[]): { tmdbMediaType: 'movie' | 'tv'; tmdbId: number } | null {
	const identity = identities.find(value => value.provider === 'tmdb');
	if (!identity) return null;
	const tmdbId = Number(identity.externalId);
	if (!/^\d+$/u.test(identity.externalId) || !Number.isSafeInteger(tmdbId) || tmdbId <= 0 || tmdbId > 2147483647) throw new Error('INVALID_IMPORT_IDENTITY');
	return { tmdbMediaType: identity.entityType, tmdbId };
}

/** Used by preview and by the locked commit path. It never matches solely by title/year. */
export async function findImportWork(db: ImportDataSource, record: ImportRecord, explicitId?: string): Promise<MiZalipWork | null> {
	const identities = importIdentities(record);
	const works = db.getRepository(MiZalipWork);
	const bindings = db.getRepository(MiZalipExternalIdentity);
	const matches = await bindings.findBy(identities);
	const ids = new Set(matches.map(identity => identity.workId));
	const tmdb = tmdbIdentity(identities);
	const legacy = tmdb ? await works.findOneBy(tmdb) : null;
	if (legacy) ids.add(legacy.id);
	if (explicitId) ids.add(explicitId);
	if (ids.size > 1) throw new Error('IMPORT_IDENTITY_CONFLICT');
	const workId = [...ids][0];
	if (!workId) return null;
	const work = await works.findOneBy({ id: workId });
	if (!work) throw new Error('NO_SUCH_WORK');
	if (tmdb && work.tmdbId !== null && (work.tmdbId !== tmdb.tmdbId || work.tmdbMediaType !== tmdb.tmdbMediaType)) throw new Error('IMPORT_IDENTITY_CONFLICT');
	const currentBindings = await bindings.findBy({ workId });
	if (currentBindings.some(current => identities.some(incoming => current.provider === incoming.provider && current.entityType === incoming.entityType && current.externalId !== incoming.externalId))) throw new Error('IMPORT_IDENTITY_CONFLICT');
	return work;
}

/** Canonical field names shared by preview, provenance checks and commit. No private snapshots. */
export function currentImportFields(work: MiZalipWork): Record<string, unknown> {
	const state = readImportState(work.importData);
	return {
		title: work.title, originalTitle: work.originalTitle, description: work.description, releaseYear: work.releaseYear,
		runtimeMinutes: work.runtimeMinutes, kind: work.kind, genres: work.genres,
		posterUrl: work.posterPath, backdropUrl: work.backdropPath, logoUrl: work.logoPath,
		galleryUrls: work.galleryPaths, trailerYoutubeKey: work.trailerYoutubeKey,
		countries: state.countries, ratings: state.ratings, ageRating: state.ageRating,
		credits: state.values.credits, companies: state.values.companies, collections: state.values.collections,
		seasons: state.values.seasons, players: state.values.players,
	};
}

function boundedText(value: string | null | undefined, length: number): string | null {
	return typeof value === 'string' ? value.trim().slice(0, length) || null : null;
}

function safeArtwork(value: string | null | undefined): string | null {
	if (!value) return null;
	if (value.startsWith('/') && !value.startsWith('//')) return value.length <= 512 ? value : null;
	try {
		const url = new URL(value);
		return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= 512 ? url.href : null;
	} catch {
		return null;
	}
}

/** Explicit projection strips accidental raw provider objects and enforces database field sizes. */
function normalizedSnapshot(record: ImportRecord): ImportRecord {
	const snapshot = Object.fromEntries(importFields.map(field => [field, structuredClone(record[field])])) as Omit<ImportRecord, 'ref' | 'identities' | 'complete' | 'warnings'>;
	const title = boundedText(record.title, 256);
	if (!title || !['movie', 'series', 'anime', 'animation'].includes(record.kind)) throw new Error('INVALID_IMPORT_RECORD');
	if (record.releaseYear !== null && (!Number.isInteger(record.releaseYear) || record.releaseYear < 1800 || record.releaseYear > 3000)) throw new Error('INVALID_IMPORT_RECORD');
	if (record.runtimeMinutes !== null && (!Number.isInteger(record.runtimeMinutes) || record.runtimeMinutes < 1 || record.runtimeMinutes > 100000)) throw new Error('INVALID_IMPORT_RECORD');
	return {
		...snapshot, ref: { source: record.ref.source, externalId: record.ref.externalId.trim(), mediaType: record.ref.mediaType }, identities: importIdentities(record), complete: record.complete,
		warnings: record.warnings.map(value => value.slice(0, 512)).slice(0, 100),
		title, originalTitle: boundedText(record.originalTitle, 256), description: boundedText(record.description, 8192),
		posterUrl: safeArtwork(record.posterUrl), backdropUrl: safeArtwork(record.backdropUrl), logoUrl: safeArtwork(record.logoUrl),
		galleryUrls: [...new Set(record.galleryUrls.map(safeArtwork).filter((value): value is string => value !== null))].slice(0, 100),
		trailerYoutubeKey: record.trailerYoutubeKey && /^[a-zA-Z0-9_-]{1,32}$/u.test(record.trailerYoutubeKey) ? record.trailerYoutubeKey : null,
		genres: [...new Set(record.genres.map(value => value.trim().slice(0, 256)).filter(Boolean))].slice(0, 100),
		countries: [...new Set(record.countries.map(value => value.trim().slice(0, 256)).filter(Boolean))].slice(0, 100),
		ageRating: boundedText(record.ageRating, 32),
		ratings: record.ratings.filter(rating => Number.isFinite(rating.value) && rating.value >= 0 && rating.value <= 10).map(rating => ({
			source: rating.source.slice(0, 32), value: rating.value, votes: rating.votes !== null && Number.isInteger(rating.votes) && rating.votes >= 0 ? rating.votes : null,
		})),
		credits: record.credits.slice(0, 1000).map(credit => ({
			source: credit.source, externalId: boundedText(credit.externalId, 100), name: boundedText(credit.name, 256) ?? '',
			role: credit.role.trim().slice(0, 64), character: boundedText(credit.character, 256), imageUrl: safeArtwork(credit.imageUrl),
		})),
		companies: record.companies.slice(0, 1000).map(company => ({
			source: company.source, externalId: boundedText(company.externalId, 100), name: boundedText(company.name, 256) ?? '', imageUrl: safeArtwork(company.imageUrl),
		})),
		collections: record.collections.slice(0, 1000).map(collection => ({
			source: collection.source, externalId: collection.externalId.trim().slice(0, 100), name: boundedText(collection.name, 256) ?? '',
			description: boundedText(collection.description, 8192), imageUrl: safeArtwork(collection.imageUrl),
		})),
		players: record.players.map(player => ({
			source: player.source, externalId: player.externalId.trim().slice(0, 100), iframeUrl: player.iframeUrl,
			quality: boundedText(player.quality, 128), translations: player.translations.map(translation => ({ id: translation.id.slice(0, 100), name: translation.name.slice(0, 256) })),
			episodes: player.episodes.map(episode => ({ seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber })),
		})),
		seasons: record.seasons.map(season => ({
			seasonNumber: season.seasonNumber, title: boundedText(season.title, 256) ?? '', description: boundedText(season.description, 8192),
			posterUrl: safeArtwork(season.posterUrl), airDate: validDate(season.airDate), episodeCount: season.episodeCount,
			episodes: season.episodes.map(episode => ({
				episodeNumber: episode.episodeNumber, title: boundedText(episode.title, 256) ?? '', originalTitle: boundedText(episode.originalTitle, 256),
				description: boundedText(episode.description, 8192), airDate: validDate(episode.airDate), stillUrl: safeArtwork(episode.stillUrl),
				runtimeMinutes: positiveInteger(episode.runtimeMinutes), tmdbEpisodeId: positiveInteger(episode.tmdbEpisodeId),
			})),
		})),
	};
}

function changedSinceImport(current: unknown, previous: unknown): boolean {
	return previous !== undefined && !sameValue(current, previous);
}

function mergePartialPlayers(current: unknown, incoming: ImportRecord['players']): ImportRecord['players'] {
	const previous = Array.isArray(current) ? current as ImportRecord['players'] : [];
	const players = new Map<string, ImportRecord['players'][number]>();
	for (const player of [...previous, ...incoming]) players.set(`${player.source}:${player.externalId}`, player);
	return [...players.values()];
}

async function syncSeasons(manager: EntityManager, idService: Pick<IdService, 'gen'>, work: MiZalipWork, record: ImportRecord, now: Date): Promise<void> {
	const seasons = manager.getRepository(MiZalipSeason);
	const episodes = manager.getRepository(MiZalipEpisode);
	for (const input of record.seasons) {
		if (!Number.isInteger(input.seasonNumber) || input.seasonNumber < 0 || input.seasonNumber > 100000) throw new Error('INVALID_IMPORT_SEASON');
		const existing = await seasons.findOneBy({ workId: work.id, seasonNumber: input.seasonNumber });
		const season = existing ?? seasons.create({
			id: idService.gen(), workId: work.id, seasonNumber: input.seasonNumber, createdAt: now, updatedAt: now,
			title: boundedText(input.title, 256) ?? `Сезон ${input.seasonNumber}`, originalTitle: null,
			description: null, posterPath: null, airDate: null, episodeCount: null, importValues: {},
		});
		const facts = {
			title: boundedText(input.title, 256), description: boundedText(input.description, 8192),
			posterPath: safeArtwork(input.posterUrl), airDate: validDate(input.airDate),
			episodeCount: input.episodeCount !== undefined && input.episodeCount !== null && Number.isInteger(input.episodeCount) && input.episodeCount >= 0 ? input.episodeCount : null,
		};
		const baseline = { ...season.importValues };
		for (const [field, incoming] of Object.entries(facts)) {
			const current = season[field as keyof typeof facts];
			if ((!existing && nonEmpty(incoming)) || (!changedSinceImport(current, baseline[field]) && canUpdateField(current, baseline[field], incoming, false))) {
				Object.assign(season, { [field]: incoming });
				baseline[field] = structuredClone(incoming);
			}
		}
		if (!existing) for (const field of Object.keys(facts)) baseline[field] = structuredClone(season[field as keyof typeof facts]);
		season.importValues = baseline;
		season.updatedAt = now;
		await seasons.save(season);
		for (const episodeInput of input.episodes) {
			if (!Number.isInteger(episodeInput.episodeNumber) || episodeInput.episodeNumber < 0 || episodeInput.episodeNumber > 100000) throw new Error('INVALID_IMPORT_EPISODE');
			const before = await episodes.findOneBy({ seasonId: season.id, episodeNumber: episodeInput.episodeNumber });
			const episode = before ?? episodes.create({
				id: idService.gen(), seasonId: season.id, episodeNumber: episodeInput.episodeNumber, createdAt: now, updatedAt: now,
				title: boundedText(episodeInput.title, 256) ?? `Серия ${episodeInput.episodeNumber}`, originalTitle: null,
				description: null, stillPath: null, airDate: null, runtimeMinutes: null, tmdbEpisodeId: null, importValues: {},
			});
			const episodeFacts = {
				title: boundedText(episodeInput.title, 256), originalTitle: boundedText(episodeInput.originalTitle, 256),
				description: boundedText(episodeInput.description, 8192), airDate: validDate(episodeInput.airDate), stillPath: safeArtwork(episodeInput.stillUrl),
				runtimeMinutes: positiveInteger(episodeInput.runtimeMinutes), tmdbEpisodeId: positiveInteger(episodeInput.tmdbEpisodeId),
			};
			const episodeBaseline = { ...episode.importValues };
			for (const [field, incoming] of Object.entries(episodeFacts)) {
				const current = episode[field as keyof typeof episodeFacts];
				if ((!before && nonEmpty(incoming)) || (!changedSinceImport(current, episodeBaseline[field]) && canUpdateField(current, episodeBaseline[field], incoming, false))) {
					Object.assign(episode, { [field]: incoming });
					episodeBaseline[field] = structuredClone(incoming);
				}
			}
			if (!before) for (const field of Object.keys(episodeFacts)) episodeBaseline[field] = structuredClone(episode[field as keyof typeof episodeFacts]);
			episode.importValues = episodeBaseline;
			episode.updatedAt = now;
			await episodes.save(episode);
		}
	}
}

function validDate(value: string | null | undefined): string | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function positiveInteger(value: number | null | undefined): number | null {
	return value !== undefined && value !== null && Number.isInteger(value) && value > 0 && value <= 2147483647 ? value : null;
}

/** One atomic commit: stable work, namespaced bindings, ownership and episodes. No network calls. */
export async function applyImportRecord(
	db: DataSource,
	idService: Pick<IdService, 'gen'>,
	record: ImportRecord,
	sources: Record<string, string>,
	options: ApplyImportOptions = {},
): Promise<ApplyImportResult> {
	const normalized = normalizedSnapshot(record);
	const importOptions = normalizeImportOptions(options.options);
	const identities = importIdentities(normalized);
	const mode = options.mode ?? 'import';
	return db.transaction(async manager => {
		// Shared identity lock is acquired before looking up any provider binding.
		await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['zalip-import-identities']);
		let work = await findImportWork(manager, normalized, options.workId);
		const created = !work;
		if (created && mode !== 'import') throw new Error('NO_SUCH_WORK');
		const now = new Date();
		const works = manager.getRepository(MiZalipWork);
		if (work) {
			work = await works.findOneOrFail({ where: { id: work.id }, lock: { mode: 'pessimistic_write' } });
		} else {
			const identitySlug = /^[a-z0-9-]+$/u.test(normalized.ref.externalId) ? normalized.ref.externalId : createHash('sha256').update(normalized.ref.externalId).digest('hex').slice(0, 20);
			const slug = `import-${normalized.ref.source}-${normalized.ref.mediaType}-${identitySlug}`;
			if (await works.existsBy({ slug })) throw new Error('IMPORT_SLUG_CONFLICT');
			work = works.create({
				id: idService.gen(), createdAt: now, updatedAt: now, publicationState: 'draft', publishedAt: null,
				slug, title: normalized.title, kind: normalized.kind, originalTitle: null, description: null,
				releaseYear: null, runtimeMinutes: null, genres: [], posterPath: null, backdropPath: null,
				logoPath: null, galleryPaths: [], trailerYoutubeKey: null, tmdbId: null, tmdbMediaType: null, importData: {},
			});
		}
		const state = readImportState(work.importData);
		const locks = [...new Set([...state.locks, ...(options.lockedFields ?? [])])];
		const current = currentImportFields(work);
		const protectedFields = new Set<string>();
		const values = { ...state.values };
		const fieldSources = { ...state.sources };
		for (const field of importFields) {
			if (!importFieldSelected(field, importOptions, created)) {
				protectedFields.add(field);
				continue;
			}
			let incoming: unknown = normalized[field];
			if (field === 'players' && !normalized.complete) incoming = mergePartialPlayers(current.players, normalized.players);
			const protectedField = !created && (locks.includes(field) || (mode === 'availability' && field !== 'players') || changedSinceImport(current[field], state.values[field]));
			if (protectedField || (!created && !canUpdateField(current[field], state.values[field], incoming, false))) {
				if (protectedField || nonEmpty(current[field])) protectedFields.add(field);
				continue;
			}
			if (field in workColumns) {
				const column = workColumns[field as keyof typeof workColumns];
				Object.assign(work, { [column]: incoming });
			}
			values[field] = structuredClone(incoming);
			fieldSources[field] = sources[field] ?? normalized.ref.source;
		}
		const tmdb = tmdbIdentity(identities);
		if (tmdb && work.tmdbId === null) Object.assign(work, tmdb);
		work.importData = {
			...work.importData, locks, values, sources: fieldSources,
			countries: values.countries ?? state.countries, ratings: values.ratings ?? state.ratings,
			ageRating: values.ageRating ?? state.ageRating,
		};
		work.updatedAt = now;
		await works.save(work);
		const bindings = manager.getRepository(MiZalipExternalIdentity);
		for (const identity of identities) {
			const existing = await bindings.findOneBy(identity);
			if (existing && existing.workId !== work.id) throw new Error('IMPORT_IDENTITY_CONFLICT');
			await bindings.save(bindings.create({
				id: existing?.id ?? idService.gen(), workId: work.id, ...identity, snapshot: normalized, updatedAt: now,
			}));
		}
		if (mode !== 'availability' && !protectedFields.has('seasons')) await syncSeasons(manager, idService, work, normalized, now);
		return { work, created, protectedFields: [...protectedFields] };
	});
}
