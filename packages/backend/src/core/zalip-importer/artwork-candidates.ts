/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import { importArtworkFields, type ImportArtworkCandidate, type ImportArtworkField, type ImportField, type ImportOptions, type ImportRecord, type ImportRef } from './types.js';

/** These IDs identify only normalized provider pictures, never a client-supplied download URL. */
export function artworkCandidate(input: Omit<ImportArtworkCandidate, 'id'>): ImportArtworkCandidate {
	return { ...input, id: createHash('sha256').update(JSON.stringify([input.source, input.field, input.url])).digest('hex') };
}

/** Plain provider URLs remain selectable even when an upstream has no image-gallery endpoint. */
export function recordArtworkCandidates(record: ImportRecord, fields?: readonly ImportField[]): ImportArtworkCandidate[] {
	const candidates = new Map<string, ImportArtworkCandidate>();
	const add = (candidate: ImportArtworkCandidate) => {
		if (fields && !fields.includes(candidate.field)) return;
		// Metadata may improve a basic candidate, but an untrusted upstream ID is never accepted.
		const normalized = artworkCandidate(candidate);
		if (!candidates.has(normalized.id) && [...candidates.values()].filter(value => value.field === candidate.field).length >= 18) return;
		candidates.set(normalized.id, normalized);
	};
	for (const field of importArtworkFields) {
		const values = field === 'galleryUrls' ? record.galleryUrls : record[field] ? [record[field]] : [];
		for (const url of values) add(artworkCandidate({ source: record.ref.source, field, url, previewUrl: url, width: null, height: null, language: null }));
	}
	for (const candidate of record.artworkCandidates ?? []) add(candidate);
	return [...candidates.values()];
}

export function sameImportRef(left: ImportRef, right: ImportRef): boolean {
	return left.source === right.source && left.externalId === right.externalId && left.mediaType === right.mediaType;
}

/** Recomputed for the exact item before any download; one title's choices cannot affect another. */
export function selectImportArtwork(record: ImportRecord, ref: ImportRef, options: ImportOptions, sources: Record<string, string>): { record: ImportRecord; sources: Record<string, string>; selectedFields: ImportArtworkField[] } {
	const selection = options.artworkSelections?.find(value => sameImportRef(value.ref, ref));
	if (!selection) return { record, sources, selectedFields: [] };
	const result = structuredClone(record);
	const selectedSources = { ...sources };
	const selectedFields: ImportArtworkField[] = [];
	for (const field of importArtworkFields) {
		const choice = selection.choices[field];
		if (choice === undefined) continue;
		if (options.fields && !options.fields.includes(field)) throw new Error('INVALID_IMPORT_OPTIONS');
		const ids = typeof choice === 'string' ? [choice] : choice;
		const selected: ImportArtworkCandidate[] = [];
		for (const id of ids) {
			const candidate = result.artworkCandidates?.find(value => value.id === id && value.field === field);
			if (!candidate) throw new Error('IMPORT_ARTWORK_SELECTION_STALE');
			selected.push(candidate);
		}
		if (field === 'galleryUrls') result.galleryUrls = selected.map(value => value.url);
		else {
			if (!selected[0]) throw new Error('IMPORT_ARTWORK_SELECTION_STALE');
			result[field] = selected[0].url;
		}
		selectedSources[field] = selected[0]?.source ?? ref.source;
		selectedFields.push(field);
	}
	return { record: result, sources: selectedSources, selectedFields };
}
