/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipAllohaService } from '@/core/ZalipAllohaService.js';

export const meta = {
	tags: ['zalip', 'admin'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:account',
	description: 'Explicitly refreshes the bounded Alloha cache and processes title subscriptions.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			checked: { type: 'integer' },
			available: { type: 'integer' },
			events: { type: 'integer' },
		},
		required: ['checked', 'available', 'events'],
	},
	errors: {
		forbidden: {
			message: 'Administrator permission is required.',
			code: 'ZALIP_ADMIN_REQUIRED',
			id: 'e67a344c-445e-48c4-ae75-b15a1420a838',
			httpStatusCode: 403,
		},
		allohaNotConfigured: {
			message: 'Alloha API is not configured on this server.',
			code: 'ZALIP_ALLOHA_NOT_CONFIGURED',
			id: '80b92362-3fdf-4c5d-a0f8-1d678c7428ef',
			httpStatusCode: 503,
		},
		allohaUnavailable: {
			message: 'Alloha API is temporarily unavailable.',
			code: 'ZALIP_ALLOHA_UNAVAILABLE',
			id: '1d5cd5ff-f594-46b2-ae19-7a03c17b4e3d',
			httpStatusCode: 503,
		},
	},
} as const;

export const paramDef = {
	type: 'object', properties: {}, required: [],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private zalipAllohaService: ZalipAllohaService,
	) {
		super(meta, paramDef, async (_ps, me) => {
			if (!await this.roleService.isAdministrator(me)) throw new ApiError(meta.errors.forbidden);
			const result = await this.zalipAllohaService.sync();
			switch (result.kind) {
				case 'not-configured': throw new ApiError(meta.errors.allohaNotConfigured);
				case 'upstream-failure': throw new ApiError(meta.errors.allohaUnavailable);
				case 'synced': return result;
			}
		});
	}
}
