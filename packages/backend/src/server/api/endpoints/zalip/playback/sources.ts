/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerApiErrors, looseImporterObject, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	tags: ['zalip'], requireCredential: true, kind: 'read:account', errors: importerApiErrors, res: looseImporterObject,
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		workId: importerIdProperty,
	},
	required: ["workId"],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private importer: ZalipImporterService,
	) {
		super(meta, paramDef, async (ps) => {
			return safeImporterCall(() => this.importer.playback(ps.workId));
		});
	}
}
