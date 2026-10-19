/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';

export const zalipChatConversationFilters = ['all', 'unread', 'people', 'groups', 'archived'] as const;
export type ZalipChatConversationFilter = typeof zalipChatConversationFilters[number];
export type ZalipChatConversationAnchor = { snapshot: string; pinned: boolean; activity: string; key: string };

const idPattern = /^[A-Za-z0-9]{1,32}$/u;
export function isZalipChatConversationKey(value: unknown): value is string {
	return typeof value === 'string' && /^(?:user|room):[A-Za-z0-9]{1,32}$/u.test(value);
}

export function zalipChatConversationScope(userId: string, filter: ZalipChatConversationFilter, query: string): string {
	return createHash('sha256').update(JSON.stringify([userId, filter, query])).digest('hex');
}

export function encodeZalipChatConversationCursor(scope: string, value: ZalipChatConversationAnchor): string {
	return Buffer.from(JSON.stringify([1, scope, value.snapshot, value.pinned, value.activity, value.key])).toString('base64url');
}

export function decodeZalipChatConversationCursor(cursor: string, scope: string): ZalipChatConversationAnchor {
	const invalid = () => new Error('INVALID_ZALIP_CHAT_CURSOR');
	if (!cursor || cursor.length > 768 || !/^[A-Za-z0-9_-]+$/u.test(cursor)) throw invalid();
	let value: unknown;
	try {
		const bytes = Buffer.from(cursor, 'base64url');
		if (bytes.toString('base64url') !== cursor) throw invalid();
		value = JSON.parse(bytes.toString('utf8'));
	} catch { throw invalid(); }
	if (!Array.isArray(value) || value.length !== 6 || value[0] !== 1 || value[1] !== scope ||
		typeof value[2] !== 'string' || !idPattern.test(value[2]) || typeof value[3] !== 'boolean' ||
		typeof value[4] !== 'string' || !idPattern.test(value[4]) || value[4] > value[2] || !isZalipChatConversationKey(value[5])) throw invalid();
	return { snapshot: value[2], pinned: value[3], activity: value[4], key: value[5] };
}
