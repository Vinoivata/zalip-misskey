/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { zalipProgressMaxSeconds } from '@/models/ZalipWatchProgress.js';
import { progressAuthProperties, progressCall, progressErrors, progressId, progressSchema } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'write:account', prohibitMoved: true,
	limit: { duration: 60000, max: 120 }, errors: progressErrors,
	description: 'Save bounded progress for your current session. Delayed sessions and non-increasing sequences are ignored.',
	res: { type: 'object', optional: false, nullable: false, properties: { accepted: { type: 'boolean', optional: false, nullable: false }, progress: { ...progressSchema, nullable: true } }, required: ['accepted', 'progress'] },
} as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...progressAuthProperties,
		workId: progressId,
		sessionId: { type: 'string', pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$', minLength: 36, maxLength: 36 },
		sequence: { type: 'integer', minimum: 1, maximum: 2147483647 },
		positionSeconds: { type: 'number', minimum: 0, maximum: zalipProgressMaxSeconds },
		durationSeconds: { type: 'number', exclusiveMinimum: 0, maximum: zalipProgressMaxSeconds },
		completed: { type: 'boolean' },
	},
	required: ['workId', 'sessionId', 'sequence'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.update(me, ps)));
	}
}
