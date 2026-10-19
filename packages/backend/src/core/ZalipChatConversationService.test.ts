/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipChatConversationService, zalipChatTarget } from './ZalipChatConversationService.js';
import { decodeZalipChatConversationCursor, zalipChatConversationScope } from '@/misc/zalip-chat-conversation-page.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import ListEndpoint from '@/server/api/endpoints/zalip/chat/conversations.js';
import ShowEndpoint from '@/server/api/endpoints/zalip/chat/preferences/show.js';
import UpdateEndpoint from '@/server/api/endpoints/zalip/chat/preferences/update.js';
import { ZalipChatConversationSettings1792445862610 } from '../../migration/1792445862610-ZalipChatConversationSettings.js';
import { ZalipChatConversationIndexes1792446213099 } from '../../migration/1792446213099-ZalipChatConversationIndexes.js';

const owner = { id: 'owner' };
const defaults = { pinnedAt: null as Date | null, archivedAt: null as Date | null, isMuted: false, pinnedMessageId: null as string | null, nativeMuted: false };
const dm = { ...defaults, key: 'user:peer', kind: 'user', targetId: 'peer', lastMessageId: 'msg01', activity: 'msg01', unread: true };
const room = { ...defaults, key: 'room:room01', kind: 'room', targetId: 'room01', lastMessageId: null, activity: 'room01', unread: false };

function fixture() {
	const state = { setting: { ...defaults }, rows: [dm, room], accessible: true, member: true, roomOwner: 'owner', pinAllowed: true, actorActive: true, policy: 'available' };
	const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<unknown[]> => {
		if (sql.startsWith('SELECT "id" FROM "user"')) return state.actorActive ? [{ id: owner.id }] : [];
		if (sql.startsWith('SET LOCAL') || sql.startsWith('SELECT pg_advisory')) return [];
		if (sql.includes('WITH dm AS')) return state.rows;
		if (sql.startsWith('SELECT u."id"')) return state.accessible ? [{ id: values[1] }] : [];
		if (sql.startsWith('SELECT r."id"')) return state.accessible ? [{ id: values[1], ownerId: state.roomOwner }] : [];
		if (sql.startsWith('SELECT "id" FROM "chat_room_membership"')) return state.member ? [{ id: 'membership' }] : [];
		if (sql.startsWith('SELECT "id" FROM "chat_message"')) return state.pinAllowed ? [{ id: values[0] }] : [];
		if (sql.startsWith('INSERT INTO "zalip_chat_conversation_setting"')) {
			if (values[5]) state.setting.pinnedAt = values[4] ? values[12] as Date : null;
			if (values[7]) state.setting.archivedAt = values[6] ? values[12] as Date : null;
			if (values[9]) state.setting.isMuted = values[8] as boolean;
			if (values[11]) state.setting.pinnedMessageId = values[10] as string | null;
			return [];
		}
		if (sql.startsWith('UPDATE "chat_room_membership"')) { state.setting.nativeMuted = values[2] as boolean; return []; }
		if (sql.startsWith('SELECT setting.')) return [state.setting];
		throw new Error(`Unexpected conversation fixture query: ${sql}`);
	});
	const roomFind = vi.fn(async (options: { where: { id: { value: string[] } } }) => options.where.id.value.map(id => ({ id })));
	const messageFind = vi.fn(async () => [{ id: 'msg01', fromUserId: 'peer', toUserId: owner.id, text: 'Synthetic preview', reactions: [], file: null }]);
	const manager = { query };
	const db = { query, manager, transaction: vi.fn(async (action: (value: typeof manager) => Promise<unknown>) => action(manager)), getRepository: (model: unknown) => {
		if (model === MiChatRoom) return { find: roomFind };
		if (model === MiChatMessage) return { find: messageFind };
		throw new Error('Unexpected conversation repository');
	} };
	const evalRedis = vi.fn().mockResolvedValue([1, 'user:peer']);
	const packMany = vi.fn(async (ids: string[]) => ids.map(id => ({ id, name: id, username: id, avatarUrl: `https://test.invalid/${id}` })));
	const packRooms = vi.fn(async (rooms: { id: string }[]) => rooms.map(value => ({ ...value, name: 'Group', isMuted: false })));
	const packMessagesDetailed = vi.fn(async (messages: { id: string }[]) => messages);
	const service = new ZalipChatConversationService(db as never, { eval: evalRedis } as never, { gen: () => 'zzzz' } as never, { getUserPolicies: async () => ({ chatAvailability: state.policy }) } as never, { packMany } as never, { packRooms, packMessagesDetailed } as never);
	return { service, state, query, db, evalRedis, packMany, packRooms, packMessagesDetailed, roomFind, messageFind };
}

