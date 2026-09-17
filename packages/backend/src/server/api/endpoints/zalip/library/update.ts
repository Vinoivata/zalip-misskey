/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip', 'account'],

	requireCredential: true,

	kind: 'write:account',

	res: {
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			status: { type: 'string', enum: ['watching', 'planned', 'completed', 'on_hold', 'dropped'] },
			episodesWatched: { type: 'integer' },
			personalRating: { type: 'integer', nullable: true },
			isFavorite: { type: 'boolean' },
			isReleaseSubscribed: { type: 'boolean' },
			work: { type: 'object', additionalProperties: true },
		},
		required: ['status', 'episodesWatched', 'personalRating', 'isFavorite', 'isReleaseSubscribed', 'work'],
	},

	errors: {
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: 'bf346fb7-bb3e-4f6d-9989-5d945da8befa',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		status: { type: 'string', enum: ['watching', 'planned', 'completed', 'on_hold', 'dropped'] },
		episodesWatched: { type: 'integer', minimum: 0 },
		personalRating: { type: 'integer', nullable: true, minimum: 1, maximum: 10 },
		isFavorite: { type: 'boolean' },
		isReleaseSubscribed: { type: 'boolean' },
	},
	required: ['workId', 'status'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const entry = await this.zalipCatalogService.updateLibrary(me, ps.workId, {
				status: ps.status,
				episodesWatched: ps.episodesWatched,
				personalRating: ps.personalRating,
				isFavorite: ps.isFavorite,
				isReleaseSubscribed: ps.isReleaseSubscribed,
			});
			if (entry == null) throw new ApiError(meta.errors.noSuchWork);
			return entry;
		});
	}
}
