/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatService, chatConversationKey } from '@/core/ChatService.js';
import type { MiChatMessage, MiUser } from '@/models/_.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ChatRoomChannel } from '@/server/api/stream/channels/chat-room.js';
import { ChatUserChannel } from '@/server/api/stream/channels/chat-user.js';
import { MainChannel } from '@/server/api/stream/channels/main.js';
import EditEndpoint from '@/server/api/endpoints/chat/messages/edit.js';
import ForwardEndpoint from '@/server/api/endpoints/chat/messages/forward.js';
import ReadEndpoint from '@/server/api/endpoints/chat/messages/read.js';
import UserTimelineEndpoint from '@/server/api/endpoints/chat/messages/user-timeline.js';
import ShowEndpoint from '@/server/api/endpoints/chat/messages/show.js';
import { MiChatReadCursor } from '@/models/ChatReadCursor.js';
import { entities } from '@/postgres.js';
import { DataSource } from 'typeorm';

const me = { id: 'alice', host: null } as MiUser;
const original = (values: Partial<MiChatMessage> = {}): MiChatMessage => ({ id: 'm001', fromUserId: 'bob', toUserId: 'alice', toRoomId: null, text: 'Canonical private message', fileId: null, reactions: [], reads: [], replyId: null, updatedAt: null, forwardedFromUserId: null, ...values } as MiChatMessage);