describe('personal conversation lists', () => {
	it('uses private native packing for only the bounded SQL page and never opens a timeline or marks read', async () => {
		const f = fixture();
		const result = await f.service.list(owner);
		expect(result.items).toMatchObject([{ key: 'user:peer', unread: true, lastMessage: { id: 'msg01', isRead: false }, preferences: { isPinned: false } }, { key: 'room:room01', room: { id: 'room01' }, lastMessage: null }]);
		expect(f.packMany).toHaveBeenCalledExactlyOnceWith(['peer'], owner, { schema: 'UserLite', includeSecrets: false });
		const sql = f.query.mock.calls.find(([sql]) => sql.includes('WITH dm AS'))!;
		expect(sql[0]).toContain('r."ownerId" = $1 OR member."id" IS NOT NULL');
		expect(sql[0]).toContain('b."blockerId" = $1');
		expect(sql[0]).toContain('b."blockeeId" = $1');
		expect(sql[0]).toContain('LEFT JOIN "chat_read_cursor"');
		expect(sql[0]).toContain('incoming."id" > frontier."readThroughId"');
		expect(sql[0]).not.toContain('isModerator');
		expect(sql[1]?.at(-1)).toBe(21);
		expect(f.evalRedis.mock.calls[0][0]).not.toMatch(/redis\.call\('(SET|DEL|SREM)'/u);
		expect(f.query.mock.calls.some(([sql]) => /UPDATE "chat_message"|INSERT INTO "chat_read_cursor"/u.test(sql))).toBe(false);
	});
	it.each(['all', 'unread', 'people', 'groups', 'archived'] as const)('filters %s and literal name search before LIMIT in SQL', async filter => {
		const f = fixture();
		await f.service.list(owner, { filter, query: '  10%_search  ', limit: 1 });
		const [sql, params] = f.query.mock.calls.find(([sql]) => sql.includes('WITH dm AS'))!;
		expect(params).toEqual(['owner', 'zzzz', '10%_search', '%10\\%\\_search%', ['user:peer'], filter, null, 0, '', 2]);
		expect(sql).toContain("$6 <> 'people' OR kind = 'user'");
		expect(sql).toContain("$6 <> 'groups' OR kind = 'room'");
		expect(sql).toContain("$6 <> 'unread' OR unread");
		expect(sql.indexOf('ILIKE')).toBeLessThan(sql.indexOf('LIMIT $10'));
	});
	it('returns a scoped keyset cursor without packing the extra sentinel conversation', async () => {
		const f = fixture();
		const result = await f.service.list(owner, { limit: 1 });
		expect(result.items).toHaveLength(1);
		expect(result.nextCursor).toBeTypeOf('string');
		expect(decodeZalipChatConversationCursor(result.nextCursor!, zalipChatConversationScope(owner.id, 'all', ''))).toEqual({ snapshot: 'zzzz', pinned: false, activity: 'msg01', key: 'user:peer' });
		expect(f.roomFind.mock.calls[0][0].where.id.value).toEqual([]);
		await expect(f.service.list({ id: 'other' }, { cursor: result.nextCursor! })).rejects.toMatchObject({ code: 'INVALID_ZALIP_CHAT_CURSOR' });
		await expect(f.service.list(owner, { cursor: result.nextCursor!, filter: 'people' })).rejects.toMatchObject({ code: 'INVALID_ZALIP_CHAT_CURSOR' });
	});
	it.each([{ limit: 0 }, { limit: 51 }, { query: 'x'.repeat(81) }, { query: '\0' }])('rejects invalid bounded input %j', async input => {
		const f = fixture();
		await expect(f.service.list(owner, input)).rejects.toMatchObject({ code: 'INVALID_ZALIP_CHAT_PREFERENCES' });
		expect(f.evalRedis).not.toHaveBeenCalled();
	});
	it('fails closed for unavailable accounts and oversize legacy unread sets', async () => {
		const f = fixture(); f.state.policy = 'unavailable';
		await expect(f.service.list(owner)).rejects.toMatchObject({ code: 'ZALIP_CHAT_UNAVAILABLE' });
		expect(f.evalRedis).not.toHaveBeenCalled();
		f.state.policy = 'available'; f.evalRedis.mockResolvedValue([5001]);
		await expect(f.service.list(owner)).rejects.toMatchObject({ code: 'ZALIP_CHAT_UNREAD_LIMIT_EXCEEDED' });
		expect(f.packMany).not.toHaveBeenCalled();
		expect(f.evalRedis.mock.calls[0][0]).toContain("if size > 5000 then return {size} end");
	});
});

describe('persistent personal chat preferences', () => {
	it('partially upserts flags and clears a personal pin without resetting the other flags', async () => {
		const f = fixture();
		await expect(f.service.updatePreferences(owner, { userId: 'peer' }, { isPinned: true, isMuted: true, pinnedMessageId: 'msg01' })).resolves.toEqual({ isPinned: true, isArchived: false, isMuted: true, pinnedMessageId: 'msg01' });
		await expect(f.service.updatePreferences(owner, { userId: 'peer' }, { isArchived: true })).resolves.toEqual({ isPinned: true, isArchived: true, isMuted: true, pinnedMessageId: 'msg01' });
		await expect(f.service.updatePreferences(owner, { userId: 'peer' }, { pinnedMessageId: null, isMuted: false })).resolves.toEqual({ isPinned: true, isArchived: true, isMuted: false, pinnedMessageId: null });
		expect(f.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['zalip-chat-setting:owner:user:peer']);
		expect(f.evalRedis).not.toHaveBeenCalled();
	});
	it('mirrors room mute/unmute for members and supports owners without a membership row', async () => {
		const f = fixture();
		f.state.setting.nativeMuted = true;
		await expect(f.service.updatePreferences(owner, { roomId: 'room01' }, { isMuted: false })).resolves.toMatchObject({ isMuted: false });
		f.state.member = false;
		await expect(f.service.updatePreferences(owner, { roomId: 'room01' }, { isMuted: true })).resolves.toMatchObject({ isMuted: true });
		expect(f.query).toHaveBeenCalledWith('UPDATE "chat_room_membership" SET "isMuted" = $3 WHERE "userId" = $1 AND "roomId" = $2', ['owner', 'room01', true]);
		await expect(f.service.isConversationMuted(owner.id, { roomId: 'room01' })).resolves.toBe(true);
	});
	it('does not let an administrator or old settings row bypass revoked room or DM access', async () => {
		const f = fixture(); f.state.accessible = false; f.state.setting.isMuted = true;
		for (const target of [{ roomId: 'room01' }, { userId: 'peer' }]) {
			await expect(f.service.showPreferences(owner, target)).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_CHAT_CONVERSATION' });
			await expect(f.service.updatePreferences(owner, target, { isPinned: true })).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_CHAT_CONVERSATION' });
		}
		expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO'))).toBe(false);
	});
	it('rechecks a non-owner membership after locking, preventing a removal race', async () => {
		const f = fixture(); f.state.roomOwner = 'other'; f.state.member = false;
		await expect(f.service.updatePreferences(owner, { roomId: 'room01' }, { isMuted: true })).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_CHAT_CONVERSATION' });
		expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO'))).toBe(false);
	});
	it('checks the pinned message belongs to the same authorized conversation', async () => {
		const f = fixture(); f.state.pinAllowed = false;
		await expect(f.service.updatePreferences(owner, { userId: 'peer' }, { pinnedMessageId: 'foreignMessage' })).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_CHAT_CONVERSATION' });
		expect(f.query.mock.calls.some(([sql]) => sql.startsWith('INSERT INTO'))).toBe(false);
	});
	it.each([{}, { userId: 'peer', roomId: 'room' }, { userId: 'owner' }, { roomId: '../room' }])('rejects an invalid target %j', target => expect(() => zalipChatTarget(owner.id, target)).toThrow('INVALID_ZALIP_CHAT_PREFERENCES'));
});

describe('conversation endpoint and migration boundaries', () => {
	it('binds list ownership to the authenticated session and validates filters/bounds', async () => {
		const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null }); const endpoint = new ListEndpoint({ list } as never);
		await endpoint.exec({ filter: 'people', limit: 5 }, owner as never, null);
		expect(list).toHaveBeenCalledWith(owner, { filter: 'people', limit: 5 });
		await expect(endpoint.exec({ userId: 'other' }, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(endpoint.exec({ limit: 51 }, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});
	it('accepts exactly one target and keeps explicit false/null versus omitted fields', async () => {
		const showPreferences = vi.fn().mockResolvedValue({}); const updatePreferences = vi.fn().mockResolvedValue({});
		const show = new ShowEndpoint({ showPreferences } as never); const update = new UpdateEndpoint({ updatePreferences } as never);
		await expect(show.exec({}, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(show.exec({ userId: 'peer', roomId: 'room01' }, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(new UpdateEndpoint(fixture().service).exec({ userId: 'peer' }, owner as never, null)).rejects.toMatchObject({ code: 'INVALID_ZALIP_CHAT_PREFERENCES' });
		await update.exec({ userId: 'peer', isMuted: false, pinnedMessageId: null }, owner as never, null);
		expect(updatePreferences).toHaveBeenCalledExactlyOnceWith(owner, { userId: 'peer', roomId: undefined }, { isMuted: false, pinnedMessageId: null });
	});
	it('creates a constrained personal target with recoverable native message deletion and drops only its own table', async () => {
		const query = vi.fn().mockResolvedValue([]); const migration = new ZalipChatConversationSettings1792445862610();
		await migration.up({ query }); const sql = query.mock.calls.map(([sql]) => sql).join('\n');
		expect(sql).toContain("\"conversationKey\" = 'user:' || \"otherUserId\"");
		expect(sql).toContain("\"conversationKey\" = 'room:' || \"roomId\"");
		expect(sql).toContain('REFERENCES "chat_message"("id") ON DELETE SET NULL');
		expect(sql).not.toMatch(/UPDATE "(?:chat_message|chat_room|user)"/u);
		query.mockClear(); await migration.down({ query }); expect(query).toHaveBeenCalledExactlyOnceWith('DROP TABLE "zalip_chat_conversation_setting"');
	});
	it('adds and reverses only the three conversation-scoped native indexes', async () => {
		const query = vi.fn().mockResolvedValue([]); const migration = new ZalipChatConversationIndexes1792446213099();
		await migration.up({ query });
		expect(query.mock.calls.map(([sql]) => sql)).toHaveLength(3);
		expect(query.mock.calls.every(([sql]) => sql.startsWith('CREATE INDEX IF NOT EXISTS "IDX_zalip_chat_message_'))).toBe(true);
		query.mockClear(); await migration.down({ query });
		expect(query.mock.calls).toHaveLength(3);
		expect(query.mock.calls.every(([sql]) => sql.startsWith('DROP INDEX IF EXISTS "public"."IDX_zalip_chat_message_'))).toBe(true);
	});
});
