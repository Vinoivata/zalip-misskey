/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { ImportArtworkCandidate, ImportArtworkChoices, ImportArtworkField, ImportArtworkSettings, ImportOptions, ImportPreview, ImportRef } from '@/utility/zalip-importer.js';

export const importerArtworkFields: ImportArtworkField[] = ['posterUrl', 'backdropUrl', 'logoUrl', 'galleryUrls'];

/** Copy every nested size: editing a form must never alter a saved profile or submitted job. */
export function importerArtworkSettings(settings?: ImportArtworkSettings, legacy = false): ImportArtworkSettings {
	const defaults: ImportArtworkSettings = { format: 'webp', quality: legacy ? 80 : 85, keepOriginal: true, galleryLimit: legacy ? 12 : 18, sizes: { posterUrl: { width: 780, height: 1170, fit: 'inside' }, backdropUrl: { width: 1920, height: 1080, fit: 'inside' }, logoUrl: { width: 1000, height: 600, fit: 'inside' }, galleryUrls: { width: 1280, height: 720, fit: 'inside' } } };
	return { ...defaults, ...settings, sizes: Object.fromEntries(importerArtworkFields.map(field => [field, { ...defaults.sizes[field], ...settings?.sizes[field] }])) as ImportArtworkSettings['sizes'] };
}

export function importerArtworkSettingsValid(settings: ImportArtworkSettings): boolean {
	const integer = (value: number, min: number, max: number): boolean => Number.isInteger(value) && value >= min && value <= max;
	return ['original', 'webp', 'avif', 'jpeg', 'png'].includes(settings.format) && integer(settings.quality, 1, 100) && typeof settings.keepOriginal === 'boolean' && integer(settings.galleryLimit, 0, 18) && importerArtworkFields.every(field => integer(settings.sizes[field].width, 0, 5000) && integer(settings.sizes[field].height, 0, 5000) && ['inside', 'cover'].includes(settings.sizes[field].fit));
}

/** A manual selection is scoped to one exact provider reference, never copied to schedules. */
export function importerArtworkOptions(options: ImportOptions, ref: ImportRef, choices: ImportArtworkChoices): ImportOptions {
	const snapshot: ImportArtworkChoices = { ...choices, ...(choices.galleryUrls ? { galleryUrls: [...choices.galleryUrls] } : {}) };
	const policy = { ...options }; delete policy.artworkSelections;
	return { ...policy, ...(Object.keys(snapshot).length ? { artworkSelections: [{ ref: { ...ref }, choices: snapshot }] } : {}) };
}

/** A zero download limit preserves the current gallery unless the administrator explicitly clears it. */
export function importerArtworkLimitChoices(choices: ImportArtworkChoices, galleryLimit = 18): ImportArtworkChoices {
	const result = { ...choices };
	if (choices.galleryUrls !== undefined) {
		if (galleryLimit === 0 && choices.galleryUrls.length > 0) delete result.galleryUrls;
		else result.galleryUrls = choices.galleryUrls.slice(0, galleryLimit);
	}
	return result;
}

export function importerArtworkSelectionStale(error: unknown): boolean {
	const code = typeof error === 'string' ? error : typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
	return code === 'IMPORT_ARTWORK_SELECTION_STALE' || code === 'ZALIP_IMPORT_ARTWORK_SELECTION_STALE';
}

/** Automatic ownership protection is not a persisted lock: an explicit editor choice can replace it. */
export function importerArtworkFieldLocked(preview: ImportPreview, field: ImportArtworkField, locks: readonly string[] = []): boolean {
	const change = preview.changes.find(item => item.field === field);
	return locks.includes(field) || preview.locks?.includes(field) === true || change?.selected === false || (preview.locks === undefined && change?.protected === true);
}

