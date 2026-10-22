/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipFeedError, ZalipFeedService } from '@/core/ZalipFeedService.js';
import { packedZalipReviewSchema } from '../reviews/schema.js';

const workSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: { type: 'string', optional: false, nullable: false },
		slug: { type: 'string', optional: false, nullable: false },
		kind: { type: 'string', optional: false, nullable: false, enum: ['movie', 'series', 'anime', 'animation'] },
		title: { type: 'string', optional: false, nullable: false },
		posterPath: { type: 'string', optional: false, nullable: true },
		releaseYear: { type: 'integer', optional: false, nullable: true },
	},
	required: ['id', 'slug', 'kind', 'title', 'posterPath', 'releaseYear'],
} as const;
const commonProperties = {
	key: { type: 'string', optional: false, nullable: false },
	id: { type: 'string', optional: false, nullable: false },
	createdAt: { type: 'string', optional: false, nullable: false, format: 'date-time' },
	work: workSchema,
} as const;

export const meta = {
	tags: ['zalip'],
	requireCredential: false,
	limit: { duration: 60000, max: 60 },
	description: 'Read canonical public title comments and reviews, or essays. Never manufactures Notes. Cursor scope includes the viewer, section and spoiler filter; privacy is reapplied on every page.',
	errors: {
		invalidFeed: { message: 'Invalid Zalip feed options.', code: 'INVALID_ZALIP_FEED', id: '1758cd3f-4877-4528-ad4d-652f28537878' },
		invalidCursor: { message: 'Invalid Zalip feed cursor.', code: 'INVALID_ZALIP_FEED_CURSOR', id: '9716749c-0f1f-4cf1-aa5e-81743f08da42' },
	},
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: {
				type: 'array', optional: false, nullable: false,
				items: {
					optional: false, nullable: false,
					anyOf: [
						{
							type: 'object', optional: false, nullable: false,
							properties: {
								...commonProperties,
								type: { type: 'string', optional: false, nullable: false, enum: ['comment'] },
								note: { type: 'object', optional: false, nullable: false, ref: 'Note' },
								discussion: {
									type: 'object', optional: false, nullable: false,
									properties: {
										rootNoteId: { type: 'string', optional: false, nullable: false },
										episodeId: { type: 'string', optional: false, nullable: true },
										episodeNumber: { type: 'integer', optional: false, nullable: true },
										seasonNumber: { type: 'integer', optional: false, nullable: true },
									},
									required: ['rootNoteId', 'episodeId', 'episodeNumber', 'seasonNumber'],
								},
							},
							required: ['key', 'id', 'createdAt', 'type', 'work', 'note', 'discussion'],
						},
						{
							type: 'object', optional: false, nullable: false,
							properties: {
								...commonProperties,
								type: { type: 'string', optional: false, nullable: false, enum: ['review', 'essay'] },
								review: packedZalipReviewSchema,
							},
							required: ['key', 'id', 'createdAt', 'type', 'work', 'review'],
						},
					],
				},
			},
			nextCursor: { type: 'string', optional: false, nullable: true },
		},
		required: ['items', 'nextCursor'],
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		section: { type: 'string', enum: ['discussions', 'essays'], default: 'discussions' },
		limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
		hideSpoilers: { type: 'boolean', default: true },
		cursor: { type: 'string', minLength: 1, maxLength: 1024 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private feed: ZalipFeedService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.feed.list(me, ps); } catch (error) {
				if (error instanceof ZalipFeedError) throw new ApiError(error.code === 'INVALID_ZALIP_FEED_CURSOR' ? meta.errors.invalidCursor : meta.errors.invalidFeed);
				throw error;
			}
		});
	}
}
