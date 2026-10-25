/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { beforeAll, describe, test } from 'vitest';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { MiZalipImporterSourceSetting } from '@/models/ZalipImporterSourceSetting.js';
import { MiZalipPlaybackSettings } from '@/models/ZalipPlaybackSettings.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { MiZalipLibraryEntry } from '@/models/ZalipLibraryEntry.js';
import { MiZalipWatchProgress } from '@/models/ZalipWatchProgress.js';
import { MiDriveFile } from '@/models/DriveFile.js';
import { api, castAsError, createAppToken, initTestDb, origin, port, sendEnvUpdateRequest, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

type ImporterTaxonomyEntry = { id: string; name: string; data: Record<string, unknown> };
type ImporterTaxonomyShow = { entry: ImporterTaxonomyEntry; works: { id: string }[] };
type ImporterTaxonomyLinks = { entries: { entry: ImporterTaxonomyEntry }[] };
type ImporterProviderStatus = { source: 'tmdb' | 'kinopoisk' | 'alloha' | 'collaps' | 'kodik' | 'vibix'; configured: boolean };
type ImporterAdminEndpoint = Extract<keyof misskey.Endpoints, `zalip/admin/importer/${string}`>;
type ImporterPermissionCase = { [E in ImporterAdminEndpoint]: [E, misskey.Endpoints[E]['req']] }[ImporterAdminEndpoint];

describe('Zalip discussions', () => {
	let admin: misskey.entities.SignupResponse;
	let viewer: misskey.entities.SignupResponse;
	let workId: string;
	let episodeId: string;

	beforeAll(async () => {
		admin = await signup({ username: 'zalipdiscussionadmin' });
		viewer = await signup({ username: 'zalipdiscviewer' });
		assert.ok(admin.id && admin.token, 'administrator signup fixture must authenticate');
		assert.ok(viewer.id && viewer.token, 'viewer signup fixture must authenticate');

		const createdWork = await api('zalip/admin/works/create', {
			slug: 'zalip-discussion-test',
			kind: 'series',
			title: 'Zalip discussion test',
		}, admin);
		assert.strictEqual(createdWork.status, 200);
		workId = createdWork.body.id;

		const unpublished = await api('zalip/discussions/ensure', { workId }, viewer);
		assert.strictEqual(unpublished.status, 404);
		assert.strictEqual(castAsError(unpublished.body).error.code, 'NO_SUCH_ZALIP_WORK');

		const publication = await api('zalip/admin/works/update-state', { workId, publicationState: 'published' }, admin);
		assert.strictEqual(publication.status, 200);

		const season = await api('zalip/admin/seasons/create', {
			workId,
			seasonNumber: 1,
			title: 'Season 1',
			originalTitle: null,
			description: null,
			airDate: null,
		}, admin);
		assert.strictEqual(season.status, 200);

		const episode = await api('zalip/admin/episodes/create', {
			workId,
			seasonNumber: 1,
			episodeNumber: 1,
			title: 'Episode 1',
			originalTitle: null,
			description: null,
			airDate: null,
			runtimeMinutes: null,
		}, admin);
		assert.strictEqual(episode.status, 200);
		episodeId = episode.body.id;
	}, 1000 * 60 * 2);

	test('returns the existing published title discussion to a signed-in viewer', async () => {
		const response = await api('zalip/discussions/ensure', { workId }, viewer);

		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.body.created, false);
		assert.strictEqual(typeof response.body.noteId, 'string');
	});

	test('adds only an exact existing native poster thumbnail to a published work and preserves its original', async () => {
		const db = await initTestDb(true);
		const posterUrl = `${origin}/files/zalip-native-poster`;
		const thumbnailUrl = `${origin}/files/thumbnail-zalip-native-poster`;
		await db.getRepository(MiDriveFile).insert({ id: 'zalipnativeposter', name: 'Native poster fixture.jpg', md5: '0'.repeat(32), type: 'image/jpeg', size: 1000, storedInternal: true, isLink: false, url: posterUrl, accessKey: 'zalip-native-poster', thumbnailUrl, thumbnailAccessKey: 'thumbnail-zalip-native-poster' });
		await db.getRepository(MiZalipWork).insert({ id: 'zalipnativework', slug: 'zalip-native-poster-fixture', title: 'Native poster fixture', kind: 'movie', publicationState: 'published', posterPath: posterUrl, createdAt: new Date(), updatedAt: new Date(), publishedAt: new Date(), importData: { locks: ['posterUrl'], localArtwork: { posterUrl }, sources: { posterUrl: 'manual' } } });
		const before = await db.getRepository(MiZalipWork).findOneByOrFail({ id: 'zalipnativework' });
		const detail = await api('zalip/works/show', { slug: before.slug });
		assert.strictEqual(detail.status, 200);
		assert.strictEqual(detail.body.posterPath, posterUrl);
		assert.strictEqual(detail.body.posterThumbnailUrl, thumbnailUrl);
		assert.strictEqual(detail.body.mediaType, 'movie');
		const page = await api('zalip/works/page', { query: 'Native poster fixture' });
		assert.strictEqual(page.status, 200);
		assert.strictEqual(page.body.items.find(work => work.id === before.id)?.posterThumbnailUrl, thumbnailUrl);
		assert.deepStrictEqual(await db.getRepository(MiZalipWork).findOneByOrFail({ id: before.id }), before);
		await db.getRepository(MiZalipWork).update(before.id, { publicationState: 'draft' });
		assert.strictEqual((await api('zalip/works/show', { slug: before.slug })).status, 404);
	});

	test('publishes only verified media types, with serial evidence taking precedence and identities kept private', async () => {
		const db = await initTestDb(true);
		const fixtures = [
			{ id: 'zaliptypemovie', kind: 'anime' as const, tmdbMediaType: 'movie' as const, expected: 'movie' },
			{ id: 'zaliptypebound', kind: 'animation' as const, tmdbMediaType: null, expected: 'movie' },
			{ id: 'zaliptypetv', kind: 'movie' as const, tmdbMediaType: 'movie' as const, expected: 'tv' },
			{ id: 'zaliptypeunknown', kind: 'anime' as const, tmdbMediaType: null, expected: null },
		];
		const now = new Date();
		await db.getRepository(MiZalipWork).insert(fixtures.map(({ expected: _expected, ...work }) => ({ ...work, slug: work.id, title: work.id, publicationState: 'published' as const, createdAt: now, updatedAt: now, publishedAt: now })));
		await db.getRepository(MiZalipExternalIdentity).insert([
			{ id: 'zaliptypeidentitym', workId: 'zaliptypebound', provider: 'kinopoisk', entityType: 'movie', externalId: 'private-media-type-movie', updatedAt: now },
			{ id: 'zaliptypeidentityt', workId: 'zaliptypetv', provider: 'tmdb', entityType: 'tv', externalId: 'private-media-type-tv', updatedAt: now },
		]);
		for (const fixture of fixtures) {
			const response = await api('zalip/works/show', { slug: fixture.id });
			assert.strictEqual(response.status, 200);
			assert.strictEqual(response.body.mediaType, fixture.expected);
			assert.strictEqual(JSON.stringify(response.body).includes('private-media-type-'), false);
			assert.strictEqual(Object.hasOwn(response.body, 'tmdbMediaType'), false);
		}
		await db.getRepository(MiZalipWork).update('zaliptypemovie', { publicationState: 'draft' });
		assert.strictEqual((await api('zalip/works/show', { slug: 'zaliptypemovie' })).status, 404);
	});

	test('pages beyond 100 published titles with global ordering and scoped cursors, excluding drafts', async () => {
		const db = await initTestDb(true);
		const repository = db.getRepository(MiZalipWork);
		const now = new Date('2026-10-16T12:00:00.000Z');
		await repository.insert(Array.from({ length: 114 }, (_, index) => ({
			id: `zalippage${String(index).padStart(5, '0')}`, slug: `zalip-page-fixture-${index}`,
			title: `Zalip page fixture ${String(index).padStart(3, '0')}`, kind: 'movie' as const,
			publicationState: index === 113 ? 'draft' as const : 'published' as const,
			releaseYear: index >= 110 ? null : 2000 + index % 10,
			createdAt: now, updatedAt: now, publishedAt: now,
			importData: { privateFixture: 'never-public' },
		})));
		const ids: string[] = [];
		let cursor: string | undefined;
		let firstCursor: string | null = null;
		do {
			const response: { status: number; body: misskey.Endpoints['zalip/works/page']['res'] } = await api('zalip/works/page', { query: 'Zalip page fixture', limit: 24, sort: 'title', ...(cursor ? { cursor } : {}) });
			assert.strictEqual(response.status, 200);
			assert.strictEqual(response.body.total, 113);
			assert.strictEqual(JSON.stringify(response.body).includes('never-public'), false);
			ids.push(...response.body.items.map(work => work.id));
			firstCursor ??= response.body.nextCursor;
			cursor = response.body.nextCursor ?? undefined;
			assert.ok(ids.length <= 113);
		} while (cursor);
		assert.strictEqual(ids.length, 113);
		assert.strictEqual(new Set(ids).size, 113);
		assert.deepStrictEqual(ids, Array.from({ length: 113 }, (_, index) => `zalippage${String(index).padStart(5, '0')}`));
		assert.ok(firstCursor);
		const wrongSort = await api('zalip/works/page', { query: 'Zalip page fixture', sort: 'year-desc', cursor: firstCursor });
		assert.strictEqual(wrongSort.status, 400);
		assert.strictEqual(castAsError(wrongSort.body).error.code, 'ZALIP_IMPORT_INVALID');
		const wrongFilter = await api('zalip/works/page', { query: 'Zalip page fixture', sort: 'title', kinds: ['series'], cursor: firstCursor });
		assert.strictEqual(wrongFilter.status, 400);
		const years: Array<number | null> = [];
		cursor = undefined;
		do {
			const response: { status: number; body: misskey.Endpoints['zalip/works/page']['res'] } = await api('zalip/works/page', { query: 'Zalip page fixture', limit: 24, sort: 'year-desc', ...(cursor ? { cursor } : {}) });
			assert.strictEqual(response.status, 200);
			years.push(...response.body.items.map(work => work.releaseYear));
			cursor = response.body.nextCursor ?? undefined;
			assert.ok(years.length <= 113);
		} while (cursor);
		assert.strictEqual(years.length, 113);
		assert.deepStrictEqual(years.slice(-3), [null, null, null]);
		assert.deepStrictEqual(years.slice(0, 110), [...years.slice(0, 110)].sort((left, right) => right! - left!));
	});

	test('includes nullable movie playback events only for authenticated active subscribers', async () => {
		const created = await api('zalip/admin/works/create', { slug: 'zalip-premiere-test', kind: 'movie', title: 'Premiere test' }, admin);
		assert.strictEqual(created.status, 200);
		const movieId = created.body.id;
		const db = await initTestDb(true);
		await db.getRepository(MiZalipAllohaAvailabilityEvent).save({ id: 'zalipmovieevent01', workId: movieId, availabilityKey: 'movie', seasonNumber: null, episodeNumber: null, translationCount: 1, createdAt: new Date(), notificationDeliveredAt: new Date() });
		const anonymous = await api('zalip/releases/subscribed', {});
		assert.strictEqual(anonymous.status, 401);
		await api('zalip/admin/works/update-state', { workId: movieId, publicationState: 'published' }, admin);
		await api('zalip/library/update', { workId: movieId, status: null, isReleaseSubscribed: true }, viewer);
		const response = await api('zalip/releases/subscribed', { limit: 50 }, viewer);
		assert.strictEqual(response.status, 200);
		const movieEvent = response.body.find(event => event.work.id === movieId);
		assert.ok(movieEvent);
		assert.strictEqual(movieEvent.source, 'playback');
		assert.strictEqual(movieEvent.season, null);
		assert.strictEqual(movieEvent.episode, null);
		const other = await api('zalip/releases/subscribed', {}, admin);
		assert.strictEqual(other.body.some(event => event.work.id === movieId), false);
		await api('zalip/admin/works/update-state', { workId: movieId, publicationState: 'draft' }, admin);
		const draft = await api('zalip/releases/subscribed', {}, viewer);
		assert.strictEqual(draft.body.some(event => event.work.id === movieId), false);
		await api('zalip/admin/works/update-state', { workId: movieId, publicationState: 'published' }, admin);
		await api('zalip/library/update', { workId: movieId, status: null, isReleaseSubscribed: false }, viewer);
		const unsubscribed = await api('zalip/releases/subscribed', {}, viewer);
		assert.strictEqual(unsubscribed.body.some(event => event.work.id === movieId), false);
	});

	test('clears and restores a list status without losing personal state or affecting another user', async () => {
		const before = await api('zalip/library/update', { workId, status: 'watching', episodesWatched: 4, personalRating: 8, isFavorite: true, isReleaseSubscribed: true }, viewer);
		assert.strictEqual(before.status, 200);
		const removed = await api('zalip/library/update', { workId, status: null }, viewer);
		assert.strictEqual(removed.status, 200);
		assert.strictEqual(removed.body.status, null);
		assert.strictEqual(removed.body.personalRating, 8);
		assert.strictEqual(removed.body.episodesWatched, 4);
		assert.strictEqual(removed.body.isFavorite, true);
		assert.strictEqual(removed.body.isReleaseSubscribed, true);
		const list = await api('zalip/library/list', {}, viewer);
		assert.strictEqual(list.body.find(entry => entry.work.id === workId)?.status, null);
		const other = await api('zalip/library/list', {}, admin);
		assert.strictEqual(other.body.some(entry => entry.work.id === workId), false);
		const restored = await api('zalip/library/update', { workId, status: 'planned' }, viewer);
		assert.strictEqual(restored.body.status, 'planned');
		assert.strictEqual(restored.body.personalRating, 8);
	});

	test('creates an episode discussion once and returns the same context on repeat', async () => {
		const first = await api('zalip/episodes/discussions/ensure', { episodeId }, viewer);
		const repeated = await api('zalip/episodes/discussions/ensure', { episodeId }, viewer);

		assert.strictEqual(first.status, 200);
		assert.strictEqual(first.body.created, true);
		assert.strictEqual(repeated.status, 200);
		assert.strictEqual(repeated.body.created, false);
		assert.strictEqual(repeated.body.noteId, first.body.noteId);
	});

	test('rejects a non-existent episode', async () => {
		const response = await api('zalip/episodes/discussions/ensure', { episodeId: '000000000000000000000000' }, viewer);

		assert.strictEqual(response.status, 404);
		assert.strictEqual(castAsError(response.body).error.code, 'NO_SUCH_ZALIP_EPISODE');
	});

	test('importer endpoints reject anonymous and non-administrator callers before provider access', async () => {
		const ref = { source: 'tmdb', externalId: '123', mediaType: 'movie' } as const;
		const kodikRef = { source: 'kodik', externalId: 'shikimori-123', mediaType: 'tv' } as const;
		const vibixRef = { source: 'vibix', externalId: '435', mediaType: 'movie' } as const;
		const cases: ImporterPermissionCase[] = [
			['zalip/admin/importer/sources', {}],
			['zalip/admin/importer/sources/check', { source: 'tmdb' }],
			['zalip/admin/importer/diagnostics', {}],
			['zalip/admin/importer/resolve', { source: 'tmdb', imdbId: 'tt1234567', mediaType: 'movie' }],
			['zalip/admin/importer/work-state/show', { workId: 'work01' }],
			['zalip/admin/importer/work-state/save', { workId: 'work01', lockedFields: [] }],
			['zalip/admin/importer/search', { source: 'tmdb', query: 'offline permission test' }],
			['zalip/admin/importer/preview', { ref }],
			['zalip/admin/importer/search', { source: 'kodik', query: 'offline permission test' }],
			['zalip/admin/importer/preview', { ref: kodikRef }],
			['zalip/admin/importer/runs/create', { refs: [kodikRef], mode: 'import' }],
			['zalip/admin/importer/sources/check', { source: 'vibix' }],
			['zalip/admin/importer/resolve', { source: 'vibix', imdbId: 'tt1234567', mediaType: 'movie' }],
			['zalip/admin/importer/search', { source: 'vibix', query: 'offline permission test' }],
			['zalip/admin/importer/preview', { ref: vibixRef }],
			['zalip/admin/importer/runs/create', { refs: [vibixRef], mode: 'import' }],
			['zalip/admin/importer/playback-settings/show', {}],
			['zalip/admin/importer/playback-settings/save', { providers: [{ source: 'alloha', label: 'Alloha', enabled: true, position: 0 }, { source: 'collaps', label: 'Collaps', enabled: true, position: 1 }, { source: 'kodik', label: 'Kodik', enabled: true, position: 2 }, { source: 'vibix', label: 'Vibix', enabled: false, position: 3 }] }],
			['zalip/admin/importer/artwork/inspect', { kind: 'work', limit: 1 }],
			['zalip/admin/importer/artwork/step', { kind: 'work', id: 'work01', field: 'posterPath', expected: 'a'.repeat(64) }],
			['zalip/admin/importer/runs/create', { refs: [ref], mode: 'import' }],
			['zalip/admin/importer/runs/list', {}],
			['zalip/admin/importer/runs/show', { runId: 'run01' }],
			['zalip/admin/importer/runs/action', { runId: 'run01', action: 'pause' }],
			['zalip/admin/importer/schedules/list', {}],
			['zalip/admin/importer/schedules/save', { name: 'Offline profile', enabled: false, source: 'tmdb', mode: 'metadata', intervalMinutes: 60 }],
			['zalip/admin/importer/schedules/run', { profileId: 'profile01' }],
			['zalip/admin/importer/schedules/action', { profileId: 'profile01', action: 'disable' }],
			['zalip/admin/importer/taxonomy/list', {}],
			['zalip/admin/importer/taxonomy/show', { entryId: 'entry01' }],
			['zalip/admin/importer/taxonomy/save', { type: 'genre', name: 'Offline genre' }],
			['zalip/admin/importer/taxonomy/link', { entryId: 'entry01', workId: 'work01' }],
			['zalip/admin/importer/taxonomy/delete', { entryId: 'entry01' }],
			['zalip/admin/importer/taxonomy/enrich-person', { entryId: 'entry01', source: 'tmdb' }],
			['zalip/admin/importer/taxonomy/import-person', { source: 'tmdb', reference: '63', preview: true }],
			['zalip/admin/importer/taxonomy/recalculate', { entryId: 'entry01', workIds: ['work01'] }],
		];
		for (const [endpoint, params] of cases) {
			const anonymous = await api(endpoint, params);
			const nativeOnly = endpoint === 'zalip/admin/importer/artwork/inspect' || endpoint === 'zalip/admin/importer/artwork/step';
			assert.strictEqual(anonymous.status, nativeOnly ? 400 : 401, endpoint);
			assert.strictEqual(castAsError(anonymous.body as Record<string, unknown>).error.code, nativeOnly ? 'ACCESS_DENIED' : 'CREDENTIAL_REQUIRED', endpoint);
			const denied = await api(endpoint, params, viewer);
			assert.strictEqual(denied.status, 403, endpoint);
			assert.strictEqual(castAsError(denied.body as Record<string, unknown>).error.code, 'ZALIP_ADMIN_REQUIRED');
		}
	});

	test.each([{ source: 'kodik', apiOrigin: 'https://kodik-api.com' }, { source: 'vibix', apiOrigin: 'https://vibix.org' }] as const)('$source credentials remain exclusive to native administrators', async ({ source, apiOrigin }) => {
		const params = { source, apiOrigin, playerOrigin: null };
		const applicationToken = await createAppToken(admin, ['read:account', 'write:account']);
		for (const [endpoint, input] of [['zalip/admin/importer/sources/settings/show', {}], ['zalip/admin/importer/sources/settings/save', params]] as const) {
			const anonymous = await api(endpoint, input);
			assert.strictEqual(anonymous.status, 400);
			assert.strictEqual(castAsError(anonymous.body).error.code, 'ACCESS_DENIED');
			const denied = await api(endpoint, input, viewer);
			assert.strictEqual(denied.status, 403);
			assert.strictEqual(castAsError(denied.body).error.code, 'ZALIP_ADMIN_REQUIRED');
			const application = await api(endpoint, input, { token: applicationToken });
			assert.strictEqual(application.status, 400);
			assert.strictEqual(castAsError(application.body).error.code, 'ACCESS_DENIED');
		}
	});

	test('playback settings upgrade legacy reads without writes and only accept complete four-provider saves', async () => {
		const db = await initTestDb(true);
		const repository = db.getRepository(MiZalipPlaybackSettings);
		const previous = await repository.findOneBy({ id: 'default' });
		const legacy = [{ source: 'collaps' as const, label: 'Custom backup', enabled: false, position: 0 }, { source: 'alloha' as const, label: 'Custom primary', enabled: false, position: 1 }];
		try {
			await repository.upsert({ id: 'default', providers: legacy, updatedAt: new Date('2026-10-17T00:00:00.000Z') }, ['id']);
			const before = await repository.findOneByOrFail({ id: 'default' });
			const upgraded = await api('zalip/admin/importer/playback-settings/show', {}, admin);
			assert.strictEqual(upgraded.status, 200);
			assert.deepStrictEqual(upgraded.body.providers, [...legacy, { source: 'kodik', label: 'KODIK', enabled: true, position: 2 }, { source: 'vibix', label: 'VIBIX', enabled: false, position: 3 }]);
			assert.deepStrictEqual(await repository.findOneByOrFail({ id: 'default' }), before);
			const legacyThree = [{ source: 'kodik' as const, label: 'Anime', enabled: false, position: 0 }, { source: 'alloha' as const, label: 'Primary', enabled: true, position: 2 }, { source: 'collaps' as const, label: 'Backup', enabled: false, position: 1 }];
			await repository.upsert({ id: 'default', providers: legacyThree, updatedAt: new Date('2026-10-18T00:00:00.000Z') }, ['id']);
			const beforeThree = await repository.findOneByOrFail({ id: 'default' });
			const upgradedThree = await api('zalip/admin/importer/playback-settings/show', {}, admin);
			assert.strictEqual(upgradedThree.status, 200);
			const orderedLegacyThree = [...legacyThree].sort((a, b) => a.position - b.position);
			assert.deepStrictEqual(upgradedThree.body.providers, [...orderedLegacyThree, { source: 'vibix', label: 'VIBIX', enabled: false, position: 3 }]);
			assert.deepStrictEqual(await repository.findOneByOrFail({ id: 'default' }), beforeThree);
			const providers = [{ source: 'vibix' as const, label: 'SDK player', enabled: false, position: 0 }, { source: 'kodik' as const, label: 'Anime', enabled: false, position: 1 }, { source: 'alloha' as const, label: 'Primary', enabled: true, position: 3 }, { source: 'collaps' as const, label: 'Backup', enabled: false, position: 2 }];
			const saved = await api('zalip/admin/importer/playback-settings/save', { providers }, admin);
			assert.strictEqual(saved.status, 200);
			assert.deepStrictEqual(saved.body.providers, [...providers].sort((a, b) => a.position - b.position));
			const persisted = await repository.findOneByOrFail({ id: 'default' });
			for (const [invalid, code] of [[legacy, 'INVALID_PARAM'], [legacyThree, 'INVALID_PARAM'], [[...providers, providers[0]], 'INVALID_PARAM'], [providers.map(row => row.source === 'kodik' ? { ...row, position: 2 } : row), 'ZALIP_IMPORT_INVALID'], [providers.map(row => row.source === 'kodik' ? { ...row, source: 'collaps' } : row), 'ZALIP_IMPORT_INVALID']] as const) {
				const rejected = await api('zalip/admin/importer/playback-settings/save', { providers: invalid } as never, admin);
				assert.strictEqual(rejected.status, 400);
				assert.strictEqual(castAsError(rejected.body).error.code, code);
				assert.deepStrictEqual(await repository.findOneByOrFail({ id: 'default' }), persisted);
			}
		} finally {
			if (previous) await repository.save(previous); else await repository.delete({ id: 'default' });
			await db.destroy();
		}
	});

	test('Kodik settings support null mirror, encrypted credentials and canonical refs without upstream calls or queued jobs', async () => {
		assert.ok(!process.env.ZALIP_IMPORTER_SETTINGS_KEY, 'the isolated fixture requires no developer encryption key');
		const db = await initTestDb(true);
		const repository = db.getRepository(MiZalipImporterSourceSetting);
		// This isolated test database must not contain a developer's encrypted credentials.
		assert.strictEqual(await repository.count(), 0);
		const beforeRuns = await db.getRepository(MiZalipImportRun).count();
		await sendEnvUpdateRequest({ key: 'ZALIP_IMPORTER_SETTINGS_KEY', value: Buffer.alloc(32, 17).toString('base64') });
		try {
			const saved = await api('zalip/admin/importer/sources/settings/save', { source: 'kodik', apiOrigin: 'https://kodik-api.com', apiToken: 'synthetic-offline-kodik-fixture', playerOrigin: 'https://mirror.provider.org' }, admin);
			assert.strictEqual(saved.status, 200);
			const settings = saved.body.sources.find(row => row.source === 'kodik');
			assert.ok(settings);
			assert.strictEqual(settings.apiToken, 'synthetic-offline-kodik-fixture');
			assert.strictEqual(settings.playerToken, null);
			assert.strictEqual(settings.playerOrigin, 'https://mirror.provider.org');
			assert.strictEqual(JSON.stringify(await repository.find()).includes('synthetic-offline-kodik-fixture'), false);
			const cleared = await api('zalip/admin/importer/sources/settings/save', { source: 'kodik', apiOrigin: 'https://kodik-api.com', playerOrigin: null, clearApiToken: true }, admin);
			assert.strictEqual(cleared.status, 200);
			assert.strictEqual(cleared.body.sources.find(row => row.source === 'kodik')?.playerOrigin, null);
			assert.strictEqual(cleared.body.sources.find(row => row.source === 'kodik')?.apiTokenSet, false);
			const status = await api('zalip/admin/importer/sources', {}, admin);
			assert.strictEqual(status.status, 200);
			assert.strictEqual((status.body.sources as ImporterProviderStatus[]).find(row => row.source === 'kodik')?.configured, false);
			const snapshot = await repository.findOneByOrFail({ source: 'kodik' });
			for (const [invalid, code] of [[{ playerToken: 'synthetic-public-token' }, 'ZALIP_IMPORT_INVALID'], [{ playerOrigin: 'http://mirror.provider.org' }, 'ZALIP_IMPORT_INVALID'], [{ playerOrigin: 'https://127.0.0.1' }, 'ZALIP_IMPORT_INVALID'], [{ playerOrigin: 'https://mirror.provider.org/path' }, 'ZALIP_IMPORT_INVALID'], [{ playerOrigin: 'https://mirror.provider.org?token=synthetic' }, 'ZALIP_IMPORT_INVALID'], [{ url: 'https://arbitrary.provider.org' }, 'INVALID_PARAM']] as const) {
				const rejected = await api('zalip/admin/importer/sources/settings/save', { source: 'kodik', apiOrigin: 'https://kodik-api.com', ...invalid } as never, admin);
				assert.strictEqual(rejected.status, 400);
				assert.strictEqual(castAsError(rejected.body).error.code, code);
				assert.deepStrictEqual(await repository.findOneByOrFail({ source: 'kodik' }), snapshot);
			}
			for (const [externalId, mediaType] of [['serial-123', 'tv'], ['movie-123', 'movie'], ['shikimori-123', 'tv'], ['kinopoisk-123', 'movie'], ['imdb-tt1234567', 'tv']] as const) {
				const response = await api('zalip/admin/importer/runs/create', { refs: [{ source: 'kodik', externalId, mediaType }], mode: 'import' }, admin);
				assert.strictEqual(response.status, 503);
				assert.strictEqual(castAsError(response.body).error.code, 'ZALIP_IMPORT_NOT_CONFIGURED');
			}
			for (const [ref, code] of [[{ source: 'kodik', externalId: '123', mediaType: 'tv' }, 'ZALIP_IMPORT_INVALID'], [{ source: 'kodik', externalId: 'movie-123', mediaType: 'tv' }, 'ZALIP_IMPORT_INVALID'], [{ source: 'tmdb', externalId: 'serial-123', mediaType: 'tv' }, 'ZALIP_IMPORT_INVALID'], [{ source: 'kodik', externalId: 'serial-0', mediaType: 'tv' }, 'INVALID_PARAM'], [{ source: 'kodik', externalId: 'serial-123?token=synthetic', mediaType: 'tv' }, 'INVALID_PARAM'], [{ source: 'kodik', externalId: 'https://kodikplayer.com/serial/123/hash', mediaType: 'tv' }, 'INVALID_PARAM']] as const) {
				const rejected = await api('zalip/admin/importer/runs/create', { refs: [ref], mode: 'import' } as never, admin);
				assert.strictEqual(rejected.status, 400);
				assert.strictEqual(castAsError(rejected.body).error.code, code);
			}
			assert.strictEqual(await db.getRepository(MiZalipImportRun).count(), beforeRuns);
		} finally {
			await repository.delete({ source: 'kodik' });
			// A full Nest reset drops the test schema and invalidates shared fixtures.
			// This service reads its key dynamically; an empty value restores no key.
			await sendEnvUpdateRequest({ key: 'ZALIP_IMPORTER_SETTINGS_KEY', value: '' });
			await db.destroy();
		}
	});

	test('Vibix credentials configure only the source, never enable playback or queue jobs', async () => {
		assert.ok(!process.env.ZALIP_IMPORTER_SETTINGS_KEY, 'the isolated fixture requires no developer encryption key');
		assert.ok(!process.env.ZALIP_VIBIX_API_TOKEN, 'the isolated fixture requires no developer Vibix token');
		const db = await initTestDb(true);
		const repository = db.getRepository(MiZalipImporterSourceSetting);
		assert.strictEqual(await repository.count(), 0);
		const beforeRuns = await db.getRepository(MiZalipImportRun).count();
		const initial = await api('zalip/admin/importer/sources', {}, admin);
		assert.strictEqual(initial.status, 200);
		assert.strictEqual((initial.body.sources as ImporterProviderStatus[]).find(row => row.source === 'vibix')?.configured, false);
		await sendEnvUpdateRequest({ key: 'ZALIP_IMPORTER_SETTINGS_KEY', value: Buffer.alloc(32, 19).toString('base64') });
		try {
			const saved = await api('zalip/admin/importer/sources/settings/save', { source: 'vibix', apiOrigin: 'https://vibix.org', apiToken: 'synthetic-offline-vibix-fixture', playerOrigin: null }, admin);
			assert.strictEqual(saved.status, 200);
			const settings = saved.body.sources.find(row => row.source === 'vibix');
			assert.ok(settings);
			assert.strictEqual(settings.apiToken, 'synthetic-offline-vibix-fixture');
			assert.strictEqual(settings.apiTokenOrigin, 'database');
			assert.strictEqual(settings.playerToken, null);
			assert.strictEqual(settings.playerOrigin, null);
			assert.strictEqual(JSON.stringify(await repository.find()).includes('synthetic-offline-vibix-fixture'), false);
			const configured = await api('zalip/admin/importer/sources', {}, admin);
			assert.strictEqual(configured.status, 200);
			assert.strictEqual((configured.body.sources as ImporterProviderStatus[]).find(row => row.source === 'vibix')?.configured, true);
			const playback = await api('zalip/admin/importer/playback-settings/show', {}, admin);
			assert.strictEqual(playback.status, 200);
			assert.strictEqual(playback.body.providers.find(row => row.source === 'vibix')?.enabled, false);
			const cleared = await api('zalip/admin/importer/sources/settings/save', { source: 'vibix', apiOrigin: 'https://vibix.org', playerOrigin: null, clearApiToken: true }, admin);
			assert.strictEqual(cleared.status, 200);
			assert.strictEqual(cleared.body.sources.find(row => row.source === 'vibix')?.apiTokenSet, false);
			const status = await api('zalip/admin/importer/sources', {}, admin);
			assert.strictEqual(status.status, 200);
			assert.strictEqual((status.body.sources as ImporterProviderStatus[]).find(row => row.source === 'vibix')?.configured, false);
			for (const [externalId, mediaType] of [['435', 'movie'], ['imdb:tt1234567', 'tv']] as const) {
				const response = await api('zalip/admin/importer/runs/create', { refs: [{ source: 'vibix', externalId, mediaType }], mode: 'import' }, admin);
				assert.strictEqual(response.status, 503);
				assert.strictEqual(castAsError(response.body).error.code, 'ZALIP_IMPORT_NOT_CONFIGURED');
			}
			assert.strictEqual(await db.getRepository(MiZalipImportRun).count(), beforeRuns);
		} finally {
			await repository.delete({ source: 'vibix' });
			await sendEnvUpdateRequest({ key: 'ZALIP_IMPORTER_SETTINGS_KEY', value: '' });
			await db.destroy();
		}
	});

	test('native administrator artwork inspection is offline, stale requests are inert and raw URLs are rejected', async () => {
		const before = await api('zalip/works/show', { slug: 'zalip-discussion-test' }, viewer);
		const inspection = await api('zalip/admin/importer/artwork/inspect', { kind: 'work', limit: 1 }, admin);
		assert.strictEqual(inspection.status, 200);
		assert.ok(Array.isArray(inspection.body.targets));
		assert.strictEqual(JSON.stringify(inspection.body).includes('https://'), false);
		const stale = await api('zalip/admin/importer/artwork/step', { kind: 'work', id: workId, field: 'posterPath', expected: 'a'.repeat(64) }, admin);
		assert.strictEqual(stale.status, 200);
		assert.strictEqual(stale.body.status, 'stale');
		const injection = await api('zalip/admin/importer/artwork/step', { kind: 'work', id: workId, field: 'posterPath', expected: 'a'.repeat(64), url: 'https://arbitrary.example.org/image.png' } as never, admin);
		assert.strictEqual(injection.status, 400);
		assert.strictEqual(castAsError(injection.body).error.code, 'INVALID_PARAM');
		const after = await api('zalip/works/show', { slug: 'zalip-discussion-test' }, viewer);
		assert.deepStrictEqual(after.body, before.body);
	});

	test('Collaps voice repair admits only native administrators and keeps offline/stale targets untouched', async () => {
		const endpoint = 'zalip/admin/importer/work-state/refresh-voices' as const;
		const input = { workId, expected: 'a'.repeat(64) };
		const anonymous = await api(endpoint, input);
		assert.strictEqual(anonymous.status, 400);
		assert.strictEqual(castAsError(anonymous.body).error.code, 'ACCESS_DENIED');
		const denied = await api(endpoint, input, viewer);
		assert.strictEqual(denied.status, 403);
		assert.strictEqual(castAsError(denied.body).error.code, 'ZALIP_ADMIN_REQUIRED');
		// Generated only by the isolated local test server, never by a live deployment.
		const appToken = await createAppToken(admin, ['write:account']);
		const application = await api(endpoint, input, { token: appToken });
		assert.strictEqual(application.status, 400);
		assert.strictEqual(castAsError(application.body).error.code, 'ACCESS_DENIED');
		const db = await initTestDb(true);
		const before = await db.getRepository(MiZalipWork).findOneByOrFail({ id: workId });
		const state = await api('zalip/admin/importer/work-state/show', { workId }, admin);
		assert.strictEqual(state.status, 200);
		assert.match(state.body.playbackRevision as string, /^[a-f0-9]{64}$/u);
		const unsupported = await api(endpoint, { workId, expected: state.body.playbackRevision as string }, admin);
		assert.strictEqual(unsupported.status, 200);
		assert.strictEqual(unsupported.body.status, 'unsupported');
		const stale = await api(endpoint, input, admin);
		assert.strictEqual(stale.status, 200);
		assert.strictEqual(stale.body.status, 'stale');
		const injection = await api(endpoint, { ...input, iframe: 'https://arbitrary.example.org/embed' } as never, admin);
		assert.strictEqual(injection.status, 400);
		assert.strictEqual(castAsError(injection.body).error.code, 'INVALID_PARAM');
		assert.deepStrictEqual(await db.getRepository(MiZalipWork).findOneByOrFail({ id: workId }), before);
	});

	test('person filmographies page unique published works, filter credits and expose only public metadata', async () => {
		const created = await api('zalip/admin/importer/taxonomy/save', { type: 'person', name: 'Zalip Person Fixture', slug: 'zalip-person-fixture', data: { biography: 'Public biography', originalName: 'Original Person Fixture', aliases: ['AlternatePersonFixture'], birthday: '1960-04-07' } }, admin);
		assert.strictEqual(created.status, 200);
		const entryId = (created.body as ImporterTaxonomyEntry).id;
		const db = await initTestDb(true);
		const now = new Date();
		await db.getRepository(MiZalipWork).insert([
			{ id: 'personmovie2020', slug: 'person-movie-2020', title: 'Person movie', kind: 'movie', releaseYear: 2020 },
			{ id: 'personseries2024', slug: 'person-series-2024', title: 'Person series', kind: 'series', releaseYear: 2024 },
			{ id: 'persondraft2025', slug: 'person-draft-2025', title: 'Secret person draft', kind: 'movie', releaseYear: 2025 },
		].map(work => ({ ...work, kind: work.kind as 'movie' | 'series', publicationState: 'draft' as const, createdAt: now, updatedAt: now })));
		for (const [workId, role] of [['personmovie2020', 'actor'], ['personmovie2020', 'director'], ['personseries2024', 'actor'], ['persondraft2025', 'director']]) {
			assert.strictEqual((await api('zalip/admin/importer/taxonomy/link', { entryId, workId, role }, admin)).status, 200);
		}
		const path = `http://127.0.0.1:${port}/zalip/taxonomy/person/zalip-person-fixture`;
		const hidden = await fetch(path);
		assert.strictEqual(hidden.status, 404);
		assert.ok((await hidden.text()).includes('name="robots" content="noindex"'));
		await db.getRepository(MiZalipWork).update(['personmovie2020', 'personseries2024'], { publicationState: 'published', publishedAt: now });
		type Filmography = { works: { id: string; credits?: { role: string }[] }[]; nextCursor: string | null };
		const first = await api('zalip/taxonomy/show', { entryId, sort: 'newest', limit: 1 });
		assert.strictEqual(first.status, 200);
		const page1 = first.body as Filmography;
		assert.deepStrictEqual(page1.works.map(work => work.id), ['personseries2024']);
		assert.ok(page1.nextCursor);
		const second = await api('zalip/taxonomy/show', { entryId, sort: 'newest', limit: 1, cursor: page1.nextCursor });
		assert.strictEqual(second.status, 200);
		const page2 = second.body as Filmography;
		assert.deepStrictEqual(page2.works.map(work => work.id), ['personmovie2020']);
		assert.deepStrictEqual(page2.works[0].credits?.map(credit => credit.role).sort(), ['actor', 'director']);
		assert.strictEqual(page2.nextCursor, null);
		const filtered = await api('zalip/taxonomy/show', { entryId, role: 'director', kind: 'movie', yearFrom: 2019, yearTo: 2021, sort: 'title' });
		assert.strictEqual(filtered.status, 200);
		assert.deepStrictEqual((filtered.body as Filmography).works.map(work => work.id), ['personmovie2020']);
		assert.strictEqual((await api('zalip/taxonomy/show', { entryId, sort: 'oldest', cursor: page1.nextCursor })).status, 400);
		const directory = await api('zalip/taxonomy/list', { type: 'person', query: 'AlternatePersonFixture', role: 'director' });
		assert.strictEqual(directory.status, 200);
		assert.ok((directory.body as { entries: ImporterTaxonomyEntry[] }).entries.some(person => person.id === entryId));
		const page = await fetch(path);
		assert.strictEqual(page.status, 200);
		const html = await page.text();
		assert.ok(html.includes('rel="canonical"'));
		assert.ok(html.includes('type="application/ld+json"'));
		assert.ok(html.includes('"@type":"Person"'));
		assert.ok(!html.includes('Secret person draft'));
	});

	test('taxonomy editorial entries and draft membership stay private until a work is published', async () => {
		const created = await api('zalip/admin/importer/taxonomy/save', {
			type: 'category', name: 'Importer private category', slug: 'importer-private-category',
			description: 'Editorial description', data: { rules: { kinds: ['movie'] } },
		}, admin);
		assert.strictEqual(created.status, 200);
		const entryId = (created.body as ImporterTaxonomyEntry).id;
		const before = await api('zalip/taxonomy/show', { entryId });
		assert.strictEqual(before.status, 404);
		const privateEntry = await api('zalip/admin/importer/taxonomy/show', { entryId }, admin);
		assert.strictEqual(privateEntry.status, 200);
		assert.strictEqual((privateEntry.body as ImporterTaxonomyShow).entry.name, 'Importer private category');
		const changed = await api('zalip/admin/importer/taxonomy/save', {
			entryId, type: 'category', name: 'Edited private category', description: 'Updated editorial description',
		}, admin);
		assert.strictEqual(changed.status, 200);
		assert.strictEqual((changed.body as ImporterTaxonomyEntry).id, entryId);

		const work = await api('zalip/admin/works/create', { slug: 'importer-private-taxonomy-work', kind: 'movie', title: 'Private taxonomy movie' }, admin);
		assert.strictEqual(work.status, 200);
		const linkedWorkId = work.body.id;
		const linked = await api('zalip/admin/importer/taxonomy/link', { entryId, workId: linkedWorkId }, admin);
		assert.strictEqual(linked.status, 200);
		const publicDraft = await api('zalip/taxonomy/show', { workId: linkedWorkId });
		assert.strictEqual(publicDraft.status, 404);
		const adminDraft = await api('zalip/admin/importer/taxonomy/show', { workId: linkedWorkId }, admin);
		assert.strictEqual(adminDraft.status, 200);
		assert.strictEqual((adminDraft.body as ImporterTaxonomyLinks).entries.some(link => link.entry.id === entryId), true);
		const privateList = await api('zalip/taxonomy/list', { type: 'category', query: 'Edited private category' });
		assert.strictEqual(privateList.status, 200);
		assert.strictEqual((privateList.body as { entries: ImporterTaxonomyEntry[] }).entries.some(entry => entry.id === entryId), false);

		await api('zalip/admin/works/update-state', { workId: linkedWorkId, publicationState: 'published' }, admin);
		const published = await api('zalip/taxonomy/show', { entryId });
		assert.strictEqual(published.status, 200);
		const publishedBody = published.body as ImporterTaxonomyShow;
		assert.strictEqual(publishedBody.works.some(item => item.id === linkedWorkId), true);
		assert.strictEqual(publishedBody.entry.data.rules, undefined);
		assert.strictEqual(publishedBody.entry.data._zalip, undefined);
		const removed = await api('zalip/admin/importer/taxonomy/link', { entryId, workId: linkedWorkId, remove: true }, admin);
		assert.strictEqual(removed.status, 200);
		const after = await api('zalip/taxonomy/show', { entryId });
		assert.strictEqual(after.status, 404);
	});

	test('playback sources require credentials and never expose unpublished titles', async () => {
		const work = await api('zalip/admin/works/create', { slug: 'importer-private-playback', kind: 'movie', title: 'Private playback movie' }, admin);
		assert.strictEqual(work.status, 200);
		const anonymous = await api('zalip/playback/sources', { workId: work.body.id });
		assert.strictEqual(anonymous.status, 401);
		const unpublished = await api('zalip/playback/sources', { workId: work.body.id }, viewer);
		assert.strictEqual(unpublished.status, 404);
		assert.strictEqual(castAsError(unpublished.body).error.code, 'ZALIP_IMPORT_NOT_FOUND');
		await api('zalip/admin/works/update-state', { workId: work.body.id, publicationState: 'published' }, admin);
		const published = await api('zalip/playback/sources', { workId: work.body.id }, viewer);
		assert.strictEqual(published.status, 200);
		assert.deepStrictEqual(published.body.sources, []);
	});

	test('an unconfigured provider cannot create an import run or contact an upstream service', async () => {
		const providers = await api('zalip/admin/importer/sources', {}, admin);
		assert.strictEqual(providers.status, 200);
		const unconfigured = (providers.body.sources as ImporterProviderStatus[]).find(source => !source.configured);
		// CI has no provider credentials. Fail safely before queueing if a developer runs this with live keys.
		assert.ok(unconfigured, 'This offline e2e case requires at least one unconfigured provider.');
		const response = await api('zalip/admin/importer/runs/create', {
			refs: [{ source: unconfigured.source, externalId: unconfigured.source === 'alloha' ? 'tmdb:movie:123' : unconfigured.source === 'kodik' ? 'movie-123' : '123', mediaType: 'movie' }], mode: 'import',
		}, admin);
		assert.strictEqual(response.status, 503);
		assert.strictEqual(castAsError(response.body).error.code, 'ZALIP_IMPORT_NOT_CONFIGURED');
	});
});

