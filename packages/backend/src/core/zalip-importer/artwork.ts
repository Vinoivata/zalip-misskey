/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { safeImportUrl } from './providers.js';
import type { Agent } from 'node:https';

const artworkHosts = ['image.tmdb.org', 'st.kp.yandex.net', 'avatars.mds.yandex.net', 'kinopoiskapiunofficial.tech'];
const dimensions = { posterUrl: [780, 1170], backdropUrl: [1920, 1080], logoUrl: [1000, 600], galleryUrls: [1280, 720] } as const;
export type ImportArtworkField = keyof typeof dimensions;

/** Only known image CDNs can be downloaded; arbitrary provider URLs remain remote. */
export function importArtworkUrl(value: string): URL | null {
	const safe = safeImportUrl(value, artworkHosts);
	if (!safe) return null;
	const url = new URL(safe);
	if (url.hostname === 'kinopoiskapiunofficial.tech' && !url.pathname.startsWith('/images/')) return null;
	return url;
}

export function artworkCacheUri(url: URL, field: ImportArtworkField): string {
	return `zalip:import-artwork:v1:${field}:${createHash('sha256').update(url.href).digest('hex')}`;
}

/** Size/timeout, no redirects, MIME plus decoder checks; no upstream errors leave this boundary. */
export async function downloadImportArtwork(url: URL, field: ImportArtworkField, agent?: Agent): Promise<{ original: Buffer; webp: Buffer; extension: string }> {
	if (!importArtworkUrl(url.href)) throw new Error('IMPORT_ARTWORK_REJECTED');
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 12000);
	try {
		const response = await fetch(url.href, { redirect: 'error', size: 8 * 1024 * 1024, signal: controller.signal, agent });
		const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (!response.ok || !mime || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mime)) throw new Error('IMPORT_ARTWORK_REJECTED');
		const original = Buffer.from(await response.arrayBuffer());
		if (!original.length || original.length > 8 * 1024 * 1024) throw new Error('IMPORT_ARTWORK_REJECTED');
		const image = sharp(original, { limitInputPixels: 32000000, animated: false });
		const metadata = await image.metadata();
		if (!metadata.format || !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format) || (metadata.pages ?? 1) > 1) throw new Error('IMPORT_ARTWORK_REJECTED');
		const [width, height] = dimensions[field];
		const webp = await image.rotate().resize(width, height, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80, alphaQuality: 95, effort: 2 }).toBuffer();
		return { original, webp, extension: metadata.format === 'jpeg' ? 'jpg' : metadata.format === 'heif' ? 'avif' : metadata.format };
	} catch {
		throw new Error('IMPORT_ARTWORK_UNAVAILABLE');
	} finally {
		clearTimeout(timer);
	}
}
