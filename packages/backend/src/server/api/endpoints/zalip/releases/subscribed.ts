/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip', 'account'],
	requireCredential: true,
	kind: 'read:account',
	description: 'List catalogue episode arrivals and film/episode playback availability for titles followed by the signed-in user.',
	res: {
		type: 'array', optional: false, nullable: false,
		items: {
			type: 'object', optional: false, nullable: false,
			properties: {
				id: { type: 'string', format: 'misskey:id', optional: false, nullable: false },
				createdAt: { type: 'string', optional: false, nullable: false },
				source: { type: 'string', enum: ['catalogue', 'playback'], optional: false, nullable: false },
				work: { type: 'object', additionalProperties: true, optional: false, nullable: false },
				season: { type: 'object', additionalProperties: true, optional: false, nullable: true },
				episode: { type: 'object', additionalProperties: true, optional: false, nullable: true },
			},
			required: ['id', 'createdAt', 'source', 'work', 'season', 'episode'],
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => await this.zalipCatalogService.listSubscribedReleaseEvents(me, ps.limit));
	}
}
