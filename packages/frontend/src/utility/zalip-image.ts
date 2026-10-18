/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref } from 'vue';
import { importerImageUrl } from '@/utility/zalip-importer.js';

export type ZalipPosterImage = { posterPath?: string | null; posterThumbnailUrl?: string | null };

/** Small cards may use an existing server rendition; large artwork keeps the chosen original. */
export function zalipPosterCandidates(work: ZalipPosterImage, size = 'w342'): string[] {
	return [...new Set([importerImageUrl(work.posterThumbnailUrl), importerImageUrl(work.posterPath, size)].filter((value): value is string => value != null))];
}

/** Keep distant horizontal slides out of the image request queue, including their logos. */
export function zalipHeroImageNearby(index: number, active: number): boolean {
	return Math.abs(index - active) <= 1;
}

export function useZalipImages() {
	const broken = ref<ReadonlySet<string>>(new Set());

	function poster(work: ZalipPosterImage, size = 'w342'): string | null {
		return zalipPosterCandidates(work, size).find(value => !broken.value.has(value)) ?? null;
	}

	function failed(event: Event): void {
		const image = event.currentTarget;
		if (!(image instanceof HTMLImageElement)) return;
		const source = image.getAttribute('src');
		if (source) broken.value = new Set([...broken.value, source]);
	}

	return { poster, failed };
}
