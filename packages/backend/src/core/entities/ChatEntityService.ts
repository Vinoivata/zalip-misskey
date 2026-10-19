/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import type { MiUser, ChatMessagesRepository, MiChatMessage, ChatRoomsRepository, MiChatRoom, MiChatRoomInvitation, ChatRoomInvitationsRepository, MiChatRoomMembership, ChatRoomMembershipsRepository } from '@/models/_.js';
import { awaitAll } from '@/misc/prelude/await-all.js';
import type { Packed } from '@/misc/json-schema.js';
import type { } from '@/models/Blocking.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { UserEntityService } from './UserEntityService.js';
import { DriveFileEntityService } from './DriveFileEntityService.js';
import { In } from 'typeorm';

type MessageContext = Pick<Packed<'ChatMessage'>, 'updatedAt' | 'replyId' | 'reply' | 'forwardedFromUser'>;

@Injectable()
export class ChatEntityService {
	constructor(
		@Inject(DI.chatMessagesRepository)
		private chatMessagesRepository: ChatMessagesRepository,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		@Inject(DI.chatRoomInvitationsRepository)
		private chatRoomInvitationsRepository: ChatRoomInvitationsRepository,

		@Inject(DI.chatRoomMembershipsRepository)
		private chatRoomMembershipsRepository: ChatRoomMembershipsRepository,

		private userEntityService: UserEntityService,
		private driveFileEntityService: DriveFileEntityService,
		private idService: IdService,
	) {
	}

	private async packMessageContext(message: MiChatMessage): Promise<MessageContext> {
		const reply = message.replyId ? (message.reply ?? await this.chatMessagesRepository.findOne({ where: { id: message.replyId }, relations: { fromUser: true, file: true } })) : null;
		const sameConversation = reply != null && (message.toRoomId != null
			? reply.toRoomId === message.toRoomId
			: reply.toRoomId == null && reply.toUserId != null && message.toUserId != null && (
				(reply.fromUserId === message.fromUserId && reply.toUserId === message.toUserId) ||
				(reply.fromUserId === message.toUserId && reply.toUserId === message.fromUserId)
			));
		return {
			updatedAt: message.updatedAt?.toISOString() ?? null,
			replyId: sameConversation ? reply.id : null,
			reply: sameConversation ? {
				id: reply.id,
				text: reply.text == null ? null : Array.from(reply.text).slice(0, 240).join(''),
				fromUser: await this.userEntityService.pack(reply.fromUser ?? reply.fromUserId),
				fileName: reply.file?.name ?? null,
			} : null,
			forwardedFromUser: message.forwardedFromUserId ? await this.userEntityService.pack(message.forwardedFromUser ?? message.forwardedFromUserId).catch(() => null) : null,
		};
	}

	/** Bounded bulk loading prevents a reply/forward query for every timeline row. */
	private async packMessageContexts(messages: MiChatMessage[], me?: { id: MiUser['id'] }): Promise<Map<string, MessageContext>> {
		const replyIds = [...new Set(messages.flatMap(message => message.replyId ? [message.replyId] : []))];
		const replies = replyIds.length > 0 ? await this.chatMessagesRepository.find({ where: { id: In(replyIds) }, relations: { fromUser: true, file: true } }) : [];
		const replyMap = new Map(replies.map(reply => [reply.id, reply]));
		const authors = new Map<string, MiUser | string>();
		for (const reply of replies) authors.set(reply.fromUserId, reply.fromUser ?? reply.fromUserId);
		for (const message of messages) if (message.forwardedFromUserId) authors.set(message.forwardedFromUserId, message.forwardedFromUser ?? message.forwardedFromUserId);
		const packedUsers = new Map((await this.userEntityService.packMany([...authors.values()], me)).map(user => [user.id, user]));
		return new Map(messages.map(message => {
			const reply = message.replyId ? replyMap.get(message.replyId) : undefined;
			const sameConversation = reply != null && (message.toRoomId != null ? reply.toRoomId === message.toRoomId : reply.toRoomId == null && reply.toUserId != null && message.toUserId != null && ((reply.fromUserId === message.fromUserId && reply.toUserId === message.toUserId) || (reply.fromUserId === message.toUserId && reply.toUserId === message.fromUserId)));
			const replyAuthor = reply ? packedUsers.get(reply.fromUserId) : undefined;
			const validReply = sameConversation && replyAuthor != null;
			return [message.id, { updatedAt: message.updatedAt?.toISOString() ?? null, replyId: validReply ? reply.id : null, reply: validReply ? { id: reply.id, text: reply.text == null ? null : Array.from(reply.text).slice(0, 240).join(''), fromUser: replyAuthor, fileName: reply.file?.name ?? null } : null, forwardedFromUser: message.forwardedFromUserId ? packedUsers.get(message.forwardedFromUserId) ?? null : null }];
		}));
	}

