/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ApiError } from '@/server/api/error.js';
import { ChatActionError } from '@/core/ChatService.js';

export const chatActionErrors = {
	noSuchMessage: { message: 'No such accessible message.', code: 'NO_SUCH_MESSAGE', id: 'df30bab4-a13b-47ab-baf2-045f730193c9', httpStatusCode: 404 },
	noSuchRoom: { message: 'No such accessible room.', code: 'NO_SUCH_ROOM', id: '1ad33340-d407-4228-ac7b-9da66475ff2c', httpStatusCode: 404 },
	noSuchUser: { message: 'No such recipient.', code: 'NO_SUCH_USER', id: 'c9fd16c6-41d5-4f10-918b-f1dc25214da1', httpStatusCode: 404 },
	cannotChat: { message: 'This chat action is not allowed.', code: 'CANNOT_CHAT', id: '07b73ede-83b9-4de9-bec1-f5317055ab71', httpStatusCode: 403 },
	contentRequired: { message: 'Message text or an existing attachment is required.', code: 'CONTENT_REQUIRED', id: 'd47fd22d-64e4-45a9-a1a2-1c686d470b99' },
	invalidTarget: { message: 'Exactly one conversation target is required.', code: 'INVALID_CHAT_TARGET', id: '20d16427-46c5-4d5e-b511-726cce6c687e' },
} as const;

export function throwChatActionError(error: unknown): never {
	if (error instanceof ChatActionError) {
		const definition = Object.values(chatActionErrors).find(value => value.code === error.code);
		if (definition) throw new ApiError(definition);
	}
	if (error instanceof Error && (error.message === 'ROLE_PERMISSION_DENIED' || error.message === 'blocked' || error.message === 'yourself' || error.message === 'you are not a member of the room' || error.message.startsWith('recipient is cannot chat'))) throw new ApiError(chatActionErrors.cannotChat);
	throw error;
}
