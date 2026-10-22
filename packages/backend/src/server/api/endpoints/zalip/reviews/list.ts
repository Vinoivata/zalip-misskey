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
	requireCredential: false,
	limit: { duration: 60000, max: 120 },
	description: 'List public title reviews and native rating statistics, respecting blocks and mutes. Rating totals include all public title scores, not a second review vote.',
	errors: { noSuchWork: zalipReviewErrors.noSuchWork, invalidReview: zalipReviewErrors.invalidReview },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: { type: 'array', optional: false, nullable: false, items: packedZalipReviewSchema },
			total: { type: 'integer', optional: false, nullable: false, minimum: 0 },
			summary: {
				type: 'object', optional: false, nullable: false,
				properties: {
					reviewCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
					positiveCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
					neutralCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
					negativeCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
					averageRating: { type: 'number', optional: false, nullable: true, minimum: 1, maximum: 10 },
					ratingCount: { type: 'integer', optional: false, nullable: false, minimum: 0 },
					histogram: { type: 'array', optional: false, nullable: false, items: { type: 'integer', optional: false, nullable: false, minimum: 0 } },
				},
				required: ['reviewCount', 'positiveCount', 'neutralCount', 'negativeCount', 'averageRating', 'ratingCount', 'histogram'],
			},
			myReview: { ...packedZalipReviewSchema, nullable: true },
			myReviews: { type: 'array', optional: false, nullable: false, items: packedZalipReviewSchema },
		},
		required: ['items', 'total', 'summary', 'myReview', 'myReviews'],
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		workId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
		format: { type: 'string', enum: ['review', 'essay'] },
		sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
		hideSpoilers: { type: 'boolean', default: false },
		sort: { type: 'string', enum: ['newest', 'helpful'], default: 'newest' },
		limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
		offset: { type: 'integer', minimum: 0, maximum: 1000, default: 0 },
	},
	required: ['workId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private reviews: ZalipReviewService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.reviews.list(ps.workId, me, ps); } catch (error) { throwZalipReviewApiError(error); }
		});
	}
}