	@bindThis
	public async packMessageDetailed(
		src: MiChatMessage['id'] | MiChatMessage,
		me?: { id: MiUser['id'] },
		options?: {
			_hint_?: {
				packedFiles?: Map<MiChatMessage['fileId'], Packed<'DriveFile'> | null>;
				packedUsers?: Map<MiChatMessage['id'], Packed<'UserLite'>>;
				packedRooms?: Map<MiChatMessage['toRoomId'], Packed<'ChatRoom'> | null>;
				contexts?: Map<string, MessageContext>;
			};
		},
	): Promise<Packed<'ChatMessage'>> {
		const packedUsers = options?._hint_?.packedUsers;
		const packedFiles = options?._hint_?.packedFiles;
		const packedRooms = options?._hint_?.packedRooms;

		const message = typeof src === 'object' ? src : await this.chatMessagesRepository.findOneByOrFail({ id: src });

		// userは削除されている可能性があるのでnull許容
		const reactions: { userId: string; user: Packed<'UserLite'> | null; reaction: string; }[] = [];

		for (const record of message.reactions) {
			const [userId, reaction] = record.split('/');
			reactions.push({
				userId,
				user: packedUsers?.get(userId) ?? (await this.userEntityService.pack(userId).catch(() => null)),
				reaction,
			});
		}

		return {
			id: message.id,
			...(options?._hint_?.contexts?.get(message.id) ?? await this.packMessageContext(message)),
			createdAt: this.idService.parse(message.id).date.toISOString(),
			text: message.text,
			fromUserId: message.fromUserId,
			fromUser: packedUsers?.get(message.fromUserId) ?? (await this.userEntityService.pack(message.fromUser ?? message.fromUserId, me)),
			toUserId: message.toUserId,
			toUser: message.toUserId ? (packedUsers?.get(message.toUserId) ?? (await this.userEntityService.pack(message.toUser ?? message.toUserId, me))) : undefined,
			toRoomId: message.toRoomId,
			toRoom: message.toRoomId ? (packedRooms?.get(message.toRoomId) ?? (await this.packRoom(message.toRoom ?? message.toRoomId, me))) : undefined,
			fileId: message.fileId,
			file: message.fileId ? (packedFiles?.get(message.fileId) ?? (await this.driveFileEntityService.pack(message.file ?? message.fileId))) : null,
			reactions: reactions.filter((r): r is { userId: string; user: Packed<'UserLite'>; reaction: string; } => r.user != null),
		};
	}

