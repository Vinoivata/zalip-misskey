/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { importerApiErrors, assertImporterAdministrator, importerAuthProperties, importerSourceProperty, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { importerSourceSettingsResponse } from './settings-common.js';

export const meta = { tags: ['zalip', 'admin'], requireCredential: true, secure: true, prohibitMoved: true, errors: importerApiErrors, res: importerSourceSettingsResponse, limit: { duration: 60000, max: 10 } } as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		source: importerSourceProperty,
		apiOrigin: { type: 'string', minLength: 1, maxLength: 1024 },
		playerOrigin: { type: 'string', nullable: true, minLength: 1, maxLength: 1024 },
		apiToken: { type: 'string', maxLength: 4096 },
		clearApiToken: { type: 'boolean' },
		playerToken: { type: 'string', maxLength: 4096 },
		clearPlayerToken: { type: 'boolean' },
	},
	required: ['source', 'apiOrigin'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private settings: ZalipImporterSourceSettingsService) {
		super(meta, paramDef, async (ps, me) => {
			return safeImporterCall(async () => {
				await assertImporterAdministrator(this.roleService, me);
				return this.settings.save({ source: ps.source, apiOrigin: ps.apiOrigin, playerOrigin: ps.playerOrigin, apiToken: ps.apiToken, clearApiToken: ps.clearApiToken, playerToken: ps.playerToken, clearPlayerToken: ps.clearPlayerToken });
			});
		});
	}
}
