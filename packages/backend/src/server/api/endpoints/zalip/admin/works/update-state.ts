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
			publicationState: { type: 'string', enum: ['draft', 'published', 'archived'] },
			publishedAt: { type: 'string', nullable: true },
		},
		required: ['id', 'publicationState', 'publishedAt'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'ae54f8cf-66d1-4f6e-bb6e-540706a2d44f',
			httpStatusCode: 403,
		},
		noSuchWork: {
			message: 'No such Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: 'b373019c-64ee-41e0-a551-c4751669f2a8',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		publicationState: { type: 'string', enum: ['draft', 'published', 'archived'] },
	},
	required: ['workId', 'publicationState'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const work = await this.zalipCatalogService.setPublicationState(ps.workId, ps.publicationState);
			if (work == null) throw new ApiError(meta.errors.noSuchWork);
			return {
				id: work.id,
				publicationState: work.publicationState,
				publishedAt: work.publishedAt,
			};
		});
	}
}
