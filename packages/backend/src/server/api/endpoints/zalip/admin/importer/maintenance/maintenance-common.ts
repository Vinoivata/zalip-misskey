/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { maintenanceKinds } from '@/core/zalip-importer/types.js';
import { importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';

export const maintenanceProperties = {
	kind: { type: 'string', enum: maintenanceKinds },
	source: { type: 'string', enum: ['collaps', 'tmdb', 'kinopoisk'] },
	options: { type: 'object', additionalProperties: false, properties: { collectionIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', pattern: '^[1-9][0-9]{0,15}$', minLength: 1, maxLength: 16 } } } },
	batchLimit: { type: 'integer', minimum: 20, maximum: 50 },
	timeBudgetSeconds: { type: 'integer', minimum: 10, maximum: 120 },
} as const;

const requiredString = { type: 'string', optional: false, nullable: false } as const;
const nullableString = { type: 'string', optional: false, nullable: true } as const;
const requiredNumber = { type: 'integer', optional: false, nullable: false } as const;
const optionsResponse = { type: 'object', optional: false, nullable: false, properties: { collectionIds: { type: 'array', optional: true, nullable: false, items: requiredString } } } as const;
const cursorResponse = {
	type: 'object', optional: false, nullable: false,
	properties: { page: requiredNumber, offset: requiredNumber, entryAfterId: nullableString, activeEntryId: nullableString, collectionIndex: requiredNumber },
} as const;
export const maintenanceRunResponse = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: requiredString, kind: { ...requiredString, enum: maintenanceKinds }, source: { ...requiredString, enum: ['collaps', 'tmdb', 'kinopoisk'] },
		state: { ...requiredString, enum: ['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'] },
		createdAt: requiredString, updatedAt: requiredString, finishedAt: nullableString, profileId: nullableString,
		options: optionsResponse, batchLimit: requiredNumber, timeBudgetSeconds: requiredNumber, cursor: cursorResponse,
		stats: { type: 'object', optional: false, nullable: false, properties: { processed: requiredNumber, created: requiredNumber, updated: requiredNumber, linked: requiredNumber, skipped: requiredNumber, failed: requiredNumber } },
		error: nullableString, retryAfter: nullableString, warnings: { type: 'array', optional: false, nullable: false, items: requiredString },
	},
} as const;
export const maintenanceProfileResponse = {
	type: 'object', optional: false, nullable: false,
	properties: {
		id: requiredString, name: requiredString, kind: { ...requiredString, enum: maintenanceKinds }, source: { ...requiredString, enum: ['collaps', 'tmdb', 'kinopoisk'] },
		enabled: { type: 'boolean', optional: false, nullable: false }, options: optionsResponse,
		intervalMinutes: requiredNumber, batchLimit: requiredNumber, timeBudgetSeconds: requiredNumber, cursor: cursorResponse,
		lastRunAt: nullableString, nextRunAt: nullableString, lastError: nullableString,
	},
} as const;
export const maintenanceRunId = { runId: importerIdProperty } as const;
export const maintenanceProfileId = { profileId: importerIdProperty } as const;
