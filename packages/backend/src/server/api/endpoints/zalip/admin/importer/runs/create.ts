/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerRefProperty, importerIdProperty, importerLockedFieldsProperty, importerCategoryIdsProperty, importerOptionsProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 6 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		refs: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: importerRefProperty },
		workIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: importerIdProperty },
		mode: { type: 'string', enum: ['import', 'sync'] },
		lockedFields: importerLockedFieldsProperty,
		categoryIds: importerCategoryIdsProperty,
		profileId: importerIdProperty,
		options: importerOptionsProperty,
	},
	required: ["mode"],
	oneOf: [{ required: ['refs'] }, { required: ['workIds'] }],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipImporterService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.importer.createRun({ refs: ps.refs, workIds: ps.workIds, mode: ps.mode, lockedFields: ps.lockedFields, categoryIds: ps.categoryIds, profileId: ps.profileId, options: ps.options }, me.id));
		});
	}
}
