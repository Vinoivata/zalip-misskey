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
	description: 'List recent Zalip episode arrivals for published catalogue works.',
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id' },
				createdAt: { type: 'string' },
				work: { type: 'object', additionalProperties: true },
				season: {
					type: 'object',
					properties: { seasonNumber: { type: 'integer' }, title: { type: 'string' } },
					required: ['seasonNumber', 'title'],
				},
				episode: {
					type: 'object',
					properties: { episodeNumber: { type: 'integer' }, title: { type: 'string' } },
					required: ['episodeNumber', 'title'],
				},
			},
			required: ['id', 'createdAt', 'work', 'season', 'episode'],
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps) => await this.zalipCatalogService.listPublishedReleaseEvents(ps.limit));
	}
}
