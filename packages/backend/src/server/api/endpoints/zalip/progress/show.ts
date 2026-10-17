/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { progressAuthProperties, progressCall, progressErrors, progressId, progressSchema } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'read:account',
	limit: { duration: 60000, max: 120 }, errors: progressErrors,
	description: 'Read only your latest playback target for a published work. No playback session is exposed.',
	res: { type: 'object', optional: false, nullable: false, properties: { progress: { ...progressSchema, nullable: true } }, required: ['progress'] },
} as const;
export const paramDef = { type: 'object', additionalProperties: false, properties: { ...progressAuthProperties, workId: progressId }, required: ['workId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.show(me, ps.workId)));
	}
}
