/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipPlaybackSettingsService } from '@/core/ZalipPlaybackSettingsService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';
import { playbackSettingsResponse } from './show.js';

export const meta = { ...importerAdminWriteMeta, limit: { duration: 60000, max: 10 }, res: playbackSettingsResponse } as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		providers: { type: 'array', minItems: 4, maxItems: 4, items: {
			type: 'object', additionalProperties: false,
			properties: {
				source: { type: 'string', enum: ['alloha', 'collaps', 'kodik', 'vibix'] },
				label: { type: 'string', minLength: 1, maxLength: 40 },
				enabled: { type: 'boolean' },
				position: { type: 'integer', minimum: 0, maximum: 3 },
			}, required: ['source', 'label', 'enabled', 'position'],
		} },
	}, required: ['providers'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private settings: ZalipPlaybackSettingsService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.settings.save(ps.providers));
		});
	}
}