	@bindThis
	public async packMessagesDetailed(
		messages: MiChatMessage[],
		me: { id: MiUser['id'] },
	) {
		if (messages.length === 0) return [];

		const excludeMe = (x: MiUser | string) => {
			if (typeof x === 'string') {
				return x !== me.id;
			} else {
				return x.id !== me.id;
			}
		};

		const users = [
			...messages.map((m) => m.fromUser ?? m.fromUserId).filter(excludeMe),
			...messages.map((m) => m.toUser ?? m.toUserId).filter(x => x != null).filter(excludeMe),
		];

		const reactedUserIds = messages.flatMap(x => x.reactions.map(r => r.split('/')[0]));

		for (const reactedUserId of reactedUserIds) {
			if (!users.some(x => typeof x === 'string' ? x === reactedUserId : x.id === reactedUserId)) {
				users.push(reactedUserId);
			}
		}

		// TODO: packedUsersに削除されたユーザーもnullとして含める
		const [packedUsers, packedFiles, packedRooms, contexts] = await Promise.all([
			this.userEntityService.packMany(users, me)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.driveFileEntityService.packMany(messages.map(m => m.file).filter(x => x != null))
				.then(files => new Map(files.map(f => [f.id, f]))),
			this.packRooms(messages.map(m => m.toRoom ?? m.toRoomId).filter(x => x != null), me)
				.then(rooms => new Map(rooms.map(r => [r.id, r]))),
			this.packMessageContexts(messages, me),
		]);

		return Promise.all(messages.map(message => this.packMessageDetailed(message, me, { _hint_: { packedUsers, packedFiles, packedRooms, contexts } })));
	}

	@bindThis
	public async packMessageLiteFor1on1(
		src: MiChatMessage['id'] | MiChatMessage,
		options?: {
			_hint_?: {
				packedFiles: Map<MiChatMessage['fileId'], Packed<'DriveFile'> | null>;
				contexts?: Map<string, MessageContext>;
			};
		},
	): Promise<Packed<'ChatMessageLiteFor1on1'>> {
		const packedFiles = options?._hint_?.packedFiles;

		const message = typeof src === 'object' ? src : await this.chatMessagesRepository.findOneByOrFail({ id: src });

		const reactions: { userId: string; reaction: string; }[] = [];

		for (const record of message.reactions) {
			const [userId, reaction] = record.split('/');
			reactions.push({
				userId,
				reaction,
			});
		}

		return {
			id: message.id,
			...(options?._hint_?.contexts?.get(message.id) ?? await this.packMessageContext(message)),
			createdAt: this.idService.parse(message.id).date.toISOString(),
			text: message.text,
			fromUserId: message.fromUserId,
			toUserId: message.toUserId!,
			fileId: message.fileId,
			file: message.fileId ? (packedFiles?.get(message.fileId) ?? (await this.driveFileEntityService.pack(message.file ?? message.fileId))) : null,
			reactions,
		};
	}

	@bindThis
	public async packMessagesLiteFor1on1(
		messages: MiChatMessage[],
	) {
		if (messages.length === 0) return [];

		const [packedFiles, contexts] = await Promise.all([
			this.driveFileEntityService.packMany(messages.map(m => m.file).filter(x => x != null))
				.then(files => new Map(files.map(f => [f.id, f]))),
			this.packMessageContexts(messages),
		]);

		return Promise.all(messages.map(message => this.packMessageLiteFor1on1(message, { _hint_: { packedFiles, contexts } })));
	}

	@bindThis
	public async packMessageLiteForRoom(
		src: MiChatMessage['id'] | MiChatMessage,
		options?: {
			_hint_?: {
				packedFiles: Map<MiChatMessage['fileId'], Packed<'DriveFile'> | null>;
				packedUsers: Map<MiUser['id'], Packed<'UserLite'>>;
				contexts?: Map<string, MessageContext>;
			};
		},
	): Promise<Packed<'ChatMessageLiteForRoom'>> {
		const packedFiles = options?._hint_?.packedFiles;
		const packedUsers = options?._hint_?.packedUsers;

		const message = typeof src === 'object' ? src : await this.chatMessagesRepository.findOneByOrFail({ id: src });

		// userは削除されている可能性があるのでnull許容
		const reactions: { userId: string; user: Packed<'UserLite'> | null; reaction: string; }[] = [];

		for (const record of message.reactions) {
			const [userId, reaction] = record.split('/');
			reactions.push({
				userId,
				user: packedUsers?.get(userId) ?? (await this.userEntityService.pack(userId).catch(() => null)),
				reaction,
			});
		}

		return {
			id: message.id,
			...(options?._hint_?.contexts?.get(message.id) ?? await this.packMessageContext(message)),
			createdAt: this.idService.parse(message.id).date.toISOString(),
			text: message.text,
			fromUserId: message.fromUserId,
			fromUser: packedUsers?.get(message.fromUserId) ?? (await this.userEntityService.pack(message.fromUser ?? message.fromUserId)),
			toRoomId: message.toRoomId!,
			fileId: message.fileId,
			file: message.fileId ? (packedFiles?.get(message.fileId) ?? (await this.driveFileEntityService.pack(message.file ?? message.fileId))) : null,
			reactions: reactions.filter((r): r is { userId: string; user: Packed<'UserLite'>; reaction: string; } => r.user != null),
		};
	}

