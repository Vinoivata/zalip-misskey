/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:notes',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			noteId: { type: 'string', format: 'misskey:id' },
			created: { type: 'boolean' },
		},
		required: ['noteId', 'created'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: '9d02d3aa-e407-4e0c-a25e-7e285e6554e4',
			httpStatusCode: 403,
		},
		noSuchEpisode: {
			message: 'No such published Zalip episode.',
			code: 'NO_SUCH_ZALIP_EPISODE',
			id: '8f73cf63-bd52-4132-9562-45c7c266ebbb',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		episodeId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', nullable: true, minLength: 1, maxLength: MAX_NOTE_TEXT_LENGTH },
	},
	required: ['episodeId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const context = await this.zalipCatalogService.createEpisodeDiscussion(me, ps.episodeId, ps.text ?? null);
			if (context == null) throw new ApiError(meta.errors.noSuchEpisode);
			return context;
		});
	}
}
