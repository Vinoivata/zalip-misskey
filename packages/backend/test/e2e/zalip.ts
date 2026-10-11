/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { beforeAll, describe, test } from 'vitest';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { api, castAsError, initTestDb, signup } from '../utils.js';
import type * as misskey from 'misskey-js';

type ImporterTaxonomyEntry = { id: string; name: string; data: Record<string, unknown> };
type ImporterTaxonomyShow = { entry: ImporterTaxonomyEntry; works: { id: string }[] };
type ImporterTaxonomyLinks = { entries: { entry: ImporterTaxonomyEntry }[] };
type ImporterProviderStatus = { source: 'tmdb' | 'kinopoisk' | 'alloha' | 'collaps'; configured: boolean };
type ImporterAdminEndpoint = Extract<keyof misskey.Endpoints, `zalip/admin/importer/${string}`>;
type ImporterPermissionCase = { [E in ImporterAdminEndpoint]: [E, misskey.Endpoints[E]['req']] }[ImporterAdminEndpoint];

describe('Zalip discussions', () => {
	let admin: misskey.entities.SignupResponse;
	let viewer: misskey.entities.SignupResponse;
	let workId: string;
	let episodeId: string;

	beforeAll(async () => {
		admin = await signup({ username: 'zalipdiscussionadmin' });
		viewer = await signup({ username: 'zalipdiscussionviewer' });

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
		const cases: ImporterPermissionCase[] = [
			['zalip/admin/importer/sources', {}],
			['zalip/admin/importer/sources/check', { source: 'tmdb' }],
			['zalip/admin/importer/diagnostics', {}],
			['zalip/admin/importer/resolve', { source: 'tmdb', imdbId: 'tt1234567', mediaType: 'movie' }],
			['zalip/admin/importer/work-state/show', { workId: 'work01' }],
			['zalip/admin/importer/work-state/save', { workId: 'work01', lockedFields: [] }],
			['zalip/admin/importer/search', { source: 'tmdb', query: 'offline permission test' }],
			['zalip/admin/importer/preview', { ref }],
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
			['zalip/admin/importer/taxonomy/recalculate', { entryId: 'entry01', workIds: ['work01'] }],
		];
		for (const [endpoint, params] of cases) {
			const anonymous = await api(endpoint, params);
			assert.strictEqual(anonymous.status, 401, endpoint);
			const denied = await api(endpoint, params, viewer);
			assert.strictEqual(denied.status, 403, endpoint);
			assert.strictEqual(castAsError(denied.body as Record<string, unknown>).error.code, 'ZALIP_ADMIN_REQUIRED');
		}
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
			refs: [{ source: unconfigured.source, externalId: unconfigured.source === 'alloha' ? 'tmdb:movie:123' : '123', mediaType: 'movie' }], mode: 'import',
		}, admin);
		assert.strictEqual(response.status, 503);
		assert.strictEqual(castAsError(response.body).error.code, 'ZALIP_IMPORT_NOT_CONFIGURED');
	});
});
