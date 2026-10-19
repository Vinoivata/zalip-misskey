/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ZalipChatConversationError } from '@/core/ZalipChatConversationService.js';
import { ApiError } from '@/server/api/error.js';

export const zalipChatConversationErrors = {
	noSuchConversation: { message: 'No such accessible chat conversation.', code: 'NO_SUCH_ZALIP_CHAT_CONVERSATION', id: 'c7748e3f-28d5-4c6b-99bf-f977d5dea3c4', httpStatusCode: 404 },
	invalidPreferences: { message: 'Invalid personal chat preferences.', code: 'INVALID_ZALIP_CHAT_PREFERENCES', id: '9c0fe8f7-b850-4aa0-ab59-0306216615b0' },
	invalidCursor: { message: 'Invalid or mismatched chat cursor.', code: 'INVALID_ZALIP_CHAT_CURSOR', id: 'c0149715-afc3-4666-8746-9e6dd3e25361' },
	unavailable: { message: 'Chat is unavailable for this account.', code: 'ZALIP_CHAT_UNAVAILABLE', id: 'd8cebee2-79d3-440c-b2ef-3af6ba2d6f92', httpStatusCode: 403 },
	unreadLimitExceeded: { message: 'Too many legacy unread conversations to enumerate safely.', code: 'ZALIP_CHAT_UNREAD_LIMIT_EXCEEDED', id: 'dbf1db4d-d3b8-466f-8c98-83c189f30561' },
} as const;

export function throwZalipChatConversationApiError(error: unknown): never {
	if (error instanceof ZalipChatConversationError) {
		const definition = Object.values(zalipChatConversationErrors).find(value => value.code === error.code);
		if (definition) throw new ApiError(definition);
	}
	throw error;
}

export const packedZalipChatConversationPreferencesSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		isPinned: { type: 'boolean', optional: false, nullable: false },
		isArchived: { type: 'boolean', optional: false, nullable: false },
		isMuted: { type: 'boolean', optional: false, nullable: false },
		pinnedMessageId: { type: 'string', optional: false, nullable: true, format: 'id' },
	},
	required: ['isPinned', 'isArchived', 'isMuted', 'pinnedMessageId'],
} as const;

export const packedZalipChatConversationSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		key: { type: 'string', optional: false, nullable: false },
		kind: { type: 'string', optional: false, nullable: false, enum: ['user', 'room'] },
		user: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
		room: { type: 'object', ref: 'ChatRoom', optional: false, nullable: true },
		lastMessage: { type: 'object', ref: 'ChatMessage', optional: false, nullable: true },
		unread: { type: 'boolean', optional: false, nullable: false },
		preferences: packedZalipChatConversationPreferencesSchema,
	},
	required: ['key', 'kind', 'user', 'room', 'lastMessage', 'unread', 'preferences'],
} as const;

export const zalipChatTargetProperties = {
	i: { type: 'string', minLength: 1, maxLength: 2048 },
	userId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
	roomId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
} as const;
