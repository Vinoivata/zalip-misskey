/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { importerApiErrors, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { importerSourceSettingsResponse } from './settings-common.js';

export const meta = { tags: ['zalip', 'admin'], requireCredential: true, secure: true, errors: importerApiErrors, res: importerSourceSettingsResponse, limit: { duration: 60000, max: 30 } } as const;
export const paramDef = { type: 'object', additionalProperties: false, properties: importerAuthProperties, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private settings: ZalipImporterSourceSettingsService) {
		super(meta, paramDef, async (ps, me) => {
			return safeImporterCall(async () => {
				await assertImporterAdministrator(this.roleService, me);
				return this.settings.show();
			});
		});
	}
}
