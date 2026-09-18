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
	description: 'Explicitly refreshes provider-owned facts and artwork for at most 100 TMDB-backed Zalip works.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			total: { type: 'integer' },
			updated: { type: 'integer' },
			failed: { type: 'integer' },
		},
		required: ['total', 'updated', 'failed'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: '48f2f4ea-9321-46f3-bd12-d14ef18d0f1a',
			httpStatusCode: 403,
		},
		tmdbNotConfigured: {
			message: 'TMDB import is not configured on this server.',
			code: 'ZALIP_TMDB_NOT_CONFIGURED',
			id: 'f2fd6515-f070-4299-a808-9dc61eb11b51',
			httpStatusCode: 503,
		},
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
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
		private zalipTmdbImportService: ZalipTmdbImportService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const targets = await this.zalipCatalogService.listTmdbMediaSyncTargets(100);
			let updated = 0;
			let failed = 0;

			for (const target of targets) {
				const result = await this.zalipTmdbImportService.refreshMedia(target);
				switch (result.kind) {
					case 'updated':
						updated++;
						break;
					case 'not-configured':
						throw new ApiError(meta.errors.tmdbNotConfigured);
					case 'not-found':
					case 'upstream-failure':
						failed++;
						break;
				}
			}

			return { total: targets.length, updated, failed };
		});
	}
}
