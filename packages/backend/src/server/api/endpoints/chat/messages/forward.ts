/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { chatActionErrors, throwChatActionError } from './action-errors.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'write:chat', prohibitMoved: true,
	limit: { duration: 3600000, max: 100, minInterval: 1000 },
	errors: chatActionErrors,
	res: { type: 'object', ref: 'ChatMessage', optional: false, nullable: false },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', maxLength: 2048 },
		messageId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		toUserId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		toRoomId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
	},
	required: ['messageId'],
	oneOf: [{ required: ['toUserId'], not: { required: ['toRoomId'] } }, { required: ['toRoomId'], not: { required: ['toUserId'] } }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.chatService.forwardMessage(me, ps.messageId, { userId: ps.toUserId, roomId: ps.toRoomId }); } catch (error) { throwChatActionError(error); }
		});
	}
}
