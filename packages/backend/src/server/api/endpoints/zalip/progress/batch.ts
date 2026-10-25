/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { progressAuthProperties, progressCall, progressErrors, progressId, progressSchema } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'read:account',
	limit: { duration: 60000, max: 120 }, errors: progressErrors,
	description: 'Read only your latest visible playback targets for up to 50 published works, including completed episodes. No playback sessions or provider resources are exposed.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: { items: { type: 'array', optional: false, nullable: false, items: progressSchema } },
		required: ['items'],
	},
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...progressAuthProperties,
		workIds: { type: 'array', minItems: 1, maxItems: 50, uniqueItems: true, items: progressId },
	},
	required: ['workIds'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.batch(me, ps.workIds)));
	}
}
