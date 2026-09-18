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
			updated: { type: 'boolean' },
		},
		required: ['updated'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'b060fed9-bb84-4a2b-a8f6-a31757c2c3f0',
			httpStatusCode: 403,
		},
		noSuchTmdbWork: {
			message: 'No TMDB-backed Zalip work was found.',
			code: 'NO_SUCH_ZALIP_TMDB_WORK',
			id: 'fdd817f9-36a6-4bb8-a1b9-c3498932d5ae',
			httpStatusCode: 404,
		},
		tmdbNotConfigured: {
			message: 'TMDB import is not configured on this server.',
			code: 'ZALIP_TMDB_NOT_CONFIGURED',
			id: '2ef6c547-3cea-4c31-8583-cba9a333324a',
			httpStatusCode: 503,
		},
		tmdbNotFound: {
			message: 'TMDB did not return this work.',
			code: 'ZALIP_TMDB_NOT_FOUND',
			id: 'b49a5e54-9372-4470-8d67-c6a1beb87100',
			httpStatusCode: 404,
		},
		tmdbUnavailable: {
			message: 'TMDB is temporarily unavailable or returned invalid data.',
			code: 'ZALIP_TMDB_UNAVAILABLE',
			id: '58950166-a21c-4631-a419-4a1fb6d5d5ee',
			httpStatusCode: 502,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
	},
	required: ['workId'],
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
			const target = await this.zalipCatalogService.getTmdbMediaSyncTarget(ps.workId);
			if (target == null) throw new ApiError(meta.errors.noSuchTmdbWork);

			const result = await this.zalipTmdbImportService.refreshMedia(target);
			switch (result.kind) {
				case 'updated': return { updated: true };
				case 'not-configured': throw new ApiError(meta.errors.tmdbNotConfigured);
				case 'not-found': throw new ApiError(meta.errors.tmdbNotFound);
				case 'upstream-failure': throw new ApiError(meta.errors.tmdbUnavailable);
			}
		});
	}
}
