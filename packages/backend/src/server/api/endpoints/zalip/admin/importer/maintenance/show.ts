/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterMaintenanceService } from '@/core/ZalipImporterMaintenanceService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { maintenanceRunId, maintenanceRunResponse } from '@/server/api/endpoints/zalip/admin/importer/maintenance/maintenance-common.js';

export const meta = {
	...importerAdminReadMeta,
	res: maintenanceRunResponse,
	limit: { duration: 60000, max: 60 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, ...maintenanceRunId },
	required: ['runId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private maintenance: ZalipImporterMaintenanceService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.maintenance.showRun(ps.runId));
		});
	}
}

