/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { zalipFilmographySorts, zalipPersonRoles } from '@/misc/zalip-taxonomy.js';
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
		cursor: { type: 'string', minLength: 1, maxLength: 2048, pattern: '^[a-zA-Z0-9_-]+$' },
		role: { type: 'string', enum: zalipPersonRoles },
		kind: { type: 'string', enum: ['movie', 'series', 'anime', 'animation'] },
		yearFrom: { type: 'integer', minimum: 1800, maximum: 3000 },
		yearTo: { type: 'integer', minimum: 1800, maximum: 3000 },
		sort: { type: 'string', enum: zalipFilmographySorts },
	},
	required: [],
	oneOf: [{ required: ['entryId'] }, { required: ['workId'] }, { required: ['slug', 'type'] }],
	not: { anyOf: ['cursor', 'role', 'kind', 'yearFrom', 'yearTo', 'sort'].map(field => ({ required: ['workId', field] })) },
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps) => {
			return safeImporterCall(async () => ps.workId ? { entries: await this.importer.listWorkEntries(ps.workId, { publishedOnly: true }) } : this.importer.showEntry({ entryId: ps.entryId, slug: ps.slug, type: ps.type, limit: ps.limit, cursor: ps.cursor, publishedOnly: true, ...(ps.role ? { role: ps.role } : {}), ...(ps.kind ? { kind: ps.kind } : {}), ...(ps.yearFrom !== undefined ? { yearFrom: ps.yearFrom } : {}), ...(ps.yearTo !== undefined ? { yearTo: ps.yearTo } : {}), ...(ps.sort ? { sort: ps.sort } : {}) }));
		});
	}
}
