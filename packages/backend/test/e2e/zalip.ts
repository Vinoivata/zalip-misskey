/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { beforeAll, describe, test } from 'vitest';
import { api, castAsError, signup } from '../utils.js';
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
