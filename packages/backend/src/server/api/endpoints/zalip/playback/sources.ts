/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipImporterService } from '@/core/ZalipImporterService.js';
import { importerApiErrors, looseImporterObject, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const meta = {
	tags: ['zalip'], requireCredential: true, kind: 'read:account', errors: importerApiErrors,
	res: {
		...looseImporterObject,
		properties: {
			sources: {
				type: 'array', optional: true, nullable: false,
				items: {
					type: 'object', optional: false, nullable: false, additionalProperties: true,
					properties: {
						vibixEpisodeMap: {
							type: 'object', optional: true, nullable: false,
							properties: {
								publisherId: { type: 'string', optional: false, nullable: false },
								seriesId: { type: 'string', optional: false, nullable: false },
								items: {
									type: 'array', optional: false, nullable: false,
									items: { type: 'object', optional: false, nullable: false, properties: {
										seasonNumber: { type: 'integer', optional: false, nullable: false },
											episodeNumber: { type: 'integer', optional: false, nullable: false },
											translationId: { type: 'string', optional: false, nullable: false },
											movieId: { type: 'string', optional: false, nullable: false },
									} },
								},
							},
						},
					},
				},
			},
		},
	},
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
