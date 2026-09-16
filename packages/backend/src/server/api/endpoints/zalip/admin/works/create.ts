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
		type: 'object',
		optional: false,
		nullable: false,
		properties: {
			id: { type: 'string', format: 'misskey:id' },
			slug: { type: 'string' },
			kind: { type: 'string', enum: ['movie', 'series', 'anime', 'animation'] },
			publicationState: { type: 'string', enum: ['draft'] },
			title: { type: 'string' },
		},
		required: ['id', 'slug', 'kind', 'publicationState', 'title'],
	},

	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'a2deed75-8a6e-4d25-b4ce-1f86297d2cd3',
			httpStatusCode: 403,
		},
		slugTaken: {
			message: 'A Zalip work already uses this slug.',
			code: 'ZALIP_WORK_SLUG_TAKEN',
			id: 'f8a04668-0d5b-4e81-98f1-7c96227c1ddb',
			httpStatusCode: 409,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		slug: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', minLength: 1, maxLength: 160 },
		kind: { type: 'string', enum: ['movie', 'series', 'anime', 'animation'] },
		title: { type: 'string', minLength: 1, maxLength: 256 },
		originalTitle: { type: 'string', nullable: true, maxLength: 256 },
		description: { type: 'string', nullable: true, maxLength: 8192 },
		releaseYear: { type: 'integer', nullable: true, minimum: 1888, maximum: 3000 },
	},
	required: ['slug', 'kind', 'title'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) {
				throw new ApiError(meta.errors.forbidden);
			}

			const work = await this.zalipCatalogService.createManualDraft(ps);
			if (work === 'duplicate') throw new ApiError(meta.errors.slugTaken);

			return {
				id: work.id,
				slug: work.slug,
				kind: work.kind,
				// createManualDraft always writes an unpublished work. Keeping the literal here
				// makes the public endpoint contract unable to accidentally expose a publication path.
				publicationState: 'draft',
				title: work.title,
			};
		});
	}
}
