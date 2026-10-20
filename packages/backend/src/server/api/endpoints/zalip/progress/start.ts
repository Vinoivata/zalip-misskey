/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ZalipWatchProgressService } from '@/core/ZalipWatchProgressService.js';
import { progressAuthProperties, progressCall, progressErrors, progressId, progressSchema } from './common.js';

export const meta = {
	tags: ['zalip', 'account'], requireCredential: true, kind: 'write:account', prohibitMoved: true,
	limit: { duration: 60000, max: 60 }, errors: progressErrors,
	description: 'Start an explicitly selected cached playback target and rotate its server-issued session. Never edits library state.',
	res: { type: 'object', optional: false, nullable: false, properties: { sessionId: { type: 'string', optional: false, nullable: false }, sequence: { type: 'integer', optional: false, nullable: false }, progress: progressSchema }, required: ['sessionId', 'sequence', 'progress'] },
} as const;
export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...progressAuthProperties,
		workId: progressId, episodeId: { ...progressId, nullable: true },
		provider: { type: 'string', enum: ['alloha', 'collaps', 'kodik', 'vibix'] },
		translationId: { type: 'string', minLength: 1, maxLength: 100, nullable: true },
		expectedResourceFingerprint: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[a-f0-9]{64}$' },
	},
	required: ['workId', 'episodeId', 'provider', 'translationId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(private progress: ZalipWatchProgressService) {
		super(meta, paramDef, (ps, me) => progressCall(() => this.progress.start(me, { workId: ps.workId, episodeId: ps.episodeId, provider: ps.provider, translationId: ps.translationId, ...(ps.expectedResourceFingerprint === undefined ? {} : { expectedResourceFingerprint: ps.expectedResourceFingerprint }) })));
	}
}
