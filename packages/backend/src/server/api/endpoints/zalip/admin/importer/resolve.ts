/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterDiagnosticsService } from '@/core/ZalipImporterDiagnosticsService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerMediaTypeProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = { ...importerAdminReadMeta, limit: { duration: 60000, max: 6 } } as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		source: { type: 'string', enum: ['tmdb', 'kinopoisk', 'collaps', 'kodik'] },
		imdbId: { type: 'string', pattern: '^tt[0-9]{5,12}$', maxLength: 14 },
		mediaType: importerMediaTypeProperty,
	},
	required: ['source', 'imdbId', 'mediaType'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private diagnostics: ZalipImporterDiagnosticsService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.diagnostics.resolve(ps.source, ps.imdbId, ps.mediaType));
		});
	}
}
