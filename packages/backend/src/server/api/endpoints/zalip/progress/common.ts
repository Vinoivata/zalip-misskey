/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ApiError } from '@/server/api/error.js';
import { ZalipProgressError } from '@/core/ZalipWatchProgressService.js';

export const progressErrors = {
	noSuchWork: { message: 'No such published Zalip work.', code: 'NO_SUCH_ZALIP_WORK', id: '07d7e784-8ba8-4409-aca9-a66292f3326d', httpStatusCode: 404 },
	invalidTarget: { message: 'Invalid canonical playback target.', code: 'INVALID_ZALIP_PROGRESS_TARGET', id: 'b98ca3d3-eade-45ea-a6c4-4c834e90d0c5' },
	unavailable: { message: 'This cached playback choice is unavailable.', code: 'ZALIP_PROGRESS_UNAVAILABLE', id: '8dd167b2-8419-48c7-896b-56ebfd3621c5' },
	invalidProgress: { message: 'Invalid playback progress.', code: 'INVALID_ZALIP_PROGRESS', id: '2f749286-e956-4461-b5b8-cf0abe7d88b7' },
	invalidCursor: { message: 'Invalid private playback cursor.', code: 'INVALID_ZALIP_PROGRESS_CURSOR', id: '2d6178a1-2359-462f-b127-7823899a3a95' },
} as const;

export const progressId = { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 } as const;
export const progressAuthProperties = { i: { type: 'string', minLength: 1, maxLength: 2048 } } as const;
export const progressSchema = {
	type: 'object', optional: false, nullable: false,
	properties: {
		workId: { ...progressId, optional: false, nullable: false },
		episodeId: { ...progressId, optional: false, nullable: true },
		seasonNumber: { type: 'integer', optional: false, nullable: true },
		episodeNumber: { type: 'integer', optional: false, nullable: true },
		provider: { type: 'string', optional: false, nullable: false, enum: ['alloha', 'collaps', 'kodik', 'vibix'] },
		translationId: { type: 'string', optional: false, nullable: true },
		mode: { type: 'string', optional: false, nullable: false, enum: ['time', 'episode'] },
		positionSeconds: { type: 'number', optional: false, nullable: true },
		durationSeconds: { type: 'number', optional: false, nullable: true },
		completed: { type: 'boolean', optional: false, nullable: false },
		lastPlayedAt: { type: 'string', optional: false, nullable: false },
	},
	required: ['workId', 'episodeId', 'seasonNumber', 'episodeNumber', 'provider', 'translationId', 'mode', 'positionSeconds', 'durationSeconds', 'completed', 'lastPlayedAt'],
} as const;

export async function progressCall<T>(action: () => Promise<T>): Promise<T> {
	try { return await action(); } catch (error) {
		if (error instanceof ZalipProgressError) {
			const definition = Object.values(progressErrors).find(candidate => candidate.code === error.code);
			if (definition) throw new ApiError(definition);
		}
		throw error;
	}
}
