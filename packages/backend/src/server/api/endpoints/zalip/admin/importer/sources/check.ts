/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterDiagnosticsService } from '@/core/ZalipImporterDiagnosticsService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerSourceProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = { ...importerAdminReadMeta, limit: { duration: 60000, max: 8 } } as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, source: importerSourceProperty },
	required: ['source'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private diagnostics: ZalipImporterDiagnosticsService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.diagnostics.check(ps.source));
		});
	}
}
