/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipTmdbImportService } from '@/core/ZalipTmdbImportService.js';

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id' },
			slug: { type: 'string' },
			publicationState: { type: 'string', enum: ['draft'] },
			title: { type: 'string' },
		},
		required: ['id', 'slug', 'publicationState', 'title'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'bddf7ac4-401d-44a8-a8c6-7c7674516b15',
			httpStatusCode: 403,
		},
		tmdbNotConfigured: {
			message: 'TMDB import is not configured on this server.',
			code: 'ZALIP_TMDB_NOT_CONFIGURED',
			id: 'c52055a3-edc9-47bb-8a23-3785ffb31ceb',
			httpStatusCode: 503,
		},
		tmdbNotFound: {
			message: 'TMDB did not return this work.',
			code: 'ZALIP_TMDB_NOT_FOUND',
			id: 'fd1bbd54-e117-4c64-a2cc-d278763d00df',
			httpStatusCode: 404,
		},
		tmdbDuplicate: {
			message: 'This TMDB work is already in the Zalip catalogue.',
			code: 'ZALIP_TMDB_DUPLICATE',
			id: '7c7ec7a7-15b1-443e-a273-68e4074ad785',
			httpStatusCode: 409,
		},
		tmdbUnavailable: {
			message: 'TMDB is temporarily unavailable or returned invalid data.',
			code: 'ZALIP_TMDB_UNAVAILABLE',
			id: '85e70c9c-2cbe-4474-8d31-bf11769fb094',
			httpStatusCode: 502,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		tmdbMediaType: { type: 'string', enum: ['movie', 'tv'] },
		tmdbId: { type: 'integer', minimum: 1, maximum: 2147483647 },
	},
	required: ['tmdbMediaType', 'tmdbId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipTmdbImportService: ZalipTmdbImportService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);

			const result = await this.zalipTmdbImportService.importDraft(ps.tmdbMediaType, ps.tmdbId);
			switch (result.kind) {
				case 'created':
					return {
						id: result.work.id,
						slug: result.work.slug,
						publicationState: 'draft',
						title: result.work.title,
					};
				case 'not-configured': throw new ApiError(meta.errors.tmdbNotConfigured);
				case 'not-found': throw new ApiError(meta.errors.tmdbNotFound);
				case 'duplicate': throw new ApiError(meta.errors.tmdbDuplicate);
				case 'upstream-failure': throw new ApiError(meta.errors.tmdbUnavailable);
			}
		});
	}
}
