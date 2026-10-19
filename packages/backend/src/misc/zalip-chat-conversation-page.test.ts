/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { decodeZalipChatConversationCursor, encodeZalipChatConversationCursor, isZalipChatConversationKey, zalipChatConversationScope } from './zalip-chat-conversation-page.js';

describe('private conversation keyset cursors', () => {
	const scope = zalipChatConversationScope('owner', 'people', 'Alice');
	const anchor = { snapshot: 'zzzz', pinned: true, activity: 'aaaa', key: 'user:alice' };
	it('round-trips an opaque scoped snapshot and tie breaker', () => expect(decodeZalipChatConversationCursor(encodeZalipChatConversationCursor(scope, anchor), scope)).toEqual(anchor));
	it.each([
		zalipChatConversationScope('other', 'people', 'Alice'),
		zalipChatConversationScope('owner', 'unread', 'Alice'),
		zalipChatConversationScope('owner', 'people', 'Bob'),
	])('rejects another owner, filter or search scope %s', other => expect(() => decodeZalipChatConversationCursor(encodeZalipChatConversationCursor(scope, anchor), other)).toThrow('INVALID_ZALIP_CHAT_CURSOR'));
	it.each(['', '!', 'a'.repeat(769), Buffer.from('null').toString('base64url'), Buffer.from(JSON.stringify([1, scope, 'zzzz', true, 'zzzzz', 'user:alice'])).toString('base64url')])('rejects malformed or future-anchor cursors %s', value => expect(() => decodeZalipChatConversationCursor(value, scope)).toThrow('INVALID_ZALIP_CHAT_CURSOR'));
	it.each(['room:abc', 'user:abc123'])('accepts only native target keys %s', value => expect(isZalipChatConversationKey(value)).toBe(true));
	it.each(['user:', 'room:../abc', 'admin:abc', 'user:' + 'x'.repeat(33), null])('rejects an unsafe target key %s', value => expect(isZalipChatConversationKey(value)).toBe(false));
});
