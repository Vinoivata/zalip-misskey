/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ApiError } from '@/server/api/error.js';
import { ZalipReviewError } from '@/core/ZalipReviewService.js';

export const zalipReviewErrors = {
	noSuchWork: { message: 'No such published Zalip work.', code: 'NO_SUCH_ZALIP_WORK', id: 'e3dcf477-467a-4614-a7b3-e50662377674', httpStatusCode: 404 },
	noSuchReview: { message: 'No such visible Zalip review.', code: 'NO_SUCH_ZALIP_REVIEW', id: 'c48ea2ce-af7c-4d93-9db3-c0112e269431', httpStatusCode: 404 },
	invalidReview: { message: 'Invalid Zalip review.', code: 'INVALID_ZALIP_REVIEW', id: 'ce313035-e561-48f7-bdb3-90c3220d3387' },
	cannotEdit: { message: 'Cannot change this Zalip review.', code: 'CANNOT_EDIT_ZALIP_REVIEW', id: '8b48e6e4-f9c2-4ec8-a24d-85ccbb88bd6c', httpStatusCode: 403 },
	cannotVoteOwn: { message: 'Cannot vote on your own Zalip review.', code: 'CANNOT_VOTE_OWN_ZALIP_REVIEW', id: '2d449571-82a5-4caf-aa77-6973f118b26f' },
} as const;

export function throwZalipReviewApiError(error: unknown): never {
	if (error instanceof ZalipReviewError) {
		const definition = Object.values(zalipReviewErrors).find(value => value.code === error.code);
		if (definition) throw new ApiError(definition);
	}
	throw error;
}

export const packedZalipReviewSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: { type: 'string', optional: false, nullable: false, format: 'id' },
		workId: { type: 'string', optional: false, nullable: false, format: 'id' },
		user: {
			type: 'object', optional: false, nullable: false,
			ref: 'UserLite',
		},
		format: { type: 'string', optional: false, nullable: false, enum: ['review', 'essay'] },
		title: { type: 'string', optional: false, nullable: true },
		body: { type: 'string', optional: false, nullable: false },
		isSpoiler: { type: 'boolean', optional: false, nullable: false },
		sentiment: { type: 'string', optional: false, nullable: false, enum: ['positive', 'neutral', 'negative'] },
		rating: { type: 'integer', optional: false, nullable: true, minimum: 1, maximum: 10 },
		helpfulCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
		unhelpfulCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
		myVote: { type: 'string', optional: false, nullable: true, enum: ['helpful', 'unhelpful', null] },
		createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		updatedAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
		canEdit: { type: 'boolean', optional: false, nullable: false },
		canDelete: { type: 'boolean', optional: false, nullable: false },
	},
	required: ['id', 'workId', 'user', 'format', 'title', 'body', 'isSpoiler', 'sentiment', 'rating', 'helpfulCount', 'unhelpfulCount', 'myVote', 'createdAt', 'updatedAt', 'canEdit', 'canDelete'],
} as const;
