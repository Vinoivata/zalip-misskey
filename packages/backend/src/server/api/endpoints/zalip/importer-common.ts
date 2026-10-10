/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ImportProviderError } from '@/core/zalip-importer/providers.js';
import { importFields, importSources } from '@/core/zalip-importer/types.js';
import type { RoleService } from '@/core/RoleService.js';
import type { MiLocalUser } from '@/models/User.js';
import { ApiError } from '@/server/api/error.js';

/** Shared definitions are declared once: identical errors keep one stable identifier across this API. */
export const importerApiErrors = {
	forbidden: { message: 'Administrator permission is required.', code: 'ZALIP_ADMIN_REQUIRED', id: '0ef8ee51-6cad-4533-b55d-50e64553f04b', httpStatusCode: 403 },
	notFound: { message: 'The requested catalogue resource was not found.', code: 'ZALIP_IMPORT_NOT_FOUND', id: '1725efd9-8bfc-4ac0-a6e9-63b0c6e4e53d', httpStatusCode: 404 },
	invalid: { message: 'The import or catalogue parameters are invalid.', code: 'ZALIP_IMPORT_INVALID', id: 'e28b4b27-7353-47a9-9a25-63e2e2505916', httpStatusCode: 400 },
	conflict: { message: 'The catalogue identity or operation conflicts with existing data.', code: 'ZALIP_IMPORT_CONFLICT', id: 'f3178194-1238-44b1-a615-643a9720019f', httpStatusCode: 409 },
	notConfigured: { message: 'The requested content provider is not configured.', code: 'ZALIP_IMPORT_NOT_CONFIGURED', id: '5885a859-b71e-45f2-b7d1-53723b3fd8f1', httpStatusCode: 503 },
	quota: { message: 'The content provider request budget is exhausted.', code: 'ZALIP_IMPORT_QUOTA_EXCEEDED', id: '893afe56-50ed-490c-839c-efacdabdec43', httpStatusCode: 429 },
	rateLimited: { message: 'The content provider is temporarily rate limited.', code: 'ZALIP_IMPORT_RATE_LIMITED', id: '755d1ab0-baab-4cfd-8afe-e0c7b8fad7f9', httpStatusCode: 429 },
	unavailable: { message: 'The import service is temporarily unavailable.', code: 'ZALIP_IMPORT_UNAVAILABLE', id: '1908d91c-0ae8-4e3e-8e03-e81498a99572', httpStatusCode: 502 },
} as const;

export const looseImporterObject = { type: 'object', optional: false, nullable: false, additionalProperties: true, properties: {} } as const;
export const importerAuthProperties = { i: { type: 'string', minLength: 1, maxLength: 2048 } } as const;
export const importerSourceProperty = { type: 'string', enum: importSources } as const;
export const importerMediaTypeProperty = { type: 'string', enum: ['movie', 'tv'] } as const;
export const importerTaxonomyTypeProperty = { type: 'string', enum: ['person', 'studio', 'genre', 'category', 'collection'] } as const;
export const importerIdProperty = { type: 'string', format: 'misskey:id', minLength: 1, maxLength: 32 } as const;
export const importerLockedFieldsProperty = { type: 'array', uniqueItems: true, maxItems: importFields.length, items: { type: 'string', enum: importFields } } as const;
export const importerCategoryIdsProperty = { type: 'array', uniqueItems: true, maxItems: 50, items: importerIdProperty } as const;
export const importerRefProperty = {
	type: 'object', additionalProperties: false,
	properties: {
		source: importerSourceProperty,
		externalId: { type: 'string', minLength: 1, maxLength: 64, pattern: '^(?:[1-9][0-9]{0,15}|tmdb:(?:movie|tv):[1-9][0-9]{0,15})$' },
		mediaType: importerMediaTypeProperty,
	},
	required: ['source', 'externalId', 'mediaType'],
} as const;

export const importerAdminReadMeta = {
	tags: ['zalip', 'admin'], requireCredential: true, kind: 'read:account',
	errors: importerApiErrors, res: looseImporterObject,
} as const;
export const importerAdminWriteMeta = {
	tags: ['zalip', 'admin'], requireCredential: true, kind: 'write:account', prohibitMoved: true,
	errors: importerApiErrors, res: looseImporterObject,
} as const;

export async function assertImporterAdministrator(roleService: Pick<RoleService, 'isAdministrator'>, user: MiLocalUser): Promise<void> {
	if (!await roleService.isAdministrator(user)) throw new ApiError(importerApiErrors.forbidden);
}

const missingResources = new Set(['NO_SUCH_CATALOG_ENTRY', 'NO_SUCH_WORK', 'NO_SUCH_IMPORT_RUN', 'NO_SUCH_IMPORT_PROFILE', 'ZALIP_CATALOG_ENTRY_NOT_FOUND']);
const invalidResources = new Set(['INVALID_CATALOG_TYPE', 'INVALID_CATALOG_ENTRY', 'INVALID_CATALOG_IMAGE', 'INVALID_CATALOG_SOURCE', 'INVALID_CATALOG_PARENT', 'CATALOG_PARENT_CYCLE', 'INVALID_CATALOG_LOOKUP', 'INVALID_CATALOG_LINK', 'INVALID_EXTERNAL_IDS', 'CATALOG_DATA_TOO_LARGE', 'INVALID_IMPORT_RUN', 'EMPTY_IMPORT_RUN', 'INVALID_IMPORT_PROFILE', 'INVALID_IMPORT_ACTION']);
const resourceConflicts = new Set(['CATALOG_TYPE_IMMUTABLE', 'CATALOG_SLUG_CONFLICT', 'CATALOG_ID_CONFLICT', 'IMPORT_ID_CONFLICT', 'IMPORT_IDENTITY_CONFLICT', 'IMPORT_RUN_BUSY']);

/** Do not return upstream messages, causes, URLs or raw database errors, even for administrators. */
export async function safeImporterCall<T>(action: () => Promise<T> | T): Promise<T> {
	try {
		return await action();
	} catch (error) {
		if (error instanceof ApiError) throw error;
		if (error instanceof ImportProviderError) {
			switch (error.code) {
				case 'not-found': throw new ApiError(importerApiErrors.notFound);
				case 'not-configured': throw new ApiError(importerApiErrors.notConfigured);
				case 'invalid-ref':
				case 'unsupported': throw new ApiError(importerApiErrors.invalid);
				case 'quota-exceeded': throw new ApiError(importerApiErrors.quota, { retryAfterMs: error.retryAfterMs ?? 86400000 });
				case 'rate-limited': throw new ApiError(importerApiErrors.rateLimited, { retryAfterMs: error.retryAfterMs ?? 60000 });
				default: throw new ApiError(importerApiErrors.unavailable);
			}
		}
		if (error instanceof Error) {
			if (missingResources.has(error.message)) throw new ApiError(importerApiErrors.notFound);
			if (invalidResources.has(error.message)) throw new ApiError(importerApiErrors.invalid);
			if (resourceConflicts.has(error.message)) throw new ApiError(importerApiErrors.conflict);
		}
		throw new ApiError(importerApiErrors.unavailable);
	}
}
