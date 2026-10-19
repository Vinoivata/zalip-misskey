/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import type { JsonObject } from '@/misc/json-value.js';
import { ChatService } from '@/core/ChatService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';
import type { ChatRoomsRepository } from '@/models/_.js';

@Injectable({ scope: Scope.TRANSIENT })
export class ChatRoomChannel extends Channel {
	public readonly chName = 'chatRoom';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:chat';
	private roomId: string;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		@Inject(DI.chatRoomsRepository)
		private chatRoomsRepository: ChatRoomsRepository,

		private chatService: ChatService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (typeof params.roomId !== 'string') return false;
		if (!this.user) return false;
		if (!/^[A-Za-z0-9]{1,32}$/u.test(params.roomId)) return false;
		if (!(await this.chatService.getChatAvailability(this.user.id)).read) return false;

		this.roomId = params.roomId;

		const room = await this.chatRoomsRepository.findOneBy({
			id: this.roomId,
		});

		if (room == null) return false;
		if (!(await this.chatService.isRoomMember(room, this.user.id))) return false;

		this.subscriber.on(`chatRoomStream:${this.roomId}`, this.onEvent);
		for (const receipt of await this.chatService.getConversationReadReceipts(this.user.id, { roomId: this.roomId })) this.send('read', receipt);

		return true;
	}

	@bindThis
	private async onEvent(data: GlobalEvents['chatRoom']['payload']) {
		if (!await this.isCurrentlyAllowed().catch(() => false)) {
			this.send('unavailable', null);
			this.connection.disconnectChannel(this.id);
			return;
		}
		this.send(data.type, data.body);
	}

	private async isCurrentlyAllowed(): Promise<boolean> {
		if (!this.user || !(await this.chatService.getChatAvailability(this.user.id)).read) return false;
		const room = await this.chatRoomsRepository.findOneBy({ id: this.roomId });
		return room != null && await this.chatService.isRoomMember(room, this.user.id);
	}

	@bindThis
	public async onMessage(type: string, body: unknown) {
		try {
			if (!await this.isCurrentlyAllowed()) throw new Error('CHANNEL_UNAVAILABLE');
			if (type === 'read') {
				const messageId = body && typeof body === 'object' && 'messageId' in body && typeof body.messageId === 'string' ? body.messageId : body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' ? body.id : undefined;
				await this.chatService.markConversationRead(this.user!.id, { roomId: this.roomId }, messageId);
			} else if (type === 'typing' && (!this.connection.token || this.connection.token.permission.includes('write:chat'))) {
				if (body && typeof body === 'object' && 'typing' in body && typeof body.typing === 'boolean') await this.chatService.typing(this.user!.id, { roomId: this.roomId }, body.typing);
			}
		} catch {
			this.send('unavailable', null);
			this.connection.disconnectChannel(this.id);
		}
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`chatRoomStream:${this.roomId}`, this.onEvent);
	}
}
