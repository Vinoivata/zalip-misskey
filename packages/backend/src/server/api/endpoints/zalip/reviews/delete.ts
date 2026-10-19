/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipReviewService } from '@/core/ZalipReviewService.js';
import { throwZalipReviewApiError, zalipReviewErrors } from './schema.js';

export const meta = {
	tags: ['zalip'],
	requireCredential: true,
	secure: true,
	limit: { duration: 60000, max: 30 },
	description: 'Soft-delete your review, or moderate a review. Native title rating and all library states remain unchanged.',
	errors: { noSuchWork: zalipReviewErrors.noSuchWork, noSuchReview: zalipReviewErrors.noSuchReview, cannotEdit: zalipReviewErrors.cannotEdit },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		reviewId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
	},
	required: ['reviewId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private reviews: ZalipReviewService) {
		super(meta, paramDef, async (ps, me) => {
			try { await this.reviews.delete(me, ps.reviewId); } catch (error) { throwZalipReviewApiError(error); }
		});
	}
}
