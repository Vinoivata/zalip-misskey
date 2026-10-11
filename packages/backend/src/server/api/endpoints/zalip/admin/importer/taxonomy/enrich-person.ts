/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { RoleService } from '@/core/RoleService.js';
import { ZalipTaxonomyService } from '@/core/ZalipTaxonomyService.js';
import { budgetedTransport } from '@/core/zalip-importer/budget.js';
import { createConfiguredImportTransport } from '@/core/zalip-importer/providers.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { fetchImportedPerson } from '@/core/zalip-importer/persons.js';
import { importerAdminWriteMeta, assertImporterAdministrator, importerAuthProperties, safeImporterCall, importerIdProperty } from '@/server/api/endpoints/zalip/importer-common.js';
import type * as Redis from 'ioredis';

export const meta = {
	...importerAdminWriteMeta,
	limit: { duration: 60000, max: 6 },
} as const;

export const paramDef = {
	type: 'object', additionalProperties: false,
	properties: {
		...importerAuthProperties,
		entryId: importerIdProperty,
		source: { type: 'string', enum: ['tmdb', 'kinopoisk'] },
	},
	required: ['entryId', 'source'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private roleService: RoleService,
		private taxonomy: ZalipTaxonomyService,
		@Inject(DI.redis) private redis: Redis.Redis,
		private sourceSettings: ZalipImporterSourceSettingsService,
	) {
		super(meta, paramDef, async (ps, me) => {
			await assertImporterAdministrator(this.roleService, me);
			return safeImporterCall(async () => {
				const config = await this.sourceSettings.getRuntime();
				const configuredBudget = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
				const transport = budgetedTransport(this.redis, createConfiguredImportTransport(config), config.kinopoiskApiKey, Number.isSafeInteger(configuredBudget) && configuredBudget > 0 ? configuredBudget : 350, config.apiOrigins.kinopoisk);
				return this.taxonomy.enrichPerson(ps.entryId, ps.source, id => fetchImportedPerson(ps.source, id, config, transport));
			});
		});
	}
}
