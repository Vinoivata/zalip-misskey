/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type { DataSource } from 'typeorm';
import type { SignupResponse } from 'misskey-js/entities.js';
import type { PackedZalipFeed } from '@/core/ZalipFeedService.js';
import { MiNote } from '@/models/Note.js';
import { MiMuting } from '@/models/Muting.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipSeason } from '@/models/ZalipSeason.js';
import { MiZalipEpisode } from '@/models/ZalipEpisode.js';
import { api, initTestDb, post, relativeFetch, signup } from '../utils.js';

describe('Zalip typed social feed HTTP API', () => {
	let author: SignupResponse;
	let reader: SignupResponse;
	let db: DataSource;
	beforeAll(async () => {
		db = await initTestDb(true);
		await signup({ username: 'zalipfeedadmin' });
		author = await signup({ username: 'zalipfeedauthor' });
		reader = await signup({ username: 'zalipfeedreader' });
	}, 120000);
	afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

	// Direct HTTP avoids borrowing a generated SDK definition from another frozen
	// release. This new endpoint's SDK is regenerated only after root freezes it.
	async function feed(params: Record<string, unknown> = {}, viewer?: SignupResponse) {
		const response = await relativeFetch('api/zalip/feed/list', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ...(viewer ? { i: viewer.token } : {}), ...params }), redirect: 'manual',
		});
		return { status: response.status, body: await response.json() as PackedZalipFeed & { error?: { code: string } } };
	}

	async function work() {
		const id = randomUUID().replaceAll('-', ''); const now = new Date();
		await db.getRepository(MiZalipWork).insert({ id, slug: `feed-test-${id}`, kind: 'movie', title: `Public feed fixture ${id}`, publicationState: 'published', publishedAt: now, createdAt: now, updatedAt: now });
		const root = await api('zalip/discussions/ensure', { workId: id }, author);
		assert.strictEqual(root.status, 200);
		return { id, root: root.body.noteId };
	}

	async function review(workId: string, format: 'review' | 'essay' = 'review', spoiler = false) {
		const response = await api('zalip/reviews/upsert', { workId, format, title: format === 'essay' ? 'An original extended opinion' : null, body: 'A real author opinion for this canonical feed fixture.', isSpoiler: spoiler, sentiment: 'positive' }, author);
		assert.strictEqual(response.status, 200); return response.body;
	}

	test('registers an anonymous readonly endpoint with typed comments/reviews and a separate essay section', async () => {
		const target = await work();
		const comment = await post(author, { text: 'A public comment by the actual author.', replyId: target.root, visibility: 'home', localOnly: true });
		const opinion = await review(target.id);
		const essay = await review(target.id, 'essay');
		const ordinary = await post(author, { text: 'An ordinary unbound personal post.' });
		const rated = await work();
		assert.strictEqual((await api('zalip/library/update', { workId: rated.id, status: null, personalRating: 9 }, reader)).status, 200);
		const result = await feed({ limit: 20 });
		assert.strictEqual(result.status, 200);
		const items = result.body.items.filter(item => item.work.id === target.id);
		assert.deepStrictEqual(new Set(items.map(item => item.key)), new Set([`comment:${comment.id}`, `review:${opinion.id}`]));
		assert.ok(result.body.items.every(item => item.type !== 'essay' && item.id !== ordinary.id && item.id !== target.root && item.work.id !== rated.id));
		const native = items.find(item => item.type === 'comment');
		assert.ok(native?.type === 'comment');
		assert.strictEqual(native.note.userId, author.id);
		assert.strictEqual(native.note.zalipDiscussion?.rootNoteId, target.root);
		assert.strictEqual(native.note.reply, undefined);
		assert.strictEqual(native.note.renote, undefined);
		assert.ok(!('importData' in native.work) && !('token' in native.note.user));
		const essays = await feed({ section: 'essays', limit: 20 });
		assert.strictEqual(essays.status, 200);
		assert.ok(essays.body.items.every(item => item.type === 'essay'));
		assert.ok(essays.body.items.some(item => item.id === essay.id && item.type === 'essay' && item.review.user.id === author.id));
	});

	test('excludes private replies, CW and spoiler opinions by default without exposing their bodies', async () => {
		const target = await work();
		const privateComment = await post(author, { text: 'PRIVATE FOLLOWERS BODY', replyId: target.root, visibility: 'followers', localOnly: true });
		const directComment = await post(author, { text: 'PRIVATE DIRECT BODY', replyId: target.root, visibility: 'specified', visibleUserIds: [reader.id], localOnly: true });
		const warned = await post(author, { text: 'CW-SPOILER BODY', cw: 'Spoiler warning', replyId: target.root, visibility: 'home', localOnly: true });
		const opinion = await review(target.id, 'review', true);
		for (const viewer of [undefined, reader, author]) {
			const result = await feed({ limit: 20 }, viewer);
			assert.strictEqual(result.status, 200);
			assert.ok(!result.body.items.some(item => [privateComment.id, directComment.id, warned.id, opinion.id].includes(item.id)));
			assert.ok(!JSON.stringify(result.body.items).includes('PRIVATE'));
		}
		const revealed = await feed({ limit: 20, hideSpoilers: false }, reader);
		assert.ok(revealed.body.items.some(item => item.id === warned.id && item.type === 'comment' && item.note.cw === 'Spoiler warning'));
		assert.ok(revealed.body.items.some(item => item.id === opinion.id && item.type === 'review' && item.review.isSpoiler));
		assert.ok(!revealed.body.items.some(item => item.id === privateComment.id || item.id === directComment.id));
	});

	test('uses native signin/time visibility and applies blocks in both directions plus active mutes', async () => {
		const target = await work();
		const comment = await post(author, { text: 'Visibility-bound canonical comment.', replyId: target.root, visibility: 'home', localOnly: true });
		const opinion = await review(target.id);
		const own = [comment.id, opinion.id];
		try {
			assert.strictEqual((await api('i/update', { requireSigninToViewContents: true }, author)).status, 200);
			assert.ok(!(await feed({ limit: 20 })).body.items.some(item => own.includes(item.id)));
			assert.ok((await feed({ limit: 20 }, reader)).body.items.some(item => item.id === comment.id));
			assert.strictEqual((await api('i/update', { makeNotesHiddenBefore: Math.ceil(Date.now() / 1000) + 60 }, author)).status, 200);
			assert.ok(!(await feed({ limit: 20 }, reader)).body.items.some(item => item.id === comment.id));
			assert.strictEqual((await api('i/update', { makeNotesHiddenBefore: null }, author)).status, 200);
			for (const [blocker, blockee] of [[reader, author], [author, reader]]) {
				assert.strictEqual((await api('blocking/create', { userId: blockee.id }, blocker)).status, 200);
				assert.ok(!(await feed({ limit: 20 }, reader)).body.items.some(item => own.includes(item.id)));
				assert.strictEqual((await api('blocking/delete', { userId: blockee.id }, blocker)).status, 200);
			}
			assert.strictEqual((await api('mute/create', { userId: author.id }, reader)).status, 204);
			assert.ok(!(await feed({ limit: 20 }, reader)).body.items.some(item => own.includes(item.id)));
			await db.getRepository(MiMuting).update({ muterId: reader.id, muteeId: author.id }, { expiresAt: new Date(Date.now() - 60000) });
			assert.ok((await feed({ limit: 20 }, reader)).body.items.some(item => item.id === comment.id));
		} finally {
			await api('blocking/delete', { userId: author.id }, reader);
			await api('blocking/delete', { userId: reader.id }, author);
			await api('mute/delete', { userId: author.id }, reader);
			await api('i/update', { requireSigninToViewContents: false, makeNotesHiddenBefore: null }, author);
		}
	});

	test('preserves deep thread context after parent deletion and removes items when the root/title disappears', async () => {
		const target = await work();
		const parent = await post(author, { text: 'A parent comment that can be removed.', replyId: target.root, visibility: 'home', localOnly: true });
		const child = await post(reader, { text: 'A surviving deeper canonical reply.', replyId: parent.id, visibility: 'home', localOnly: true });
		assert.strictEqual((await api('notes/delete', { noteId: parent.id }, author)).status, 204);
		const result = await feed({ limit: 20 });
		assert.strictEqual(result.status, 200);
		assert.ok(result.body.items.some(item => item.id === child.id && item.type === 'comment' && item.discussion.rootNoteId === target.root));
		await db.getRepository(MiNote).delete(target.root);
		assert.ok(!(await feed({ limit: 20 })).body.items.some(item => item.id === child.id));
		const unpublished = await work(); const opinion = await review(unpublished.id);
		await db.getRepository(MiZalipWork).update(unpublished.id, { publicationState: 'draft', title: 'PRIVATE TITLE MUST NOT LEAK' });
		const hidden = await feed({ limit: 20 });
		assert.ok(!hidden.body.items.some(item => item.id === opinion.id));
		assert.ok(!JSON.stringify(hidden.body.items).includes('PRIVATE TITLE'));
	});

	test('binds episode comments canonically and honors native thread muting', async () => {
		const target = await work(); const now = new Date();
		const seasonId = randomUUID().replaceAll('-', ''); const episodeId = randomUUID().replaceAll('-', '');
		await db.getRepository(MiZalipSeason).insert({ id: seasonId, workId: target.id, seasonNumber: 2, title: 'Season 2', createdAt: now, updatedAt: now });
		await db.getRepository(MiZalipEpisode).insert({ id: episodeId, seasonId, episodeNumber: 4, title: 'Synthetic episode', createdAt: now, updatedAt: now });
		const root = await api('zalip/episodes/discussions/ensure', { episodeId }, author);
		assert.strictEqual(root.status, 200);
		const comment = await post(author, { text: 'Canonical episode discussion comment.', replyId: root.body.noteId, visibility: 'home', localOnly: true });
		const shown = await feed({ limit: 20 }, reader);
		assert.ok(shown.body.items.some(item => item.id === comment.id && item.type === 'comment' && item.discussion.episodeId === episodeId && item.discussion.episodeNumber === 4 && item.discussion.seasonNumber === 2));
		try {
			assert.strictEqual((await api('notes/thread-muting/create', { noteId: root.body.noteId }, reader)).status, 204);
			assert.ok(!(await feed({ limit: 20 }, reader)).body.items.some(item => item.id === comment.id));
		} finally { await api('notes/thread-muting/delete', { noteId: root.body.noteId }, reader); }
	});

	test('validates navigation scope and never repeats mixed-page keys', async () => {
		const first = await feed({ limit: 1 }, reader);
		assert.strictEqual(first.status, 200); assert.ok(first.body.nextCursor);
		for (const [params, viewer] of [[{ section: 'essays', cursor: first.body.nextCursor }, reader], [{ cursor: first.body.nextCursor }, author], [{ hideSpoilers: false, cursor: first.body.nextCursor }, reader], [{ cursor: 'malformed!' }, reader]] as const) {
			const invalid = await feed(params, viewer); assert.strictEqual(invalid.status, 400); assert.strictEqual(invalid.body.error?.code, 'INVALID_ZALIP_FEED_CURSOR');
		}
		for (const params of [{ limit: 21 }, { section: 'private' }, { viewerId: author.id }]) assert.strictEqual((await feed(params, reader)).status, 400);
		const seen = new Set(first.body.items.map(item => item.key));
		let cursor: string | null = first.body.nextCursor;
		for (let pages = 0; cursor && pages < 20; pages++) {
			const next = await feed({ cursor, limit: 2 }, reader); assert.strictEqual(next.status, 200);
			for (const item of next.body.items) { assert.ok(!seen.has(item.key)); seen.add(item.key); }
			assert.notStrictEqual(next.body.nextCursor, cursor); cursor = next.body.nextCursor;
		}
		assert.strictEqual(cursor, null);
	});

	test('retains native reaction toggles and poll choices without hydrating newly private nested Notes', async () => {
		const target = await work();
		const parent = await post(author, { text: 'SECRET NESTED PARENT BODY', replyId: target.root, visibility: 'home', localOnly: true });
		const quoted = await post(author, { text: 'SECRET NESTED QUOTE BODY', visibility: 'home', localOnly: true });
		const comment = await post(reader, { text: 'An independently public comment with a native poll.', replyId: parent.id, renoteId: quoted.id, visibility: 'home', localOnly: true, poll: { choices: ['Yes', 'No'] } });
		assert.strictEqual((await api('notes/reactions/create', { noteId: comment.id, reaction: '👍' }, author)).status, 204);
		assert.strictEqual((await api('notes/polls/vote', { noteId: comment.id, choice: 0 }, author)).status, 204);
		// A formerly public parent/quote may become private after a public reply exists.
		await db.getRepository(MiNote).update(parent.id, { visibility: 'specified', visibleUserIds: [reader.id] });
		await db.getRepository(MiNote).update(quoted.id, { visibility: 'specified', visibleUserIds: [reader.id] });
		const result = await feed({ limit: 20 }, author); assert.strictEqual(result.status, 200);
		const item = result.body.items.find(value => value.id === comment.id);
		assert.ok(item?.type === 'comment'); assert.strictEqual(item.note.myReaction, '👍');
		assert.deepStrictEqual(item.note.poll?.choices.map(choice => [choice.text, choice.votes, choice.isVoted]), [['Yes', 1, true], ['No', 0, false]]);
		assert.strictEqual(item.note.replyId, parent.id); assert.strictEqual(item.note.renoteId, quoted.id);
		assert.strictEqual(item.note.reply, undefined); assert.strictEqual(item.note.renote, undefined);
		assert.ok(!JSON.stringify(result.body.items).includes('SECRET NESTED'));
		const anonymous = await feed({ limit: 20 }); assert.strictEqual(anonymous.status, 200);
		assert.ok(!JSON.stringify(anonymous.body.items).includes('SECRET NESTED'));
		assert.strictEqual((await api('notes/reactions/delete', { noteId: comment.id }, author)).status, 204);
		const toggled = (await feed({ limit: 20 }, author)).body.items.find(value => value.id === comment.id);
		assert.ok(toggled?.type === 'comment'); assert.strictEqual(toggled.note.myReaction, undefined);
		assert.strictEqual(toggled.note.poll?.choices[0].isVoted, true);
	});
});
