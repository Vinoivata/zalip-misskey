/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipAllohaSource } from '@/models/ZalipAllohaSource.js';
import { MiZalipWatchProgress, zalipProgressMaxSeconds, zalipProgressProviders } from '@/models/ZalipWatchProgress.js';
import type { ZalipProgressProvider } from '@/models/ZalipWatchProgress.js';
import type { MiLocalUser } from '@/models/User.js';
import { configuredImportPlayerUrl } from './zalip-importer/providers.js';
import { readImportState } from './zalip-importer/policy.js';
import type { ImportPlayer } from './zalip-importer/types.js';
import { ZalipPlaybackSettingsService } from './ZalipPlaybackSettingsService.js';
import { ZalipImporterSourceSettingsService } from './ZalipImporterSourceSettingsService.js';
import { ZalipCatalogService } from './ZalipCatalogService.js';

export type ProgressTarget = { workId: string; episodeId: string | null; provider: ZalipProgressProvider; translationId: string | null; expectedResourceFingerprint?: string };
export type ProgressUpdate = { workId: string; sessionId: string; sequence: number; positionSeconds?: number; durationSeconds?: number; completed?: boolean };
export type PackedWatchProgress = {
	workId: string; episodeId: string | null; seasonNumber: number | null; episodeNumber: number | null;
	provider: ZalipProgressProvider; translationId: string | null; mode: 'time' | 'episode';
	positionSeconds: number | null; durationSeconds: number | null; completed: boolean; lastPlayedAt: string;
};
export class ZalipProgressError extends Error {
	constructor(public code: 'NO_SUCH_ZALIP_WORK' | 'INVALID_ZALIP_PROGRESS_TARGET' | 'ZALIP_PROGRESS_UNAVAILABLE' | 'INVALID_ZALIP_PROGRESS' | 'INVALID_ZALIP_PROGRESS_CURSOR') { super(code); }
}

