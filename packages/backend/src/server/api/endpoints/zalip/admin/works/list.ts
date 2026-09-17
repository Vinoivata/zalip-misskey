/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

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
		posterPath: { type: 'string', nullable: true },
		backdropPath: { type: 'string', nullable: true },
		trailerYoutubeKey: { type: 'string', nullable: true },
		publicationState: { type: 'string', enum: ['draft', 'published', 'archived'] },
		publishedAt: { type: 'string', nullable: true },
	},
	required: ['id', 'slug', 'kind', 'title', 'originalTitle', 'description', 'releaseYear', 'posterPath', 'backdropPath', 'trailerYoutubeKey', 'publicationState', 'publishedAt'],
} as const;

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'read:account',
	res: { type: 'array', optional: false, nullable: false, items: workSchema },
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'e9456a4e-67e3-4b55-a5eb-5f5b506d0e75',
			httpStatusCode: 403,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			return await this.zalipCatalogService.listAdminWorks(ps.limit);
		});
	}
}
