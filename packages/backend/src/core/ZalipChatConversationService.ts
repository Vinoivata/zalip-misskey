/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import * as Redis from 'ioredis';
import type { EntityManager } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { MiChatMessage } from '@/models/ChatMessage.js';
import { MiChatRoom } from '@/models/ChatRoom.js';
import type { MiUser } from '@/models/User.js';
import type { Packed } from '@/misc/json-schema.js';
import { decodeZalipChatConversationCursor, encodeZalipChatConversationCursor, isZalipChatConversationKey, zalipChatConversationFilters, zalipChatConversationScope, type ZalipChatConversationFilter } from '@/misc/zalip-chat-conversation-page.js';

export type ZalipChatConversationTarget = { userId?: string; roomId?: string };
export type PackedZalipChatConversationPreferences = { isPinned: boolean; isArchived: boolean; isMuted: boolean; pinnedMessageId: string | null };
export type ZalipChatConversationPreferenceUpdate = Partial<PackedZalipChatConversationPreferences>;
export type PackedZalipChatConversation = {
	key: string;
	kind: 'user' | 'room';
	user: Packed<'UserLite'> | null;
	room: Packed<'ChatRoom'> | null;
	lastMessage: Packed<'ChatMessage'> | null;
	unread: boolean;
	preferences: PackedZalipChatConversationPreferences;
};
export type PackedZalipChatConversationList = { items: PackedZalipChatConversation[]; nextCursor: string | null };
type Viewer = Pick<MiUser, 'id'>;
type SettingRow = { pinnedAt: Date | null; archivedAt: Date | null; isMuted: boolean; pinnedMessageId: string | null; nativeMuted: boolean };
type ConversationRow = SettingRow & { key: string; kind: 'user' | 'room'; targetId: string; lastMessageId: string | null; activity: string; unread: boolean };
type ErrorCode = 'NO_SUCH_ZALIP_CHAT_CONVERSATION' | 'INVALID_ZALIP_CHAT_PREFERENCES' | 'INVALID_ZALIP_CHAT_CURSOR' | 'ZALIP_CHAT_UNAVAILABLE' | 'ZALIP_CHAT_UNREAD_LIMIT_EXCEEDED';

export class ZalipChatConversationError extends Error {
	constructor(public readonly code: ErrorCode) { super(code); }
}

export function zalipChatTarget(meId: string, input: ZalipChatConversationTarget): { key: string; kind: 'user' | 'room'; id: string } {
	if ((input.userId == null) === (input.roomId == null)) throw new ZalipChatConversationError('INVALID_ZALIP_CHAT_PREFERENCES');
	const kind = input.userId != null ? 'user' : 'room';
	const id = input.userId ?? input.roomId!;
	if (!/^[A-Za-z0-9]{1,32}$/u.test(id) || kind === 'user' && id === meId) throw new ZalipChatConversationError('INVALID_ZALIP_CHAT_PREFERENCES');
	return { key: `${kind}:${id}`, kind, id };
}

function packPreferences(row?: SettingRow): PackedZalipChatConversationPreferences {
	return { isPinned: row?.pinnedAt != null, isArchived: row?.archivedAt != null, isMuted: row?.isMuted === true || row?.nativeMuted === true, pinnedMessageId: row?.pinnedMessageId ?? null };
}

