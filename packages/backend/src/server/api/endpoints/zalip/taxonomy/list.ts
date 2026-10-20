/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { zalipPersonRoles } from '@/misc/zalip-taxonomy.js';
import { importerApiErrors, looseImporterObject, importerAuthProperties, safeImporterCall, importerTaxonomyTypeProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	tags: ['zalip'], requireCredential: false, errors: importerApiErrors, res: looseImporterObject,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		type: importerTaxonomyTypeProperty,
		query: { type: 'string', maxLength: 256 },
		role: { type: 'string', enum: zalipPersonRoles },
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
		offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
	},
	required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps) => {
			return safeImporterCall(async () => ({ entries: await this.importer.listEntries({ type: ps.type, query: ps.query, limit: ps.limit, offset: ps.offset, publishedOnly: true, ...(ps.role ? { role: ps.role } : {}) }) }));
		});
	}
}
