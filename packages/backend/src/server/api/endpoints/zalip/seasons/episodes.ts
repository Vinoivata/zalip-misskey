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
	description: 'List canonical episode metadata for one published Zalip season. Playback sources are not included.',
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id' },
				episodeNumber: { type: 'integer' },
				title: { type: 'string' },
				originalTitle: { type: 'string', nullable: true },
				description: { type: 'string', nullable: true },
				airDate: { type: 'string', nullable: true },
				stillPath: { type: 'string', nullable: true },
				runtimeMinutes: { type: 'integer', nullable: true },
				discussionNoteId: { type: 'string', format: 'misskey:id', nullable: true },
			},
			required: ['id', 'episodeNumber', 'title', 'originalTitle', 'description', 'airDate', 'stillPath', 'runtimeMinutes', 'discussionNoteId'],
		},
	},
	errors: {
		noSuchSeason: {
			message: 'No such published Zalip season.',
			code: 'NO_SUCH_ZALIP_SEASON',
			id: 'ac475caa-6291-4d6b-ae23-2f2d7ca13bb0',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		slug: { type: 'string', minLength: 1, maxLength: 160 },
		seasonNumber: { type: 'integer', minimum: 0, maximum: 10000 },
	},
	required: ['slug', 'seasonNumber'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps) => {
			const episodes = await this.zalipCatalogService.listPublishedSeasonEpisodes(ps.slug, ps.seasonNumber);
			if (episodes == null) throw new ApiError(meta.errors.noSuchSeason);
			return episodes;
		});
	}
}
