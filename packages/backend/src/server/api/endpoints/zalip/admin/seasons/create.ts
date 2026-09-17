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
			seasonNumber: { type: 'integer' },
			title: { type: 'string' },
		},
		required: ['id', 'seasonNumber', 'title'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: '739c57f4-c0a5-4586-9927-15559d25abe8',
			httpStatusCode: 403,
		},
		noSuchWork: {
			message: 'No such Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '13706161-2660-4b11-958b-410338531f7b',
			httpStatusCode: 404,
		},
		seasonTaken: {
			message: 'This Zalip work already has that season number.',
			code: 'ZALIP_SEASON_NUMBER_TAKEN',
			id: 'a0278f04-3ee8-49b0-a330-849f92745019',
			httpStatusCode: 409,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		seasonNumber: { type: 'integer', minimum: 0, maximum: 10000 },
		title: { type: 'string', minLength: 1, maxLength: 256 },
		originalTitle: { type: 'string', nullable: true, maxLength: 256 },
		description: { type: 'string', nullable: true, maxLength: 8192 },
		airDate: { type: 'string', nullable: true, pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
	},
	required: ['workId', 'seasonNumber', 'title', 'originalTitle', 'description', 'airDate'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const season = await this.zalipCatalogService.createManualSeason(ps.workId, ps);
			if (season === 'no-such-work') throw new ApiError(meta.errors.noSuchWork);
			if (season === 'duplicate') throw new ApiError(meta.errors.seasonTaken);
			return { id: season.id, seasonNumber: season.seasonNumber, title: season.title };
		});
	}
}
