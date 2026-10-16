/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { createHash } from 'node:crypto';
import fetch from 'node-fetch';
import sharp from 'sharp';
import { safeImportUrl } from './providers.js';
import { normalizeImportArtworkSettings } from './policy.js';
import type { ImportArtworkField, ImportArtworkSettingsInput } from './types.js';
import type { Agent } from 'node:https';

const artworkHosts = ['image.tmdb.org', 'st.kp.yandex.net', 'avatars.mds.yandex.net', 'kinopoiskapiunofficial.tech'];
export type { ImportArtworkField } from './types.js';

export const importArtworkLimits = Object.freeze({ inputBytes: 8 * 1024 * 1024, outputBytes: 24 * 1024 * 1024, pixels: 32000000, requestTimeoutMs: 12000, processingTimeoutSeconds: 10, batchTimeoutMs: 60000, batchBytes: 96 * 1024 * 1024 });
export type ImportArtworkDownload = { original: Buffer; processed: Buffer; extension: string; originalExtension: string; format: string; width: number; height: number };

/** Own only literal TMDB basenames: never reinterpret local /files paths or arbitrary relative URLs. */
export function equivalentImportArtwork(current: unknown, incoming: unknown, allowTmdbPath = false): boolean {
	if (Array.isArray(current) || Array.isArray(incoming)) return Array.isArray(current) && Array.isArray(incoming) && current.length === incoming.length && current.every((value, position) => equivalentImportArtwork(value, incoming[position], allowTmdbPath));
	if (typeof current !== 'string' || typeof incoming !== 'string') return current === incoming;
	const canonical = (value: string): string => {
		if (allowTmdbPath && /^\/[A-Za-z0-9._-]{1,256}$/u.test(value)) return `https://image.tmdb.org/t/p/original${value}`;
		try {
			const url = new URL(value);
			if (url.origin === 'https://image.tmdb.org' && !url.username && !url.password && !url.search && !url.hash && /^\/t\/p\/(?:original|w[1-9]\d{0,4})\/[A-Za-z0-9._-]{1,256}$/u.test(url.pathname)) return `https://image.tmdb.org/t/p/original/${url.pathname.split('/').pop()}`;
		} catch { /* Non-provider values can match literally, never by a fabricated provider URL. */ }
		return value;
	};
	return canonical(current) === canonical(incoming);
}

/** Only known image CDNs can be downloaded; arbitrary provider URLs remain remote. */
export function importArtworkUrl(value: string): URL | null {
	const safe = safeImportUrl(value, artworkHosts);
	if (!safe) return null;
	const url = new URL(safe);
	if (url.hostname === 'kinopoiskapiunofficial.tech' && !url.pathname.startsWith('/images/')) return null;
	return url;
}

export function artworkCacheUri(url: URL, field: ImportArtworkField, input?: ImportArtworkSettingsInput, legacy = true): string {
	const settings = normalizeImportArtworkSettings(input, legacy);
	// Fixed property order makes semantically identical form submissions share the same asset.
	const transform = { format: settings.format, quality: settings.quality, size: settings.sizes[field], alpha: 'preserve-logo-v1' };
	return `zalip:import-artwork:v2:${field}:${createHash('sha256').update(JSON.stringify([url.href, transform])).digest('hex')}`;
}

/** Retaining the same original at several sizes or in different roles does not duplicate it. */
export function artworkOriginalCacheUri(url: URL): string {
	return `zalip:import-artwork:original:v2:${createHash('sha256').update(url.href).digest('hex')}`;
}

/** Size/timeout, no redirects, MIME plus decoder checks; no upstream errors leave this boundary. */
export async function downloadImportArtwork(url: URL, field: ImportArtworkField, agent?: Agent, input?: ImportArtworkSettingsInput, legacy = true, deadlineAt = Date.now() + importArtworkLimits.requestTimeoutMs + importArtworkLimits.processingTimeoutSeconds * 1000): Promise<ImportArtworkDownload> {
	if (!importArtworkUrl(url.href)) throw new Error('IMPORT_ARTWORK_REJECTED');
	const settings = normalizeImportArtworkSettings(input, legacy);
	const controller = new AbortController();
	if (Date.now() >= deadlineAt) throw new Error('IMPORT_ARTWORK_UNAVAILABLE');
	const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(importArtworkLimits.requestTimeoutMs, deadlineAt - Date.now())));
	try {
		const response = await fetch(url.href, { redirect: 'error', size: importArtworkLimits.inputBytes, signal: controller.signal, agent });
		const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
		if (!response.ok || !mime || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(mime)) throw new Error('IMPORT_ARTWORK_REJECTED');
		const declaredSize = response.headers.get('content-length');
		if (declaredSize && (!/^\d+$/u.test(declaredSize) || Number(declaredSize) > importArtworkLimits.inputBytes)) throw new Error('IMPORT_ARTWORK_REJECTED');
		const original = Buffer.from(await response.arrayBuffer());
		if (!original.length || original.length > importArtworkLimits.inputBytes) throw new Error('IMPORT_ARTWORK_REJECTED');
		if (Date.now() >= deadlineAt) throw new Error('IMPORT_ARTWORK_REJECTED');
		const image = sharp(original, { limitInputPixels: importArtworkLimits.pixels, animated: false }).timeout({ seconds: Math.max(1, Math.min(importArtworkLimits.processingTimeoutSeconds, Math.floor((deadlineAt - Date.now()) / 1000))) });
		const metadata = await image.metadata();
		if (!metadata.format || !['jpeg', 'png', 'webp', 'avif', 'heif'].includes(metadata.format) || (metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height || metadata.width * metadata.height > importArtworkLimits.pixels) throw new Error('IMPORT_ARTWORK_REJECTED');
		const originalFormat = metadata.format === 'heif' ? 'avif' : metadata.format;
		let format = settings.format === 'original' ? originalFormat : settings.format;
		// JPEG cannot represent transparency. A logo requested as JPEG keeps PNG instead of a black rectangle.
		if (format === 'jpeg' && field === 'logoUrl' && metadata.hasAlpha) format = 'png';
		const { width, height, fit } = settings.sizes[field];
		let transformed = image.rotate();
		if (width || height) transformed = transformed.resize(width || undefined, height || undefined, { fit, withoutEnlargement: true });
		if (format === 'webp') transformed = transformed.webp({ quality: settings.quality, alphaQuality: 100, effort: 2 });
		else if (format === 'avif') transformed = transformed.avif({ quality: settings.quality, effort: 2 });
		else if (format === 'jpeg') transformed = transformed.flatten({ background: '#ffffff' }).jpeg({ quality: settings.quality });
		else transformed = transformed.png({ compressionLevel: 8 });
		const { data, info } = await transformed.toBuffer({ resolveWithObject: true });
		if (!data.length || data.length > importArtworkLimits.outputBytes || info.width * info.height > importArtworkLimits.pixels || Date.now() >= deadlineAt) throw new Error('IMPORT_ARTWORK_REJECTED');
		return { original, processed: data, extension: format === 'jpeg' ? 'jpg' : format, originalExtension: originalFormat === 'jpeg' ? 'jpg' : originalFormat, format, width: info.width, height: info.height };
	} catch {
		throw new Error('IMPORT_ARTWORK_UNAVAILABLE');
	} finally {
		clearTimeout(timer);
	}
}
