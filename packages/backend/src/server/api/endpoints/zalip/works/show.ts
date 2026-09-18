/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip'],

	requireCredential: false,

	description: 'Show one published Zalip cinema title by its canonical slug.',

	res: {
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
			galleryPaths: { type: 'array', items: { type: 'string' } },
			trailerYoutubeKey: { type: 'string', nullable: true },
			seasons: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'string', format: 'misskey:id' },
						seasonNumber: { type: 'integer' },
						title: { type: 'string' },
						originalTitle: { type: 'string', nullable: true },
						description: { type: 'string', nullable: true },
						posterPath: { type: 'string', nullable: true },
						airDate: { type: 'string', nullable: true },
						episodeCount: { type: 'integer', nullable: true },
					},
					required: ['id', 'seasonNumber', 'title', 'originalTitle', 'description', 'posterPath', 'airDate', 'episodeCount'],
				},
			},
		},
		required: ['id', 'slug', 'kind', 'title', 'originalTitle', 'description', 'releaseYear', 'genres', 'runtimeMinutes', 'posterPath', 'backdropPath', 'galleryPaths', 'trailerYoutubeKey', 'seasons'],
	},

	errors: {
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '9dc69f6d-916e-49e7-90d1-e66d9e336d45',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		slug: { type: 'string', minLength: 1, maxLength: 160 },
	},
	required: ['slug'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps) => {
			const work = await this.zalipCatalogService.showPublished(ps.slug);
			if (work == null) throw new ApiError(meta.errors.noSuchWork);
			return work;
		});
	}
}
