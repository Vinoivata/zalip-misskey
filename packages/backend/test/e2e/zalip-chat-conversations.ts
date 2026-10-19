/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { afterAll, beforeAll, describe, test } from 'vitest';
import type { DataSource } from 'typeorm';
import { loadConfig } from '@/config.js';
import { IdService } from '@/core/IdService.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import { MiChatRoomMembership } from '@/models/ChatRoomMembership.js';
import { MiChatReadCursor } from '@/models/ChatReadCursor.js';
import { api, castAsError, createAppToken, initTestDb, signup } from '../utils.js';
import type * as Misskey from 'misskey-js';

function assertApiError(response: { status: number; body: unknown }, status: number, code: string) {
	assert.strictEqual(response.status, status, JSON.stringify(response.body));
	assert.strictEqual(castAsError(response.body as Record<string, unknown>).error.code, code);
}

describe('private personal messenger conversations', () => {
	let admin: Misskey.entities.SignupResponse;
	let owner: Misskey.entities.SignupResponse;
	let peer: Misskey.entities.SignupResponse;
	let db: DataSource;
	let roomId: string;
	let dmId: string;
	let outgoingDmId: string;
	let groupMessageId: string;
	let membershipId: string;

	beforeAll(async () => {
		db = await initTestDb(true);
		admin = await signup({ username: 'chatlistadmin' });
		owner = await signup({ username: 'chatlistowner' });
		peer = await signup({ username: 'chatlistpeer' });
		for (const user of [admin, owner, peer]) assert.ok(user.id && user.token, 'messenger fixtures must authenticate');
		const ids = new IdService(loadConfig()); let sequence = 0;
		const nextId = () => ids.gen(Date.now() - 120000 + sequence++);
		roomId = nextId(); membershipId = nextId(); dmId = nextId(); outgoingDmId = nextId(); groupMessageId = nextId();
		await db.getRepository(MiChatRoom).insert({ id: roomId, ownerId: owner.id, name: 'Synthetic private messenger group' });
		await db.getRepository(MiChatRoomMembership).insert({ id: membershipId, roomId, userId: peer.id });
		await db.getRepository(MiChatMessage).insert([
			{ id: dmId, fromUserId: peer.id, toUserId: owner.id, text: 'Synthetic personal preview' },
			{ id: outgoingDmId, fromUserId: owner.id, toUserId: peer.id, text: 'Synthetic own editable message' },
			{ id: groupMessageId, fromUserId: peer.id, toRoomId: roomId, text: 'Synthetic private group preview' },
		]);
		await db.getRepository(MiChatReadCursor).insert({ userId: owner.id, conversationKey: `user:${peer.id}`, readThroughId: dmId, updatedAt: new Date() });
	}, 120000);
	afterAll(async () => { if (db?.isInitialized) await db.destroy(); });

	test('requires native chat scopes and rejects caller-selected ownership', async () => {
		assertApiError(await api('zalip/chat/conversations', {}), 401, 'CREDENTIAL_REQUIRED');
		assertApiError(await api('zalip/chat/preferences/show', { userId: peer.id }), 401, 'CREDENTIAL_REQUIRED');
		assertApiError(await api('zalip/chat/preferences/update', { userId: peer.id, isPinned: true }), 401, 'CREDENTIAL_REQUIRED');
		const accountOnly = await createAppToken(owner, ['read:account']);
		assertApiError(await api('zalip/chat/conversations', {}, { token: accountOnly }), 403, 'PERMISSION_DENIED');
		const chatRead = await createAppToken(owner, ['read:chat']);
		assert.strictEqual((await api('zalip/chat/conversations', {}, { token: chatRead })).status, 200);
		assertApiError(await api('zalip/chat/preferences/update', { userId: peer.id, isMuted: true }, { token: chatRead }), 403, 'PERMISSION_DENIED');
		const injectedOwner = { filter: 'all' as const, userId: admin.id };
		assertApiError(await api('zalip/chat/conversations', injectedOwner, owner), 400, 'INVALID_PARAM');
	});

	test('serves only actual participants and never gives an administrator private previews or preferences', async () => {
		const response = await api('zalip/chat/conversations', {}, owner);
		assert.strictEqual(response.status, 200);
		assert.ok(response.body.items.some(item => item.key === `user:${peer.id}`));
		assert.ok(response.body.items.some(item => item.key === `room:${roomId}`));
		const outsider = await api('zalip/chat/conversations', {}, admin);
		assert.strictEqual(outsider.status, 200); assert.deepStrictEqual(outsider.body.items, []);
		assertApiError(await api('zalip/chat/preferences/show', { userId: owner.id }, admin), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
		assertApiError(await api('zalip/chat/preferences/show', { roomId }, admin), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
		assertApiError(await api('zalip/chat/preferences/update', { roomId, isPinned: true }, admin), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
	});

	test('supports server-side personal/group search and scoped keyset pages without changing read state', async () => {
		const before = await db.getRepository(MiChatReadCursor).findBy({ userId: owner.id });
		const first = await api('zalip/chat/conversations', { limit: 1 }, owner);
		assert.strictEqual(first.status, 200); assert.strictEqual(first.body.items.length, 1); assert.ok(first.body.nextCursor);
		const second = await api('zalip/chat/conversations', { limit: 1, cursor: first.body.nextCursor }, owner);
		assert.strictEqual(second.status, 200); assert.strictEqual(second.body.items.length, 1); assert.notStrictEqual(second.body.items[0].key, first.body.items[0].key);
		assertApiError(await api('zalip/chat/conversations', { filter: 'people', cursor: first.body.nextCursor }, owner), 400, 'INVALID_ZALIP_CHAT_CURSOR');
		assert.deepStrictEqual((await api('zalip/chat/conversations', { filter: 'people' }, owner)).body.items.map(item => item.kind), ['user']);
		assert.deepStrictEqual((await api('zalip/chat/conversations', { filter: 'groups' }, owner)).body.items.map(item => item.kind), ['room']);
		assert.deepStrictEqual((await api('zalip/chat/conversations', { query: 'Synthetic private messenger' }, owner)).body.items.map(item => item.key), [`room:${roomId}`]);
		assert.strictEqual((await api('zalip/chat/preferences/show', { userId: peer.id }, owner)).status, 200);
		assert.deepStrictEqual(await db.getRepository(MiChatReadCursor).findBy({ userId: owner.id }), before);
		assertApiError(await api('zalip/chat/conversations', { limit: 51 }, owner), 400, 'INVALID_PARAM');
	});

	test('partially persists personal pin/archive/mute and rejects cross-conversation pinned messages', async () => {
		const pin = await api('zalip/chat/preferences/update', { userId: peer.id, isPinned: true, isMuted: true, pinnedMessageId: dmId }, owner);
		assert.strictEqual(pin.status, 200); assert.deepStrictEqual(pin.body, { isPinned: true, isArchived: false, isMuted: true, pinnedMessageId: dmId });
		assert.strictEqual((await api('zalip/chat/preferences/update', { userId: peer.id, isArchived: true }, owner)).status, 200);
		assert.deepStrictEqual((await api('zalip/chat/conversations', { filter: 'archived' }, owner)).body.items.map(item => item.key), [`user:${peer.id}`]);
		assert.strictEqual((await api('zalip/chat/conversations', { filter: 'people' }, owner)).body.items.length, 0);
		assertApiError(await api('zalip/chat/preferences/update', { userId: peer.id, pinnedMessageId: groupMessageId }, owner), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
		const clear = await api('zalip/chat/preferences/update', { userId: peer.id, pinnedMessageId: null, isMuted: false, isArchived: false }, owner);
		assert.strictEqual(clear.status, 200); assert.deepStrictEqual(clear.body, { isPinned: true, isArchived: false, isMuted: false, pinnedMessageId: null });
		assertApiError(await api('zalip/chat/preferences/update', { userId: peer.id }, owner), 400, 'INVALID_ZALIP_CHAT_PREFERENCES');
	});

	test('revoked membership cannot be restored by saved personal settings or administrative status', async () => {
		assert.strictEqual((await api('zalip/chat/preferences/update', { roomId, isPinned: true }, peer)).status, 200);
		await db.getRepository(MiChatRoomMembership).delete(membershipId);
		try {
			assert.strictEqual((await api('zalip/chat/conversations', { filter: 'groups' }, peer)).body.items.length, 0);
			assertApiError(await api('zalip/chat/preferences/show', { roomId }, peer), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
			assertApiError(await api('zalip/chat/preferences/update', { roomId, isMuted: true }, peer), 404, 'NO_SUCH_ZALIP_CHAT_CONVERSATION');
		} finally { await db.getRepository(MiChatRoomMembership).insert({ id: membershipId, roomId, userId: peer.id }); }
	});

	test('native edit, forward and visible-read routes enforce authentication, scopes and exact targets', async () => {
		assertApiError(await api('chat/messages/edit', { messageId: outgoingDmId, text: 'Edited' }), 401, 'CREDENTIAL_REQUIRED');
		assertApiError(await api('chat/messages/forward', { messageId: dmId, toRoomId: roomId }), 401, 'CREDENTIAL_REQUIRED');
		assertApiError(await api('chat/messages/read', { messageId: dmId, userId: peer.id }), 401, 'CREDENTIAL_REQUIRED');
		const readOnly = { token: await createAppToken(owner, ['read:chat']) };
		assertApiError(await api('chat/messages/edit', { messageId: outgoingDmId, text: 'Edited' }, readOnly), 403, 'PERMISSION_DENIED');
		assertApiError(await api('chat/messages/forward', { messageId: dmId, toRoomId: roomId }, readOnly), 403, 'PERMISSION_DENIED');
		const writeOnly = { token: await createAppToken(owner, ['write:chat']) };
		assertApiError(await api('chat/messages/read', { messageId: dmId, userId: peer.id }, writeOnly), 403, 'PERMISSION_DENIED');
		assertApiError(await api('chat/messages/forward', { messageId: dmId, toUserId: peer.id, toRoomId: roomId }, owner), 400, 'INVALID_PARAM');
		assertApiError(await api('chat/messages/read', { messageId: dmId, userId: peer.id, roomId }, owner), 400, 'INVALID_PARAM');
		assertApiError(await api('chat/messages/edit', { messageId: outgoingDmId, text: '  ' }, owner), 400, 'CONTENT_REQUIRED');
	});

	test('edits only own messages and preserves canonical reply and forwarded-author contexts', async () => {
		const edited = await api('chat/messages/edit', { messageId: outgoingDmId, text: '  Synthetic edited message  ' }, owner);
		assert.strictEqual(edited.status, 200); assert.strictEqual(edited.body.text, 'Synthetic edited message'); assert.ok(edited.body.updatedAt);
		assert.strictEqual((await db.getRepository(MiChatMessage).findOneByOrFail({ id: outgoingDmId })).text, 'Synthetic edited message');
		assertApiError(await api('chat/messages/edit', { messageId: dmId, text: 'Not my message' }, owner), 404, 'NO_SUCH_MESSAGE');
		assertApiError(await api('chat/messages/edit', { messageId: outgoingDmId, text: 'Administrative outsider' }, admin), 404, 'NO_SUCH_MESSAGE');
		const reply = await api('chat/messages/create-to-room', { toRoomId: roomId, text: 'Synthetic nested reply', replyId: groupMessageId }, owner);
		assert.strictEqual(reply.status, 200); assert.strictEqual(reply.body.replyId, groupMessageId); assert.strictEqual(reply.body.reply?.fromUser.id, peer.id);
		assertApiError(await api('chat/messages/create-to-room', { toRoomId: roomId, text: 'Cross-conversation reply', replyId: dmId }, owner), 404, 'NO_SUCH_MESSAGE');
		const forwarded = await api('chat/messages/forward', { messageId: dmId, toRoomId: roomId }, owner);
		assert.strictEqual(forwarded.status, 200); assert.strictEqual(forwarded.body.fromUser.id, owner.id);
		assert.strictEqual(forwarded.body.forwardedFromUser?.id, peer.id); assert.strictEqual(forwarded.body.text, 'Synthetic personal preview');
		assertApiError(await api('chat/messages/forward', { messageId: dmId, toRoomId: roomId }, admin), 404, 'NO_SUCH_MESSAGE');
	});

	test('visible frontiers reject foreign conversations, blocked peers and revoked group membership', async () => {
		const read = await api('chat/messages/read', { roomId, messageId: groupMessageId }, owner);
		assert.strictEqual(read.status, 200); assert.strictEqual(read.body.readThroughId, groupMessageId);
		assert.strictEqual((await db.getRepository(MiChatReadCursor).findOneByOrFail({ userId: owner.id, conversationKey: `room:${roomId}` })).readThroughId, groupMessageId);
		assertApiError(await api('chat/messages/read', { userId: peer.id, messageId: groupMessageId }, owner), 404, 'NO_SUCH_MESSAGE');
		assertApiError(await api('chat/messages/read', { userId: peer.id, messageId: dmId }, admin), 404, 'NO_SUCH_MESSAGE');
		assert.strictEqual((await api('blocking/create', { userId: peer.id }, owner)).status, 200);
		try {
			assertApiError(await api('chat/messages/read', { userId: peer.id, messageId: dmId }, owner), 404, 'NO_SUCH_MESSAGE');
			assertApiError(await api('chat/messages/forward', { messageId: dmId, toRoomId: roomId }, owner), 404, 'NO_SUCH_MESSAGE');
			assertApiError(await api('chat/messages/edit', { messageId: outgoingDmId, text: 'Blocked conversation' }, owner), 404, 'NO_SUCH_MESSAGE');
			assert.strictEqual((await api('zalip/chat/conversations', { filter: 'people' }, owner)).body.items.length, 0);
		} finally { assert.strictEqual((await api('blocking/delete', { userId: peer.id }, owner)).status, 200); }
		await db.getRepository(MiChatRoomMembership).delete(membershipId);
		try {
			assertApiError(await api('chat/messages/read', { roomId, messageId: groupMessageId }, peer), 404, 'NO_SUCH_ROOM');
		} finally { await db.getRepository(MiChatRoomMembership).insert({ id: membershipId, roomId, userId: peer.id }); }
	});
});
