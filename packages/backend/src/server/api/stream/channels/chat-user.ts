/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable, Scope } from '@nestjs/common';
import { bindThis } from '@/decorators.js';
import type { GlobalEvents } from '@/core/GlobalEventService.js';
import type { JsonObject } from '@/misc/json-value.js';
import { ChatService } from '@/core/ChatService.js';
import Channel, { type ChannelRequest } from '../channel.js';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class ChatUserChannel extends Channel {
	public readonly chName = 'chatUser';
	public static shouldShare = false;
	public static requireCredential = true as const;
	public static kind = 'read:chat';
	private otherId: string;

	constructor(
		@Inject(REQUEST)
		request: ChannelRequest,

		private chatService: ChatService,
	) {
		super(request);
	}

	@bindThis
	public async init(params: JsonObject): Promise<boolean> {
		if (typeof params.otherId !== 'string') return false;
		if (!this.user) return false;
		if (params.otherId === this.user.id) return false;
		if (!/^[A-Za-z0-9]{1,32}$/u.test(params.otherId)) return false;
		if (!await this.chatService.canViewUserConversation(this.user.id, params.otherId)) return false;

		this.otherId = params.otherId;

		this.subscriber.on(`chatUserStream:${this.user.id}-${this.otherId}`, this.onEvent);
		for (const receipt of await this.chatService.getConversationReadReceipts(this.user.id, { userId: this.otherId })) this.send('read', receipt);

		return true;
	}

	@bindThis
	private async onEvent(data: GlobalEvents['chatUser']['payload']) {
		const allowed = this.user != null && await this.chatService.canViewUserConversation(this.user.id, this.otherId).catch(() => false);
		if (!allowed) {
			this.send('unavailable', null);
			this.connection.disconnectChannel(this.id);
			return;
		}
		this.send(data.type, data.body);
	}

	@bindThis
	public async onMessage(type: string, body: unknown) {
		if (!this.user || !this.otherId) return;
		try {
			if (type === 'read') {
				const messageId = body && typeof body === 'object' && 'messageId' in body && typeof body.messageId === 'string' ? body.messageId : body && typeof body === 'object' && 'id' in body && typeof body.id === 'string' ? body.id : undefined;
				await this.chatService.markConversationRead(this.user.id, { userId: this.otherId }, messageId);
			} else if (type === 'typing' && (!this.connection.token || this.connection.token.permission.includes('write:chat'))) {
				if (body && typeof body === 'object' && 'typing' in body && typeof body.typing === 'boolean') await this.chatService.typing(this.user.id, { userId: this.otherId }, body.typing);
			}
		} catch {
			// A denied/revoked channel must not produce an unhandled promise or private error payload.
			this.send('unavailable', null);
			this.connection.disconnectChannel(this.id);
		}
	}

	@bindThis
	public dispose() {
		this.subscriber.off(`chatUserStream:${this.user!.id}-${this.otherId}`, this.onEvent);
	}
}
