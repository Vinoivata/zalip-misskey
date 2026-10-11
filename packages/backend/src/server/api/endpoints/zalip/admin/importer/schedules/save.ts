/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerIdProperty, importerSourceProperty, importerLockedFieldsProperty, importerCategoryIdsProperty, importerOptionsProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 10 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		id: importerIdProperty,
		name: { type: 'string', minLength: 1, maxLength: 120 },
		enabled: { type: 'boolean' },
		source: importerSourceProperty,
		mode: { type: 'string', enum: ['metadata', 'availability', 'collection', 'discovery'] },
		intervalMinutes: { type: 'integer', minimum: 15, maximum: 43200 },
		collectionId: { type: 'string', nullable: true, minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' },
		lockedFields: importerLockedFieldsProperty,
		categoryIds: importerCategoryIdsProperty,
		options: importerOptionsProperty,
	},
	required: ["name", "enabled", "source", "mode", "intervalMinutes"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipImporterService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.importer.saveProfile({ id: ps.id, name: ps.name, enabled: ps.enabled, source: ps.source, mode: ps.mode, intervalMinutes: ps.intervalMinutes, collectionId: ps.collectionId, lockedFields: ps.lockedFields, categoryIds: ps.categoryIds, options: ps.options }));
		});
	}
}
