/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id' },
			episodeNumber: { type: 'integer' },
			title: { type: 'string' },
		},
		required: ['id', 'episodeNumber', 'title'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'd9b0cdb1-f286-4dff-8fb4-dc833c658ba4',
			httpStatusCode: 403,
		},
		noSuchSeason: {
			message: 'No such Zalip season.',
			code: 'NO_SUCH_ZALIP_SEASON',
			id: '0e21667f-133e-4474-903b-43f9fb21521b',
			httpStatusCode: 404,
		},
		episodeTaken: {
			message: 'This Zalip season already has that episode number.',
			code: 'ZALIP_EPISODE_NUMBER_TAKEN',
			id: 'c2fe2ce0-b39d-42f8-b98b-9a0376cbe5d2',
			httpStatusCode: 409,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		seasonNumber: { type: 'integer', minimum: 0, maximum: 10000 },
		episodeNumber: { type: 'integer', minimum: 0, maximum: 100000 },
		title: { type: 'string', minLength: 1, maxLength: 256 },
		originalTitle: { type: 'string', nullable: true, maxLength: 256 },
		description: { type: 'string', nullable: true, maxLength: 8192 },
		airDate: { type: 'string', nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
		runtimeMinutes: { type: 'integer', nullable: true, minimum: 0, maximum: 10000 },
	},
	required: ['workId', 'seasonNumber', 'episodeNumber', 'title', 'originalTitle', 'description', 'airDate', 'runtimeMinutes'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const episode = await this.zalipCatalogService.createManualEpisode(ps.workId, ps.seasonNumber, ps);
			if (episode === 'no-such-season') throw new ApiError(meta.errors.noSuchSeason);
			if (episode === 'duplicate') throw new ApiError(meta.errors.episodeTaken);
			return { id: episode.id, episodeNumber: episode.episodeNumber, title: episode.title };
		});
	}
}
