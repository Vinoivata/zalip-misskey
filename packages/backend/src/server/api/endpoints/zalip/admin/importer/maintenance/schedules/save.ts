/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterMaintenanceService } from '@/core/ZalipImporterMaintenanceService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { maintenanceProperties, maintenanceProfileId, maintenanceProfileResponse } from '@/server/api/endpoints/zalip/admin/importer/maintenance/maintenance-common.js';

export const meta = {
	...importerAdminWriteMeta,
	res: maintenanceProfileResponse,
	limit: { duration: 60000, max: 10 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, ...maintenanceProperties, ...maintenanceProfileId, name: { type: 'string', minLength: 1, maxLength: 120 }, intervalMinutes: { type: 'integer', minimum: 60, maximum: 10080 } },
	required: ['name', 'kind', 'source', 'intervalMinutes'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private maintenance: ZalipImporterMaintenanceService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.maintenance.saveProfile({ profileId: ps.profileId, name: ps.name, kind: ps.kind, source: ps.source, intervalMinutes: ps.intervalMinutes, options: ps.options, batchLimit: ps.batchLimit, timeBudgetSeconds: ps.timeBudgetSeconds }));
		});
	}
}

