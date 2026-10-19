/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipChatConversationService } from '@/core/ZalipChatConversationService.js';
import { packedZalipChatConversationPreferencesSchema, throwZalipChatConversationApiError, zalipChatConversationErrors, zalipChatTargetProperties } from '../schema.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'read:chat',
	limit: { duration: 60000, max: 120 },
	description: 'Read only your personal pin, archive and notification settings for an accessible existing conversation. No read markers change.',
	errors: { noSuchConversation: zalipChatConversationErrors.noSuchConversation, invalidPreferences: zalipChatConversationErrors.invalidPreferences, unavailable: zalipChatConversationErrors.unavailable },
	res: packedZalipChatConversationPreferencesSchema,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: zalipChatTargetProperties,
	oneOf: [{ required: ['userId'] }, { required: ['roomId'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private conversations: ZalipChatConversationService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.conversations.showPreferences(me, ps); } catch (error) { throwZalipChatConversationApiError(error); }
		});
	}
}