	@bindThis
	public async packMessagesLiteForRoom(
		messages: MiChatMessage[],
	) {
		if (messages.length === 0) return [];

		const users = messages.map(x => x.fromUser ?? x.fromUserId);
		const reactedUserIds = messages.flatMap(x => x.reactions.map(r => r.split('/')[0]));

		for (const reactedUserId of reactedUserIds) {
			if (!users.some(x => typeof x === 'string' ? x === reactedUserId : x.id === reactedUserId)) {
				users.push(reactedUserId);
			}
		}

		const [packedUsers, packedFiles, contexts] = await Promise.all([
			this.userEntityService.packMany(users)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.driveFileEntityService.packMany(messages.map(m => m.file).filter(x => x != null))
				.then(files => new Map(files.map(f => [f.id, f]))),
			this.packMessageContexts(messages),
		]);

		return Promise.all(messages.map(message => this.packMessageLiteForRoom(message, { _hint_: { packedFiles, packedUsers, contexts } })));
	}

	@bindThis
	public async packRoom(
		src: MiChatRoom['id'] | MiChatRoom,
		me?: { id: MiUser['id'] },
		options?: {
			_hint_?: {
				packedOwners: Map<MiChatRoom['id'], Packed<'UserLite'>>;
				myMemberships?: Map<MiChatRoom['id'], MiChatRoomMembership | null | undefined>;
				myInvitations?: Map<MiChatRoom['id'], MiChatRoomInvitation | null | undefined>;
			};
		},
	): Promise<Packed<'ChatRoom'>> {
		const room = typeof src === 'object' ? src : await this.chatRoomsRepository.findOneByOrFail({ id: src });

		const membership = me && me.id !== room.ownerId ? (options?._hint_?.myMemberships?.get(room.id) ?? (await this.chatRoomMembershipsRepository.findOneBy({ roomId: room.id, userId: me.id }))) : null;
		const invitation = me && me.id !== room.ownerId ? (options?._hint_?.myInvitations?.get(room.id) ?? (await this.chatRoomInvitationsRepository.findOneBy({ roomId: room.id, userId: me.id }))) : null;

		return {
			id: room.id,
			createdAt: this.idService.parse(room.id).date.toISOString(),
			name: room.name,
			description: room.description,
			ownerId: room.ownerId,
			owner: options?._hint_?.packedOwners.get(room.ownerId) ?? (await this.userEntityService.pack(room.owner ?? room.ownerId, me)),
			isMuted: membership != null ? membership.isMuted : false,
			invitationExists: invitation != null,
		};
	}

	@bindThis
	public async packRooms(
		rooms: (MiChatRoom | MiChatRoom['id'])[],
		me: { id: MiUser['id'] },
	) {
		if (rooms.length === 0) return [];

		const _rooms = rooms.filter((room): room is MiChatRoom => typeof room !== 'string');
		if (_rooms.length !== rooms.length) {
			_rooms.push(
				...(await this.chatRoomsRepository.find({
					where: {
						id: In(rooms.filter((room): room is string => typeof room === 'string')),
					},
					relations: { owner: true },
				})),
			);
		}

		const owners = _rooms.map(x => x.owner ?? x.ownerId);

		const [packedOwners, myMemberships, myInvitations] = await Promise.all([
			this.userEntityService.packMany(owners, me)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.chatRoomMembershipsRepository.find({
				where: {
					roomId: In(_rooms.map(x => x.id)),
					userId: me.id,
				},
			}).then(memberships => new Map(_rooms.map(r => [r.id, memberships.find(m => m.roomId === r.id)]))),
			this.chatRoomInvitationsRepository.find({
				where: {
					roomId: In(_rooms.map(x => x.id)),
					userId: me.id,
				},
			}).then(invitations => new Map(_rooms.map(r => [r.id, invitations.find(i => i.roomId === r.id)]))),
		]);

		return Promise.all(_rooms.map(room => this.packRoom(room, me, { _hint_: { packedOwners, myMemberships, myInvitations } })));
	}

