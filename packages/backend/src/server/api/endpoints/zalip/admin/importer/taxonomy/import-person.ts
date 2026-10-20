/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipPersonImportService, personImportWarnings } from '@/core/ZalipPersonImportService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';

const personProperties = {
	type: { type: 'string', enum: ['person'], optional: false, nullable: false },
	name: { type: 'string', optional: false, nullable: false },
	description: { type: 'string', optional: false, nullable: true },
	imageUrl: { type: 'string', optional: false, nullable: true },
	externalIds: { type: 'object', optional: false, nullable: false, additionalProperties: { type: 'string' } },
	data: { type: 'object', optional: false, nullable: false, additionalProperties: true, properties: {} },
} as const;

// A packed person contains only the taxonomy's fixed public fact projection, never provider JSON or provenance.
export const importedPersonEntrySchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		...personProperties,
		id: { type: 'string', optional: false, nullable: false },
		slug: { type: 'string', optional: false, nullable: false },
		parentId: { type: 'string', optional: false, nullable: true },
	},
} as const;

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 6 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			preview: { type: 'boolean', optional: false, nullable: false },
			source: { type: 'string', enum: ['tmdb', 'kinopoisk'], optional: false, nullable: false },
			externalId: { type: 'string', optional: false, nullable: false },
			person: { type: 'object', optional: false, nullable: false, properties: personProperties },
			existingEntry: { ...importedPersonEntrySchema, nullable: true },
			entry: { ...importedPersonEntrySchema, nullable: true },
			created: { type: 'boolean', optional: false, nullable: false },
			changedFields: { type: 'array', optional: false, nullable: false, items: { type: 'string', optional: false, nullable: false } },
			warnings: { type: 'array', optional: false, nullable: false, items: { type: 'string', enum: personImportWarnings, optional: false, nullable: false } },
		},
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		source: { type: 'string', enum: ['tmdb', 'kinopoisk'] },
		reference: { type: 'string', minLength: 1, maxLength: 1024 },
		preview: { type: 'boolean', default: true },
	},
	required: ['source', 'reference'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private persons: ZalipPersonImportService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.persons.importPerson(ps.source, ps.reference, ps.preview));
		});
	}
}
