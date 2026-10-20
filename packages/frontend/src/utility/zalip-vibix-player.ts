/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** These public embed IDs are not API record IDs or the server-side bearer token. */
export type VibixEmbed = { publisherId: string; type: 'movie' | 'series'; id: string };
export type VibixPlayerSelection = { seasonNumber: number | null; episodeNumber: number | null; translationId: string | null };

/** Never add allow-same-origin: the third-party SDK must not see Misskey cookies or storage. */
export const vibixPlayerSandbox = 'allow-scripts allow-forms allow-presentation';
const sdkUrls = ['https://graphicslab.io/sdk/v2/rendex-sdk.min.js', 'https://alt.graphicslab.io/sdk/v2/rendex-sdk.min.js'] as const;
const positiveId = (value: unknown): value is string => typeof value === 'string' && /^[1-9]\d{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));

export function validVibixEmbed(value: unknown): value is VibixEmbed {
	if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
	const fields = Object.getOwnPropertyDescriptors(value);
	if (Reflect.ownKeys(value).length !== 3 || Object.keys(fields).some(key => !['publisherId', 'type', 'id'].includes(key) || !Object.hasOwn(fields[key], 'value'))) return false;
	return positiveId(fields.publisherId?.value) && positiveId(fields.id?.value) && (fields.type?.value === 'movie' || fields.type?.value === 'series');
}

/** Only fixed markup and validated documented data-* values; never interpolate provider embed HTML. */
export function vibixPlayerDocument(embed: unknown, selection: VibixPlayerSelection = { seasonNumber: null, episodeNumber: null, translationId: null }): string | null {
	if (!validVibixEmbed(embed) || (selection.translationId != null && !positiveId(selection.translationId))) return null;
	const { seasonNumber, episodeNumber } = selection;
	if ((seasonNumber == null) !== (episodeNumber == null)) return null;
	if (seasonNumber != null && (embed.type !== 'series' || !Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 1000 || !Number.isSafeInteger(episodeNumber) || episodeNumber! < 0 || episodeNumber! > 100000)) return null;
	const attributes = [
		`data-publisher-id="${embed.publisherId}"`, `data-type="${embed.type}"`, `data-id="${embed.id}"`,
		'data-width="100%"', 'data-height="100%"',
		...(seasonNumber == null ? [] : [`data-season="${seasonNumber}"`, `data-episodes="${episodeNumber}"`]),
		...(selection.translationId == null ? [] : [`data-voiceover="${selection.translationId}"`, 'data-voiceover-only="true"']),
	];
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;width:100%;height:100%;background:transparent}ins,iframe{display:block;width:100%;height:100%;border:0}</style>${sdkUrls.map(url => `<script src="${url}" async></script>`).join('')}</head><body><ins ${attributes.join(' ')}></ins></body></html>`;
}
