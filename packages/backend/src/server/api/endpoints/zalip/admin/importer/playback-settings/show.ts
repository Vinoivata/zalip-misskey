/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipPlaybackSettingsService } from '@/core/ZalipPlaybackSettingsService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';

export const playbackSettingsResponse = {
	type: 'object', optional: false, nullable: false,
	properties: { providers: { type: 'array', items: {
		type: 'object', properties: {
			source: { type: 'string', enum: ['alloha', 'collaps', 'kodik', 'vibix'] }, label: { type: 'string' },
			enabled: { type: 'boolean' }, position: { type: 'integer' },
		}, required: ['source', 'label', 'enabled', 'position'],
	} } }, required: ['providers'],
} as const;
export const meta = { ...importerAdminReadMeta, res: playbackSettingsResponse } as const;
export const paramDef = { type: 'object', additionalProperties: false, properties: importerAuthProperties, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private settings: ZalipPlaybackSettingsService) {
		super(meta, paramDef, async (_ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.settings.show());
		});
	}
}
