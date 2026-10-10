/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerAdminReadMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerSourceProperty, importerMediaTypeProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminReadMeta,
	limit: { duration: 60000, max: 10 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		source: importerSourceProperty,
		query: { type: 'string', minLength: 1, maxLength: 256 },
		page: { type: 'integer', minimum: 1, maximum: 500, default: 1 },
		mediaType: importerMediaTypeProperty,
	},
	required: ["source", "query"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipImporterService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.importer.search(ps.source, ps.query, ps.page, ps.mediaType));
		});
	}
}
