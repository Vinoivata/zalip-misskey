/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:notes',
	limit: {
		duration: 1000 * 60 * 60,
		max: 30,
	},
	description: 'Create the hidden local root for a published Zalip title discussion when it does not exist yet.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			noteId: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
			created: { type: 'boolean', optional: false, nullable: false },
		},
		required: ['noteId', 'created'],
	},
	errors: {
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '707cfb72-f7cb-4a7d-91e2-f77be76929f5',
			httpStatusCode: 404,
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
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const context = await this.zalipCatalogService.createDiscussion(me, ps.workId, null);
			if (context == null) throw new ApiError(meta.errors.noSuchWork);
			return context;
		});
	}
}
