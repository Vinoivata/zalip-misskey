/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipChatConversationService } from '@/core/ZalipChatConversationService.js';
import { zalipChatConversationFilters } from '@/misc/zalip-chat-conversation-page.js';
import { packedZalipChatConversationSchema, throwZalipChatConversationApiError, zalipChatConversationErrors } from './schema.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60000, max: 120 },
	description: 'Page only your accessible conversations with server-side search and personal archive filters. This read never marks messages read. unread describes your incoming state, not recipient read receipts.',
	errors: { invalidPreferences: zalipChatConversationErrors.invalidPreferences, invalidCursor: zalipChatConversationErrors.invalidCursor, unavailable: zalipChatConversationErrors.unavailable, unreadLimitExceeded: zalipChatConversationErrors.unreadLimitExceeded },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: { type: 'array', optional: false, nullable: false, items: packedZalipChatConversationSchema },
			nextCursor: { type: 'string', optional: false, nullable: true },
		},
		required: ['items', 'nextCursor'],
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		filter: { type: 'string', enum: zalipChatConversationFilters, default: 'all' },
		query: { type: 'string', maxLength: 80 },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		cursor: { type: 'string', minLength: 1, maxLength: 768 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private conversations: ZalipChatConversationService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.conversations.list(me, ps); } catch (error) { throwZalipChatConversationApiError(error); }
		});
	}
}
