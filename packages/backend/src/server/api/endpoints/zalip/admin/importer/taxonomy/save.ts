/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerTaxonomyTypeProperty, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 20 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		type: importerTaxonomyTypeProperty,
		name: { type: 'string', minLength: 1, maxLength: 256 },
		slug: { type: 'string', minLength: 1, maxLength: 160 },
		description: { type: 'string', nullable: true, maxLength: 8192 },
		imageUrl: { type: 'string', nullable: true, maxLength: 1024 },
		parentId: { ...importerIdProperty, nullable: true },
		externalIds: {
			type: 'object', maxProperties: 32,
			propertyNames: { pattern: '^[a-z0-9:_-]{1,64}$' },
			additionalProperties: { type: 'string', minLength: 1, maxLength: 128 },
		},
		data: {
			type: 'object', additionalProperties: false,
			properties: {
				biography: { type: 'string', nullable: true, maxLength: 16384 },
				birthday: { type: 'string', nullable: true, maxLength: 32 },
				deathday: { type: 'string', nullable: true, maxLength: 32 },
				placeOfBirth: { type: 'string', nullable: true, maxLength: 256 },
				homepage: { type: 'string', nullable: true, maxLength: 1024 },
				originalName: { type: 'string', nullable: true, maxLength: 256 },
				aliases: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 256 } },
				identityQuality: { type: 'string', enum: ['verified', 'unresolved'] },
				collectionKind: { type: 'string', enum: ['manual', 'provider', 'rules'] },
				semanticKind: { type: 'string', enum: ['theme', 'platform', 'franchise'] },
				isEnabled: { type: 'boolean' },
				rules: {
					type: 'object', additionalProperties: false,
					properties: {
						all: { type: 'boolean' },
						kinds: { type: 'array', maxItems: 4, uniqueItems: true, items: { type: 'string', enum: ['movie', 'series', 'anime', 'animation'] } },
						genres: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
						countries: { type: 'array', maxItems: 50, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 128 } },
						yearFrom: { type: 'integer', minimum: 1800, maximum: 3000 },
						yearTo: { type: 'integer', minimum: 1800, maximum: 3000 },
					},
				},
			},
		},
	},
	required: ['type', 'name'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private importer: ZalipTaxonomyService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.importer.saveEntry({ type: ps.type, name: ps.name, slug: ps.slug, description: ps.description, imageUrl: ps.imageUrl, parentId: ps.parentId, externalIds: ps.externalIds, data: ps.data }, ps.entryId));
		});
	}
}
