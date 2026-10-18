/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type { DataSource } from 'typeorm';
import { MiZalipNoteViewStat } from '@/models/ZalipNoteViewStat.js';
import { api, castAsError, createAppToken, initTestDb, post, signup } from '../utils.js';
import type * as Misskey from 'misskey-js';

describe('Zalip private-safe note-view aggregates', () => {
	let author: Misskey.entities.SignupResponse;
	let viewer: Misskey.entities.SignupResponse;
	let outsider: Misskey.entities.SignupResponse;
	let db: DataSource;
	beforeAll(async () => {
		db = await initTestDb(true);
		author = await signup({ username: 'zalipviewauthor' });
		viewer = await signup({ username: 'zalipviewreader' });
		outsider = await signup({ username: 'zalipviewother' });
		for (const user of [author, viewer, outsider]) assert.ok(user.id && user.token, 'view fixture must authenticate');
	});
	afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

	test('records one durable count for concurrent visible dwells and reads it in native note packs without counting reads or the author', async () => {
		const note = await post(author, { text: 'Public view fixture', visibility: 'public' });
		const first = await api('notes/show', { noteId: note.id });
		assert.strictEqual(first.status, 200); assert.strictEqual(first.body.zalipViewCount, 0);
		const own = await api('zalip/notes/views/record', { noteId: note.id }, author);
		assert.strictEqual(own.status, 200); assert.deepStrictEqual(own.body, { counted: false, viewCount: 0 });
		const requests = await Promise.all(Array.from({ length: 5 }, () => api('zalip/notes/views/record', { noteId: note.id }, viewer)));
		assert.ok(requests.every(response => response.status === 200));
		assert.strictEqual(requests.filter(response => response.body.counted).length, 1);
		const row = await db.getRepository(MiZalipNoteViewStat).findOneByOrFail({ noteId: note.id });
		assert.strictEqual(String(row.count), '1');
		const shown = await api('notes/show', { noteId: note.id });
		assert.strictEqual(shown.body.zalipViewCount, 1);
		assert.strictEqual((await api('notes/show', { noteId: note.id }, viewer)).body.zalipViewCount, 1);
		const second = await api('zalip/notes/views/record', { noteId: note.id }, outsider);
		assert.deepStrictEqual(second.body, { counted: true, viewCount: 2 });
	});

	test('rejects guest and application-token recording without any aggregate row', async () => {
		const note = await post(author, { text: 'Native recording only' });
		const guest = await api('zalip/notes/views/record', { noteId: note.id });
		assert.strictEqual(guest.status, 400); assert.strictEqual(castAsError(guest.body).error.code, 'ACCESS_DENIED');
		const token = await createAppToken(viewer, ['write:notes', 'read:account']);
		const application = await api('zalip/notes/views/record', { noteId: note.id }, { token, bearer: true });
		assert.strictEqual(application.status, 400); assert.strictEqual(castAsError(application.body).error.code, 'ACCESS_DENIED');
		assert.strictEqual(await db.getRepository(MiZalipNoteViewStat).countBy({ noteId: note.id }), 0);
	});

	test('respects specified visibility and omits counts from hidden private packs', async () => {
		const note = await post(author, { text: 'Private view fixture', visibility: 'specified', visibleUserIds: [viewer.id] });
		const allowed = await api('zalip/notes/views/record', { noteId: note.id }, viewer);
		assert.strictEqual(allowed.status, 200); assert.strictEqual(allowed.body.counted, true);
		const denied = await api('zalip/notes/views/record', { noteId: note.id }, outsider);
		assert.strictEqual(denied.status, 404); assert.strictEqual(castAsError(denied.body).error.code, 'NO_SUCH_NOTE');
		const hidden = await api('notes/show', { noteId: note.id }, outsider);
		assert.strictEqual(hidden.body.isHidden, true); assert.strictEqual(hidden.body.zalipViewCount, undefined);
		const guest = await api('notes/show', { noteId: note.id });
		assert.strictEqual(guest.body.isHidden, true); assert.strictEqual(guest.body.zalipViewCount, undefined);
	});

	test('refuses muted authors and either direction of blocking without counting', async () => {
		const note = await post(author, { text: 'Filtered view fixture' });
		assert.strictEqual((await api('mute/create', { userId: author.id }, viewer)).status, 204);
		assert.strictEqual((await api('zalip/notes/views/record', { noteId: note.id }, viewer)).status, 404);
		assert.strictEqual((await api('mute/delete', { userId: author.id }, viewer)).status, 204);
		assert.strictEqual((await api('blocking/create', { userId: author.id }, viewer)).status, 204);
		assert.strictEqual((await api('zalip/notes/views/record', { noteId: note.id }, viewer)).status, 404);
		assert.strictEqual((await api('blocking/delete', { userId: author.id }, viewer)).status, 204);
		assert.strictEqual((await api('blocking/create', { userId: viewer.id }, author)).status, 204);
		assert.strictEqual((await api('zalip/notes/views/record', { noteId: note.id }, viewer)).status, 404);
		assert.strictEqual((await api('blocking/delete', { userId: viewer.id }, author)).status, 204);
		assert.strictEqual(await db.getRepository(MiZalipNoteViewStat).countBy({ noteId: note.id }), 0);
	});

	test('cascades only a deleted note aggregate and cannot create a view for a missing note', async () => {
		const note = await post(author, { text: 'Deleted view fixture' });
		assert.strictEqual((await api('zalip/notes/views/record', { noteId: note.id }, viewer)).status, 200);
		assert.strictEqual((await api('notes/delete', { noteId: note.id }, author)).status, 204);
		assert.strictEqual(await db.getRepository(MiZalipNoteViewStat).countBy({ noteId: note.id }), 0);
		assert.strictEqual((await api('zalip/notes/views/record', { noteId: note.id }, viewer)).status, 404);
	});
});
