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
			title: { type: 'string' },
			originalTitle: { type: 'string', nullable: true },
			description: { type: 'string', nullable: true },
			releaseYear: { type: 'integer', nullable: true },
		},
		required: ['id', 'title', 'originalTitle', 'description', 'releaseYear'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: '9b569b1f-cd4b-4cc8-a9e5-7d0ac4d634c5',
			httpStatusCode: 403,
		},
		noSuchWork: {
			message: 'No such Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '04cd18d0-55de-4f61-941b-a5d6e7e731f2',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		title: { type: 'string', minLength: 1, maxLength: 256 },
		originalTitle: { type: 'string', nullable: true, maxLength: 256 },
		description: { type: 'string', nullable: true, maxLength: 8192 },
		releaseYear: { type: 'integer', nullable: true, minimum: 1888, maximum: 3000 },
	},
	required: ['workId', 'title', 'originalTitle', 'description', 'releaseYear'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const work = await this.zalipCatalogService.updateAdminWork(ps.workId, {
				title: ps.title,
				originalTitle: ps.originalTitle,
				description: ps.description,
				releaseYear: ps.releaseYear,
			});
			if (work == null) throw new ApiError(meta.errors.noSuchWork);
			return {
				id: work.id,
				title: work.title,
				originalTitle: work.originalTitle,
				description: work.description,
				releaseYear: work.releaseYear,
			};
		});
	}
}
