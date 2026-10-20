/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerTaxonomyTypeProperty, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminReadMeta,
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
	},
	required: [],
	oneOf: [{ required: ['entryId'] }, { required: ['workId'] }, { required: ['slug', 'type'] }],
	not: { required: ['workId', 'cursor'] },
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(async () => ps.workId ? { entries: await this.importer.listWorkEntries(ps.workId, { publishedOnly: false }) } : this.importer.showEntry({ entryId: ps.entryId, slug: ps.slug, type: ps.type, limit: ps.limit, cursor: ps.cursor, publishedOnly: false }));
		});
	}
}