	@bindThis
	public async packRoomInvitation(
		src: MiChatRoomInvitation['id'] | MiChatRoomInvitation,
		me: { id: MiUser['id'] },
		options?: {
			_hint_?: {
				packedRooms: Map<MiChatRoomInvitation['roomId'], Packed<'ChatRoom'>>;
				packedUsers: Map<MiChatRoomInvitation['id'], Packed<'UserLite'>>;
			};
		},
	): Promise<Packed<'ChatRoomInvitation'>> {
		const invitation = typeof src === 'object' ? src : await this.chatRoomInvitationsRepository.findOneByOrFail({ id: src });

		return {
			id: invitation.id,
			createdAt: this.idService.parse(invitation.id).date.toISOString(),
			roomId: invitation.roomId,
			room: options?._hint_?.packedRooms.get(invitation.roomId) ?? (await this.packRoom(invitation.room ?? invitation.roomId, me)),
			userId: invitation.userId,
			user: options?._hint_?.packedUsers.get(invitation.userId) ?? (await this.userEntityService.pack(invitation.user ?? invitation.userId, me)),
		};
	}

	@bindThis
	public async packRoomInvitations(
		invitations: MiChatRoomInvitation[],
		me: { id: MiUser['id'] },
	) {
		if (invitations.length === 0) return [];

		return Promise.all(invitations.map(invitation => this.packRoomInvitation(invitation, me)));
	}

	@bindThis
	public async packRoomMembership(
		src: MiChatRoomMembership['id'] | MiChatRoomMembership,
		me: { id: MiUser['id'] },
		options?: {
			populateUser?: boolean;
			populateRoom?: boolean;
			_hint_?: {
				packedRooms: Map<MiChatRoomMembership['roomId'], Packed<'ChatRoom'>>;
				packedUsers: Map<MiChatRoomMembership['id'], Packed<'UserLite'>>;
			};
		},
	): Promise<Packed<'ChatRoomMembership'>> {
		const membership = typeof src === 'object' ? src : await this.chatRoomMembershipsRepository.findOneByOrFail({ id: src });

		return {
			id: membership.id,
			createdAt: this.idService.parse(membership.id).date.toISOString(),
			userId: membership.userId,
			user: options?.populateUser ? (options._hint_?.packedUsers.get(membership.userId) ?? (await this.userEntityService.pack(membership.user ?? membership.userId, me))) : undefined,
			roomId: membership.roomId,
			room: options?.populateRoom ? (options._hint_?.packedRooms.get(membership.roomId) ?? (await this.packRoom(membership.room ?? membership.roomId, me))) : undefined,
		};
	}

	@bindThis
	public async packRoomMemberships(
		memberships: MiChatRoomMembership[],
		me: { id: MiUser['id'] },
		options: {
			populateUser?: boolean;
			populateRoom?: boolean;
		} = {},
	) {
		if (memberships.length === 0) return [];

		const users = memberships.map(x => x.user ?? x.userId);
		const rooms = memberships.map(x => x.room ?? x.roomId);

		const [packedUsers, packedRooms] = await Promise.all([
			this.userEntityService.packMany(users, me)
				.then(users => new Map(users.map(u => [u.id, u]))),
			this.packRooms(rooms, me)
				.then(rooms => new Map(rooms.map(r => [r.id, r]))),
		]);

		return Promise.all(memberships.map(membership => this.packRoomMembership(membership, me, { ...options, _hint_: { packedUsers, packedRooms } })));
	}
}
