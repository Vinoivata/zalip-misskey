/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { ZalipWatchProgressService, parseProgressCursor, validatedProgressValues } from '@/core/ZalipWatchProgressService.js';
import type { ProgressTarget } from '@/core/ZalipWatchProgressService.js';
import { MiZalipWatchProgress } from '@/models/ZalipWatchProgress.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipAllohaSource } from '@/models/ZalipAllohaSource.js';
import type { MiLocalUser } from '@/models/User.js';
import { defaultPlaybackSettings } from './zalip-importer/playback-settings.js';
import type { ImportPlayer } from './zalip-importer/types.js';

const owner = { id: 'owner' } as MiLocalUser;
const other = { id: 'other' } as MiLocalUser;
const fingerprint = (id = 'serial-1', path = '/serial/1/hash/720p', providerTranslationId = '12') => createHash('sha256').update(JSON.stringify([id, path, providerTranslationId])).digest('hex');
const target: ProgressTarget = { workId: 'work', episodeId: 'episode1', provider: 'kodik', translationId: 'serial-1', expectedResourceFingerprint: fingerprint() };
const kodik = () => ({ source: 'kodik', externalId: 'shikimori-123', iframeUrl: 'https://kodikplayer.com/serial/1/hash/720p', translations: [{ id: 'serial-1', providerTranslationId: '12', name: 'Voice', iframe: 'https://kodikplayer.com/serial/1/hash/720p', episodes: [{ seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 2 }] }], episodes: [] });
const lockedPlayer = (provider: 'alloha' | 'collaps'): ImportPlayer => {
	const iframeUrl = provider === 'alloha' ? 'https://ascorbic-as.stravers.live/?token_movie=title-fixture' : 'https://api.nextembed.ws/embed/movie/123';
	return { source: provider, externalId: '123', iframeUrl, quality: null, translations: [{ id: '246', name: 'LE-Production', iframe: `${iframeUrl}${provider === 'alloha' ? '&translation=246' : '?oneSound=LE-Production'}`, episodes: [{ seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 2 }] }], episodes: [{ seasonNumber: 1, episodeNumber: 1 }, { seasonNumber: 1, episodeNumber: 2 }] };
};
const lockedFingerprint = (provider: 'alloha' | 'collaps', translationId: string | null, iframe: string, season: number | null = 1, episode: number | null = 1) => {
	const url = new URL(iframe);
	return createHash('sha256').update(JSON.stringify([provider, 'v1', translationId, url.pathname, provider === 'alloha' ? url.searchParams.get('token_movie') : null, url.searchParams.get(provider === 'alloha' ? 'translation' : 'oneSound'), season, episode])).digest('hex');
};
const lockedTarget = (player: ImportPlayer, episode = 1): ProgressTarget => ({ workId: 'work', episodeId: `episode${episode}`, provider: player.source, translationId: player.translations[0].id, expectedResourceFingerprint: lockedFingerprint(player.source as 'alloha' | 'collaps', player.translations[0].id, player.translations[0].iframe!, 1, episode) });

