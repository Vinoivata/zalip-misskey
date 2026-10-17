/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { workSchema } from '../works/list.js';
import { progressAuthProperties, progressCall, progressErrors, progressId, progressSchema } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'read:account',
	limit: { duration: 60000, max: 120 }, errors: progressErrors,
	description: 'Page only your unfinished, visible playback targets for published works by server playback time.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			items: { type: 'array', optional: false, nullable: false, items: { ...progressSchema, properties: { ...progressSchema.properties, work: workSchema, episode: { type: 'object', optional: false, nullable: true, properties: { id: { ...progressId, optional: false, nullable: false }, title: { type: 'string', optional: false, nullable: false }, stillPath: { type: 'string', optional: false, nullable: true } }, required: ['id', 'title', 'stillPath'] } }, required: [...progressSchema.required, 'work', 'episode'] } },
			nextCursor: { type: 'string', optional: false, nullable: true },
		},
		required: ['items', 'nextCursor'],
	},
} as const;
export const paramDef = { type: 'object', additionalProperties: false, properties: { ...progressAuthProperties, limit: { type: 'integer', minimum: 1, maximum: 50, default: 12 }, cursor: { type: 'string', minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' } }, required: [] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.continue(me, ps.limit, ps.cursor)));
	}
}
