/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip'],
	requireCredential: false,
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			noteId: { type: 'string', format: 'misskey:id', nullable: true },
		},
		required: ['noteId'],
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
		super(meta, paramDef, async (ps) => ({
			noteId: await this.zalipCatalogService.showDiscussion(ps.workId),
		}));
	}
}
