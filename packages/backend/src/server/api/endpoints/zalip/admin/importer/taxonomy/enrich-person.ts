/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipPersonImportService, personImportWarnings } from '@/core/ZalipPersonImportService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';
import { importedPersonEntrySchema } from './import-person.js';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 6 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			entry: importedPersonEntrySchema,
			changedFields: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			warnings: { type: 'array', optional: false, nullable: false, items: { type: 'string', enum: personImportWarnings, optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		source: { type: 'string', enum: ['tmdb', 'kinopoisk'] },
	},
	required: ['entryId', 'source'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private persons: ZalipPersonImportService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.persons.enrichPerson(ps.entryId, ps.source));
		});
	}
}
