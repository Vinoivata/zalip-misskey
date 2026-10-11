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
	limit: { duration: 60000, max: 10 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, entryId: importerIdProperty },
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
			return safeImporterCall(async () => {
				await this.taxonomy.deleteEntry(ps.entryId);
				return { deleted: true };
			});
		});
	}
}
