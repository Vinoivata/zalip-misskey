/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	...importerAdminWriteMeta, secure: true, limit: { duration: 60000, max: 15 },
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			workId: { type: 'string', optional: false, nullable: false },
			status: { type: 'string', optional: false, nullable: false, enum: ['updated', 'already-current', 'locked', 'stale', 'unsupported', 'empty', 'unavailable'] },
			translations: { type: 'integer', optional: false, nullable: false },
			playbackRevision: { type: 'string', optional: false, nullable: false },
		},
	},
} as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: { ...importerAuthProperties, workId: importerIdProperty, expected: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' } },
	required: ['workId', 'expected'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private roleService: RoleService, private importer: ZalipImporterService) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(() => this.importer.refreshCollapsVoices(ps.workId, ps.expected));
		});
	}
}
