/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 6 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		workIds: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 100, items: importerIdProperty },
		afterId: importerIdProperty,
		limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
	},
	not: { required: ['workIds', 'afterId'] },
	required: ['entryId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private taxonomy: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.taxonomy.recalculateCategory({ entryId: ps.entryId, workIds: ps.workIds, afterId: ps.afterId, limit: ps.limit }));
		});
	}
}
