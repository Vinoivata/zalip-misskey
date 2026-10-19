/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { EventEmitter } from 'eventemitter3';
import type * as Misskey from 'misskey-js';

export const chatConversationEvents = new EventEmitter<{ changed: () => void }>();

export type ChatReplyPreview = { id: string; text: string | null; fromUser: Misskey.entities.UserLite; fileName: string | null };
export type ChatUiMessage = Omit<Misskey.entities.ChatMessageLite, 'fromUser' | 'reactions'> & {
	fromUser: Misskey.entities.UserLite;
	reactions: { reaction: string; userId: string; user: Misskey.entities.UserLite }[];
	updatedAt?: string | null;
	replyId?: string | null;
	reply?: ChatReplyPreview | null;
	forwardedFromUser?: Misskey.entities.UserLite | null;
	toRoom?: Misskey.entities.ChatRoom | null;
	toUser?: Misskey.entities.UserLite | null;
};
export type ChatConversationTarget = { userId?: string; roomId?: string };
export type ChatConversationMetadata = { title: string; user: Misskey.entities.UserDetailed | null; room: Misskey.entities.ChatRoom | null };
export type ChatConversationPreferences = { isPinned: boolean; isArchived: boolean; isMuted: boolean; pinnedMessageId: string | null };
export type ChatConversation = {
	key: string;
	kind: 'user' | 'room';
	user: Misskey.entities.UserLite | null;
	room: Misskey.entities.ChatRoom | null;
	lastMessage: Misskey.entities.ChatMessage | null;
	unread: boolean;
	preferences: ChatConversationPreferences;
};
export type ChatConversationsResponse = { items: ChatConversation[]; nextCursor: string | null };

/** Device drafts belong to an account as well as the peer; legacy unscoped drafts are never read. */
export function chatDraftKey(accountId: string, target: ChatConversationTarget): string {
	return `${accountId}:${target.userId ? `user:${target.userId}` : `room:${target.roomId ?? ''}`}`;
}

export function readChatDrafts(raw: string | null): Record<string, { text: string; file: Misskey.entities.DriveFile | null }> {
	try {
		const value: unknown = JSON.parse(raw ?? '{}');
		if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
		const result: Record<string, { text: string; file: Misskey.entities.DriveFile | null }> = {};
		for (const [key, draft] of Object.entries(value)) {
			if (!draft || typeof draft !== 'object' || typeof draft.text !== 'string' || draft.text.length > 4000) continue;
			result[key] = { text: draft.text, file: draft.file && typeof draft.file === 'object' && typeof draft.file.id === 'string' ? draft.file : null };
		}
		return result;
	} catch { return {}; }
}