/** No caller-selected owner and no admin bypass: every list and preference is strictly personal. */
@Injectable()
export class ZalipChatConversationService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.redis) private redisClient: Redis.Redis,
		private idService: IdService,
		private roleService: RoleService,
		private userEntityService: UserEntityService,
		private chatEntityService: ChatEntityService,
	) {}

	private async assertAvailable(me: Viewer): Promise<void> {
		const actor = await this.db.query<{ id: string }[]>('SELECT "id" FROM "user" WHERE "id" = $1 AND "host" IS NULL AND "isSuspended" = false AND "isDeleted" = false', [me.id]);
		if (actor.length !== 1 || !['available', 'readonly'].includes((await this.roleService.getUserPolicies(me.id)).chatAvailability)) throw new ZalipChatConversationError('ZALIP_CHAT_UNAVAILABLE');
	}

	/** Read-only and atomically capped: do not fetch a potentially unbounded SMEMBERS first. */
	private async unreadLegacyKeys(me: Viewer): Promise<string[]> {
		const result = await this.redisClient.eval(`
local size = redis.call('SCARD', KEYS[1])
if size > 5000 then return {size} end
local result = {size}
for _, key in ipairs(redis.call('SMEMBERS', KEYS[1])) do
 local user = string.match(key, '^user:([%w]+)$')
 local room = string.match(key, '^room:([%w]+)$')
 if user and string.len(user) <= 32 and redis.call('GET', ARGV[1] .. user) then table.insert(result, key) end
 if room and string.len(room) <= 32 and redis.call('GET', ARGV[2] .. room) then table.insert(result, key) end
end
return result`, 1, `newChatMessagesExists:${me.id}`, `newUserChatMessageExists:${me.id}:`, `newRoomChatMessageExists:${me.id}:`);
		if (!Array.isArray(result) || typeof result[0] !== 'number') throw new Error('CHAT_REDIS_OPERATION_FAILED');
		if (result[0] > 5000) throw new ZalipChatConversationError('ZALIP_CHAT_UNREAD_LIMIT_EXCEEDED');
		return result.slice(1).filter(isZalipChatConversationKey);
	}

	public async list(me: Viewer, options: { filter?: ZalipChatConversationFilter; query?: string; limit?: number; cursor?: string } = {}): Promise<PackedZalipChatConversationList> {
		const filter = options.filter ?? 'all';
		const query = (options.query ?? '').trim().replace(/\s+/gu, ' ');
		const limit = options.limit ?? 20;
		if (!zalipChatConversationFilters.includes(filter) || Array.from(query).length > 80 || query.includes('\0') || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new ZalipChatConversationError('INVALID_ZALIP_CHAT_PREFERENCES');
		await this.assertAvailable(me);
		const scope = zalipChatConversationScope(me.id, filter, query);
		let anchor: ReturnType<typeof decodeZalipChatConversationCursor> | null = null;
		if (options.cursor != null) {
			try { anchor = decodeZalipChatConversationCursor(options.cursor, scope); } catch { throw new ZalipChatConversationError('INVALID_ZALIP_CHAT_CURSOR'); }
		}
		const snapshot = anchor?.snapshot ?? this.idService.gen();
		const unreadKeys = await this.unreadLegacyKeys(me);
		const pattern = `%${query.replace(/[\\%_]/gu, '\\$&')}%`;
		const rows = await this.db.transaction(async manager => {
			await manager.query("SET LOCAL statement_timeout = '3000ms'");
			return manager.query<ConversationRow[]>(`
			WITH dm AS (
				SELECT DISTINCT ON (m.peer) m.peer, m.id FROM (
					SELECT "toUserId" AS peer, "id" FROM "chat_message" WHERE "fromUserId" = $1 AND "toUserId" IS NOT NULL AND "toRoomId" IS NULL AND "id" <= $2
					UNION ALL SELECT "fromUserId", "id" FROM "chat_message" WHERE "toUserId" = $1 AND "toRoomId" IS NULL AND "id" <= $2
				) m WHERE m.peer <> $1 ORDER BY m.peer, m.id DESC
			), room_ids AS (
				SELECT "id" FROM "chat_room" WHERE "ownerId" = $1
				UNION SELECT "roomId" FROM "chat_room_membership" WHERE "userId" = $1
			), conversations AS (
				SELECT 'user:' || u."id" AS key, 'user'::varchar AS kind, u."id" AS "targetId", dm.id AS "lastMessageId", dm.id AS activity, false AS "nativeMuted"
				FROM dm JOIN "user" u ON u."id" = dm.peer AND u."isDeleted" = false AND u."isSuspended" = false
				WHERE NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $1 AND b."blockeeId" = u."id") OR (b."blockeeId" = $1 AND b."blockerId" = u."id"))
				AND ($3 = '' OR COALESCE(u."name", '') ILIKE $4 ESCAPE '\\' OR u."username" ILIKE $4 ESCAPE '\\')
				UNION ALL
				SELECT 'room:' || r."id", 'room', r."id", last."id", COALESCE(last."id", r."id"), COALESCE(member."isMuted", false)
				FROM room_ids accessible JOIN "chat_room" r ON r."id" = accessible."id"
				LEFT JOIN "chat_room_membership" member ON member."roomId" = r."id" AND member."userId" = $1
				LEFT JOIN LATERAL (SELECT m."id" FROM "chat_message" m WHERE m."toRoomId" = r."id" AND m."id" <= $2 ORDER BY m."id" DESC LIMIT 1) last ON true
				WHERE r."id" <= $2 AND (r."ownerId" = $1 OR member."id" IS NOT NULL) AND ($3 = '' OR r."name" ILIKE $4 ESCAPE '\\')
			), projected AS (
				SELECT c.*, setting."pinnedAt", setting."archivedAt", COALESCE(setting."isMuted", false) AS "isMuted", setting."pinnedMessageId",
				CASE WHEN frontier."userId" IS NULL THEN c.key = ANY($5::varchar[]) ELSE EXISTS (
					SELECT 1 FROM "chat_message" incoming WHERE incoming."id" > frontier."readThroughId" AND incoming."id" <= $2 AND incoming."fromUserId" <> $1
					AND ((c.kind = 'user' AND incoming."fromUserId" = c."targetId" AND incoming."toUserId" = $1 AND incoming."toRoomId" IS NULL) OR (c.kind = 'room' AND incoming."toRoomId" = c."targetId"))
				) END AS unread
				FROM conversations c LEFT JOIN "zalip_chat_conversation_setting" setting ON setting."userId" = $1 AND setting."conversationKey" = c.key
				LEFT JOIN "chat_read_cursor" frontier ON frontier."userId" = $1 AND frontier."conversationKey" = c.key
			)
			SELECT * FROM projected WHERE
				CASE WHEN $6 = 'archived' THEN "archivedAt" IS NOT NULL ELSE "archivedAt" IS NULL END
				AND ($6 <> 'people' OR kind = 'user') AND ($6 <> 'groups' OR kind = 'room') AND ($6 <> 'unread' OR unread)
				AND ($7::varchar IS NULL OR
					("pinnedAt" IS NOT NULL)::int < $8 OR (("pinnedAt" IS NOT NULL)::int = $8 AND (activity < $9 OR (activity = $9 AND key > $7))))
			ORDER BY ("pinnedAt" IS NOT NULL) DESC, activity DESC, key ASC LIMIT $10
			`, [me.id, snapshot, query, pattern, unreadKeys, filter, anchor?.key ?? null, anchor?.pinned ? 1 : 0, anchor?.activity ?? '', limit + 1]);
		});
		const page = rows.slice(0, limit);
		const [users, rooms, messages] = await Promise.all([
			this.userEntityService.packMany(page.filter(row => row.kind === 'user').map(row => row.targetId), me, { schema: 'UserLite', includeSecrets: false }),
			this.db.getRepository(MiChatRoom).find({ where: { id: In(page.filter(row => row.kind === 'room').map(row => row.targetId)) } }).then(rooms => this.chatEntityService.packRooms(rooms, me)),
			this.db.getRepository(MiChatMessage).find({ where: { id: In(page.map(row => row.lastMessageId).filter((id): id is string => id != null)) }, relations: { file: true } }).then(messages => this.chatEntityService.packMessagesDetailed(messages, me)),
		]);
		const userById = new Map(users.map(user => [user.id, user]));
		const roomById = new Map(rooms.map(room => [room.id, room]));
		const messageById = new Map(messages.map(message => [message.id, message]));
		const items = page.flatMap(row => {
			const user = row.kind === 'user' ? userById.get(row.targetId) : null;
			const room = row.kind === 'room' ? roomById.get(row.targetId) : null;
			if (row.kind === 'user' && user == null || row.kind === 'room' && room == null) return [];
			const preferences = packPreferences(row);
			const lastMessage = row.lastMessageId == null ? null : messageById.get(row.lastMessageId) ?? null;
			if (lastMessage) lastMessage.isRead = !row.unread;
			if (room) room.isMuted = preferences.isMuted;
			return [{ key: row.key, kind: row.kind, user: user ?? null, room: room ?? null, lastMessage, unread: row.unread, preferences }];
		});
		const last = page.at(-1);
		return { items, nextCursor: rows.length > limit && last ? encodeZalipChatConversationCursor(scope, { snapshot, pinned: last.pinnedAt != null, activity: last.activity, key: last.key }) : null };
	}

	private async assertTargetAccess(manager: EntityManager, me: Viewer, target: ReturnType<typeof zalipChatTarget>, lock = false): Promise<void> {
		const rows = target.kind === 'user'
			? await manager.query<{ id: string }[]>(`SELECT u."id" FROM "user" u WHERE u."id" = $2 AND u."isDeleted" = false AND u."isSuspended" = false
				AND NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $1 AND b."blockeeId" = $2) OR (b."blockeeId" = $1 AND b."blockerId" = $2))
				AND EXISTS (SELECT 1 FROM "chat_message" m WHERE m."toRoomId" IS NULL AND ((m."fromUserId" = $1 AND m."toUserId" = $2) OR (m."fromUserId" = $2 AND m."toUserId" = $1)))${lock ? ' FOR SHARE OF u' : ''}`, [me.id, target.id])
			: await manager.query<{ id: string; ownerId: string }[]>(`SELECT r."id", r."ownerId" FROM "chat_room" r WHERE r."id" = $2 AND (r."ownerId" = $1 OR EXISTS (SELECT 1 FROM "chat_room_membership" member WHERE member."roomId" = r."id" AND member."userId" = $1))${lock ? ' FOR SHARE OF r' : ''}`, [me.id, target.id]);
		if (rows.length !== 1) throw new ZalipChatConversationError('NO_SUCH_ZALIP_CHAT_CONVERSATION');
		if (lock && target.kind === 'room') {
			const membership = await manager.query<{ id: string }[]>('SELECT "id" FROM "chat_room_membership" WHERE "roomId" = $2 AND "userId" = $1 FOR SHARE', [me.id, target.id]);
			if ((rows[0] as { ownerId?: string }).ownerId !== me.id && membership.length !== 1) throw new ZalipChatConversationError('NO_SUCH_ZALIP_CHAT_CONVERSATION');
		}
	}

	private async preferences(manager: EntityManager, me: Viewer, target: ReturnType<typeof zalipChatTarget>): Promise<PackedZalipChatConversationPreferences> {
		const rows = await manager.query<SettingRow[]>(`SELECT setting."pinnedAt", setting."archivedAt", COALESCE(setting."isMuted", false) AS "isMuted", setting."pinnedMessageId", COALESCE(member."isMuted", false) AS "nativeMuted"
			FROM (SELECT 1) singleton LEFT JOIN "zalip_chat_conversation_setting" setting ON setting."userId" = $1 AND setting."conversationKey" = $2
			LEFT JOIN "chat_room_membership" member ON member."userId" = $1 AND member."roomId" = $3`, [me.id, target.key, target.kind === 'room' ? target.id : null]);
		return packPreferences(rows[0]);
	}

	public async showPreferences(me: Viewer, input: ZalipChatConversationTarget): Promise<PackedZalipChatConversationPreferences> {
		const target = zalipChatTarget(me.id, input);
		await this.assertAvailable(me);
		return this.db.transaction(async manager => { await this.assertTargetAccess(manager, me, target); return this.preferences(manager, me, target); });
	}

	public async updatePreferences(me: Viewer, input: ZalipChatConversationTarget, update: ZalipChatConversationPreferenceUpdate): Promise<PackedZalipChatConversationPreferences> {
		const target = zalipChatTarget(me.id, input);
		if (Object.entries(update).some(([key, value]) => key === 'pinnedMessageId' ? value !== null && (typeof value !== 'string' || !/^[A-Za-z0-9]{1,32}$/u.test(value)) : !['isPinned', 'isArchived', 'isMuted'].includes(key) || typeof value !== 'boolean') || Object.keys(update).length === 0) throw new ZalipChatConversationError('INVALID_ZALIP_CHAT_PREFERENCES');
		await this.assertAvailable(me);
		return this.db.transaction(async manager => {
			await this.assertTargetAccess(manager, me, target, true);
			await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`zalip-chat-setting:${me.id}:${target.key}`]);
			if (update.pinnedMessageId != null) {
				const messages = target.kind === 'room'
					? await manager.query<{ id: string }[]>('SELECT "id" FROM "chat_message" WHERE "id" = $1 AND "toRoomId" = $2 FOR SHARE', [update.pinnedMessageId, target.id])
					: await manager.query<{ id: string }[]>('SELECT "id" FROM "chat_message" WHERE "id" = $1 AND "toRoomId" IS NULL AND (("fromUserId" = $2 AND "toUserId" = $3) OR ("fromUserId" = $3 AND "toUserId" = $2)) FOR SHARE', [update.pinnedMessageId, me.id, target.id]);
				if (messages.length !== 1) throw new ZalipChatConversationError('NO_SUCH_ZALIP_CHAT_CONVERSATION');
			}
			const now = new Date();
			await manager.query(`INSERT INTO "zalip_chat_conversation_setting" ("userId", "conversationKey", "otherUserId", "roomId", "pinnedAt", "archivedAt", "isMuted", "pinnedMessageId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, CASE WHEN $5 THEN $13::timestamptz ELSE NULL END, CASE WHEN $7 THEN $13::timestamptz ELSE NULL END, COALESCE($9, false), $11, $13, $13)
				ON CONFLICT ("userId", "conversationKey") DO UPDATE SET
				"pinnedAt" = CASE WHEN $6 THEN EXCLUDED."pinnedAt" ELSE "zalip_chat_conversation_setting"."pinnedAt" END,
				"archivedAt" = CASE WHEN $8 THEN EXCLUDED."archivedAt" ELSE "zalip_chat_conversation_setting"."archivedAt" END,
				"isMuted" = CASE WHEN $10 THEN EXCLUDED."isMuted" ELSE "zalip_chat_conversation_setting"."isMuted" END,
				"pinnedMessageId" = CASE WHEN $12 THEN EXCLUDED."pinnedMessageId" ELSE "zalip_chat_conversation_setting"."pinnedMessageId" END, "updatedAt" = EXCLUDED."updatedAt"`,
			[me.id, target.key, target.kind === 'user' ? target.id : null, target.kind === 'room' ? target.id : null, update.isPinned ?? false, update.isPinned !== undefined, update.isArchived ?? false, update.isArchived !== undefined, update.isMuted ?? null, update.isMuted !== undefined, update.pinnedMessageId ?? null, update.pinnedMessageId !== undefined, now]);
			if (target.kind === 'room' && update.isMuted !== undefined) await manager.query('UPDATE "chat_room_membership" SET "isMuted" = $3 WHERE "userId" = $1 AND "roomId" = $2', [me.id, target.id, update.isMuted]);
			return this.preferences(manager, me, target);
		});
	}

	/** Used by ChatService for notification gating only; it must never remove unread markers. */
	public async isConversationMuted(userId: string, input: ZalipChatConversationTarget): Promise<boolean> {
		const target = zalipChatTarget(userId, input);
		return (await this.preferences(this.db.manager, { id: userId }, target)).isMuted;
	}
}
