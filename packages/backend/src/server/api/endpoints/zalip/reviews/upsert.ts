/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipReviewService } from '@/core/ZalipReviewService.js';
import { packedZalipReviewSchema, throwZalipReviewApiError, zalipReviewErrors } from './schema.js';

export const meta = {
	tags: ['zalip'],
	requireCredential: true,
	secure: true,
	prohibitMoved: true,
	limit: { duration: 60000, max: 10, minInterval: 1000 },
	description: 'Create or edit your public review or essay for a published title, one of each format per author. Other formats are preserved. An omitted rating preserves your shared native library score; null clears only that score. No other library state is modified.',
	errors: { noSuchWork: zalipReviewErrors.noSuchWork, noSuchReview: zalipReviewErrors.noSuchReview, invalidReview: zalipReviewErrors.invalidReview, cannotEdit: zalipReviewErrors.cannotEdit },
	res: packedZalipReviewSchema,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		workId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		format: { type: 'string', enum: ['review', 'essay'] },
		title: { type: 'string', nullable: true, maxLength: 200 },
		body: { type: 'string', minLength: 20, maxLength: 12000 },
		isSpoiler: { type: 'boolean' },
		sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
		rating: { type: 'integer', nullable: true, minimum: 1, maximum: 10 },
	},
	required: ['workId', 'format', 'body', 'isSpoiler', 'sentiment'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private reviews: ZalipReviewService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.reviews.upsert(me, ps.workId, ps); } catch (error) { throwZalipReviewApiError(error); }
		});
	}
}
