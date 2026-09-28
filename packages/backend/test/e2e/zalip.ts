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
});