function fixture() {
	const work = { id: 'work', title: 'Title', kind: 'series', tmdbMediaType: 'tv', publicationState: 'published', importData: { values: { players: [kodik()] }, locks: ['players'], preserved: true } } as unknown as MiZalipWork;
	const season = { id: 'season', workId: 'work', seasonNumber: 1 } as MiZalipSeason;
	const episodes = new Map(['episode1', 'episode2'].map((id, index) => [id, { id, seasonId: 'season', season, episodeNumber: index + 1, title: `Episode ${index + 1}`, stillPath: '/files/frame.webp' } as MiZalipEpisode]));
	const rows = new Map<string, MiZalipWatchProgress>();
	const key = (value: { userId: string; workId: string }) => `${value.userId}:${value.workId}`;
	const hydrate = (value?: MiZalipWatchProgress) => value ? Object.assign(structuredClone(value), { work, episode: value.episodeId ? episodes.get(value.episodeId) : null }) : null;
	const progress = {
		findOneBy: vi.fn(async (where: { userId: string; workId: string }) => hydrate(rows.get(key(where)))),
		findOne: vi.fn(async (options: { where: { userId: string; workId: string } }) => hydrate(rows.get(key(options.where)))),
		create: (value: unknown) => value as MiZalipWatchProgress,
		save: vi.fn(async (row: MiZalipWatchProgress) => { rows.set(key(row), structuredClone(row)); return row; }),
		update: vi.fn(async (where: { userId: string; workId: string }, values: Partial<MiZalipWatchProgress>) => { const row = rows.get(key(where)); if (row) Object.assign(row, values); }),
		createQueryBuilder: vi.fn(),
	};
	const works = { findOne: vi.fn(async (options: { where: { id: string; publicationState: string } }) => work.id === options.where.id && work.publicationState === options.where.publicationState ? structuredClone(work) : null) };
	const episodeRepo = { findOne: vi.fn(async (options: { where: { id: string } }) => episodes.get(options.where.id) ?? null) };
	const seasons = { countBy: vi.fn(async () => work.kind === 'series' ? 1 : 0) };
	const identities = { findBy: vi.fn(async () => [] as { entityType: 'movie' | 'tv' }[]) };
	const legacy = { findOneBy: vi.fn(async () => null as unknown as MiZalipAllohaSource | null) };
	const getRepository = (model: unknown) => {
		if (model === MiZalipWork) return works;
		if (model === MiZalipEpisode) return episodeRepo;
		if (model === MiZalipSeason) return seasons;
		if (model === MiZalipExternalIdentity) return identities;
		if (model === MiZalipAllohaSource) return legacy;
		if (model === MiZalipWatchProgress) return progress;
		throw new Error('Unexpected repository: progress must never write library/importer tables.');
	};
	const manager = { getRepository, query: vi.fn(async () => []) };
	let turn = Promise.resolve();
	const db = { manager, getRepository, transaction: vi.fn(async <T>(action: (value: typeof manager) => Promise<T>) => { const pending = turn.then(() => action(manager)); turn = pending.then(() => undefined, () => undefined); return pending; }) };
	const playbackSettings = { show: vi.fn(async () => ({ providers: defaultPlaybackSettings() })) };
	const settings = { getRuntime: vi.fn(async () => ({})) };
	const catalogue = { packWork: vi.fn((value: MiZalipWork) => ({ id: value.id, title: value.title })) };
	const service = new ZalipWatchProgressService(db as never, playbackSettings as never, settings as never, catalogue as never);
	return { service, work, season, episodes, rows, progress, works, seasons, identities, legacy, manager, playbackSettings, settings, catalogue };
}

