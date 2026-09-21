/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { zalipWorkKinds } from '@/models/ZalipWork.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { zalipCatalogueGenreLimit, ZalipCatalogService } from '@/core/ZalipCatalogService.js';

const workSchema = {
	type: 'object',
	optional: false,
	nullable: false,
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
		trailerYoutubeKey: { type: 'string', nullable: true },
	},
	required: ['id', 'slug', 'kind', 'title', 'originalTitle', 'description', 'releaseYear', 'genres', 'runtimeMinutes', 'posterPath', 'backdropPath', 'trailerYoutubeKey'],
} as const;

export const meta = {
	tags: ['zalip'],

	requireCredential: false,

	description: 'List published Zalip cinema titles.',

	res: {
		type: 'array',
		optional: false,
		nullable: false,
		items: workSchema,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
		/** @deprecated Use genres for one or more genre facets. */
		genre: { type: 'string', minLength: 1, maxLength: 80 },
		genres: { type: 'array', minItems: 1, maxItems: zalipCatalogueGenreLimit, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
		/** @deprecated Use kinds for one or more content formats. */
		kind: { type: 'string', enum: zalipWorkKinds },
		kinds: { type: 'array', minItems: 1, maxItems: zalipWorkKinds.length, uniqueItems: true, items: { type: 'string', enum: zalipWorkKinds } },
		query: { type: 'string', minLength: 2, maxLength: 100 },
		yearFrom: { type: 'integer', minimum: 1888, maximum: 2200 },
		yearTo: { type: 'integer', minimum: 1888, maximum: 2200 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps) => {
			return await this.zalipCatalogService.listPublished(ps.limit, {
				genres: Array.from(new Set([...(ps.genre ? [ps.genre] : []), ...(ps.genres ?? [])])).slice(0, zalipCatalogueGenreLimit),
				kinds: [...(ps.kind ? [ps.kind] : []), ...(ps.kinds ?? [])],
				query: ps.query,
				yearFrom: ps.yearFrom,
				yearTo: ps.yearTo,
			});
		});
	}
}