/** Personal convenience state only. A provider event never grants access, rewards or public ratings. */
@Injectable()
export class ZalipWatchProgressService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private playbackSettings: ZalipPlaybackSettingsService,
		private sourceSettings: ZalipImporterSourceSettingsService,
		private catalogue: ZalipCatalogService,
	) {}

	private async lock(manager: EntityManager, userId: string, workId: string) {
		// The advisory lock also serializes first insert and reset against delayed saves.
		await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-progress:${userId}:${workId}`]);
	}

	private async work(manager: EntityManager, workId: string, lock = false) {
		const work = await manager.getRepository(MiZalipWork).findOne({ where: { id: workId, publicationState: 'published' }, ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}) });
		if (!work) throw new ZalipProgressError('NO_SUCH_ZALIP_WORK');
		return work;
	}

	private async episode(manager: EntityManager, work: MiZalipWork, episodeId: string | null) {
		if (episodeId != null) {
			const episode = await manager.getRepository(MiZalipEpisode).findOne({ where: { id: episodeId }, relations: { season: true } });
			if (!episode || episode.season?.workId !== work.id) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_TARGET');
			return episode;
		}
		const identities = await manager.getRepository(MiZalipExternalIdentity).findBy({ workId: work.id });
		const serial = work.kind === 'series' || work.tmdbMediaType === 'tv' || identities.some(identity => identity.entityType === 'tv') || await manager.getRepository(MiZalipSeason).countBy({ workId: work.id }) > 0;
		const movie = work.kind === 'movie' || work.tmdbMediaType === 'movie' || identities.some(identity => identity.entityType === 'movie');
		if (serial || !movie) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_TARGET');
		return null;
	}

	private async runtime() {
		const [{ providers }, config] = await Promise.all([this.playbackSettings.show(), this.sourceSettings.getRuntime()]);
		return { providers, config };
	}

	private async resource(manager: EntityManager, work: MiZalipWork, episode: MiZalipEpisode | null, target: ProgressTarget, runtime: Awaited<ReturnType<ZalipWatchProgressService['runtime']>>) {
		if (!zalipProgressProviders.includes(target.provider) || !runtime.providers.some(provider => provider.source === target.provider && provider.enabled)) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
		if (target.translationId !== null && (!target.translationId.trim() || target.translationId.length > 100)) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_TARGET');
		const stored = readImportState(work.importData).values.players;
		// Match the public playback projection: snapshots may retain multiple resource slots per provider.
		const player = (Array.isArray(stored) ? stored : []).find(candidate => candidate && typeof candidate === 'object' && candidate.source === target.provider) as ImportPlayer | undefined;
		if (player && configuredImportPlayerUrl(player.iframeUrl, target.provider, runtime.config)) {
			const translations = Array.isArray(player.translations) ? player.translations.slice(0, 100) : [];
			const translation = target.translationId == null ? null : translations.find(voice => voice?.id === target.translationId);
			if (target.translationId != null && (!translation || (translation.iframe && !configuredImportPlayerUrl(translation.iframe, target.provider, runtime.config)))) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			if (target.translationId == null && translations.length > 0) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_TARGET');
			if (target.provider === 'kodik' && (!translation?.iframe || !configuredImportPlayerUrl(translation.iframe, 'kodik', runtime.config))) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			if (episode) {
				const coverage = translation?.episodes ?? (Array.isArray(player.episodes) && player.episodes.length ? player.episodes : undefined);
				if ((target.provider === 'kodik' && !Array.isArray(coverage)) || (Array.isArray(coverage) && !coverage.some(item => item.seasonNumber === episode.season!.seasonNumber && item.episodeNumber === episode.episodeNumber))) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			}
			const identity = target.provider === 'kodik' && translation ? translation.id : player.externalId;
			const voiceUrl = translation?.iframe ? configuredImportPlayerUrl(translation.iframe, target.provider, runtime.config) : null;
			// A new resource path/hash is a different cut, even if the upstream edition ID is reused.
			// Approved mirror-origin and token changes alone do not invalidate the same media timeline.
			const resourceId = target.provider === 'kodik' && translation && voiceUrl
				? createHash('sha256').update(JSON.stringify([translation.id, new URL(voiceUrl).pathname, translation.providerTranslationId ?? null])).digest('hex')
				: identity;
			if (typeof resourceId !== 'string' || !resourceId || resourceId.length > 100) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			const mode = target.provider === 'kodik' && typeof translation?.providerTranslationId === 'string' && /^[1-9]\d{0,15}$/u.test(translation.providerTranslationId) ? 'time' as const : 'episode' as const;
			return { resourceId, mode };
		}
		// Legacy Alloha is a separate local cache; never fetch its upstream API during playback.
		if (target.provider === 'alloha') {
			const legacy = await manager.getRepository(MiZalipAllohaSource).findOneBy({ workId: work.id });
			if (legacy?.isAvailable && configuredImportPlayerUrl(legacy.iframe, 'alloha', runtime.config)) {
				const translation = legacy.translations.find(voice => String(voice.id) === target.translationId);
				if (target.translationId != null && (!translation || !configuredImportPlayerUrl(translation.iframe, 'alloha', runtime.config))) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
				if (target.translationId == null && legacy.translations.length) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_TARGET');
				return { resourceId: legacy.id, mode: 'episode' as const };
			}
		}
		throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
	}

	private pack(row: MiZalipWatchProgress, episode: MiZalipEpisode | null = row.episode) : PackedWatchProgress {
		return {
			workId: row.workId, episodeId: row.episodeId, seasonNumber: episode?.season?.seasonNumber ?? null, episodeNumber: episode?.episodeNumber ?? null,
			provider: row.provider, translationId: row.translationId, mode: row.mode,
			positionSeconds: row.positionSeconds, durationSeconds: row.durationSeconds, completed: row.completed, lastPlayedAt: row.lastPlayedAt.toISOString(),
		};
	}

	public async show(me: MiLocalUser, workId: string) {
		await this.work(this.db.manager, workId);
		const row = await this.db.getRepository(MiZalipWatchProgress).findOne({ where: { userId: me.id, workId }, relations: { episode: { season: true } } });
		return { progress: row && !row.hidden ? this.pack(row) : null };
	}

	public async start(me: MiLocalUser, target: ProgressTarget) {
		const runtime = await this.runtime();
		return this.db.transaction(async manager => {
			await this.lock(manager, me.id, target.workId);
			const work = await this.work(manager, target.workId, true);
			const episode = await this.episode(manager, work, target.episodeId);
			const { resourceId, mode } = await this.resource(manager, work, episode, target, runtime);
			// Bind the claim to the exact mounted frame, not a newer snapshot that arrived meanwhile.
			if (mode === 'time' && target.expectedResourceFingerprint !== resourceId) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			const repository = manager.getRepository(MiZalipWatchProgress);
			const existing = await repository.findOneBy({ userId: me.id, workId: target.workId });
			const same = existing && !existing.hidden && !existing.completed && existing.episodeId === target.episodeId && existing.provider === target.provider && existing.translationId === target.translationId && existing.resourceId === resourceId && existing.mode === mode;
			const now = new Date();
			const row = repository.create({
				userId: me.id, workId: target.workId, episodeId: target.episodeId, provider: target.provider, translationId: target.translationId,
				resourceId, mode, sessionId: randomUUID(), sequence: 0, completed: false, hidden: false,
				positionSeconds: same ? existing.positionSeconds : null, durationSeconds: same ? existing.durationSeconds : null,
				lastPlayedAt: now, createdAt: existing?.createdAt ?? now,
			});
			await repository.save(row);
			return { sessionId: row.sessionId, sequence: row.sequence, progress: this.pack(row, episode) };
		});
	}

	public async update(me: MiLocalUser, input: ProgressUpdate) {
		if (!Number.isSafeInteger(input.sequence) || input.sequence < 1 || input.sequence > 2147483647) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
		const runtime = await this.runtime();
		return this.db.transaction(async manager => {
			await this.lock(manager, me.id, input.workId);
			const work = await this.work(manager, input.workId, true);
			const repository = manager.getRepository(MiZalipWatchProgress);
			const row = await repository.findOne({ where: { userId: me.id, workId: input.workId }, relations: { episode: { season: true } } });
			if (!row || row.hidden) return { accepted: false, progress: null };
			if (row.sessionId !== input.sessionId || row.sequence >= input.sequence) return { accepted: false, progress: this.pack(row) };
			const episode = await this.episode(manager, work, row.episodeId);
			const current = await this.resource(manager, work, episode, row, runtime);
			if (current.resourceId !== row.resourceId || current.mode !== row.mode) throw new ZalipProgressError('ZALIP_PROGRESS_UNAVAILABLE');
			const values = validatedProgressValues(row, input);
			Object.assign(row, values, { sequence: input.sequence, lastPlayedAt: new Date() });
			await repository.save(row);
			return { accepted: true, progress: this.pack(row, episode) };
		});
	}

	public async reset(me: MiLocalUser, workId: string) {
		return this.db.transaction(async manager => {
			await this.lock(manager, me.id, workId);
			// No publication check: the owner can erase a now-hidden title without learning its metadata.
			await manager.getRepository(MiZalipWatchProgress).update({ userId: me.id, workId }, { hidden: true, sessionId: randomUUID(), sequence: 0, positionSeconds: null, durationSeconds: null, completed: false });
			return { cleared: true };
		});
	}

	public async continue(me: MiLocalUser, limit: number, cursor?: string) {
		if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
		const query = this.db.getRepository(MiZalipWatchProgress).createQueryBuilder('progress')
			.innerJoinAndSelect('progress.work', 'work').leftJoinAndSelect('progress.episode', 'episode').leftJoinAndSelect('episode.season', 'season')
			.where('progress.userId = :userId', { userId: me.id }).andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.andWhere('progress.hidden = false').andWhere('progress.completed = false');
		if (cursor) {
			const parsed = parseProgressCursor(cursor);
			query.andWhere('(progress.lastPlayedAt < :played OR (progress.lastPlayedAt = :played AND progress.workId < :workId))', parsed);
		}
		const rows = await query.orderBy('progress.lastPlayedAt', 'DESC').addOrderBy('progress.workId', 'DESC').take(limit + 1).getMany();
		const visible = rows.slice(0, limit);
		const last = visible.at(-1);
		return {
			items: visible.map(row => ({ ...this.pack(row), work: this.catalogue.packWork(row.work!), episode: row.episode ? { id: row.episode.id, title: row.episode.title, stillPath: row.episode.stillPath } : null })),
			nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ played: last.lastPlayedAt.toISOString(), workId: last.workId })).toString('base64url') : null,
		};
	}
}

export function validatedProgressValues(row: Pick<MiZalipWatchProgress, 'provider' | 'mode' | 'positionSeconds' | 'durationSeconds' | 'completed'>, input: Pick<ProgressUpdate, 'positionSeconds' | 'durationSeconds' | 'completed'>) {
	if (row.mode !== 'time' && (input.positionSeconds !== undefined || input.durationSeconds !== undefined)) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
	const positionSeconds = input.positionSeconds ?? row.positionSeconds;
	const durationSeconds = input.durationSeconds ?? row.durationSeconds;
	if (durationSeconds !== null && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > zalipProgressMaxSeconds)) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
	if (positionSeconds !== null && (!Number.isFinite(positionSeconds) || positionSeconds < 0 || durationSeconds === null || positionSeconds > durationSeconds)) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
	if (input.completed === true && (row.mode !== 'time' || positionSeconds === null || durationSeconds === null || positionSeconds < durationSeconds * 0.9)) throw new ZalipProgressError('INVALID_ZALIP_PROGRESS');
	return { positionSeconds, durationSeconds, completed: input.completed ?? row.completed };
}

export function parseProgressCursor(cursor: string): { played: string; workId: string } {
	try {
		if (cursor.length > 512 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw new Error();
		const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
		if (value == null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2 || typeof value.played !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value.played) || new Date(value.played).toISOString() !== value.played || typeof value.workId !== 'string' || !/^[A-Za-z0-9]{1,32}$/u.test(value.workId)) throw new Error();
		return { played: value.played, workId: value.workId };
	} catch { throw new ZalipProgressError('INVALID_ZALIP_PROGRESS_CURSOR'); }
}