describe('ZalipWatchProgressService private playback state', () => {
	it('starts only a canonical target, mints a session and keeps importer locks and metadata unchanged', async () => {
		const f = fixture(); const before = structuredClone(f.work);
		const result = await f.service.start(owner, target);
		expect(result).toMatchObject({ sequence: 0, progress: { workId: 'work', episodeId: 'episode1', seasonNumber: 1, episodeNumber: 1, mode: 'time', positionSeconds: null, durationSeconds: null, completed: false } });
		expect(result.sessionId).toMatch(/^[a-f\d-]{36}$/u);
		expect(f.work).toEqual(before);
		expect(f.manager.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['zalip-progress:owner:work']);
		expect(f.works.findOne).toHaveBeenCalledWith({ where: { id: 'work', publicationState: 'published' }, lock: { mode: 'pessimistic_read' } });
	});

	it('saves same-session progress, permits seeking backwards and preserves unspecified duration', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		expect(await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 700, durationSeconds: 1000 })).toMatchObject({ accepted: true, progress: { positionSeconds: 700, durationSeconds: 1000 } });
		expect(await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 2, positionSeconds: 90 })).toMatchObject({ accepted: true, progress: { positionSeconds: 90, durationSeconds: 1000 } });
	});

	it('rejects duplicate and out-of-order saves without writing or changing lastPlayedAt', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 9, positionSeconds: 500, durationSeconds: 1000 });
		const before = structuredClone(f.rows.get('owner:work')); const writes = f.progress.save.mock.calls.length;
		for (const sequence of [9, 1]) expect(await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence, positionSeconds: 50 })).toMatchObject({ accepted: false, progress: { positionSeconds: 500 } });
		expect(f.rows.get('owner:work')).toEqual(before); expect(f.progress.save).toHaveBeenCalledTimes(writes);
	});

	it('a new episode/device session defeats a delayed old episode save', async () => {
		const f = fixture(); const old = await f.service.start(owner, target);
		const current = await f.service.start(owner, { ...target, episodeId: 'episode2' });
		expect(current.sessionId).not.toBe(old.sessionId);
		expect(await f.service.update(owner, { workId: 'work', sessionId: old.sessionId, sequence: 999, positionSeconds: 500, durationSeconds: 1000 })).toMatchObject({ accepted: false, progress: { episodeId: 'episode2', positionSeconds: null } });
	});

	it('concurrent starts leave one row and only the last server session can save', async () => {
		const f = fixture();
		const [first, second] = await Promise.all([f.service.start(owner, target), f.service.start(owner, { ...target, episodeId: 'episode2' })]);
		expect(f.rows.size).toBe(1);
		expect((await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1 })).accepted).toBe(false);
		expect((await f.service.update(owner, { workId: 'work', sessionId: second.sessionId, sequence: 1 })).accepted).toBe(true);
	});

	it('a fresh session on the same exact resource preserves an unfinished position, not across voices', async () => {
		const f = fixture(); const first = await f.service.start(owner, target);
		await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 50, durationSeconds: 1000 });
		expect((await f.service.start(owner, target)).progress.positionSeconds).toBe(50);
		const player = kodik(); player.translations.push({ ...player.translations[0], id: 'serial-2', providerTranslationId: '13', iframe: 'https://kodikplayer.com/serial/2/hash/720p' });
		f.work.importData = { values: { players: [player] } };
		expect((await f.service.start(owner, { ...target, translationId: 'serial-2', expectedResourceFingerprint: fingerprint('serial-2', '/serial/2/hash/720p', '13') })).progress.positionSeconds).toBeNull();
	});

	it('completion belongs only to the item and explicit rewatch starts from unknown/zero position', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 950, durationSeconds: 1000, completed: true });
		expect((await f.service.show(owner, 'work')).progress?.completed).toBe(true);
		expect((await f.service.start(owner, target)).progress).toMatchObject({ completed: false, positionSeconds: null });
	});

	it('same edition with a changed media path cannot inherit or update old seconds', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 50, durationSeconds: 1000 });
		const player = kodik(); player.translations[0].iframe = 'https://kodikplayer.com/serial/1/replaced-cut/720p'; f.work.importData = { values: { players: [player] } };
		await expect(f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 2, positionSeconds: 100 })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		expect((await f.service.start(owner, { ...target, expectedResourceFingerprint: fingerprint('serial-1', '/serial/1/replaced-cut/720p') })).progress.positionSeconds).toBeNull();
	});

	it('snapshot replacement before a claim cannot attribute old mounted-cut events to the new cut', async () => {
		const f = fixture(); const player = kodik(); player.translations[0].iframe = 'https://kodikplayer.com/serial/1/replaced-cut/720p'; f.work.importData = { values: { players: [player] } };
		await expect(f.service.start(owner, target)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		expect(f.rows.size).toBe(0); expect(f.progress.save).not.toHaveBeenCalled();
		const { expectedResourceFingerprint: _omitted, ...withoutProof } = target;
		await expect(f.service.start(owner, withoutProof)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
	});

	it('approved mirror-origin rotation preserves the exact same media timeline', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 50, durationSeconds: 1000 });
		f.settings.getRuntime.mockResolvedValue({ kodikPlayerOrigin: 'https://approved.example.org' });
		expect((await f.service.start(owner, target)).progress.positionSeconds).toBe(50);
	});

	it('reset only clears its owner, rotates the session and old saves cannot resurrect the card', async () => {
		const f = fixture(); const session = await f.service.start(owner, target); await f.service.start(other, target);
		await f.service.reset(owner, 'work');
		expect(await f.service.show(owner, 'work')).toEqual({ progress: null });
		expect((await f.service.show(other, 'work')).progress).not.toBeNull();
		expect(await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 20, positionSeconds: 30, durationSeconds: 100 })).toEqual({ accepted: false, progress: null });
		expect(f.rows.get('owner:work')?.sessionId).not.toBe(session.sessionId);
		expect((await f.service.start(owner, target)).progress.positionSeconds).toBeNull();
	});

	it('another user cannot read or update a session even with its UUID', async () => {
		const f = fixture(); const session = await f.service.start(owner, target);
		expect(await f.service.show(other, 'work')).toEqual({ progress: null });
		expect(await f.service.update(other, { workId: 'work', sessionId: session.sessionId, sequence: 1 })).toEqual({ accepted: false, progress: null });
		expect(f.rows.size).toBe(1);
	});

	it.each(['draft', 'archived'] as const)('published boundary rejects %s in show/start/update but allows owner clearing', async publicationState => {
		const f = fixture(); const session = await f.service.start(owner, target); f.work.publicationState = publicationState;
		await expect(f.service.show(owner, 'work')).rejects.toThrow('NO_SUCH_ZALIP_WORK');
		await expect(f.service.start(owner, target)).rejects.toThrow('NO_SUCH_ZALIP_WORK');
		await expect(f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1 })).rejects.toThrow('NO_SUCH_ZALIP_WORK');
		expect(await f.service.reset(owner, 'work')).toEqual({ cleared: true });
	});

	it('rejects wrong/missing episode, series with null episode, ambiguous anime and false film identity', async () => {
		const f = fixture();
		await expect(f.service.start(owner, { ...target, episodeId: 'missing' })).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		f.episodes.get('episode1')!.season = { ...f.season, workId: 'otherWork' };
		await expect(f.service.start(owner, target)).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		await expect(f.service.start(owner, { ...target, episodeId: null })).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		f.work.kind = 'anime'; f.work.tmdbMediaType = null;
		await expect(f.service.start(owner, { ...target, episodeId: null })).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		f.work.kind = 'movie'; f.identities.findBy.mockResolvedValue([{ entityType: 'tv' }]);
		await expect(f.service.start(owner, { ...target, episodeId: null })).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		expect(f.rows.size).toBe(0);
	});

	it('supports a known movie with no episode and specials with canonical season/episode zero', async () => {
		const f = fixture(); f.work.kind = 'movie'; f.work.tmdbMediaType = 'movie';
		expect((await f.service.start(owner, { ...target, episodeId: null })).progress.episodeId).toBeNull();
		f.season.seasonNumber = 0; f.episodes.get('episode1')!.episodeNumber = 0;
		const player = kodik(); player.translations[0].episodes = [{ seasonNumber: 0, episodeNumber: 0 }]; f.work.importData = { values: { players: [player] } };
		expect((await f.service.start(owner, target)).progress).toMatchObject({ seasonNumber: 0, episodeNumber: 0 });
	});

	it('provider policy, exact voice, coverage and valid iframe are checked against current cached state', async () => {
		const f = fixture();
		await expect(f.service.start(owner, { ...target, translationId: 'serial-999' })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		await expect(f.service.start(owner, { ...target, translationId: null })).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
		const player = kodik(); player.translations[0].episodes = []; f.work.importData = { values: { players: [player] } };
		await expect(f.service.start(owner, target)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		player.translations[0].episodes = [{ seasonNumber: 1, episodeNumber: 1 }]; player.translations[0].iframe = 'https://evil.example.org/serial/1/hash/720p';
		await expect(f.service.start(owner, target)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		f.work.importData = { values: { players: [kodik()] } };
		f.playbackSettings.show.mockResolvedValue({ providers: defaultPlaybackSettings().map(value => ({ ...value, enabled: false })) });
		await expect(f.service.start(owner, target)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
	});

	it('missing numeric Kodik JSAPI voice identity explicitly falls back to episode-only', async () => {
		const f = fixture(); const player = kodik(); delete (player.translations[0] as { providerTranslationId?: string }).providerTranslationId;
		f.work.importData = { values: { players: [player] } };
		const session = await f.service.start(owner, target);
		expect(session.progress.mode).toBe('episode');
		await expect(f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 1, durationSeconds: 10 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
	});

	it('finds the same current provider as public playback after retained duplicate provider slots', async () => {
		const f = fixture();
		f.work.importData = { values: { players: [...Array.from({ length: 5 }, (_, index) => ({ source: 'collaps', externalId: String(index), translations: [] })), kodik()] } };
		expect((await f.service.start(owner, target)).progress.mode).toBe('time');
	});

	it.each(['alloha', 'collaps'] as const)('%s permits only episode fallback without claiming seconds', async provider => {
		const f = fixture(); const iframeUrl = provider === 'alloha' ? 'https://ascorbic-as.stravers.live/?token_movie=fixture' : 'https://api.nextembed.ws/embed/movie/123';
		f.work.importData = { values: { players: [{ source: provider, externalId: '123', iframeUrl, translations: [], episodes: [] }] } };
		const session = await f.service.start(owner, { ...target, provider, translationId: null });
		expect(session.progress).toMatchObject({ mode: 'episode', positionSeconds: null, durationSeconds: null });
		expect((await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1 })).accepted).toBe(true);
		await expect(f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 2, positionSeconds: 1, durationSeconds: 10 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
	});

	it.each(['alloha', 'collaps'] as const)('%s accepts locked canonical serial seconds only with the mounted-resource proof', async provider => {
		const f = fixture(); const player = lockedPlayer(provider); const selection = lockedTarget(player);
		f.work.importData = { values: { players: [player] } };
		await expect(f.service.start(owner, { ...selection, expectedResourceFingerprint: undefined })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		await expect(f.service.start(owner, { ...selection, expectedResourceFingerprint: '0'.repeat(64) })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		expect(f.rows.size).toBe(0);
		const session = await f.service.start(owner, selection);
		expect(session.progress.mode).toBe('time');
		expect((await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 100, durationSeconds: 1000 })).progress).toMatchObject({ positionSeconds: 100, durationSeconds: 1000 });
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 2, positionSeconds: 20 });
		expect((await f.service.start(owner, selection)).progress.positionSeconds).toBe(20);
	});

	it.each(['alloha', 'collaps'] as const)('%s derives an omitted legacy voice iframe with the same selector as public playback', async provider => {
		const f = fixture(); const player = lockedPlayer(provider); const selection = lockedTarget(player);
		delete player.translations[0].iframe;
		f.work.importData = { values: { players: [player] } };
		expect((await f.service.start(owner, selection)).progress.mode).toBe('time');
	});

	it.each(['alloha', 'collaps'] as const)('%s keeps an identical timeline through approved mirror, public-token and start-time rotation', async provider => {
		const f = fixture(); const player = lockedPlayer(provider); const selection = lockedTarget(player);
		f.work.importData = { values: { players: [player] } };
		const first = await f.service.start(owner, selection);
		await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 100, durationSeconds: 1000 });
		player.translations[0].iframe += provider === 'alloha' ? '&start=500' : '&time=500';
		f.settings.getRuntime.mockResolvedValue(provider === 'alloha' ? { allohaPlayerOrigin: 'https://approved.example.org', allohaPlayerToken: 'new-public-fixture' } : { collapsPlayerOrigin: 'https://approved.example.org' });
		const rotated = await f.service.start(owner, selection);
		expect(rotated.progress).toMatchObject({ mode: 'time', positionSeconds: 100 });
		expect((await f.service.update(owner, { workId: 'work', sessionId: rotated.sessionId, sequence: 1, positionSeconds: 120 })).accepted).toBe(true);
	});

	it.each(['alloha', 'collaps'] as const)('%s binds the fingerprint to the canonical episode and rejects a stale target proof', async provider => {
		const f = fixture(); const player = lockedPlayer(provider); const selection = lockedTarget(player);
		f.work.importData = { values: { players: [player] } };
		const first = await f.service.start(owner, selection);
		await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 100, durationSeconds: 1000 });
		await expect(f.service.start(owner, { ...selection, episodeId: 'episode2' })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		const second = await f.service.start(owner, lockedTarget(player, 2));
		expect(second.progress).toMatchObject({ episodeId: 'episode2', positionSeconds: null });
		expect((await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 2, positionSeconds: 200 })).accepted).toBe(false);
	});

	it.each(['alloha', 'collaps'] as const)('%s invalidates old seconds when a media path or chosen voice changes', async provider => {
		for (const change of ['path', 'voice'] as const) {
			const f = fixture(); const player = lockedPlayer(provider); const selection = lockedTarget(player);
			f.work.importData = { values: { players: [player] } };
			const first = await f.service.start(owner, selection);
			await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 100, durationSeconds: 1000 });
			const url = new URL(player.translations[0].iframe!);
			if (change === 'path') url.pathname = '/replaced-cut';
			else {
				player.translations[0].id = '247'; player.translations[0].name = 'Another voice';
				url.searchParams.set(provider === 'alloha' ? 'translation' : 'oneSound', provider === 'alloha' ? '247' : 'Another voice');
			}
			player.translations[0].iframe = url.href;
			await expect(f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 2, positionSeconds: 200 })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
			await expect(f.service.start(owner, selection)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
			expect((await f.service.start(owner, lockedTarget(player))).progress.positionSeconds).toBeNull();
		}
	});

	it('Alloha changes in token_movie invalidate the timeline while malformed identities/selectors retain episode-only playability', async () => {
		const f = fixture(); const player = lockedPlayer('alloha'); f.work.importData = { values: { players: [player] } };
		const selection = lockedTarget(player); const session = await f.service.start(owner, selection);
		await f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 1, positionSeconds: 100, durationSeconds: 1000 });
		player.translations[0].iframe = player.translations[0].iframe!.replace('title-fixture', 'new-title-fixture');
		await expect(f.service.update(owner, { workId: 'work', sessionId: session.sessionId, sequence: 2, positionSeconds: 120 })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		expect((await f.service.start(owner, lockedTarget(player))).progress.positionSeconds).toBeNull();
		for (const query of ['translation=246', 'token_movie=short&translation=246', `token_movie=${'x'.repeat(257)}&translation=246`, 'token_movie=title.fixture&translation=246', 'token_movie=title-fixture&token_movie=other-fixture&translation=246', 'token_movie=title-fixture&translation=246&translation=246', 'token_movie=title-fixture&translation=247', 'token_movie=title-fixture']) {
			player.translations[0].iframe = `https://ascorbic-as.stravers.live/?${query}`;
			const fallback = await f.service.start(owner, selection);
			expect(fallback.progress).toMatchObject({ mode: 'episode', positionSeconds: null });
			await expect(f.service.update(owner, { workId: 'work', sessionId: fallback.sessionId, sequence: 1, positionSeconds: 10, durationSeconds: 1000 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
		}
	});

	it('Collaps serial seconds require exact per-voice episode coverage, not only parent coverage', async () => {
		const f = fixture(); const player = lockedPlayer('collaps'); f.work.importData = { values: { players: [player] } };
		delete player.translations[0].episodes;
		const fallback = await f.service.start(owner, lockedTarget(player));
		expect(fallback.progress.mode).toBe('episode');
		await expect(f.service.update(owner, { workId: 'work', sessionId: fallback.sessionId, sequence: 1, positionSeconds: 10, durationSeconds: 1000 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
		player.translations[0].episodes = [];
		await expect(f.service.start(owner, lockedTarget(player))).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		player.translations[0].episodes = [{ seasonNumber: 1, episodeNumber: 2 }];
		await expect(f.service.start(owner, lockedTarget(player))).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
		player.translations[0].episodes.push({ seasonNumber: 1, episodeNumber: 1 });
		expect((await f.service.start(owner, lockedTarget(player))).progress.mode).toBe('time');
	});

	it('malformed or mismatched Collaps selectors preserve playback without claiming a verified timeline', async () => {
		const f = fixture(); const player = lockedPlayer('collaps'); const selection = lockedTarget(player); f.work.importData = { values: { players: [player] } };
		for (const query of ['', '?oneSound=', '?oneSound=Another+voice', '?oneSound=LE-Production&oneSound=LE-Production', '?oneSound=LE-Production%00']) {
			player.translations[0].iframe = `https://api.nextembed.ws/embed/movie/123${query}`;
			const fallback = await f.service.start(owner, selection);
			expect(fallback.progress).toMatchObject({ mode: 'episode', positionSeconds: null, durationSeconds: null });
			await expect(f.service.update(owner, { workId: 'work', sessionId: fallback.sessionId, sequence: 1, positionSeconds: 10, durationSeconds: 100 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
		}
	});

	it('Alloha movie seconds remain disabled despite a valid selected voice; explicit Collaps movies can track seconds', async () => {
		for (const provider of ['alloha', 'collaps'] as const) {
			const f = fixture(); f.work.kind = 'movie'; f.work.tmdbMediaType = 'movie'; const player = lockedPlayer(provider); delete player.translations[0].episodes;
			f.work.importData = { values: { players: [player] } };
			const selection = { ...lockedTarget(player), episodeId: null, expectedResourceFingerprint: lockedFingerprint(provider, '246', player.translations[0].iframe!, null, null) };
			const result = await f.service.start(owner, selection);
			expect(result.progress.mode).toBe(provider === 'alloha' ? 'episode' : 'time');
			if (provider === 'alloha') await expect(f.service.update(owner, { workId: 'work', sessionId: result.sessionId, sequence: 1, positionSeconds: 10, durationSeconds: 100 })).rejects.toThrow('INVALID_ZALIP_PROGRESS');
		}
	});

	it('resumes a Collaps movie with null episode at the saved time only for the same exact voice without library writes', async () => {
		const f = fixture(); f.work.kind = 'movie'; f.work.tmdbMediaType = 'movie';
		const player = lockedPlayer('collaps'); player.episodes = []; delete player.translations[0].episodes;
		const anotherVoice = new URL(player.iframeUrl); anotherVoice.searchParams.set('oneSound', 'Another Studio');
		player.translations.push({ id: '247', name: 'Another Studio', iframe: anotherVoice.href });
		f.work.importData = { ...f.work.importData, values: { players: [player] } };
		const before = structuredClone(f.work);
		const repositories = vi.spyOn(f.manager, 'getRepository');
		const selection: ProgressTarget = { workId: 'work', episodeId: null, provider: 'collaps', translationId: '246', expectedResourceFingerprint: lockedFingerprint('collaps', '246', player.translations[0].iframe!, null, null) };
		const first = await f.service.start(owner, selection);
		expect(await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 120, durationSeconds: 7200 })).toMatchObject({ accepted: true, progress: { episodeId: null, seasonNumber: null, episodeNumber: null, mode: 'time', positionSeconds: 120, durationSeconds: 7200, completed: false } });
		expect(await f.service.show(owner, 'work')).toMatchObject({ progress: { episodeId: null, translationId: '246', positionSeconds: 120, durationSeconds: 7200 } });
		const resumed = await f.service.start(owner, selection);
		expect(resumed.sessionId).not.toBe(first.sessionId);
		expect(resumed).toMatchObject({ sequence: 0, progress: { episodeId: null, seasonNumber: null, episodeNumber: null, translationId: '246', mode: 'time', positionSeconds: 120, durationSeconds: 7200, completed: false } });
		const otherSelection = { ...selection, translationId: '247', expectedResourceFingerprint: lockedFingerprint('collaps', '247', anotherVoice.href, null, null) };
		const switched = await f.service.start(owner, otherSelection);
		expect(switched.progress).toMatchObject({ episodeId: null, translationId: '247', mode: 'time', positionSeconds: null, durationSeconds: null });
		expect(await f.service.update(owner, { workId: 'work', sessionId: resumed.sessionId, sequence: 999, positionSeconds: 121, durationSeconds: 7200 })).toMatchObject({ accepted: false, progress: { translationId: '247', positionSeconds: null } });
		expect(f.work).toEqual(before);
		const privateProgressDependencies = new Set<unknown>([MiZalipWork, MiZalipSeason, MiZalipExternalIdentity, MiZalipWatchProgress]);
		expect(repositories.mock.calls.every(([model]) => privateProgressDependencies.has(model))).toBe(true);
		expect(f.catalogue.packWork).not.toHaveBeenCalled();
	});

	it('Collaps movie seconds reject ambiguous case-insensitive substring voice matches', async () => {
		const f = fixture(); f.work.kind = 'movie'; f.work.tmdbMediaType = 'movie'; const player = lockedPlayer('collaps');
		const selection = { ...lockedTarget(player), episodeId: null, expectedResourceFingerprint: lockedFingerprint('collaps', '246', player.translations[0].iframe!, null, null) };
		player.translations.push({ id: '247', name: ' LE-PRODUCTION Commentary ', iframe: 'https://api.nextembed.ws/embed/movie/123?oneSound=LE-PRODUCTION+Commentary' });
		f.work.importData = { values: { players: [player] } };
		expect((await f.service.start(owner, selection)).progress.mode).toBe('episode');
		const exactLonger = { ...selection, translationId: '247', expectedResourceFingerprint: lockedFingerprint('collaps', '247', player.translations[1].iframe!, null, null) };
		expect((await f.service.start(owner, exactLonger)).progress.mode).toBe('time');
		player.translations[1].name = 'LE-Production';
		expect((await f.service.start(owner, selection)).progress.mode).toBe('episode');
	});

	it('Alloha default serial embeds can use their concrete identity only when no explicit voices exist', async () => {
		const f = fixture(); const player = lockedPlayer('alloha'); player.translations = []; f.work.importData = { values: { players: [player] } };
		const selection: ProgressTarget = { ...target, provider: 'alloha', translationId: null, expectedResourceFingerprint: lockedFingerprint('alloha', null, player.iframeUrl) };
		expect((await f.service.start(owner, selection)).progress.mode).toBe('time');
		player.translations = lockedPlayer('alloha').translations;
		await expect(f.service.start(owner, selection)).rejects.toThrow('INVALID_ZALIP_PROGRESS_TARGET');
	});

	it('legacy Alloha serials share mounted identity checks and resume without contacting upstream', async () => {
		const f = fixture(); f.work.importData = {}; const player = lockedPlayer('alloha');
		const translation = { id: 246, name: 'LE-Production', iframe: player.translations[0].iframe!, quality: null, resolutions: [] };
		f.legacy.findOneBy.mockResolvedValue({ id: 'legacy-cache', isAvailable: true, iframe: player.iframeUrl, translations: [translation] } as unknown as MiZalipAllohaSource);
		const selection = lockedTarget(player); const first = await f.service.start(owner, selection);
		expect(first.progress.mode).toBe('time');
		await f.service.update(owner, { workId: 'work', sessionId: first.sessionId, sequence: 1, positionSeconds: 50, durationSeconds: 1000 });
		expect((await f.service.start(owner, selection)).progress.positionSeconds).toBe(50);
		f.legacy.findOneBy.mockResolvedValue({ id: 'legacy-cache', isAvailable: true, iframe: player.iframeUrl, translations: [{ ...translation, iframe: translation.iframe.replace('title-fixture', 'new-title-fixture') }] } as unknown as MiZalipAllohaSource);
		await expect(f.service.start(owner, selection)).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
	});

	it('legacy cached Alloha works locally and snapshots/resource replacement invalidates old saves', async () => {
		const f = fixture(); f.work.importData = {};
		f.legacy.findOneBy.mockResolvedValue({ id: 'cache1', isAvailable: true, iframe: 'https://ascorbic-as.stravers.live/?token_movie=fixture', translations: [] } as unknown as MiZalipAllohaSource);
		const legacy = await f.service.start(owner, { ...target, provider: 'alloha', translationId: null }); expect(legacy.progress.mode).toBe('episode');
		f.work.importData = { values: { players: [kodik()] } }; const current = await f.service.start(owner, target);
		f.work.importData = { values: { players: [{ ...kodik(), translations: [] }] } };
		await expect(f.service.update(owner, { workId: 'work', sessionId: current.sessionId, sequence: 1 })).rejects.toThrow('ZALIP_PROGRESS_UNAVAILABLE');
	});

	it('show never exposes session/resource/importer data and never writes', async () => {
		const f = fixture(); await f.service.start(owner, target); f.progress.save.mockClear();
		const serialized = JSON.stringify(await f.service.show(owner, 'work'));
		for (const secret of ['sessionId', 'resourceId', 'importData', 'locks', 'iframe', 'sequence']) expect(serialized).not.toContain(secret);
		expect(f.progress.save).not.toHaveBeenCalled();
	});

	it('continue enforces owner/publication/visibility/completion in SQL and uses bounded stable keysets', async () => {
		const f = fixture(); await f.service.start(owner, target);
		const row = { ...f.rows.get('owner:work')!, work: f.work, episode: f.episodes.get('episode1')! };
		const query = { innerJoinAndSelect: vi.fn(), leftJoinAndSelect: vi.fn(), where: vi.fn(), andWhere: vi.fn(), orderBy: vi.fn(), addOrderBy: vi.fn(), take: vi.fn(), getMany: vi.fn(async () => [row, { ...row, workId: 'work0' }]) };
		for (const method of ['innerJoinAndSelect', 'leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'take'] as const) query[method].mockReturnValue(query);
		f.progress.createQueryBuilder.mockReturnValue(query);
		const first = await f.service.continue(owner, 1);
		expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
		expect(query.where).toHaveBeenCalledWith('progress.userId = :userId', { userId: 'owner' });
		expect(query.andWhere).toHaveBeenCalledWith('work.publicationState = :publicationState', { publicationState: 'published' });
		expect(query.andWhere).toHaveBeenCalledWith('progress.hidden = false'); expect(query.andWhere).toHaveBeenCalledWith('progress.completed = false');
		expect(query.take).toHaveBeenCalledWith(2); expect(query.addOrderBy).toHaveBeenCalledWith('progress.workId', 'DESC');
		await f.service.continue(owner, 1, first.nextCursor!);
		expect(query.andWhere).toHaveBeenCalledWith(expect.stringContaining('progress.lastPlayedAt < :played'), { played: row.lastPlayedAt.toISOString(), workId: 'work' });
		expect(first.items[0].episode).toEqual({ id: 'episode1', title: 'Episode 1', stillPath: '/files/frame.webp' });
		expect(JSON.stringify(first)).not.toContain('sessionId');
	});

	it.each([0, -1, 51, 1.1, NaN])('bounds continue limit %s before issuing SQL', async limit => {
		const f = fixture(); await expect(f.service.continue(owner, limit)).rejects.toThrow('INVALID_ZALIP_PROGRESS'); expect(f.progress.createQueryBuilder).not.toHaveBeenCalled();
	});
});

describe('watch progress numeric/cursor bounds', () => {
	const row = { provider: 'kodik' as const, mode: 'time' as const, positionSeconds: null, durationSeconds: null, completed: false };
	it.each([{ positionSeconds: NaN, durationSeconds: 100 }, { positionSeconds: Infinity, durationSeconds: 100 }, { positionSeconds: -1, durationSeconds: 100 }, { positionSeconds: 101, durationSeconds: 100 }, { positionSeconds: 1 }, { durationSeconds: 0 }, { durationSeconds: -1 }, { durationSeconds: 172801 }, { durationSeconds: Infinity }, { positionSeconds: 20, durationSeconds: 100, completed: true }])('rejects invalid progress %o', input => expect(() => validatedProgressValues(row, input)).toThrow('INVALID_ZALIP_PROGRESS'));
	it('accepts fractional time and maximum allowed duration', () => expect(validatedProgressValues(row, { positionSeconds: 1.25, durationSeconds: 172800 })).toMatchObject({ positionSeconds: 1.25, durationSeconds: 172800 }));
	it.each(['!', 'a'.repeat(513), Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ played: 'invalid', workId: 'work' })).toString('base64url'), Buffer.from(JSON.stringify({ played: '2026-10-17T12:00:00.000Z', workId: "' OR TRUE" })).toString('base64url'), Buffer.from(JSON.stringify({ played: '2026-10-17T12:00:00.000Z', workId: 'work', userId: 'other' })).toString('base64url')])('rejects malformed/extra-field cursor %s', input => expect(() => parseProgressCursor(input)).toThrow('INVALID_ZALIP_PROGRESS_CURSOR'));
});
