/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DI } from '@/di-symbols.js';
import { ZalipTaxonomyService, type PackedZalipCatalogEntry } from '@/core/ZalipTaxonomyService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { ZalipImporterArtworkService } from '@/core/ZalipImporterArtworkService.js';
import { budgetedTransport } from '@/core/zalip-importer/budget.js';
import { createConfiguredImportTransport, ImportProviderError } from '@/core/zalip-importer/providers.js';
import { fetchImportedPerson, parseImportPersonReference, type ImportPersonSource, type ImportPersonInput } from '@/core/zalip-importer/persons.js';
import type { ZalipCatalogEntryInput } from '@/misc/zalip-taxonomy.js';
import type * as Redis from 'ioredis';

export const personImportWarnings = ['person-photo-local-unavailable'] as const;
export type PersonImportWarning = typeof personImportWarnings[number];
type PackedImportedPersonEntry = Omit<PackedZalipCatalogEntry, 'type'> & { type: 'person' };
export type ImportedPersonPreview = {
	type: 'person'; name: string; description: string | null; imageUrl: string | null;
	externalIds: Record<string, string>; data: Record<string, unknown>;
};
export type PersonImportResult = {
	preview: boolean; source: ImportPersonSource; externalId: string; person: ImportedPersonPreview;
	existingEntry: PackedImportedPersonEntry | null; entry: PackedImportedPersonEntry | null;
	created: boolean; changedFields: string[]; warnings: PersonImportWarning[];
};

/** Administrator-requested person import. No name matching, external filmography or raw payload storage. */
@Injectable()
export class ZalipPersonImportService {
	constructor(
		private taxonomy: ZalipTaxonomyService,
		private settings: ZalipImporterSourceSettingsService,
		private artwork: ZalipImporterArtworkService,
		@Inject(DI.redis) private redis: Redis.Redis,
	) {}

	private packedPerson(entry: PackedZalipCatalogEntry): PackedImportedPersonEntry {
		if (entry.type !== 'person') throw new ImportProviderError('malformed-response');
		return { ...entry, type: 'person' };
	}

	private async runtime() {
		const config = await this.settings.getRuntime();
		const configuredBudget = Number(process.env.ZALIP_KINOPOISK_DAILY_BUDGET ?? 350);
		const transport = budgetedTransport(this.redis, createConfiguredImportTransport(config), config.kinopoiskApiKey, Number.isSafeInteger(configuredBudget) && configuredBudget > 0 ? configuredBudget : 350, config.apiOrigins.kinopoisk);
		return { config, transport };
	}

	/** Keep editorial/local photographs untouched, including during an otherwise useful metadata refresh. */
	public async localizePhoto(person: ZalipCatalogEntryInput, allowed: boolean, warnings: PersonImportWarning[]): Promise<ImportPersonInput> {
		const result: ImportPersonInput = structuredClone(person);
		if (!allowed) { delete result.imageUrl; return result; }
		if (!result.imageUrl) return result;
		try {
			result.imageUrl = await this.artwork.cachePersonPhoto(result.imageUrl);
			result.localizedImage = result.imageUrl;
		} catch {
			// Only the normalized public provider photo survives. Failure is never reported as local success.
			warnings.push('person-photo-local-unavailable');
		}
		return result;
	}

	public async importPerson(source: ImportPersonSource, reference: string, preview = true): Promise<PersonImportResult> {
		const externalId = parseImportPersonReference(source, reference);
		const existing = await this.taxonomy.findImportedPerson(source, externalId);
		const { config, transport } = await this.runtime();
		const person = await fetchImportedPerson(source, externalId, config, transport);
		const warnings: PersonImportWarning[] = [];
		const result: PersonImportResult = {
			preview, source, externalId,
			person: { type: 'person', name: person.name, description: person.description ?? null, imageUrl: person.imageUrl ?? null, externalIds: person.externalIds ?? {}, data: person.data ?? {} },
			existingEntry: existing ? this.packedPerson(existing.entry) : null, entry: null, created: false, changedFields: [], warnings,
		};
		// Preview consumes only the same bounded provider requests; no catalogue or Drive writes.
		if (preview) return result;
		const localized = await this.localizePhoto(person, existing?.canImportImage ?? true, warnings);
		const imported = await this.taxonomy.importPerson(localized, source);
		return { ...result, ...imported, entry: this.packedPerson(imported.entry) };
	}

	public async enrichPerson(entryId: string, source: ImportPersonSource): Promise<{ entry: PackedImportedPersonEntry; changedFields: string[]; warnings: PersonImportWarning[] }> {
		const { config, transport } = await this.runtime();
		const warnings: PersonImportWarning[] = [];
		const result = await this.taxonomy.enrichPerson(entryId, source, async (id, context) => this.localizePhoto(await fetchImportedPerson(source, id, config, transport), context.canImportImage, warnings));
		return { ...result, entry: this.packedPerson(result.entry), warnings };
	}
}
