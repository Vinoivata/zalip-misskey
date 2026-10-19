/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipChatConversationService, type ZalipChatConversationPreferenceUpdate } from '@/core/ZalipChatConversationService.js';
import { packedZalipChatConversationPreferencesSchema, throwZalipChatConversationApiError, zalipChatConversationErrors, zalipChatTargetProperties } from '../schema.js';

export const meta = {
	tags: ['chat'], requireCredential: true, kind: 'write:chat',
	limit: { duration: 60000, max: 120, minInterval: 200 },
	description: 'Partially update only your conversation settings. Omitted fields are preserved; null clears your personal pinned message. Pinning does not pin a message for other room members, and muting does not mark anything read.',
	errors: { noSuchConversation: zalipChatConversationErrors.noSuchConversation, invalidPreferences: zalipChatConversationErrors.invalidPreferences, unavailable: zalipChatConversationErrors.unavailable },
	res: packedZalipChatConversationPreferencesSchema,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...zalipChatTargetProperties,
		isPinned: { type: 'boolean' },
		isArchived: { type: 'boolean' },
		isMuted: { type: 'boolean' },
		pinnedMessageId: { type: 'string', nullable: true, format: 'misskey:id', minLength: 1, maxLength: 32 },
	},
	oneOf: [{ required: ['userId'] }, { required: ['roomId'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private conversations: ZalipChatConversationService) {
		super(meta, paramDef, async (ps, me) => {
			const values = ps as ZalipChatConversationPreferenceUpdate;
			const fields = ['isPinned', 'isArchived', 'isMuted', 'pinnedMessageId'] as const;
			const update = Object.fromEntries(fields.filter(key => key in values).map(key => [key, values[key]])) as ZalipChatConversationPreferenceUpdate;
			try { return await this.conversations.updatePreferences(me, { userId: ps.userId, roomId: ps.roomId }, update); } catch (error) { throwZalipChatConversationApiError(error); }
		});
	}
}
