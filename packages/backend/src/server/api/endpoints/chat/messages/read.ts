/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ChatService } from '@/core/ChatService.js';
import { chatActionErrors, throwChatActionError } from './action-errors.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60000, max: 240 },
	errors: chatActionErrors,
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			readThroughId: { type: 'string', optional: false, nullable: true },
			hasUnread: { type: 'boolean', optional: false, nullable: false },
		},
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', maxLength: 2048 },
		messageId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		userId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		roomId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
	},
	required: ['messageId'],
	oneOf: [{ required: ['userId'], not: { required: ['roomId'] } }, { required: ['roomId'], not: { required: ['userId'] } }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private chatService: ChatService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.chatService.markConversationRead(me.id, { userId: ps.userId, roomId: ps.roomId }, ps.messageId); } catch (error) { throwChatActionError(error); }
		});
	}
}
