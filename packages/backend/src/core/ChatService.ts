/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import * as Redis from 'ioredis';
import { Brackets, DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import type { Config } from '@/config.js';
import { QueueService } from '@/core/QueueService.js';
import { IdService } from '@/core/IdService.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { ChatEntityService } from '@/core/entities/ChatEntityService.js';
import { ApRendererService } from '@/core/activitypub/ApRendererService.js';
import { PushNotificationService } from '@/core/PushNotificationService.js';
import { bindThis } from '@/decorators.js';
import type { ChatApprovalsRepository, ChatMessagesRepository, ChatRoomInvitationsRepository, ChatRoomMembershipsRepository, ChatRoomsRepository, DriveFilesRepository, MiChatMessage, MiChatRoom, MiChatRoomMembership, MiDriveFile, MiUser, MutingsRepository, UsersRepository } from '@/models/_.js';
import { UserBlockingService } from '@/core/UserBlockingService.js';
import { QueryService } from '@/core/QueryService.js';
import { RoleService } from '@/core/RoleService.js';
import { UserFollowingService } from '@/core/UserFollowingService.js';
import { MiChatRoomInvitation } from '@/models/ChatRoomInvitation.js';
import { Packed } from '@/misc/json-schema.js';
import { sqlLikeEscape } from '@/misc/sql-like-escape.js';
import { CustomEmojiService } from '@/core/CustomEmojiService.js';
import { emojiRegex } from '@/misc/emoji-regex.js';
import { NotificationService } from '@/core/NotificationService.js';
import { ModerationLogService } from '@/core/ModerationLogService.js';
import { ZalipChatConversationService } from '@/core/ZalipChatConversationService.js';

export type ChatConversationTarget = { userId?: string; roomId?: string };
export class ChatActionError extends Error {
	constructor(public readonly code: 'NO_SUCH_MESSAGE' | 'NO_SUCH_ROOM' | 'NO_SUCH_USER' | 'CANNOT_CHAT' | 'CONTENT_REQUIRED' | 'INVALID_CHAT_TARGET') { super(code); }
}

export function chatConversationKey(target: ChatConversationTarget): string {
	if ((target.userId == null) === (target.roomId == null)) throw new ChatActionError('INVALID_CHAT_TARGET');
	if (!/^[A-Za-z0-9]{1,32}$/u.test(target.userId ?? target.roomId ?? '')) throw new ChatActionError('INVALID_CHAT_TARGET');
	return target.userId ? `user:${target.userId}` : `room:${target.roomId}`;
}

const MAX_ROOM_MEMBERS = 50;
const MAX_REACTIONS_PER_MESSAGE = 100;
const isCustomEmojiRegexp = /^:([\w+-]+)(?:@\.)?:$/;

// TODO: ReactionServiceのやつと共通化
function normalizeEmojiString(x: string) {
	const match = emojiRegex.exec(x);
	if (match) {
		// 合字を含む1つの絵文字
		const unicode = match[0];

		// 異体字セレクタ除去
		return unicode.match('\u200d') ? unicode : unicode.replace(/\ufe0f/g, '');
	} else {
		throw new Error('invalid emoji');
	}
}

@Injectable()
export class ChatService {
	constructor(
		@Inject(DI.config)
		private config: Config,

		@Inject(DI.redis)
		private redisClient: Redis.Redis,

		@Inject(DI.usersRepository)
		private usersRepository: UsersRepository,

		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		@Inject(DI.chatApprovalsRepository)
		private chatApprovalsRepository: ChatApprovalsRepository,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		@Inject(DI.chatRoomInvitationsRepository)
		private chatRoomInvitationsRepository: ChatRoomInvitationsRepository,

		@Inject(DI.chatRoomMembershipsRepository)
		private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,

		@Inject(DI.mutingsRepository)
		private mutingsRepository: MutingsRepository,

		private userEntityService: UserEntityService,
		private chatEntityService: ChatEntityService,
		private idService: IdService,
		private globalEventService: GlobalEventService,
		private apRendererService: ApRendererService,
		private queueService: QueueService,
		private pushNotificationService: PushNotificationService,
		private notificationService: NotificationService,
		private userBlockingService: UserBlockingService,
		private queryService: QueryService,
		private roleService: RoleService,
		private userFollowingService: UserFollowingService,
		private customEmojiService: CustomEmojiService,
		private moderationLogService: ModerationLogService,
		@Inject(DI.db) private db: DataSource,
		@Inject(DI.driveFilesRepository) private driveFilesRepository: DriveFilesRepository,
		private zalipChatConversationService: ZalipChatConversationService,
	) {
	}

	@bindThis
	public async getChatAvailability(userId: MiUser['id']): Promise<{ read: boolean; write: boolean; }> {
		const policies = await this.roleService.getUserPolicies(userId);

		switch (policies.chatAvailability) {
			case 'available':
				return {
					read: true,
					write: true,
				};
			case 'readonly':
				return {
					read: true,
					write: false,
				};
			case 'unavailable':
				return {
					read: false,
					write: false,
				};
			default:
				throw new Error('invalid chat availability (unreachable)');
		}
	}

	/** getChatAvailabilityの糖衣。主にAPI呼び出し時に走らせて、権限的に問題ない場合はそのまま続行する */
	@bindThis
	public async checkChatAvailability(userId: MiUser['id'], permission: 'read' | 'write') {
		const policy = await this.getChatAvailability(userId);
		if (policy[permission] === false) {
			throw new Error('ROLE_PERMISSION_DENIED');
		}
	}

	@bindThis
	public async createMessageToUser(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toUser: MiUser, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
		replyId?: string | null;
		/** Internal forwarding only; never copied from public create parameters. */
		forwardedFromUserId?: string | null;
	}): Promise<Packed<'ChatMessageLiteFor1on1'>> {
		if (fromUser.id === toUser.id) {
			throw new Error('yourself');
		}

		const approvals = await this.chatApprovalsRepository.createQueryBuilder('approval')
			.where(new Brackets(qb => { // 自分が相手を許可しているか
				qb.where('approval.userId = :fromUserId', { fromUserId: fromUser.id })
					.andWhere('approval.otherId = :toUserId', { toUserId: toUser.id });
			}))
			.orWhere(new Brackets(qb => { // 相手が自分を許可しているか
				qb.where('approval.userId = :toUserId', { toUserId: toUser.id })
					.andWhere('approval.otherId = :fromUserId', { fromUserId: fromUser.id });
			}))
			.take(2)
			.getMany();

		const otherApprovedMe = approvals.some(approval => approval.userId === toUser.id);
		const iApprovedOther = approvals.some(approval => approval.userId === fromUser.id);

		if (!otherApprovedMe) {
			if (toUser.chatScope === 'none') {
				throw new Error('recipient is cannot chat (none)');
			} else if (toUser.chatScope === 'followers') {
				const isFollower = await this.userFollowingService.isFollowing(fromUser.id, toUser.id);
				if (!isFollower) {
					throw new Error('recipient is cannot chat (followers)');
				}
			} else if (toUser.chatScope === 'following') {
				const isFollowing = await this.userFollowingService.isFollowing(toUser.id, fromUser.id);
				if (!isFollowing) {
					throw new Error('recipient is cannot chat (following)');
				}
			} else if (toUser.chatScope === 'mutual') {
				const isMutual = await this.userFollowingService.isMutual(fromUser.id, toUser.id);
				if (!isMutual) {
					throw new Error('recipient is cannot chat (mutual)');
				}
			}
		}

		if (!(await this.getChatAvailability(toUser.id)).write) {
			throw new Error('recipient is cannot chat (policy)');
		}

		const [blocked, blocking] = await Promise.all([
			this.userBlockingService.checkBlocked(toUser.id, fromUser.id),
			this.userBlockingService.checkBlocked(fromUser.id, toUser.id),
		]);
		if (blocked || blocking) {
			throw new Error('blocked');
		}
		await this.validateReply(fromUser.id, params.replyId, { userId: toUser.id });

		const message = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toUserId: toUser.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
			replyId: params.replyId ?? null,
			forwardedFromUserId: params.forwardedFromUserId ?? null,
			updatedAt: null,
		} satisfies Partial<MiChatMessage>;

		const inserted = await this.chatMessagesRepository.insertOne(message);

		// 相手を許可しておく
		if (!iApprovedOther) {
			await this.chatApprovalsRepository.upsert({
				id: this.idService.gen(),
				userId: fromUser.id,
				otherId: toUser.id,
			}, ['userId', 'otherId']);
		}

		const packedMessage = await this.chatEntityService.packMessageLiteFor1on1(inserted);

		if (this.userEntityService.isLocalUser(toUser)) {
			const redisPipeline = this.redisClient.multi();
			redisPipeline.set(`newUserChatMessageExists:${toUser.id}:${fromUser.id}`, message.id);
			redisPipeline.sadd(`newChatMessagesExists:${toUser.id}`, `user:${fromUser.id}`);
			await this.execChatRedis(redisPipeline);
			this.globalEventService.publishMainStream(toUser.id, 'chatUnreadState', { hasUnread: true });
		}

		if (this.userEntityService.isLocalUser(fromUser)) {
			// 自分のストリーム
			this.globalEventService.publishChatUserStream(fromUser.id, toUser.id, 'message', packedMessage);
		}

		if (this.userEntityService.isLocalUser(toUser)) {
			// 相手のストリーム
			this.globalEventService.publishChatUserStream(toUser.id, fromUser.id, 'message', packedMessage);
		}

		// 3秒経っても既読にならなかったらイベント発行
		if (this.userEntityService.isLocalUser(toUser)) {
			setTimeout(() => { void this.notifyUnreadUserMessage(inserted, toUser).catch(() => { /* Markers remain authoritative if a delayed notification fails. */ }); }, 3000);
		}

		return packedMessage;
	}

	@bindThis
	public async createMessageToRoom(fromUser: { id: MiUser['id']; host: MiUser['host']; }, toRoom: MiChatRoom, params: {
		text?: string | null;
		file?: MiDriveFile | null;
		uri?: string | null;
		replyId?: string | null;
		/** Internal forwarding only. */
		forwardedFromUserId?: string | null;
	}): Promise<Packed<'ChatMessageLiteForRoom'>> {
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: toRoom.id })).map(m => ({
			userId: m.userId,
			isMuted: m.isMuted,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: toRoom.ownerId,
			isMuted: false,
		});

		if (!memberships.some(member => member.userId === fromUser.id)) {
			throw new Error('you are not a member of the room');
		}
		if (toRoom.isArchived) throw new ChatActionError('CANNOT_CHAT');
		await this.validateReply(fromUser.id, params.replyId, { roomId: toRoom.id });

		const membershipsOtherThanMe = memberships.filter(member => member.userId !== fromUser.id);

		const message = {
			id: this.idService.gen(),
			fromUserId: fromUser.id,
			toRoomId: toRoom.id,
			text: params.text ? params.text.trim() : null,
			fileId: params.file ? params.file.id : null,
			reads: [],
			uri: params.uri ?? null,
			replyId: params.replyId ?? null,
			forwardedFromUserId: params.forwardedFromUserId ?? null,
			updatedAt: null,
		} satisfies Partial<MiChatMessage>;

		const inserted = await this.chatMessagesRepository.insertOne(message);

		const packedMessage = await this.chatEntityService.packMessageLiteForRoom(inserted);

		const redisPipeline = this.redisClient.multi();
		for (const membership of membershipsOtherThanMe) {
			redisPipeline.set(`newRoomChatMessageExists:${membership.userId}:${toRoom.id}`, message.id);
			redisPipeline.sadd(`newChatMessagesExists:${membership.userId}`, `room:${toRoom.id}`);
		}
		await this.execChatRedis(redisPipeline);
		for (const member of membershipsOtherThanMe) this.globalEventService.publishMainStream(member.userId, 'chatUnreadState', { hasUnread: true });
		this.globalEventService.publishChatRoomStream(toRoom.id, 'message', packedMessage);

		// 3秒経っても既読にならなかったらイベント発行
		setTimeout(() => { void this.notifyUnreadRoomMessage(inserted, toRoom.id, membershipsOtherThanMe).catch(() => { /* Leave unread markers intact for the next state refresh. */ }); }, 3000);

		return packedMessage;
	}

	/** Current private-conversation access; staff status is not a participant privilege. */
	public async canViewUserConversation(userId: string, otherId: string): Promise<boolean> {
		if (userId === otherId || !(await this.getChatAvailability(userId)).read) return false;
		return !await this.userBlockingService.checkBlocked(userId, otherId) && !await this.userBlockingService.checkBlocked(otherId, userId);
	}

	public async canViewMessage(userId: string, message: MiChatMessage): Promise<boolean> {
		if (!(await this.getChatAvailability(userId)).read) return false;
		if (message.toRoomId) {
			const room = await this.findRoomById(message.toRoomId);
			if (room && await this.isRoomMember(room, userId)) return true;
		} else if (message.toUserId && (message.fromUserId === userId || message.toUserId === userId)) {
			return this.canViewUserConversation(userId, message.fromUserId === userId ? message.toUserId : message.fromUserId);
		}
		return false;
	}

	/** Only current participants' durable frontiers; an absent Redis marker is not proof of reading. */
	public async getConversationReadReceipts(userId: string, target: ChatConversationTarget): Promise<{ userId: string; messageId: string }[]> {
		chatConversationKey(target);
		if (target.userId) {
			if (!await this.canViewUserConversation(userId, target.userId)) return [];
			return this.db.query(`SELECT "userId", "readThroughId" AS "messageId" FROM "chat_read_cursor" WHERE "userId" = $1 AND "conversationKey" = $2`, [target.userId, `user:${userId}`]);
		}
		const room = await this.findRoomById(target.roomId!);
		if (!room || !(await this.getChatAvailability(userId)).read || !await this.isRoomMember(room, userId)) return [];
		return this.db.query(`SELECT c."userId", c."readThroughId" AS "messageId" FROM "chat_read_cursor" c INNER JOIN "user" u ON u."id" = c."userId" AND NOT u."isDeleted" AND NOT u."isSuspended" WHERE c."conversationKey" = $1 AND (c."userId" = $2 OR EXISTS (SELECT 1 FROM "chat_room_membership" member WHERE member."roomId" = $3 AND member."userId" = c."userId")) ORDER BY c."userId" LIMIT 51`, [`room:${room.id}`, room.ownerId, room.id]);
	}

	private messageMatchesTarget(userId: string, message: MiChatMessage, target: ChatConversationTarget): boolean {
		if (target.roomId) return message.toRoomId === target.roomId;
		return message.toRoomId == null && ((message.fromUserId === userId && message.toUserId === target.userId) || (message.fromUserId === target.userId && message.toUserId === userId));
	}

	private async validateReply(userId: string, replyId: string | null | undefined, target: ChatConversationTarget): Promise<void> {
		if (!replyId) return;
		const reply = await this.findMessageById(replyId);
		if (!reply || !this.messageMatchesTarget(userId, reply, target) || !await this.canViewMessage(userId, reply)) throw new ChatActionError('NO_SUCH_MESSAGE');
	}

	public async editMessage(me: MiUser, messageId: string, text: string | null): Promise<Packed<'ChatMessage'>> {
		await this.checkChatAvailability(me.id, 'write');
		const message = await this.findMyMessageById(me.id, messageId);
		if (!message || message.fromUserId !== me.id || !await this.canViewMessage(me.id, message)) throw new ChatActionError('NO_SUCH_MESSAGE');
		const normalized = text?.trim() || null;
		if ((normalized == null && message.fileId == null) || Array.from(normalized ?? '').length > 2000) throw new ChatActionError('CONTENT_REQUIRED');
		if (message.toRoomId && (await this.findRoomById(message.toRoomId))?.isArchived) throw new ChatActionError('CANNOT_CHAT');
		message.text = normalized;
		message.updatedAt = new Date();
		const result = await this.chatMessagesRepository.update({ id: message.id, fromUserId: me.id }, { text: normalized, updatedAt: message.updatedAt });
		if (!result.affected) throw new ChatActionError('NO_SUCH_MESSAGE');
		if (message.toRoomId) {
			this.globalEventService.publishChatRoomStream(message.toRoomId, 'updated', await this.chatEntityService.packMessageLiteForRoom(message));
		} else if (message.toUserId) {
			const packed = await this.chatEntityService.packMessageLiteFor1on1(message);
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'updated', packed);
			this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'updated', packed);
		}
		return this.chatEntityService.packMessageDetailed(message, me);
	}

	public async forwardMessage(me: MiUser, messageId: string, target: ChatConversationTarget): Promise<Packed<'ChatMessage'>> {
		chatConversationKey(target);
		await this.checkChatAvailability(me.id, 'write');
		const source = await this.findMessageById(messageId);
		if (!source || !await this.canViewMessage(me.id, source)) throw new ChatActionError('NO_SUCH_MESSAGE');
		const file = source.fileId ? await this.driveFilesRepository.findOneBy({ id: source.fileId }) : null;
		if (!source.text?.trim() && !file) throw new ChatActionError('CONTENT_REQUIRED');
		const params = { text: source.text, file, forwardedFromUserId: source.forwardedFromUserId ?? source.fromUserId };
		let created: { id: string };
		if (target.userId) {
			const recipient = await this.usersRepository.findOneBy({ id: target.userId });
			if (!recipient || recipient.isSuspended || recipient.isDeleted) throw new ChatActionError('NO_SUCH_USER');
			created = await this.createMessageToUser(me, recipient, params);
		} else {
			const room = await this.findRoomById(target.roomId!);
			if (!room) throw new ChatActionError('NO_SUCH_ROOM');
			created = await this.createMessageToRoom(me, room, params);
		}
		return this.chatEntityService.packMessageDetailed(created.id, me);
	}

	/** Ephemeral, throttled signals; no typing text or keystrokes are stored. */
	public async typing(userId: string, target: ChatConversationTarget, typing: boolean): Promise<void> {
		const key = chatConversationKey(target);
		await this.checkChatAvailability(userId, 'write');
		if (target.roomId) {
			const room = await this.findRoomById(target.roomId);
			if (!room || room.isArchived || !await this.isRoomMember(room, userId)) throw new ChatActionError('NO_SUCH_ROOM');
		} else {
			if (target.userId === userId || await this.userBlockingService.checkBlocked(target.userId!, userId) || await this.userBlockingService.checkBlocked(userId, target.userId!)) throw new ChatActionError('CANNOT_CHAT');
			// Do not expose typing presence to a stranger before a permitted conversation exists.
			if ((await this.userTimeline(userId, target.userId!, 1)).length === 0) return;
		}
		if (await this.redisClient.set(`chatTyping:${userId}:${key}`, '1', 'PX', 1500, 'NX') !== 'OK') return;
		if (target.roomId) this.globalEventService.publishChatRoomStream(target.roomId, 'typing', { userId, typing });
		else this.globalEventService.publishChatUserStream(target.userId!, userId, 'typing', { userId, typing });
	}

	public async markConversationRead(readerId: string, target: ChatConversationTarget, messageId?: string): Promise<{ readThroughId: string | null; hasUnread: boolean }> {
		const key = chatConversationKey(target);
		if (messageId != null && !/^[A-Za-z0-9]{1,32}$/u.test(messageId)) throw new ChatActionError('NO_SUCH_MESSAGE');
		await this.checkChatAvailability(readerId, 'read');
		if (target.roomId) {
			const room = await this.findRoomById(target.roomId);
			if (!room || !await this.isRoomMember(room, readerId)) throw new ChatActionError('NO_SUCH_ROOM');
		}
		const message = messageId ? await this.findMessageById(messageId) : (await this.chatMessagesRepository.createQueryBuilder('message')
			.where(target.roomId ? 'message.toRoomId = :roomId' : 'message.toRoomId IS NULL AND ((message.fromUserId = :me AND message.toUserId = :other) OR (message.fromUserId = :other AND message.toUserId = :me))', { roomId: target.roomId, me: readerId, other: target.userId })
			.orderBy('message.id', 'DESC').getOne());
		if (!message) {
			if (messageId) throw new ChatActionError('NO_SUCH_MESSAGE');
			return { readThroughId: null, hasUnread: await this.hasUnreadMessages(readerId) };
		}
		if (!this.messageMatchesTarget(readerId, message, target) || !await this.canViewMessage(readerId, message)) throw new ChatActionError('NO_SUCH_MESSAGE');
		const [cursor] = await this.db.query<{ readThroughId: string }[]>(`INSERT INTO "chat_read_cursor" ("userId", "conversationKey", "readThroughId", "updatedAt") VALUES ($1, $2, $3, now()) ON CONFLICT ("userId", "conversationKey") DO UPDATE SET "readThroughId" = GREATEST("chat_read_cursor"."readThroughId", EXCLUDED."readThroughId"), "updatedAt" = CASE WHEN "chat_read_cursor"."readThroughId" < EXCLUDED."readThroughId" THEN EXCLUDED."updatedAt" ELSE "chat_read_cursor"."updatedAt" END RETURNING "readThroughId"`, [readerId, key, message.id]);
		const markerKey = target.roomId ? `newRoomChatMessageExists:${readerId}:${target.roomId}` : `newUserChatMessageExists:${readerId}:${target.userId}`;
		await this.redisClient.eval(`local marker = redis.call('GET', KEYS[1]); if marker and marker <= ARGV[1] then redis.call('DEL', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[2]); end; return 1`, 2, markerKey, `newChatMessagesExists:${readerId}`, cursor.readThroughId, key);
		const receipt = { userId: readerId, messageId: cursor.readThroughId };
		if (target.roomId) this.globalEventService.publishChatRoomStream(target.roomId, 'read', receipt);
		else {
			this.globalEventService.publishChatUserStream(target.userId!, readerId, 'read', receipt);
			this.globalEventService.publishChatUserStream(readerId, target.userId!, 'read', receipt);
		}
		const hasUnread = await this.hasUnreadMessages(readerId);
		this.globalEventService.publishMainStream(readerId, 'chatUnreadState', { hasUnread });
		await this.publishChatReadState(readerId);
		return { readThroughId: cursor.readThroughId, hasUnread };
	}

	/** Redis EXEC can resolve successfully while an individual command contains an error. */
	private async execChatRedis(commands: Redis.ChainableCommander): Promise<[Error | null, unknown][]> {
		const results = await commands.exec();
		if (results == null || results.some(result => result.length !== 2 || result[0] != null)) throw new Error('CHAT_REDIS_OPERATION_FAILED');
		return results;
	}

	private async notifyUnreadUserMessage(message: MiChatMessage, recipient: MiUser): Promise<void> {
		const key = `newUserChatMessageExists:${recipient.id}:${message.fromUserId}`;
		if (await this.redisClient.get(key) !== message.id) return;
		const currentMessage = await this.findMessageById(message.id);
		if (!currentMessage || !await this.canViewUserConversation(recipient.id, message.fromUserId)) return;
		if (await this.zalipChatConversationService.isConversationMuted(recipient.id, { userId: message.fromUserId })) return;
		const packed = await this.chatEntityService.packMessageDetailed(currentMessage, recipient);
		// Packing may await database/cache work while another client marks this dialog read.
		if (await this.redisClient.get(key) !== message.id) return;
		if (!await this.chatMessagesRepository.existsBy({ id: message.id })) return;
		this.globalEventService.publishMainStream(recipient.id, 'newChatMessage', packed);
		this.pushNotificationService.pushNotification(recipient.id, 'newChatMessage', packed);
	}

	private async notifyUnreadRoomMessage(message: MiChatMessage, roomId: MiChatRoom['id'], members: { userId: MiUser['id'] }[]): Promise<void> {
		const readMarkers = async () => {
			const pipeline = this.redisClient.pipeline();
			for (const member of members) pipeline.get(`newRoomChatMessageExists:${member.userId}:${roomId}`);
			return this.execChatRedis(pipeline);
		};
		if ((await readMarkers()).every(marker => marker[1] !== message.id)) return;
		const currentMessage = await this.findMessageById(message.id);
		if (!currentMessage) return;
		const room = await this.findRoomById(roomId);
		if (!room) return;
		const packed = await this.chatEntityService.packMessageDetailed(currentMessage);
		const current = await readMarkers();
		for (let index = 0; index < members.length; index++) {
			if (current[index]?.[1] !== message.id) continue;
			if (!await this.isRoomMember(room, members[index].userId) || !(await this.getChatAvailability(members[index].userId)).read) continue;
			if (await this.zalipChatConversationService.isConversationMuted(members[index].userId, { roomId })) continue;
			if (!await this.chatMessagesRepository.existsBy({ id: message.id })) return;
			this.globalEventService.publishMainStream(members[index].userId, 'newChatMessage', packed);
			this.pushNotificationService.pushNotification(members[index].userId, 'newChatMessage', packed);
		}
	}

	@bindThis
	public async readUserChatMessage(
		readerId: MiUser['id'],
		senderId: MiUser['id'],
	): Promise<void> {
		if (!await this.canViewUserConversation(readerId, senderId)) throw new ChatActionError('CANNOT_CHAT');
		const frontiers = await this.persistLegacyReadCursor(readerId, { userId: senderId });
		await this.clearReadMarkers(readerId, frontiers);
		await this.publishChatReadState(readerId);
	}

	@bindThis
	public async readRoomChatMessage(
		readerId: MiUser['id'],
		roomId: MiChatRoom['id'],
	): Promise<void> {
		const room = await this.findRoomById(roomId);
		if (!room || !(await this.getChatAvailability(readerId)).read || !await this.isRoomMember(room, readerId)) throw new ChatActionError('NO_SUCH_ROOM');
		const frontiers = await this.persistLegacyReadCursor(readerId, { roomId });
		await this.clearReadMarkers(readerId, frontiers);
		await this.publishChatReadState(readerId);
	}

	@bindThis
	public async readAllChatMessages(
		readerId: MiUser['id'],
	): Promise<void> {
		// Only frontier rows are written, never a mass rewrite of private message history.
		await this.checkChatAvailability(readerId, 'read');
		const frontiers = await this.db.query<{ conversationKey: string; readThroughId: string }[]>(`INSERT INTO "chat_read_cursor" ("userId", "conversationKey", "readThroughId", "updatedAt")
			SELECT $1::varchar(32), scoped.key, MAX(scoped.id), now() FROM (
			 SELECT 'user:' || m."toUserId" AS key, m."id" AS id FROM "chat_message" m WHERE m."toRoomId" IS NULL AND m."fromUserId" = $1
			 UNION ALL SELECT 'user:' || m."fromUserId", m."id" FROM "chat_message" m WHERE m."toRoomId" IS NULL AND m."toUserId" = $1
			 UNION ALL SELECT 'room:' || m."toRoomId", m."id" FROM (SELECT "id" FROM "chat_room" WHERE "ownerId" = $1 UNION SELECT "roomId" FROM "chat_room_membership" WHERE "userId" = $1) rooms INNER JOIN "chat_message" m ON m."toRoomId" = rooms.id WHERE m."toRoomId" IS NOT NULL
			) scoped WHERE scoped.key NOT LIKE 'user:%' OR NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = $1 AND b."blockeeId" = substring(scoped.key FROM 6)) OR (b."blockeeId" = $1 AND b."blockerId" = substring(scoped.key FROM 6))) GROUP BY scoped.key
			ON CONFLICT ("userId", "conversationKey") DO UPDATE SET "readThroughId" = GREATEST("chat_read_cursor"."readThroughId", EXCLUDED."readThroughId"), "updatedAt" = EXCLUDED."updatedAt" RETURNING "conversationKey", "readThroughId"`, [readerId]);
		await this.clearReadMarkers(readerId, frontiers);
		await this.publishChatReadState(readerId);
	}

	private async persistLegacyReadCursor(readerId: string, target: ChatConversationTarget): Promise<{ conversationKey: string; readThroughId: string }[]> {
		const key = chatConversationKey(target);
		return this.db.query(`INSERT INTO "chat_read_cursor" ("userId", "conversationKey", "readThroughId", "updatedAt")
			SELECT $1::varchar(32), $2::varchar(64), MAX(m."id"), now() FROM "chat_message" m
			WHERE ${target.roomId ? 'm."toRoomId" = $3 AND EXISTS (SELECT 1 FROM "chat_room" r WHERE r."id" = m."toRoomId" AND (r."ownerId" = $1 OR EXISTS (SELECT 1 FROM "chat_room_membership" member WHERE member."roomId" = r."id" AND member."userId" = $1)))' : 'm."toRoomId" IS NULL AND ((m."fromUserId" = $1 AND m."toUserId" = $3) OR (m."fromUserId" = $3 AND m."toUserId" = $1))'} HAVING COUNT(*) > 0
			ON CONFLICT ("userId", "conversationKey") DO UPDATE SET "readThroughId" = GREATEST("chat_read_cursor"."readThroughId", EXCLUDED."readThroughId"), "updatedAt" = EXCLUDED."updatedAt" RETURNING "conversationKey", "readThroughId"`, [readerId, key, target.roomId ?? target.userId]);
	}

	private async clearReadMarkers(readerId: string, frontiers: { conversationKey: string; readThroughId: string }[]): Promise<void> {
		if (frontiers.length === 0) return;
		await this.redisClient.eval(`local frontiers = cjson.decode(ARGV[3]); for _, frontier in ipairs(frontiers) do local dialog = frontier.conversationKey; local user = string.match(dialog, '^user:([%w]+)$'); local room = string.match(dialog, '^room:([%w]+)$'); local key = user and (ARGV[1] .. user) or room and (ARGV[2] .. room); if key then local marker = redis.call('GET', key); if marker and marker <= frontier.readThroughId then redis.call('DEL', key); redis.call('SREM', KEYS[1], dialog); end; end; end; return #frontiers`, 1, `newChatMessagesExists:${readerId}`, `newUserChatMessageExists:${readerId}:`, `newRoomChatMessageExists:${readerId}:`, JSON.stringify(frontiers));
	}

	private async publishChatReadState(readerId: MiUser['id']): Promise<void> {
		// Reading one conversation must not clear the badge of another unread conversation.
		if (!await this.hasUnreadMessages(readerId)) this.globalEventService.publishMainStream(readerId, 'readAllChatMessages');
	}

	@bindThis
	public findMessageById(messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId });
	}

	@bindThis
	public findMyMessageById(userId: MiUser['id'], messageId: MiChatMessage['id']) {
		return this.chatMessagesRepository.findOneBy({ id: messageId, fromUserId: userId });
	}

	@bindThis
	public async hasPermissionToViewRoomTimeline(meId: MiUser['id'], room: MiChatRoom) {
		return this.isRoomMember(room, meId);
	}

	@bindThis
	public async deleteMessage(message: MiChatMessage) {
		await this.chatMessagesRepository.delete(message.id);

		if (message.toUserId) {
			const [fromUser, toUser] = await Promise.all([
				this.usersRepository.findOneByOrFail({ id: message.fromUserId }),
				this.usersRepository.findOneByOrFail({ id: message.toUserId }),
			]);

			if (this.userEntityService.isLocalUser(fromUser)) this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId, 'deleted', message.id);
			if (this.userEntityService.isLocalUser(toUser)) this.globalEventService.publishChatUserStream(message.toUserId, message.fromUserId, 'deleted', message.id);

			if (this.userEntityService.isLocalUser(fromUser) && this.userEntityService.isRemoteUser(toUser)) {
				//const activity = this.apRendererService.addContext(this.apRendererService.renderDelete(this.apRendererService.renderTombstone(`${this.config.url}/notes/${message.id}`), fromUser));
				//this.queueService.deliver(fromUser, activity, toUser.inbox);
			}
		} else if (message.toRoomId) {
			this.globalEventService.publishChatRoomStream(message.toRoomId, 'deleted', message.id);
		}
	}

	@bindThis
	public async userTimeline(meId: MiUser['id'], otherId: MiUser['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
			.setParameter('meId', meId)
			.setParameter('otherId', otherId);

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async roomTimeline(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatMessage['id'] | null, untilId?: MiChatMessage['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatMessagesRepository.createQueryBuilder('message'), sinceId, untilId)
			.andWhere('message.toRoomId = :roomId', { roomId })
			.leftJoinAndSelect('message.file', 'file')
			.leftJoinAndSelect('message.fromUser', 'fromUser');

		const messages = await query.take(limit).getMany();

		return messages;
	}

	@bindThis
	public async userHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		const history: MiChatMessage[] = [];

		const mutingQuery = this.mutingsRepository.createQueryBuilder('muting')
			.select('muting.muteeId')
			.where('muting.muterId = :muterId', { muterId: meId });

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => (m.fromUserId === meId) ? m.toUserId! : m.fromUserId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where(new Brackets(qb => {
					qb
						.where('message.fromUserId = :meId', { meId: meId })
						.orWhere('message.toUserId = :meId', { meId: meId });
				}))
				.andWhere('message.toRoomId IS NULL')
				.andWhere(`message.fromUserId NOT IN (${ mutingQuery.getQuery() })`)
				.andWhere(`message.toUserId NOT IN (${ mutingQuery.getQuery() })`);

			if (found.length > 0) {
				query.andWhere('message.fromUserId NOT IN (:...found)', { found: found });
				query.andWhere('message.toUserId NOT IN (:...found)', { found: found });
			}

			query.setParameters(mutingQuery.getParameters());

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async roomHistory(meId: MiUser['id'], limit: number): Promise<MiChatMessage[]> {
		// TODO: 一回のクエリにまとめられるかも
		const [memberRoomIds, ownedRoomIds] = await Promise.all([
			this.chatRoomMembershipsRepository.findBy({
				userId: meId,
			}).then(xs => xs.map(x => x.roomId)),
			this.chatRoomsRepository.findBy({
				ownerId: meId,
			}).then(xs => xs.map(x => x.id)),
		]);

		const roomIds = memberRoomIds.concat(ownedRoomIds);

		if (memberRoomIds.length === 0 && ownedRoomIds.length === 0) {
			return [];
		}

		const history: MiChatMessage[] = [];

		for (let i = 0; i < limit; i++) {
			const found = history.map(m => m.toRoomId!);

			const query = this.chatMessagesRepository.createQueryBuilder('message')
				.orderBy('message.id', 'DESC')
				.where('message.toRoomId IN (:...roomIds)', { roomIds });

			if (found.length > 0) {
				query.andWhere('message.toRoomId NOT IN (:...found)', { found: found });
			}

			const message = await query.getOne();

			if (message) {
				history.push(message);
			} else {
				break;
			}
		}

		return history;
	}

	@bindThis
	public async getUserReadStateMap(userId: MiUser['id'], otherIds: MiUser['id'][]) {
		const readStateMap: Record<MiUser['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const otherId of otherIds) {
			redisPipeline.get(`newUserChatMessageExists:${userId}:${otherId}`);
		}

		const markers = await this.execChatRedis(redisPipeline);

		for (let i = 0; i < otherIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[otherIds[i]] = marker == null;
		}
		for (const cursor of await this.getCursorUnreadStates(userId, otherIds.map(id => `user:${id}`))) readStateMap[cursor.conversationKey.slice(5)] = !cursor.hasUnread;

		return readStateMap;
	}

	@bindThis
	public async getRoomReadStateMap(userId: MiUser['id'], roomIds: MiChatRoom['id'][]) {
		const readStateMap: Record<MiChatRoom['id'], boolean> = {};

		const redisPipeline = this.redisClient.pipeline();

		for (const roomId of roomIds) {
			redisPipeline.get(`newRoomChatMessageExists:${userId}:${roomId}`);
		}

		const markers = await this.execChatRedis(redisPipeline);

		for (let i = 0; i < roomIds.length; i++) {
			const marker = markers[i][1];
			readStateMap[roomIds[i]] = marker == null;
		}
		for (const cursor of await this.getCursorUnreadStates(userId, roomIds.map(id => `room:${id}`))) readStateMap[cursor.conversationKey.slice(5)] = !cursor.hasUnread;

		return readStateMap;
	}

	@bindThis
	public async hasUnreadMessages(userId: MiUser['id']) {
		const cursors = await this.getCursorUnreadStates(userId);
		if (cursors.some(cursor => cursor.hasUnread)) return true;
		// Existing conversations without a frontier keep their old Redis semantics;
		// historical messages are never retroactively turned into unread messages.
		if (cursors.length === 0) return await this.redisClient.scard(`newChatMessagesExists:${userId}`) > 0;
		const markers = await this.redisClient.smembers(`newChatMessagesExists:${userId}`);
		const known = new Set(cursors.map(cursor => cursor.conversationKey));
		return markers.some(marker => !known.has(marker));
	}

	private async getCursorUnreadStates(userId: string, keys?: string[]): Promise<{ conversationKey: string; hasUnread: boolean }[]> {
		if (keys?.length === 0) return [];
		return this.db.query(`SELECT c."conversationKey", EXISTS (
			SELECT 1 FROM "chat_message" m WHERE m."id" > c."readThroughId" AND m."fromUserId" <> $1 AND (
				(c."conversationKey" LIKE 'user:%' AND m."toRoomId" IS NULL AND m."toUserId" = $1 AND m."fromUserId" = substring(c."conversationKey" from 6)) OR
				(c."conversationKey" LIKE 'room:%' AND m."toRoomId" = substring(c."conversationKey" from 6) AND EXISTS (SELECT 1 FROM "chat_room" r WHERE r."id" = m."toRoomId" AND (r."ownerId" = $1 OR EXISTS (SELECT 1 FROM "chat_room_membership" member WHERE member."roomId" = r."id" AND member."userId" = $1))))
			)) AS "hasUnread" FROM "chat_read_cursor" c WHERE c."userId" = $1${keys ? ' AND c."conversationKey" = ANY($2::varchar[])' : ''}`, keys ? [userId, keys] : [userId]);
	}

	@bindThis
	public async createRoom(owner: MiUser, params: Partial<{
		name: string;
		description: string;
	}>) {
		const room = {
			id: this.idService.gen(),
			name: params.name,
			description: params.description,
			ownerId: owner.id,
		} satisfies Partial<MiChatRoom>;

		const created = await this.chatRoomsRepository.insertOne(room);

		return created;
	}

	@bindThis
	public async hasPermissionToViewRoomInfo(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		if (await this.isRoomMember(room, meId)) {
			return true;
		}

		if (await this.chatRoomInvitationsRepository.findOneBy({ roomId: room.id, userId: meId })) {
			return true;
		}

		if (await this.roleService.isModerator({ id: meId })) {
			return true;
		}

		return false;
	}

	@bindThis
	public async hasPermissionToDeleteRoom(meId: MiUser['id'], room: MiChatRoom) {
		if (room.ownerId === meId) {
			return true;
		}

		const iAmModerator = await this.roleService.isModerator({ id: meId });
		if (iAmModerator) {
			return true;
		}

		return false;
	}

	@bindThis
	public async deleteRoom(room: MiChatRoom, deleter?: MiUser) {
		const memberships = (await this.chatRoomMembershipsRepository.findBy({ roomId: room.id })).map(m => ({
			userId: m.userId,
		})).concat({ // ownerはmembershipレコードを作らないため
			userId: room.ownerId,
		});

		// 未読フラグ削除
		const redisPipeline = this.redisClient.multi();
		for (const membership of memberships) {
			redisPipeline.del(`newRoomChatMessageExists:${membership.userId}:${room.id}`);
			redisPipeline.srem(`newChatMessagesExists:${membership.userId}`, `room:${room.id}`);
		}
		await this.execChatRedis(redisPipeline);
		await Promise.all(memberships.map(membership => this.publishChatReadState(membership.userId)));

		await this.chatRoomsRepository.delete(room.id);

		if (deleter) {
			const deleterIsModerator = await this.roleService.isModerator(deleter);

			if (deleterIsModerator) {
				this.moderationLogService.log(deleter, 'deleteChatRoom', {
					roomId: room.id,
					room: room,
				});
			}
		}
	}

	@bindThis
	public async findMyRoomById(ownerId: MiUser['id'], roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOneBy({ id: roomId, ownerId: ownerId });
	}

	@bindThis
	public async findRoomById(roomId: MiChatRoom['id']) {
		return this.chatRoomsRepository.findOne({
			where: { id: roomId },
			relations: { owner: true },
		});
	}

	@bindThis
	public async isRoomMember(room: MiChatRoom, userId: MiUser['id']) {
		if (room.ownerId === userId) return true;
		const membership = await this.chatRoomMembershipsRepository.findOneBy({ roomId: room.id, userId });
		return membership != null;
	}

	@bindThis
	public async createRoomInvitation(inviterId: MiUser['id'], roomId: MiChatRoom['id'], inviteeId: MiUser['id']) {
		if (inviterId === inviteeId) {
			throw new Error('yourself');
		}

		const room = await this.chatRoomsRepository.findOneByOrFail({ id: roomId, ownerId: inviterId });

		if (await this.isRoomMember(room, inviteeId)) {
			throw new Error('already member');
		}

		const existingInvitation = await this.chatRoomInvitationsRepository.findOneBy({ roomId, userId: inviteeId });
		if (existingInvitation) {
			throw new Error('already invited');
		}

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		// TODO: cehck block

		const invitation = {
			id: this.idService.gen(),
			roomId: room.id,
			userId: inviteeId,
		} satisfies Partial<MiChatRoomInvitation>;

		const created = await this.chatRoomInvitationsRepository.insertOne(invitation);

		this.notificationService.createNotification(inviteeId, 'chatRoomInvitationReceived', {
			invitationId: invitation.id,
		}, inviterId);

		return created;
	}

	@bindThis
	public async getSentRoomInvitationsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.roomId = :roomId', { roomId });

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async getOwnedRoomsWithPagination(ownerId: MiUser['id'], limit: number, sinceId?: MiChatRoom['id'] | null, untilId?: MiChatRoom['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomsRepository.createQueryBuilder('room'), sinceId, untilId)
			.andWhere('room.ownerId = :ownerId', { ownerId });

		const rooms = await query.take(limit).getMany();

		return rooms;
	}

	@bindThis
	public async getReceivedRoomInvitationsWithPagination(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomInvitation['id'] | null, untilId?: MiChatRoomInvitation['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomInvitationsRepository.createQueryBuilder('invitation'), sinceId, untilId)
			.andWhere('invitation.userId = :userId', { userId })
			.andWhere('invitation.ignored = FALSE');

		const invitations = await query.take(limit).getMany();

		return invitations;
	}

	@bindThis
	public async joinToRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });

		const membershipsCount = await this.chatRoomMembershipsRepository.countBy({ roomId });
		if (membershipsCount >= MAX_ROOM_MEMBERS) {
			throw new Error('room is full');
		}

		const membership = {
			id: this.idService.gen(),
			roomId: roomId,
			userId: userId,
		} satisfies Partial<MiChatRoomMembership>;

		// TODO: transaction
		await this.chatRoomMembershipsRepository.insertOne(membership);
		await this.chatRoomInvitationsRepository.delete(invitation.id);
	}

	@bindThis
	public async ignoreRoomInvitation(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const invitation = await this.chatRoomInvitationsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomInvitationsRepository.update(invitation.id, { ignored: true });
	}

	@bindThis
	public async leaveRoom(userId: MiUser['id'], roomId: MiChatRoom['id']) {
		const membership = await this.chatRoomMembershipsRepository.findOneByOrFail({ roomId, userId });
		await this.chatRoomMembershipsRepository.delete(membership.id);

		// 未読フラグを消す (「既読にする」というわけでもないのでreadメソッドは使わないでおく)
		const redisPipeline = this.redisClient.multi();
		redisPipeline.del(`newRoomChatMessageExists:${userId}:${roomId}`);
		redisPipeline.srem(`newChatMessagesExists:${userId}`, `room:${roomId}`);
		await this.execChatRedis(redisPipeline);
		await this.publishChatReadState(userId);
	}

	@bindThis
	public async muteRoom(userId: MiUser['id'], roomId: MiChatRoom['id'], mute: boolean) {
		await this.zalipChatConversationService.updatePreferences({ id: userId }, { roomId }, { isMuted: mute });
	}

	@bindThis
	public async updateRoom(room: MiChatRoom, params: {
		name?: string;
		description?: string;
	}): Promise<MiChatRoom> {
		return this.chatRoomsRepository.createQueryBuilder().update()
			.set(params)
			.where('id = :id', { id: room.id })
			.returning('*')
			.execute()
			.then((response) => {
				return response.raw[0];
			});
	}

	@bindThis
	public async getRoomMembershipsWithPagination(roomId: MiChatRoom['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.roomId = :roomId', { roomId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}

	@bindThis
	public async searchMessages(meId: MiUser['id'], query: string, limit: number, params: {
		userId?: MiUser['id'] | null;
		roomId?: MiChatRoom['id'] | null;
	}) {
		const q = this.chatMessagesRepository.createQueryBuilder('message');
		q.andWhere(`((message."toRoomId" IS NULL AND (message."fromUserId" = :viewerId OR message."toUserId" = :viewerId) AND NOT EXISTS (SELECT 1 FROM "blocking" b WHERE (b."blockerId" = message."fromUserId" AND b."blockeeId" = message."toUserId") OR (b."blockerId" = message."toUserId" AND b."blockeeId" = message."fromUserId"))) OR EXISTS (SELECT 1 FROM "chat_room" scoped_room WHERE scoped_room."id" = message."toRoomId" AND (scoped_room."ownerId" = :viewerId OR EXISTS (SELECT 1 FROM "chat_room_membership" scoped_member WHERE scoped_member."roomId" = scoped_room."id" AND scoped_member."userId" = :viewerId))))`, { viewerId: meId });

		if (params.userId) {
			q.andWhere(new Brackets(qb => {
				qb
					.where(new Brackets(qb => {
						qb
							.where('message.fromUserId = :meId')
							.andWhere('message.toUserId = :otherId');
					}))
					.orWhere(new Brackets(qb => {
						qb
							.where('message.fromUserId = :otherId')
							.andWhere('message.toUserId = :meId');
					}));
			}))
				.setParameter('meId', meId)
				.setParameter('otherId', params.userId);
		} else if (params.roomId) {
			q.andWhere('message.toRoomId = :roomId', { roomId: params.roomId });
		} else {
			const membershipsQuery = this.chatRoomMembershipsRepository.createQueryBuilder('membership')
				.select('membership.roomId')
				.where('membership.userId = :meId', { meId: meId });

			const ownedRoomsQuery = this.chatRoomsRepository.createQueryBuilder('room')
				.select('room.id')
				.where('room.ownerId = :meId', { meId });

			q.andWhere(new Brackets(qb => {
				qb
					.where('message.fromUserId = :meId')
					.orWhere('message.toUserId = :meId')
					.orWhere(`message.toRoomId IN (${membershipsQuery.getQuery()})`)
					.orWhere(`message.toRoomId IN (${ownedRoomsQuery.getQuery()})`);
			}));

			q.setParameters(membershipsQuery.getParameters());
			q.setParameters(ownedRoomsQuery.getParameters());
		}

		q.andWhere('LOWER(message.text) LIKE :q', { q: `%${ sqlLikeEscape(query.toLowerCase()) }%` });

		q.leftJoinAndSelect('message.file', 'file');
		q.leftJoinAndSelect('message.fromUser', 'fromUser');
		q.leftJoinAndSelect('message.toUser', 'toUser');
		q.leftJoinAndSelect('message.toRoom', 'toRoom');
		q.leftJoinAndSelect('toRoom.owner', 'toRoomOwner');

		const messages = await q.orderBy('message.id', 'DESC').take(limit).getMany();

		return messages;
	}

	@bindThis
	public async react(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else {
			const name = custom[1];
			const emoji = (await this.customEmojiService.localEmojisCache.fetch()).get(name);

			if (emoji == null) {
				throw new Error('no such emoji');
			} else {
				reaction = `:${name}:`;
			}
		}

		const message = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });
		if (!await this.canViewMessage(userId, message)) throw new ChatActionError('NO_SUCH_MESSAGE');

		if (message.fromUserId === userId) {
			throw new Error('cannot react to own message');
		}

		if (message.toRoomId === null && message.toUserId !== userId) {
			throw new Error('cannot react to others message');
		}

		if (message.reactions.length >= MAX_REACTIONS_PER_MESSAGE) {
			throw new Error('too many reactions');
		}
		if (message.reactions.includes(`${userId}/${reaction}`)) return;

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		if (room) {
			if (!(await this.isRoomMember(room, userId))) {
				throw new Error('cannot react to others message');
			}
		}

		const result = await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => `array_append("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.andWhere('cardinality("reactions") < :max', { max: MAX_REACTIONS_PER_MESSAGE })
			.andWhere('NOT (:record = ANY("reactions"))', { record: `${userId}/${reaction}` })
			.execute();
		if (!result.affected) return;

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'react', {
				messageId: message.id,
				userId,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'react', {
				messageId: message.id,
				userId,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'react', {
				messageId: message.id,
				userId,
				reaction,
			});
		}
	}

	@bindThis
	public async unreact(messageId: MiChatMessage['id'], userId: MiUser['id'], reaction_: string) {
		let reaction;

		const custom = reaction_.match(isCustomEmojiRegexp);

		if (custom == null) {
			reaction = normalizeEmojiString(reaction_);
		} else { // 削除されたカスタム絵文字のリアクションを削除したいかもしれないので絵文字の存在チェックはする必要なし
			const name = custom[1];
			reaction = `:${name}:`;
		}

		const message = await this.chatMessagesRepository.findOneByOrFail({ id: messageId });
		if (!await this.canViewMessage(userId, message)) throw new ChatActionError('NO_SUCH_MESSAGE');
		if (!message.reactions.includes(`${userId}/${reaction}`)) return;

		const room = message.toRoomId ? await this.chatRoomsRepository.findOneByOrFail({ id: message.toRoomId }) : null;

		const result = await this.chatMessagesRepository.createQueryBuilder().update()
			.set({
				reactions: () => `array_remove("reactions", '${userId}/${reaction}')`,
			})
			.where('id = :id', { id: message.id })
			.andWhere(':record = ANY("reactions")', { record: `${userId}/${reaction}` })
			.execute();
		if (!result.affected) return;

		if (room) {
			this.globalEventService.publishChatRoomStream(room.id, 'unreact', {
				messageId: message.id,
				userId,
				user: await this.userEntityService.pack(userId),
				reaction,
			});
		} else {
			this.globalEventService.publishChatUserStream(message.fromUserId, message.toUserId!, 'unreact', {
				messageId: message.id,
				userId,
				reaction,
			});
			this.globalEventService.publishChatUserStream(message.toUserId!, message.fromUserId, 'unreact', {
				messageId: message.id,
				userId,
				reaction,
			});
		}
	}

	@bindThis
	public async getMyMemberships(userId: MiUser['id'], limit: number, sinceId?: MiChatRoomMembership['id'] | null, untilId?: MiChatRoomMembership['id'] | null) {
		const query = this.queryService.makePaginationQuery(this.chatRoomMembershipsRepository.createQueryBuilder('membership'), sinceId, untilId)
			.andWhere('membership.userId = :userId', { userId });

		const memberships = await query.take(limit).getMany();

		return memberships;
	}
}