/** A refreshed provider set can remove candidates. Do not submit stale or newly protected choices. */
export function importerArtworkCurrentChoices(preview: ImportPreview, choices: ImportArtworkChoices): ImportArtworkChoices {
	const result: ImportArtworkChoices = {};
	for (const field of importerArtworkFields) {
		if (importerArtworkFieldLocked(preview, field)) continue;
		const ids = new Set((preview.record.artworkCandidates ?? []).filter(candidate => candidate.field === field).map(candidate => candidate.id));
		const choice = choices[field];
		if (field === 'galleryUrls' && Array.isArray(choice)) result.galleryUrls = choice.filter(id => ids.has(id));
		else if (field !== 'galleryUrls' && typeof choice === 'string' && ids.has(choice)) result[field] = choice;
	}
	return result;
}

export function importerArtworkChoiceSelected(candidate: ImportArtworkCandidate, choices: ImportArtworkChoices, preview: ImportPreview, galleryLimit = 18): boolean {
	if (candidate.field === 'galleryUrls' && galleryLimit === 0) return false;
	const choice = importerArtworkLimitChoices(choices, galleryLimit)[candidate.field];
	if (choice !== undefined) return Array.isArray(choice) ? choice.includes(candidate.id) : choice === candidate.id;
	const current = candidate.field === 'galleryUrls' ? preview.record.galleryUrls.slice(0, galleryLimit) : preview.record[candidate.field];
	const first = preview.record.artworkCandidates?.find(item => item.field === candidate.field && item.url === candidate.url);
	return first?.id === candidate.id && (Array.isArray(current) ? current.includes(candidate.url) : current === candidate.url);
}

/** Project only advertised IDs into the preview. The server independently revalidates every ID. */
export function importerArtworkPreview(preview: ImportPreview, choices: ImportArtworkChoices, locks: readonly string[] = [], galleryLimit = 18): ImportPreview {
	const record = { ...preview.record, galleryUrls: [...preview.record.galleryUrls] };
	const limitedChoices = importerArtworkLimitChoices(choices, galleryLimit);
	const explicitFields = new Set<ImportArtworkField>();
	for (const field of importerArtworkFields) {
		const choice = limitedChoices[field];
		if (importerArtworkFieldLocked(preview, field, locks) || (choice === undefined && preview.changes.some(change => change.field === field && change.protected))) continue;
		if (field === 'galleryUrls' && galleryLimit === 0 && !(Array.isArray(choice) && choice.length === 0)) {
			const before = preview.changes.find(change => change.field === field)?.before;
			record.galleryUrls = preview.workId && Array.isArray(before) ? before.filter((value): value is string => typeof value === 'string') : [];
			continue;
		}
		if (choice === undefined) { if (field === 'galleryUrls') record.galleryUrls = record.galleryUrls.slice(0, galleryLimit); continue; }
		const candidates = (preview.record.artworkCandidates ?? []).filter(candidate => candidate.field === field);
		if (field === 'galleryUrls' && Array.isArray(choice)) {
			const selected = choice.map(id => candidates.find(candidate => candidate.id === id));
			if (selected.every(candidate => candidate !== undefined)) { record.galleryUrls = selected.map(candidate => candidate.url); explicitFields.add(field); }
		} else if (field !== 'galleryUrls' && typeof choice === 'string') {
			const selected = candidates.find(candidate => candidate.id === choice);
			if (selected) { record[field] = selected.url; explicitFields.add(field); }
		}
	}
	return { ...preview, record, changes: preview.changes.map(change => importerArtworkFields.includes(change.field as ImportArtworkField) ? { ...change, after: record[change.field as ImportArtworkField], protected: explicitFields.has(change.field as ImportArtworkField) ? false : change.protected } : change) };
}

/** Only the current title can carry manual choices; batch and schedule callers use plain options. */
export function importerArtworkSameRef(left: ImportRef, right: ImportRef): boolean {
	return left.source === right.source && left.mediaType === right.mediaType && left.externalId === right.externalId;
}
