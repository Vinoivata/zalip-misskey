/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipArtworkLocalizationService } from '@/core/ZalipArtworkLocalizationService.js';
import { artworkLocalizationFields, artworkLocalizationKinds } from '@/core/zalip-importer/localization.js';
import { assertImporterAdministrator, importerApiErrors, importerAuthProperties, importerIdProperty, looseImporterObject, safeImporterCall } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	tags: ['zalip', 'admin'], requireCredential: true, secure: true, prohibitMoved: true,
	limit: { duration: 60000, max: 120 }, errors: importerApiErrors, res: looseImporterObject,
} as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, kind: { type: 'string', enum: artworkLocalizationKinds }, id: importerIdProperty, field: { type: 'string', enum: artworkLocalizationFields }, expected: { type: 'string', pattern: '^[a-f0-9]{64}$', minLength: 64, maxLength: 64 } },
	required: ['kind', 'id', 'field', 'expected'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private localization: ZalipArtworkLocalizationService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.localization.step(ps.kind, ps.id, ps.field, ps.expected));
		});
	}
}