function fixture() {
	const rows = new Map<string, MiChatMessage>([['m001', original()]]);
	const rooms = new Map([['roomA', { id: 'roomA', ownerId: 'alice', isArchived: false }], ['roomB', { id: 'roomB', ownerId: 'alice', isArchived: false }]]);
	const members = new Set<string>(['roomA:alice', 'roomA:bob', 'roomB:alice']);
	const availability = new Map<string, string>();
	const users = new Map(['alice', 'bob', 'carol'].map(id => [id, { id, host: null, isSuspended: false, isDeleted: false, chatScope: 'everyone' }]));
	const markers = new Map<string, string>(); const unread = new Set<string>(); const cursors = new Map<string, string>();
	let sequence = 10;
	const update = vi.fn(async (where: { id: string; fromUserId: string }, changes: Partial<MiChatMessage>) => {
		const row = rows.get(where.id); if (!row || row.fromUserId !== where.fromUserId) return { affected: 0 };
		Object.assign(row, changes); return { affected: 1 };
	});
	const messages = {
		findOneBy: vi.fn(async ({ id }: { id: string }) => rows.get(id) ? structuredClone(rows.get(id)) : null),
		findOne: vi.fn(async ({ where }: { where: { id: string } }) => rows.get(where.id) ? structuredClone(rows.get(where.id)) : null),
		findOneByOrFail: vi.fn(async ({ id }: { id: string }) => { const row = rows.get(id); if (!row) throw new Error('Not found'); return structuredClone(row); }),
		update,
		existsBy: vi.fn(async ({ id }: { id: string }) => rows.has(id)),
		insertOne: vi.fn(async (input: MiChatMessage) => { const row = { ...input, reactions: input.reactions ?? [] }; rows.set(input.id, row); return row; }),
	};
	const query = vi.fn(async (sql: string, params: unknown[] = []) => {
		if (sql.startsWith('INSERT INTO "chat_read_cursor"') && sql.includes('RETURNING')) {
			const [userId, key, messageId] = params as string[];
			const cursorKey = `${userId}:${key}`; const next = [cursors.get(cursorKey) ?? '', messageId].sort().at(-1)!; cursors.set(cursorKey, next);
			return [{ readThroughId: next }];
		}
		if (sql.startsWith('SELECT c."conversationKey"')) {
			const [userId, keys] = params as [string, string[] | undefined];
			return [...cursors].filter(([key]) => key.startsWith(`${userId}:`)).flatMap(([entryKey, frontier]) => {
				const key = entryKey.slice(userId.length + 1); if (keys && !keys.includes(key)) return [];
				const hasUnread = [...rows.values()].some(row => row.id > frontier && row.fromUserId !== userId && (key.startsWith('room:') ? row.toRoomId === key.slice(5) && members.has(`${key.slice(5)}:${userId}`) : row.toRoomId == null && row.toUserId === userId && row.fromUserId === key.slice(5)));
				return [{ conversationKey: key, hasUnread }];
			});
		}
		return [];
	});
	const pipeline = () => {
		const operations: (() => unknown)[] = [];
		const instance = {
			get: (key: string) => { operations.push(() => markers.get(key) ?? null); return instance; },
			set: (key: string, value: string) => { operations.push(() => markers.set(key, value)); return instance; },
			sadd: (_key: string, value: string) => { operations.push(() => unread.add(value)); return instance; },
			exec: async () => operations.map(operation => [null, operation()]),
		}; return instance;
	};
	const redis = {
		multi: pipeline, pipeline,
		get: async (key: string) => markers.get(key) ?? null,
		scard: async () => unread.size,
		smembers: async () => [...unread],
		set: vi.fn().mockResolvedValue('OK'),
		eval: vi.fn(async (_script: string, count: number, marker: string, _setKey: string, frontier: string, key: string) => {
			expect(count).toBe(2); const value = markers.get(marker); if (value && value <= frontier) { markers.delete(marker); unread.delete(key); } return 1;
		}),
	};
	const events = { publishChatUserStream: vi.fn(), publishChatRoomStream: vi.fn(), publishMainStream: vi.fn() };
	const pack = (rowOrId: string | MiChatMessage) => { const row = typeof rowOrId === 'string' ? rows.get(rowOrId)! : rowOrId; return { id: row.id, text: row.text, fromUserId: row.fromUserId, toUserId: row.toUserId, toRoomId: row.toRoomId, updatedAt: row.updatedAt?.toISOString() ?? null, replyId: row.replyId, forwardedFromUser: row.forwardedFromUserId ? { id: row.forwardedFromUserId } : null }; };
	const userEntity = { isLocalUser: () => true, isRemoteUser: () => false, pack: async (value: string | { id: string }) => ({ id: typeof value === 'string' ? value : value.id, username: typeof value === 'string' ? value : value.id, avatarUrl: '/avatar', avatarBlurhash: null, avatarDecorations: [] }) };
	const service = Object.create(ChatService.prototype) as ChatService;
	Object.assign(service, {
		db: { query }, redisClient: redis, chatMessagesRepository: messages,
		chatRoomsRepository: { findOne: async ({ where }: { where: { id: string } }) => rooms.get(where.id), findOneByOrFail: async ({ id }: { id: string }) => rooms.get(id) },
		chatRoomMembershipsRepository: { findBy: async ({ roomId }: { roomId: string }) => [...members].filter(value => value.startsWith(`${roomId}:`)).map(value => ({ userId: value.split(':')[1], isMuted: false })), findOneBy: async ({ roomId, userId }: { roomId: string; userId: string }) => members.has(`${roomId}:${userId}`) ? { roomId, userId } : null },
		usersRepository: { findOneBy: async ({ id }: { id: string }) => users.get(id) },
		driveFilesRepository: { findOneBy: async ({ id }: { id: string }) => id === 'file1' ? { id, name: 'source image.jpg', userId: 'bob' } : null },
		roleService: { getUserPolicies: async (id: string) => ({ chatAvailability: availability.get(id) ?? 'available' }), isModerator: async () => true },
		globalEventService: events,
		chatEntityService: { packMessageDetailed: vi.fn(async (row: string | MiChatMessage) => pack(row)), packMessageLiteForRoom: vi.fn(async (row: MiChatMessage) => pack(row)), packMessageLiteFor1on1: vi.fn(async (row: MiChatMessage) => pack(row)) },
		userEntityService: userEntity,
		idService: { gen: () => `m${++sequence}` },
		zalipChatConversationService: { isConversationMuted: vi.fn().mockResolvedValue(false), updatePreferences: vi.fn().mockResolvedValue({ isMuted: true }) },
		pushNotificationService: { pushNotification: vi.fn() },
		userBlockingService: { checkBlocked: vi.fn().mockResolvedValue(false) },
	});
	return { service, rows, rooms, members, users, messages, query, markers, unread, cursors, events, redis, userEntity, availability };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Canonical messenger actions', () => {
	it('accepts only one bounded, native conversation key', () => {
		for (const target of [{}, { userId: 'bob', roomId: 'roomA' }, { userId: '../other' }, { roomId: 'x'.repeat(33) }]) expect(() => chatConversationKey(target)).toThrow('INVALID_CHAT_TARGET');
		expect(chatConversationKey({ userId: 'bob' })).toBe('user:bob');
	});

	it('edits only the current author and preserves the existing file and destination', async () => {
		const f = fixture(); f.rows.set('mine', original({ id: 'mine', fromUserId: 'alice', toUserId: 'bob', fileId: 'file1' }));
		const result = await f.service.editMessage(me, 'mine', '  Edited canonical text  ');
		expect(result).toMatchObject({ id: 'mine', text: 'Edited canonical text', updatedAt: expect.any(String) });
		expect(f.messages.update).toHaveBeenCalledWith({ id: 'mine', fromUserId: 'alice' }, { text: 'Edited canonical text', updatedAt: expect.any(Date) });
		expect(f.rows.get('mine')).toMatchObject({ fileId: 'file1', toUserId: 'bob' });
		expect(f.events.publishChatUserStream).toHaveBeenCalledWith('bob', 'alice', 'updated', expect.objectContaining({ id: 'mine' }));
	});

	it('denies editing other authors, revoked members, readonly accounts and empty content', async () => {
		const f = fixture();
		await expect(f.service.editMessage(me, 'm001', 'bad edit')).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		f.rows.set('mine', original({ id: 'mine', fromUserId: 'alice', toUserId: null, toRoomId: 'roomC' }));
		await expect(f.service.editMessage(me, 'mine', 'bad edit')).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		f.rows.set('mine', original({ id: 'mine', fromUserId: 'alice', toUserId: 'bob' }));
		await expect(f.service.editMessage(me, 'mine', '  ')).rejects.toMatchObject({ code: 'CONTENT_REQUIRED' });
		f.availability.set('alice', 'readonly'); await expect(f.service.editMessage(me, 'mine', 'bad edit')).rejects.toThrow('ROLE_PERMISSION_DENIED');
		expect(f.messages.update).not.toHaveBeenCalled();
	});

	it('resolves replies on the server and rejects cross-room/cross-DM targets', async () => {
		const f = fixture();
		await expect(f.service.createMessageToRoom(me, f.rooms.get('roomA') as never, { text: 'Reply', replyId: 'm001' })).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		f.rows.set('source', original({ id: 'source', toUserId: null, toRoomId: 'roomA' }));
		await expect(f.service.createMessageToRoom(me, f.rooms.get('roomB') as never, { text: 'Reply', replyId: 'source' })).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		const created = await f.service.createMessageToRoom(me, f.rooms.get('roomA') as never, { text: 'Reply', replyId: 'source' });
		expect(f.rows.get(created.id)?.replyId).toBe('source'); expect(f.messages.insertOne).toHaveBeenCalledOnce();
	});

	it('forwards canonical source content/file with public-author attribution only', async () => {
		const f = fixture(); f.rows.set('m001', original({ fileId: 'file1', replyId: 'privateSourceReply', uri: 'https://private.invalid/source' }));
		const create = vi.spyOn(f.service, 'createMessageToRoom').mockImplementation(async (_actor, target, params) => {
			const row = original({ id: 'forward1', fromUserId: me.id, toUserId: null, toRoomId: target.id, text: params.text!, fileId: params.file?.id, forwardedFromUserId: params.forwardedFromUserId }); f.rows.set(row.id, row); return row as never;
		});
		const result = await f.service.forwardMessage(me, 'm001', { roomId: 'roomA' });
		expect(create).toHaveBeenCalledWith(me, expect.objectContaining({ id: 'roomA' }), { text: 'Canonical private message', file: expect.objectContaining({ id: 'file1', userId: 'bob' }), forwardedFromUserId: 'bob' });
		expect(JSON.stringify(result)).not.toContain('privateSourceReply'); expect(JSON.stringify(result)).not.toContain('private.invalid');
		expect(result.forwardedFromUser).toEqual({ id: 'bob' });
	});

	it('moderator status cannot bypass private source participant ACL when forwarding', async () => {
		const f = fixture(); f.rows.set('m001', original({ fromUserId: 'carol', toUserId: 'bob' }));
		const create = vi.spyOn(f.service, 'createMessageToRoom');
		await expect(f.service.forwardMessage(me, 'm001', { roomId: 'roomA' })).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' }); expect(create).not.toHaveBeenCalled();
	});

	it('denies administrator outsiders and two-way blocked pairs across private actions', async () => {
		const f = fixture(); const blocking = (f.service as unknown as { userBlockingService: { checkBlocked: ReturnType<typeof vi.fn> } }).userBlockingService.checkBlocked;
		f.rows.set('privateRoom', original({ id: 'privateRoom', toUserId: null, toRoomId: 'roomC' }));
		expect(await f.service.canViewMessage('alice', f.rows.get('privateRoom')!)).toBe(false);
		await expect(new ShowEndpoint(f.service, {} as never, {} as never).exec({ messageId: 'privateRoom' }, me as never, null)).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		for (const blockedPair of ['alice:bob', 'bob:alice']) {
			blocking.mockImplementation(async (a: string, b: string) => `${a}:${b}` === blockedPair);
			expect(await f.service.canViewUserConversation('alice', 'bob')).toBe(false);
			await expect(f.service.markConversationRead('alice', { userId: 'bob' }, 'm001')).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
			await expect(f.service.forwardMessage(me, 'm001', { roomId: 'roomA' })).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
			expect(await f.service.getConversationReadReceipts('alice', { userId: 'bob' })).toEqual([]);
		}
		expect(f.events.publishChatUserStream).not.toHaveBeenCalled();
	});

	it('forwarding still applies native destination membership and readonly policy', async () => {
		const f = fixture(); f.rooms.set('roomC', { id: 'roomC', ownerId: 'carol', isArchived: false });
		await expect(f.service.forwardMessage(me, 'm001', { roomId: 'roomC' })).rejects.toThrow('you are not a member of the room');
		f.availability.set('alice', 'readonly'); await expect(f.service.forwardMessage(me, 'm001', { roomId: 'roomA' })).rejects.toThrow('ROLE_PERMISSION_DENIED');
		expect(f.messages.insertOne).not.toHaveBeenCalled();
	});

	it('uses a monotonic visible read frontier and does not erase a newer unread message', async () => {
		const f = fixture(); f.rows.set('m002', original({ id: 'm002' })); f.markers.set('newUserChatMessageExists:alice:bob', 'm002'); f.unread.add('user:bob');
		expect(await f.service.markConversationRead('alice', { userId: 'bob' }, 'm001')).toEqual({ readThroughId: 'm001', hasUnread: true });
		expect(f.markers.get('newUserChatMessageExists:alice:bob')).toBe('m002');
		expect(await f.service.markConversationRead('alice', { userId: 'bob' }, 'm002')).toEqual({ readThroughId: 'm002', hasUnread: false });
		expect(await f.service.markConversationRead('alice', { userId: 'bob' }, 'm001')).toEqual({ readThroughId: 'm002', hasUnread: false });
		expect(f.events.publishChatUserStream).toHaveBeenCalledWith('bob', 'alice', 'read', { userId: 'alice', messageId: 'm002' });
		expect(f.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE "chat_message"'))).toHaveLength(0);
	});

	it('rejects read-through IDs from another conversation and keeps its cursor unchanged', async () => {
		const f = fixture(); f.rows.set('private', original({ id: 'private', fromUserId: 'carol', toUserId: 'bob' }));
		await expect(f.service.markConversationRead('alice', { userId: 'bob' }, 'private')).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		await expect(f.service.markConversationRead('alice', { userId: 'bob' }, '../bad')).rejects.toMatchObject({ code: 'NO_SUCH_MESSAGE' });
		expect(f.cursors.size).toBe(0); expect(f.redis.eval).not.toHaveBeenCalled();
	});

	it('keeps a read cursor valid after its frontier message is deleted', async () => {
		const f = fixture(); await f.service.markConversationRead('alice', { userId: 'bob' }, 'm001'); f.rows.delete('m001');
		f.rows.set('m000', original({ id: 'm000' })); expect(await f.service.hasUnreadMessages('alice')).toBe(false);
		f.rows.set('m002', original({ id: 'm002' })); expect(await f.service.hasUnreadMessages('alice')).toBe(true);
	});

	it('never rewrites legacy history into unread when there is no cursor', async () => {
		const f = fixture(); expect(await f.service.hasUnreadMessages('alice')).toBe(false);
		f.unread.add('user:bob'); expect(await f.service.hasUnreadMessages('alice')).toBe(true);
	});

	it('throttles room typing, rejects nonmembers and stores no message contents', async () => {
		const f = fixture(); await f.service.typing('alice', { roomId: 'roomA' }, true);
		expect(f.events.publishChatRoomStream).toHaveBeenCalledWith('roomA', 'typing', { userId: 'alice', typing: true });
		expect(f.redis.set).toHaveBeenCalledWith('chatTyping:alice:room:roomA', '1', 'PX', 1500, 'NX');
		f.redis.set.mockResolvedValueOnce(null); await f.service.typing('alice', { roomId: 'roomA' }, true); expect(f.events.publishChatRoomStream).toHaveBeenCalledOnce();
		await expect(f.service.typing('carol', { roomId: 'roomA' }, true)).rejects.toMatchObject({ code: 'NO_SUCH_ROOM' }); expect(f.messages.insertOne).not.toHaveBeenCalled();
	});
});

