/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { validVibixEmbed, vibixPlayerDocument, vibixPlayerSandbox } from '@/utility/zalip-vibix-player.js';

const embed = { publisherId: '123456789', type: 'series', id: '12345' } as const;
const selection = { seasonNumber: 2, episodeNumber: 5, translationId: '42' };

describe('isolated Vibix SDK document', () => {
	it('builds only documented SDK attributes from public embed IDs, not API record IDs or raw HTML', () => {
		const document = new DOMParser().parseFromString(vibixPlayerDocument(embed, selection)!, 'text/html');
		expect([...document.querySelectorAll('script')].map(script => script.src)).toEqual(['https://graphicslab.io/sdk/v2/rendex-sdk.min.js', 'https://alt.graphicslab.io/sdk/v2/rendex-sdk.min.js']);
		expect([...document.querySelector('ins')!.attributes].map(attribute => [attribute.name, attribute.value])).toEqual([['data-publisher-id', '123456789'], ['data-type', 'series'], ['data-id', '12345'], ['data-width', '100%'], ['data-height', '100%'], ['data-season', '2'], ['data-episodes', '5'], ['data-voiceover', '42'], ['data-voiceover-only', 'true']]);
		expect(document.querySelectorAll('iframe')).toHaveLength(0);
		expect(vibixPlayerSandbox.split(' ')).toEqual(['allow-scripts', 'allow-forms', 'allow-presentation']);
		expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
	});
	it('allows a movie or unknown native serial selection without inventing coordinates or a time offset', () => {
		for (const type of ['movie', 'series'] as const) {
			const document = new DOMParser().parseFromString(vibixPlayerDocument({ ...embed, type })!, 'text/html');
			for (const attribute of ['data-season', 'data-episodes', 'data-episode', 'data-time', 'data-start', 'data-voiceover']) expect(document.querySelector('ins')!.hasAttribute(attribute)).toBe(false);
		}
	});
	it.each(['', '0', '-1', '1.5', '01', '1" onload="alert(1)', '<script>', '1'.repeat(17), '9007199254740992'])('rejects unsafe/noncanonical numeric public IDs: %s', value => {
		for (const field of ['publisherId', 'id']) expect(validVibixEmbed({ ...embed, [field]: value })).toBe(false);
		expect(vibixPlayerDocument(embed, { ...selection, translationId: value })).toBeNull();
	});
	it('rejects raw embed HTML, unknown types, partial coordinates and accessor properties', () => {
		for (const value of ['<ins data-id="123">', { ...embed, html: '<script>' }, { ...embed, type: 'kp' }, { ...embed, id: 123 }, Object.defineProperty({ ...embed }, 'id', { get: () => { throw new Error('must not invoke accessor'); } })]) expect(vibixPlayerDocument(value)).toBeNull();
		for (const candidate of [{ ...selection, seasonNumber: null }, { ...selection, episodeNumber: null }, { ...selection, seasonNumber: -1 }, { ...selection, episodeNumber: 100001 }, { ...selection, episodeNumber: Number.NaN }]) expect(vibixPlayerDocument(embed, candidate)).toBeNull();
		expect(vibixPlayerDocument({ ...embed, type: 'movie' }, selection)).toBeNull();
	});
});
