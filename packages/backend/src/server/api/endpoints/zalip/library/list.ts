/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

const libraryEntrySchema = {
	type: 'object',
	optional: false,
	nullable: false,
	properties: {
		status: { type: 'string', enum: ['watching', 'planned', 'completed', 'on_hold', 'dropped'] },
		episodesWatched: { type: 'integer' },
		personalRating: { type: 'integer', nullable: true },
		isFavorite: { type: 'boolean' },
		isReleaseSubscribed: { type: 'boolean' },
		work: {
			type: 'object',
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
		},
	},
	required: ['status', 'episodesWatched', 'personalRating', 'isFavorite', 'isReleaseSubscribed', 'work'],
} as const;

export const meta = {
	tags: ['zalip', 'account'],

	requireCredential: true,

	kind: 'read:account',

	res: {
		type: 'array',
		optional: false,
		nullable: false,
		items: libraryEntrySchema,
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			return await this.zalipCatalogService.listLibrary(me);
		});
	}
}
