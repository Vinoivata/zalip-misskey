/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { importerApiErrors, looseImporterObject, importerAuthProperties, safeImporterCall, importerTaxonomyTypeProperty, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	tags: ['zalip'], requireCredential: false, errors: importerApiErrors, res: looseImporterObject,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		workId: importerIdProperty,
		slug: { type: 'string', minLength: 1, maxLength: 160, pattern: '^[\\p{L}\\p{N}]+(?:-[\\p{L}\\p{N}]+)*$' },
		type: importerTaxonomyTypeProperty,
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
	},
	required: [],
	oneOf: [{ required: ['entryId'] }, { required: ['workId'] }, { required: ['slug', 'type'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps) => {
			return safeImporterCall(async () => ps.workId ? { entries: await this.importer.listWorkEntries(ps.workId, { publishedOnly: true }) } : this.importer.showEntry({ entryId: ps.entryId, slug: ps.slug, type: ps.type, limit: ps.limit, publishedOnly: true }));
		});
	}
}
