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
	limit: { duration: 60000, max: 60, minInterval: 300 },
	description: 'Toggle helpfulness on another visible review. Repeating the selected value removes the vote; null explicitly clears it.',
	errors: zalipReviewErrors,
	res: packedZalipReviewSchema,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		reviewId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		value: { type: 'string', nullable: true, enum: ['helpful', 'unhelpful', null] },
	},
	required: ['reviewId', 'value'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private reviews: ZalipReviewService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.reviews.vote(me, ps.reviewId, ps.value); } catch (error) { throwZalipReviewApiError(error); }
		});
	}
}
