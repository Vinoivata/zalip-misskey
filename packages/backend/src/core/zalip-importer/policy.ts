/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { importFields, type ImportField, type ImportRecord, type ImportWorkState } from './types.js';

export function nonEmpty(value: unknown): boolean {
	return value != null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

export function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

/** Without an ownership baseline existing nonempty data is treated as editorial. */
export function canUpdateField(current: unknown, previous: unknown, incoming: unknown, locked: boolean): boolean {
	return !locked && nonEmpty(incoming) && (previous !== undefined ? sameValue(current, previous) : !nonEmpty(current));
}

export function readImportState(data: Record<string, unknown> | undefined): ImportWorkState {
	const value = data ?? {};
	return {
		locks: Array.isArray(value.locks) ? value.locks.filter((item): item is string => typeof item === 'string') : [],
		values: value.values && typeof value.values === 'object' ? value.values as Record<string, unknown> : {},
		sources: value.sources && typeof value.sources === 'object' ? value.sources as Record<string, string> : {},
		countries: Array.isArray(value.countries) ? value.countries as string[] : [],
		ratings: Array.isArray(value.ratings) ? value.ratings as ImportRecord['ratings'] : [],
		ageRating: typeof value.ageRating === 'string' ? value.ageRating : null,
	};
}

export function mergeImportRecords(records: ImportRecord[]): { record: ImportRecord; sources: Record<string, string> } {
	if (records.length === 0) throw new Error('Import needs at least one normalized record.');
	const first = records[0];
	const record = structuredClone(first);
	const sources: Record<string, string> = {};
	const artwork = new Set(['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls', 'trailerYoutubeKey', 'seasons']);
	for (const field of importFields) {
		const priority = artwork.has(field) ? ['tmdb', 'kinopoisk', 'collaps', 'alloha'] : ['kinopoisk', 'tmdb', 'collaps', 'alloha'];
		const candidates = [...records].sort((left, right) => priority.indexOf(left.ref.source) - priority.indexOf(right.ref.source));
		const selected = candidates.find(candidate => nonEmpty(candidate[field]));
		if (selected) {
			(record as unknown as Record<ImportField, unknown>)[field] = structuredClone(selected[field]);
			sources[field] = selected.ref.source;
		}
	}
	const identities = new Map<string, ImportRecord['identities'][number]>();
	for (const item of records.flatMap(item => item.identities)) identities.set(`${item.provider}/${item.entityType}/${item.externalId}`, item);
	record.identities = [...identities.values()];
	record.players = records.flatMap(item => item.players).filter((item, index, all) => all.findIndex(other => other.source === item.source && other.externalId === item.externalId) === index);
	record.ratings = records.flatMap(item => item.ratings).filter((item, index, all) => all.findIndex(other => other.source === item.source) === index);
	record.collections = records.flatMap(item => item.collections).filter((item, index, all) => all.findIndex(other => other.source === item.source && other.externalId === item.externalId) === index);
	record.complete = records.every(item => item.complete);
	record.warnings = [...new Set(records.flatMap(item => item.warnings))];
	return { record, sources };
}
