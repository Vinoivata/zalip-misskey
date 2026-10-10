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
	limit: { duration: 60000, max: 30 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		workId: importerIdProperty,
		role: { type: 'string', maxLength: 64 },
		character: { type: 'string', nullable: true, maxLength: 256 },
		position: { type: 'integer', minimum: 0, maximum: 100000 },
		remove: { type: 'boolean', default: false },
	},
	required: ["entryId", "workId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(async () => {
				if (ps.remove) await this.importer.unlinkWork({ entryId: ps.entryId, workId: ps.workId, role: ps.role });
				else await this.importer.linkWork({ entryId: ps.entryId, workId: ps.workId, role: ps.role, character: ps.character, position: ps.position });
				return { ok: true };
			});
		});
	}
}
