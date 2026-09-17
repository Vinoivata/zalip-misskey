/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { ZalipTmdbImportService } from '@/core/ZalipTmdbImportService.js';

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			added: { type: 'integer' },
			updated: { type: 'integer' },
			total: { type: 'integer' },
		},
		required: ['added', 'updated', 'total'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: '74e66e2e-3641-47ac-8d99-bbe5ed952c7d',
			httpStatusCode: 403,
		},
		noSuchImportableSeason: {
			message: 'No TMDB-backed Zalip season was found for this work.',
			code: 'NO_SUCH_ZALIP_TMDB_SEASON',
			id: '4d4afc1e-6d6c-4a34-a9f6-5869a60e2ce5',
			httpStatusCode: 404,
		},
		tmdbNotConfigured: {
			message: 'TMDB import is not configured on this server.',
			code: 'ZALIP_TMDB_NOT_CONFIGURED',
			id: '0ea7822c-98f2-46dc-a8f8-6212970fe92a',
			httpStatusCode: 503,
		},
		tmdbNotFound: {
			message: 'TMDB did not return this season.',
			code: 'ZALIP_TMDB_SEASON_NOT_FOUND',
			id: '11b7c5ef-8b94-4e1f-9159-98b36a50f235',
			httpStatusCode: 404,
		},
		tmdbUnavailable: {
			message: 'TMDB is temporarily unavailable or returned invalid data.',
			code: 'ZALIP_TMDB_UNAVAILABLE',
			id: '929c126d-cf3c-470a-b69b-02c6464d11d6',
			httpStatusCode: 502,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		seasonNumber: { type: 'integer', minimum: 0, maximum: 10000 },
	},
	required: ['workId', 'seasonNumber'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
		private zalipTmdbImportService: ZalipTmdbImportService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const target = await this.zalipCatalogService.getTmdbSeasonSyncTarget(ps.workId, ps.seasonNumber);
			if (target == null) throw new ApiError(meta.errors.noSuchImportableSeason);

			const result = await this.zalipTmdbImportService.importSeasonEpisodes(target);
			switch (result.kind) {
				case 'synced': return { added: result.added, updated: result.updated, total: result.total };
				case 'not-configured': throw new ApiError(meta.errors.tmdbNotConfigured);
				case 'not-found': throw new ApiError(meta.errors.tmdbNotFound);
				case 'upstream-failure': throw new ApiError(meta.errors.tmdbUnavailable);
			}
		});
	}
}
