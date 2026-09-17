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
			id: '07c7f55c-7f34-4560-88b8-833f40f4eaa9',
			httpStatusCode: 403,
		},
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '9806546e-2ec8-4885-bcd6-fd0592a65f25',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', nullable: true, minLength: 1, maxLength: MAX_NOTE_TEXT_LENGTH },
	},
	required: ['workId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const context = await this.zalipCatalogService.createDiscussion(me, ps.workId, ps.text ?? null);
			if (context == null) throw new ApiError(meta.errors.noSuchWork);
			return context;
		});
	}
}
