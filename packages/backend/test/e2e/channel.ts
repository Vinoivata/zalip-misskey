/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'assert';
import { describe, beforeAll, test } from 'vitest';
import { api, castAsError, signup, uploadFile } from '../utils.js';
import type * as misskey from 'misskey-js';

describe('Channel', () => {
	let alice: misskey.entities.SignupResponse;
	beforeAll(async () => {
		alice = await signup({ username: 'alice' });
	});

	describe('Follow', () => {
		let channel: misskey.entities.ChannelsCreateResponse;

		beforeAll(async () => {
			const res = await api('channels/create', { name: 'follow-test-channel' }, alice);
			channel = res.body;
		});

		test('フォローしているチャンネルを再度フォローするとALREADY_FOLLOWINGエラーになる', async () => {
			const res1 = await api('channels/follow', { channelId: channel.id }, alice);
			assert.strictEqual(res1.status, 204);

			const res2 = await api('channels/follow', { channelId: channel.id }, alice);
			assert.strictEqual(res2.status, 400);
			assert.strictEqual(castAsError(res2.body as any).error.code, 'ALREADY_FOLLOWING');
		});
	});

	describe('Banner updates', () => {
		let bob: misskey.entities.SignupResponse;
		let original: misskey.entities.DriveFile;
		let replacement: misskey.entities.DriveFile;
		let foreign: misskey.entities.DriveFile;

		beforeAll(async () => {
			bob = await signup({ username: 'channelbannerbob' });
			const first = await uploadFile(alice);
			const second = await uploadFile(alice, { path: '192.png' });
			const other = await uploadFile(bob);
			for (const response of [first, second, other]) assert.strictEqual(response.status, 200);
			assert.ok(first.body && second.body && other.body);
			original = first.body;
			replacement = second.body;
			foreign = other.body;
			assert.notStrictEqual(original.id, replacement.id);
		});

		async function withBanner() {
			const response = await api('channels/create', { name: 'banner-update-fixture', bannerId: original.id }, alice);
			assert.strictEqual(response.status, 200);
			assert.strictEqual(response.body.bannerId, original.id);
			return response.body;
		}

		test('retains an omitted banner while persisting other channel settings', async () => {
			const channel = await withBanner();
			const updated = await api('channels/update', { channelId: channel.id, name: 'renamed-banner-fixture' }, alice);
			assert.strictEqual(updated.status, 200);
			assert.strictEqual(updated.body.bannerId, original.id);
			const reloaded = await api('channels/show', { channelId: channel.id }, alice);
			assert.strictEqual(reloaded.status, 200);
			assert.strictEqual(reloaded.body.name, 'renamed-banner-fixture');
			assert.strictEqual(reloaded.body.bannerId, original.id);
		});

		test('clears an explicitly null banner durably and idempotently', async () => {
			const channel = await withBanner();
			for (let attempt = 0; attempt < 2; attempt++) {
				const updated = await api('channels/update', { channelId: channel.id, bannerId: null }, alice);
				assert.strictEqual(updated.status, 200);
				assert.strictEqual(updated.body.bannerId, null);
				assert.strictEqual(updated.body.bannerUrl, null);
				const reloaded = await api('channels/show', { channelId: channel.id }, alice);
				assert.strictEqual(reloaded.status, 200);
				assert.strictEqual(reloaded.body.bannerId, null);
				assert.strictEqual(reloaded.body.bannerUrl, null);
			}
		});

		test('replaces the banner with another owned file', async () => {
			const channel = await withBanner();
			const updated = await api('channels/update', { channelId: channel.id, bannerId: replacement.id }, alice);
			assert.strictEqual(updated.status, 200);
			assert.strictEqual(updated.body.bannerId, replacement.id);
			assert.strictEqual((await api('channels/show', { channelId: channel.id }, alice)).body.bannerId, replacement.id);
		});

		test('rejects foreign or missing replacement files without changing the existing banner', async () => {
			const channel = await withBanner();
			for (const bannerId of [foreign.id, '0000000000000000']) {
				const response = await api('channels/update', { channelId: channel.id, bannerId }, alice);
				assert.strictEqual(response.status, 400);
				assert.strictEqual(castAsError(response.body as any).error.code, 'NO_SUCH_FILE');
				assert.strictEqual((await api('channels/show', { channelId: channel.id }, alice)).body.bannerId, original.id);
			}
		});

		test('rejects an unrelated user clearing a channel banner', async () => {
			const channel = await withBanner();
			const response = await api('channels/update', { channelId: channel.id, bannerId: null }, bob);
			assert.strictEqual(response.status, 400);
			assert.strictEqual(castAsError(response.body as any).error.code, 'ACCESS_DENIED');
			assert.strictEqual((await api('channels/show', { channelId: channel.id }, alice)).body.bannerId, original.id);
		});
	});
});
