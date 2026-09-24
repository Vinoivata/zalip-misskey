/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { zalipWorkKinds } from '@/models/ZalipWork.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

const workSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: { type: 'string', format: 'misskey:id' },
		slug: { type: 'string' },
		kind: { type: 'string', enum: ['movie', 'series', 'anime', 'animation'] },
		title: { type: 'string' },
		originalTitle: { type: 'string', nullable: true },
		description: { type: 'string', nullable: true },
		releaseYear: { type: 'integer', nullable: true },
		genres: { type: 'array', items: { type: 'string' } },
		runtimeMinutes: { type: 'integer', nullable: true },
		posterPath: { type: 'string', nullable: true },
		backdropPath: { type: 'string', nullable: true },
		logoPath: { type: 'string', nullable: true },
		trailerYoutubeKey: { type: 'string', nullable: true },
		communityRating: { type: 'number', nullable: true },
		ratingCount: { type: 'integer' },
	},
	required: ['id', 'slug', 'kind', 'title', 'originalTitle', 'description', 'releaseYear', 'genres', 'runtimeMinutes', 'posterPath', 'backdropPath', 'logoPath', 'trailerYoutubeKey', 'communityRating', 'ratingCount'],
} as const;

export const meta = {
	tags: ['zalip'],
	requireCredential: false,
	description: 'Search published Zalip titles by a literal title or original title fragment.',
	res: { type: 'array', optional: false, nullable: false, items: workSchema },
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		query: { type: 'string', minLength: 2, maxLength: 100 },
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		kind: { type: 'string', enum: zalipWorkKinds },
	},
	required: ['query'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps) => await this.zalipCatalogService.searchPublished(ps.query, ps.limit, ps.kind));
	}
}
