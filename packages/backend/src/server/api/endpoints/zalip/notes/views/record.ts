/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipNoteViewService, ZalipNoteViewUnavailableError } from '@/core/ZalipNoteViewService.js';

export const meta = {
	tags: ['zalip', 'notes'],
	secure: true,
	requireCredential: true,
	limit: { duration: 60000, max: 120 },
	description: 'Record a visible post after UI dwell. Authenticated viewers only; deduplicated for 24 hours without IP or device tracking. Own posts are excluded.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			counted: { type: 'boolean', optional: false, nullable: false },
			viewCount: { type: 'integer', optional: false, nullable: false, minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
		},
		required: ['counted', 'viewCount'],
	},
	errors: {
		noSuchNote: { message: 'No such visible note.', code: 'NO_SUCH_NOTE', id: '119ba05d-a6d2-4ee3-8bb4-cc2af9d10ea5', httpStatusCode: 404 },
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		i: { type: 'string', minLength: 1, maxLength: 2048 },
		noteId: { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 },
	},
	required: ['noteId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private noteViews: ZalipNoteViewService) {
		super(meta, paramDef, async (ps, me) => {
			try { return await this.noteViews.record(me, ps.noteId); } catch (error) {
				if (error instanceof ZalipNoteViewUnavailableError) throw new ApiError(meta.errors.noSuchNote);
				throw error;
			}
		});
	}
}
