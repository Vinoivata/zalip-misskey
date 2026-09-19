/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { Endpoint } from '@/server/api/endpoint-base.js';

export const meta = {
	tags: ['zalip'],
	requireCredential: false,
	allowGet: true,
	cacheSec: 60,
	description: 'List genre facets used by published Zalip cinema titles.',
	res: {
		type: 'array',
		optional: false,
		nullable: false,
		items: { type: 'string', optional: false, nullable: false },
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
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async () => {
			return await this.zalipCatalogService.listPublishedGenres();
		});
	}
}
