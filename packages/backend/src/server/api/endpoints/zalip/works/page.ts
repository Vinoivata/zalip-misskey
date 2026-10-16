/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { zalipCatalogueSorts } from '@/misc/zalip-catalogue-page.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { importerApiErrors, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { paramDef as listParamDef, workSchema } from './list.js';

export const meta = {
	tags: ['zalip'], requireCredential: false,
	description: 'Page all published catalogue titles using a filter-scoped keyset cursor and global ordering.',
	limit: { duration: 60000, max: 120 }, errors: importerApiErrors,
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: { type: 'array', optional: false, nullable: false, items: workSchema },
			total: { type: 'integer', optional: false, nullable: false },
			nextCursor: { type: 'string', optional: false, nullable: true },
		},
		required: ['items', 'total', 'nextCursor'],
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		...listParamDef.properties,
		limit: { type: 'integer', minimum: 1, maximum: 50, default: 24 },
		sort: { type: 'string', enum: zalipCatalogueSorts, default: 'newest' },
		cursor: { type: 'string', minLength: 1, maxLength: 2048, pattern: '^[A-Za-z0-9_-]+$' },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private catalogue: ZalipCatalogService) {
		super(meta, paramDef, async ps => safeImporterCall(() => this.catalogue.pagePublished(ps.limit, {
			genres: [...new Set([...(ps.genre ? [ps.genre] : []), ...(ps.genres ?? [])])],
			kinds: [...new Set([...(ps.kind ? [ps.kind] : []), ...(ps.kinds ?? [])])],
			query: ps.query, yearFrom: ps.yearFrom, yearTo: ps.yearTo,
		}, ps.sort, ps.cursor)));
	}
}