describe('Zalip private continue watching', () => {
	let owner: misskey.entities.SignupResponse;
	let other: misskey.entities.SignupResponse;
	let db: Awaited<ReturnType<typeof initTestDb>>;
	const movieId = 'watchprogressmovie';
	const seriesId = 'watchprogressseries';
	const draftId = 'watchprogressdraft';
	const extraId = 'watchprogressextra';
	const episodeId = 'watchprogressepisode';
	const episode2Id = 'watchprogressepisode2';
	const film = { workId: movieId, episodeId: null, provider: 'kodik', translationId: 'movie-7', expectedResourceFingerprint: createHash('sha256').update(JSON.stringify(['movie-7', '/video/7/fixture/720p', '12'])).digest('hex') } as const;
	const serial = { workId: seriesId, episodeId, provider: 'kodik', translationId: 'serial-8', expectedResourceFingerprint: createHash('sha256').update(JSON.stringify(['serial-8', '/serial/8/fixture/720p', '12'])).digest('hex') } as const;
	const player = (movie: boolean) => ({
		source: 'kodik', externalId: movie ? 'kinopoisk-7' : 'shikimori-8', iframeUrl: `https://kodikplayer.com/${movie ? 'video/7' : 'serial/8'}/fixture/720p`, quality: null,
		translations: [{ id: movie ? 'movie-7' : 'serial-8', providerTranslationId: '12', name: 'Fixture', iframe: `https://kodikplayer.com/${movie ? 'video/7' : 'serial/8'}/fixture/720p`, episodes: movie ? [] : [{ seasonNumber: 0, episodeNumber: 0 }, { seasonNumber: 0, episodeNumber: 1 }] }], episodes: [],
	});

	beforeAll(async () => {
		owner = await signup({ username: 'watchprogressowner' }); other = await signup({ username: 'watchprogressother' });
		db = await initTestDb(true);
		const now = new Date();
		await db.getRepository(MiZalipWork).insert([movieId, seriesId, draftId, extraId].map(id => ({
			id, slug: id, title: id, kind: id === seriesId ? 'series' as const : 'movie' as const,
			tmdbMediaType: id === seriesId ? 'tv' as const : 'movie' as const,
			publicationState: id === draftId ? 'draft' as const : 'published' as const,
			createdAt: now, updatedAt: now, publishedAt: id === draftId ? null : now,
			importData: { values: { players: [player(id !== seriesId)] }, locks: ['players'], privateFixture: 'private-progress-importer-baseline' },
		})));
		await db.getRepository(MiZalipSeason).insert({ id: 'watchprogressseason', workId: seriesId, seasonNumber: 0, title: 'Specials', createdAt: now, updatedAt: now });
		await db.getRepository(MiZalipEpisode).insert([episodeId, episode2Id].map((id, index) => ({ id, seasonId: 'watchprogressseason', episodeNumber: index, title: `Special ${index}`, createdAt: now, updatedAt: now })));
		await api('zalip/library/update', { workId: movieId, status: 'planned', personalRating: 7, isFavorite: true, isReleaseSubscribed: true }, owner);
	}, 120000);

	test('requires credentials and exact read/write scopes, with no caller-selected owner', async () => {
		const anonymous = await api('zalip/progress/show', { workId: movieId });
		assert.strictEqual(anonymous.status, 401); assert.strictEqual(castAsError(anonymous.body).error.code, 'CREDENTIAL_REQUIRED');
		const readToken = await createAppToken(owner, ['read:account']);
		assert.strictEqual((await api('zalip/progress/show', { workId: movieId }, { token: readToken })).status, 200);
		const forbidden = await api('zalip/progress/start', film, { token: readToken });
		assert.strictEqual(forbidden.status, 403); assert.strictEqual(castAsError(forbidden.body).error.code, 'PERMISSION_DENIED');
		assert.strictEqual((await api('zalip/progress/batch', { workIds: [movieId] })).status, 401);
		assert.strictEqual((await api('zalip/progress/batch', { workIds: [movieId] }, { token: readToken })).status, 200);
		const notificationToken = await createAppToken(owner, ['read:notifications']);
		const privateHistory = await api('zalip/progress/batch', { workIds: [movieId] }, { token: notificationToken });
		assert.strictEqual(privateHistory.status, 403); assert.strictEqual(castAsError(privateHistory.body).error.code, 'PERMISSION_DENIED');
	});

	test('persists exact seconds, permits seek backwards and never edits personal library/importer state', async () => {
		const beforeWork = await db.getRepository(MiZalipWork).findOneByOrFail({ id: movieId });
		const beforeLibrary = await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: owner.id, workId: movieId });
		const started = await api('zalip/progress/start', film, owner); assert.strictEqual(started.status, 200);
		assert.strictEqual(started.body.progress.mode, 'time'); assert.strictEqual(started.body.progress.positionSeconds, null);
		const saved = await api('zalip/progress/update', { workId: movieId, sessionId: started.body.sessionId, sequence: 2, positionSeconds: 600.25, durationSeconds: 1000 }, owner);
		assert.strictEqual(saved.status, 200); assert.strictEqual(saved.body.accepted, true);
		const backwards = await api('zalip/progress/update', { workId: movieId, sessionId: started.body.sessionId, sequence: 3, positionSeconds: 90 }, owner);
		assert.strictEqual(backwards.body.progress?.positionSeconds, 90);
		const stale = await api('zalip/progress/update', { workId: movieId, sessionId: started.body.sessionId, sequence: 1, positionSeconds: 700 }, owner);
		assert.strictEqual(stale.body.accepted, false); assert.strictEqual(stale.body.progress?.positionSeconds, 90);
		assert.deepStrictEqual(await db.getRepository(MiZalipLibraryEntry).findOneByOrFail({ userId: owner.id, workId: movieId }), beforeLibrary);
		assert.deepStrictEqual(await db.getRepository(MiZalipWork).findOneByOrFail({ id: movieId }), beforeWork);
		const otherView = await api('zalip/progress/show', { workId: movieId }, other); assert.strictEqual(otherView.body.progress, null);
		const otherWrite = await api('zalip/progress/update', { workId: movieId, sessionId: started.body.sessionId, sequence: 99 }, other); assert.strictEqual(otherWrite.body.accepted, false);
		const publicWork = await api('zalip/works/show', { slug: movieId });
		for (const key of ['positionSeconds', 'durationSeconds', 'sessionId', 'private-progress-importer-baseline']) assert.strictEqual(JSON.stringify(publicWork.body).includes(key), false);
	});

	test('batch reads completed owned targets only, preserving publication, reset and canonical episode boundaries', async () => {
		const started = await api('zalip/progress/start', film, owner);
		await api('zalip/progress/update', { workId: movieId, sessionId: started.body.sessionId, sequence: 1, positionSeconds: 1000, durationSeconds: 1000, completed: true }, owner);
		await api('zalip/progress/start', serial, owner);
		await api('zalip/progress/start', film, other);
		const repository = db.getRepository(MiZalipWatchProgress);
		const filmRow = await repository.findOneByOrFail({ userId: owner.id, workId: movieId });
		await repository.insert([draftId, extraId].map(workId => ({
			userId: owner.id, workId, episodeId: null, provider: filmRow.provider, translationId: filmRow.translationId,
			mode: filmRow.mode, resourceId: filmRow.resourceId, positionSeconds: filmRow.positionSeconds, durationSeconds: filmRow.durationSeconds,
			completed: filmRow.completed, hidden: workId === extraId, sessionId: filmRow.sessionId, sequence: filmRow.sequence,
			lastPlayedAt: filmRow.lastPlayedAt, createdAt: filmRow.createdAt,
		})));
		try {
			const result = await api('zalip/progress/batch', { workIds: [movieId, seriesId, draftId, extraId, 'missingwork'] }, owner);
			assert.strictEqual(result.status, 200);
			assert.deepStrictEqual(result.body.items.map(item => item.workId), [movieId, seriesId]);
			assert.strictEqual(result.body.items[0].completed, true);
			assert.strictEqual(result.body.items[0].positionSeconds, 1000);
			assert.strictEqual(result.body.items[1].seasonNumber, 0);
			assert.strictEqual(result.body.items[1].episodeNumber, 0);
			for (const key of ['sessionId', 'resourceId', 'sequence', 'hidden', 'userId', 'private-progress-importer-baseline']) assert.strictEqual(JSON.stringify(result.body).includes(key), false);
			assert.deepStrictEqual(await repository.findOneByOrFail({ userId: owner.id, workId: movieId }), filmRow);
			const others = await api('zalip/progress/batch', { workIds: [movieId, seriesId] }, other);
			assert.deepStrictEqual(others.body.items.map(item => item.workId), [movieId]);
			assert.strictEqual(others.body.items[0].positionSeconds, null);
			await repository.update({ userId: owner.id, workId: movieId }, { episodeId });
			assert.deepStrictEqual((await api('zalip/progress/batch', { workIds: [movieId] }, owner)).body.items, []);
			await repository.update({ userId: owner.id, workId: movieId }, { episodeId: null });
			await repository.update({ userId: owner.id, workId: seriesId }, { episodeId: null });
			assert.deepStrictEqual((await api('zalip/progress/batch', { workIds: [seriesId] }, owner)).body.items, []);
			await repository.update({ userId: owner.id, workId: seriesId }, { episodeId });
		} finally {
			await repository.delete({ userId: owner.id, workId: draftId });
			await repository.delete({ userId: owner.id, workId: extraId });
		}
	});

	test('canonical specials are valid and a new episode/session defeats delayed saves', async () => {
		const first = await api('zalip/progress/start', serial, owner); assert.strictEqual(first.status, 200);
		assert.strictEqual(first.body.progress.seasonNumber, 0); assert.strictEqual(first.body.progress.episodeNumber, 0);
		const second = await api('zalip/progress/start', { ...serial, episodeId: episode2Id }, owner); assert.strictEqual(second.status, 200);
		assert.notStrictEqual(first.body.sessionId, second.body.sessionId);
		const stale = await api('zalip/progress/update', { workId: seriesId, sessionId: first.body.sessionId, sequence: 100, positionSeconds: 100, durationSeconds: 300 }, owner);
		assert.strictEqual(stale.body.accepted, false); assert.strictEqual(stale.body.progress?.episodeId, episode2Id);
		const row = await db.getRepository(MiZalipWatchProgress).findOneByOrFail({ userId: owner.id, workId: seriesId }); assert.strictEqual(row.sessionId, second.body.sessionId);
		const wrongWork = await api('zalip/progress/start', { ...film, episodeId }, owner); assert.strictEqual(wrongWork.status, 400); assert.strictEqual(castAsError(wrongWork.body).error.code, 'INVALID_ZALIP_PROGRESS_TARGET');
	});

	test('drafts remain unavailable and cannot enter private continue results', async () => {
		for (const endpoint of ['zalip/progress/show', 'zalip/progress/start'] as const) {
			const result = endpoint === 'zalip/progress/show' ? await api(endpoint, { workId: draftId }, owner) : await api(endpoint, { ...film, workId: draftId }, owner);
			assert.strictEqual(result.status, 404); assert.strictEqual(castAsError(result.body).error.code, 'NO_SUCH_ZALIP_WORK');
		}
	});

	test('continue pages only owner rows, reset clears position and a delayed save cannot resurrect it', async () => {
		const start = await api('zalip/progress/start', film, owner); assert.strictEqual(start.status, 200);
		await api('zalip/progress/start', { ...film, workId: extraId }, other);
		const first = await api('zalip/progress/continue', { limit: 1 }, owner); assert.strictEqual(first.status, 200); assert.strictEqual(first.body.items.length, 1); assert.ok(first.body.nextCursor);
		const second = await api('zalip/progress/continue', { limit: 1, cursor: first.body.nextCursor! }, owner); assert.strictEqual(second.status, 200);
		const ids = [...first.body.items, ...second.body.items].map(item => item.workId); assert.strictEqual(new Set(ids).size, 2); assert.strictEqual(ids.includes(extraId), false); assert.strictEqual(ids.includes(draftId), false);
		for (const key of ['sessionId', 'resourceId', 'private-progress-importer-baseline']) assert.strictEqual(JSON.stringify(first.body).includes(key), false);
		assert.strictEqual((await api('zalip/progress/reset', { workId: movieId }, owner)).status, 200);
		assert.strictEqual((await api('zalip/progress/show', { workId: movieId }, owner)).body.progress, null);
		const late = await api('zalip/progress/update', { workId: movieId, sessionId: start.body.sessionId, sequence: 100, positionSeconds: 30, durationSeconds: 100 }, owner); assert.strictEqual(late.body.accepted, false);
		const after = await api('zalip/progress/continue', {}, owner); assert.strictEqual(after.body.items.some(item => item.workId === movieId), false);
	});

	test('deleting a canonical episode removes its target, never converts it into a film', async () => {
		const started = await api('zalip/progress/start', { ...serial, episodeId: episode2Id }, owner); assert.strictEqual(started.status, 200);
		await db.getRepository(MiZalipEpisode).delete({ id: episode2Id });
		assert.strictEqual(await db.getRepository(MiZalipWatchProgress).countBy({ userId: owner.id, workId: seriesId }), 0);
		assert.strictEqual((await api('zalip/progress/show', { workId: seriesId }, owner)).body.progress, null);
	});
});
