/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { importSources } from '@/core/zalip-importer/types.js';

const string = { type: 'string', optional: false, nullable: false } as const;
const nullableString = { ...string, nullable: true } as const;
const boolean = { type: 'boolean', optional: false, nullable: false } as const;
const origin = { ...string, enum: ['environment', 'database', 'none'] } as const;
/** Native secure administrator endpoints only; this response intentionally contains visible keys. */
export const importerSourceSettingsResponse = {
	type: 'object', optional: false, nullable: false,
	properties: {
		encryptionReady: boolean,
		sources: {
			type: 'array', optional: false, nullable: false,
			items: {
				type: 'object', optional: false, nullable: false,
				properties: { source: { ...string, enum: importSources }, apiOrigin: string, playerOrigin: nullableString, apiToken: nullableString, playerToken: nullableString, apiTokenSet: boolean, apiTokenOrigin: origin, playerTokenSet: boolean, playerTokenOrigin: origin, updatedAt: nullableString },
			},
		},
	},
} as const;