describe('Chat packing and endpoint trust boundaries', () => {
	it('packs one-hop reply only inside the same conversation and never a forwarded source ID', async () => {
		const f = fixture(); const service = new ChatEntityService(f.messages as never, {} as never, {} as never, {} as never, f.userEntity as never, {} as never, { parse: () => ({ date: new Date() }) } as never);
		f.rows.set('source', original({ id: 'source', text: 'x'.repeat(500) }));
		const same = await service.packMessageLiteFor1on1(original({ id: 'reply', fromUserId: 'alice', toUserId: 'bob', replyId: 'source', forwardedFromUserId: 'carol' }));
		expect(same.reply?.text).toHaveLength(240); expect(same.reply?.fromUser.id).toBe('bob'); expect(same.forwardedFromUser?.id).toBe('carol'); expect(same).not.toHaveProperty('forwardedFromMessageId');
		const cross = await service.packMessageLiteForRoom(original({ id: 'reply', fromUserId: 'alice', toUserId: null, toRoomId: 'roomA', replyId: 'source' }));
		expect(cross.reply).toBeNull(); expect(cross.replyId).toBeNull();
	});

	it('includes reaction actor IDs rather than guessing them from the message author', async () => {
		const f = fixture(); const service = new ChatEntityService(f.messages as never, {} as never, {} as never, {} as never, f.userEntity as never, {} as never, { parse: () => ({ date: new Date() }) } as never);
		const packed = await service.packMessageLiteFor1on1(original({ reactions: ['alice/👍', 'bob/🔥'] }));
		expect(packed.reactions).toEqual([{ userId: 'alice', reaction: '👍' }, { userId: 'bob', reaction: '🔥' }]);
	});

	it('rejects caller-supplied forwarding snapshots, authors and multiple destinations', async () => {
		const forward = vi.fn().mockResolvedValue({}); const endpoint = new ForwardEndpoint({ forwardMessage: forward } as never);
		for (const extra of [{ text: 'Forged' }, { fromUserId: 'carol' }, { toRoomId: 'roomA' }]) await expect(endpoint.exec({ messageId: 'm001', toUserId: 'bob', ...extra }, me as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(forward).not.toHaveBeenCalled(); await endpoint.exec({ messageId: 'm001', toUserId: 'bob' }, me as never, null);
		expect(forward).toHaveBeenCalledWith(me, 'm001', { userId: 'bob', roomId: undefined });
	});

	it('binds edits/read actions to the actor and requires a visible read ID', async () => {
		const edit = vi.fn().mockResolvedValue({}); const read = vi.fn().mockResolvedValue({ readThroughId: 'm001', hasUnread: false });
		await new EditEndpoint({ editMessage: edit } as never).exec({ messageId: 'm001', text: 'Edit' }, me as never, null); expect(edit).toHaveBeenCalledWith(me, 'm001', 'Edit');
		const endpoint = new ReadEndpoint({ markConversationRead: read } as never);
		await expect(endpoint.exec({ userId: 'bob' }, me as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await endpoint.exec({ userId: 'bob', messageId: 'm001' }, me as never, null); expect(read).toHaveBeenCalledWith('alice', { userId: 'bob', roomId: undefined }, 'm001');
	});

	it('timeline reads can explicitly opt out of marking a conversation read', async () => {
		const read = vi.fn(); const chat = { checkChatAvailability: vi.fn(), canViewUserConversation: vi.fn().mockResolvedValue(true), userTimeline: vi.fn().mockResolvedValue([]), readUserChatMessage: read };
		const endpoint = new UserTimelineEndpoint({ packMessagesLiteFor1on1: vi.fn().mockResolvedValue([]) } as never, chat as never, { getUser: async () => ({ id: 'bob' }) } as never, {} as never);
		await endpoint.exec({ userId: 'bob', markAsRead: false }, me as never, null); expect(read).not.toHaveBeenCalled();
		await endpoint.exec({ userId: 'bob' }, me as never, null); expect(read).toHaveBeenCalledWith('alice', 'bob');
	});

	it('registers frontier metadata without a message FK so removal cannot reset read state', async () => {
		class MetadataDataSource extends DataSource { async prepare() { await this.buildMetadatas(); } }
		const db = new MetadataDataSource({ type: 'postgres', entities }); await db.prepare();
		const cursor = db.getMetadata(MiChatReadCursor); expect(cursor.foreignKeys).toHaveLength(1); expect(cursor.foreignKeys[0].columnNames).toEqual(['userId']);
	});
});

describe('Streaming privacy and revocation', () => {
	const connection = (permission?: string[]) => ({ user: { id: 'alice' }, token: permission ? { permission } : undefined, subscriber: { on: vi.fn(), off: vi.fn() }, sendMessageToWs: vi.fn(), disconnectChannel: vi.fn() });

	it('room stream stops delivery after membership is revoked without waiting for socket closure', async () => {
		const socket = connection(); const member = vi.fn().mockResolvedValue(true); const chat = { getChatAvailability: async () => ({ read: true }), isRoomMember: member, getConversationReadReceipts: async () => [] };
		const channel = new ChatRoomChannel({ id: 'channel1', connection: socket } as never, { findOneBy: async () => ({ id: 'roomA' }) } as never, chat as never);
		expect(await channel.init({ roomId: 'roomA' })).toBe(true); member.mockResolvedValue(false);
		await (channel as unknown as { onEvent: (value: unknown) => Promise<void> }).onEvent({ type: 'message', body: { id: 'secret', text: 'must not leave server' } });
		expect(socket.sendMessageToWs).toHaveBeenCalledExactlyOnceWith('channel', { id: 'channel1', type: 'unavailable', body: null }); expect(socket.disconnectChannel).toHaveBeenCalledWith('channel1');
	});

	it('chat role denial and transient permission lookup failure fail closed', async () => {
		const socket = connection(); const availability = vi.fn().mockResolvedValue(true); const channel = new ChatUserChannel({ id: 'channel1', connection: socket } as never, { canViewUserConversation: availability, getConversationReadReceipts: async () => [] } as never);
		expect(await channel.init({ otherId: 'bob' })).toBe(true); availability.mockRejectedValue(new Error('database unavailable'));
		await (channel as unknown as { onEvent: (value: unknown) => Promise<void> }).onEvent({ type: 'message', body: { text: 'secret' } });
		expect(socket.sendMessageToWs).toHaveBeenCalledWith('channel', { id: 'channel1', type: 'unavailable', body: null });
	});

	it('read-only OAuth chat channels cannot send typing signals', async () => {
		const socket = connection(['read:account', 'read:chat']); const typing = vi.fn();
		const channel = new ChatUserChannel({ id: 'channel1', connection: socket } as never, { canViewUserConversation: async () => true, getConversationReadReceipts: async () => [], typing } as never);
		await channel.init({ otherId: 'bob' }); await channel.onMessage('typing', { typing: true }); expect(typing).not.toHaveBeenCalled();
	});

	it('restores only durable initial receipts on reopen, without marking messages read', async () => {
		const socket = connection(); const receipts = [{ userId: 'bob', messageId: 'm005' }]; const mark = vi.fn();
		const channel = new ChatUserChannel({ id: 'channel1', connection: socket } as never, { canViewUserConversation: async () => true, getConversationReadReceipts: async () => receipts, markConversationRead: mark } as never);
		expect(await channel.init({ otherId: 'bob' })).toBe(true);
		expect(socket.sendMessageToWs).toHaveBeenCalledExactlyOnceWith('channel', { id: 'channel1', type: 'read', body: receipts[0] }); expect(mark).not.toHaveBeenCalled();
	});

	it.each([{ permissions: ['read:account'] }, { permissions: ['read:account', 'read:chat'] }])('main channel enforces chat OAuth scope independently (%j)', async ({ permissions }) => {
		const socket = connection([...permissions]); const chat = { getChatAvailability: async () => ({ read: true }), findMessageById: async () => original(), canViewMessage: async () => true };
		const channel = new MainChannel({ id: 'channel1', connection: socket } as never, {} as never, chat as never); await channel.init({});
		const callback = socket.subscriber.on.mock.calls[0][1] as (payload: unknown) => Promise<void>;
		await callback({ type: 'newChatMessage', body: { id: 'private', text: 'private text' } });
		if (permissions.includes('read:chat')) expect(socket.sendMessageToWs).toHaveBeenCalledOnce(); else expect(socket.sendMessageToWs).not.toHaveBeenCalled();
		await callback({ type: 'chatUnreadState', body: { hasUnread: true } }); expect(socket.sendMessageToWs).toHaveBeenCalledWith('channel', expect.objectContaining({ type: 'chatUnreadState', body: { hasUnread: true } }));
	});
});
