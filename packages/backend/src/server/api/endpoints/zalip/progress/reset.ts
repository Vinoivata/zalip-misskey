/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { progressAuthProperties, progressCall, progressErrors, progressId } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'write:account', prohibitMoved: true,
	limit: { duration: 60000, max: 60 }, errors: progressErrors,
	description: 'Clear only your resume position, hide its continue card and invalidate pending saves. Does not remove library entries.',
	res: { type: 'object', optional: false, nullable: false, properties: { cleared: { type: 'boolean', optional: false, nullable: false } }, required: ['cleared'] },
} as const;
export const paramDef = { type: 'object', additionalProperties: false, properties: { ...progressAuthProperties, workId: progressId }, required: ['workId'] } as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.reset(me, ps.workId)));
	}
}
