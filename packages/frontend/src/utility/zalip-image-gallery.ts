/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { importerImageUrl } from '@/utility/zalip-importer.js';

export type ZalipGalleryImage = string | {
	url: string;
	thumbnailUrl?: string | null;
	width?: number | null;
	height?: number | null;
	alt?: string;
};

export type NormalizedZalipGalleryImage = {
	url: string;
	thumbnailUrl: string | null;
	width: number | null;
	height: number | null;
	alt: string;
};

/** URL-only artwork stays URL-only: never invent a DriveFile or feed it to a file API. */
export function normalizeZalipGallery(images: readonly ZalipGalleryImage[]): NormalizedZalipGalleryImage[] {
	const seen = new Set<string>();
	const dimension = (value: number | null | undefined): number | null => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
	return images.flatMap(image => {
		const source = typeof image === 'string' ? { url: image } : image;
		const url = importerImageUrl(source.url, 'original');
		if (!url || seen.has(url)) return [];
		seen.add(url);
		return [{ url, thumbnailUrl: importerImageUrl(source.thumbnailUrl), width: dimension(source.width), height: dimension(source.height), alt: source.alt ?? '' }];
	});
}
