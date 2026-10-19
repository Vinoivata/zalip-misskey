/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Bounded public-author attribution only; forwarding never exposes the original conversation. */
export const chatMessageContextProperties = {
	updatedAt: { type: 'string', format: 'date-time', optional: false, nullable: true },
	replyId: { type: 'string', optional: false, nullable: true },
	reply: {
		type: 'object', optional: false, nullable: true,
		properties: {
			id: { type: 'string', optional: false, nullable: false },
			text: { type: 'string', optional: false, nullable: true },
			fromUser: { type: 'object', ref: 'UserLite', optional: false, nullable: false },
			fileName: { type: 'string', optional: false, nullable: true },
		},
	},
	forwardedFromUser: { type: 'object', ref: 'UserLite', optional: false, nullable: true },
} as const;
