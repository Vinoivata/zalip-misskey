/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validVibixEmbed, vibixPlayerDocument, vibixPlayerSandbox } from '@/utility/zalip-vibix-player.js';

const embed = { publisherId: '123456789', type: 'series', id: '12345' } as const;
const selection = { seasonNumber: 2, episodeNumber: 5, translationId: '42' };
const sdkUrls = ['https://graphicslab.io/sdk/v2/rendex-sdk.min.js', 'https://alt.graphicslab.io/sdk/v2/rendex-sdk.min.js'];

function sdkHarness() {
	const markup = vibixPlayerDocument(embed, selection)!;
	const document = new DOMParser().parseFromString(markup, 'text/html');
	const bootstrap = document.querySelector('script')!.textContent!;
	const attempts: HTMLScriptElement[] = [];
	const pending: { callback: () => void; delay: number }[] = [];
	vi.spyOn(document.head, 'appendChild').mockImplementation(<T extends Node>(node: T): T => {
		// Execute only our bootstrap, never fetch or evaluate third-party SDK code.
		expect(document.querySelector('ins')?.getAttribute('data-id')).toBe(embed.id);
		expect(document.querySelector('ins')?.getAttribute('data-episodes')).toBe(String(selection.episodeNumber));
		const script = node as unknown as HTMLScriptElement;
		vi.spyOn(script, 'remove');
		attempts.push(script);
		return node;
	});
	const start = () => runInNewContext(bootstrap, {
		document,
		window: { setTimeout: (callback: () => void, delay: number) => { pending.push({ callback, delay }); } },
	}, { timeout: 1000 });
	const fail = () => attempts.at(-1)!.dispatchEvent(new Event('error'));
	const succeed = () => attempts.at(-1)!.dispatchEvent(new Event('load'));
	return { markup, document, attempts, pending, start, fail, succeed };
}

afterEach(() => vi.restoreAllMocks());

describe('isolated Vibix SDK document', () => {
	it('builds only documented SDK attributes from public embed IDs, not API record IDs or raw HTML', () => {
		const document = new DOMParser().parseFromString(vibixPlayerDocument(embed, selection)!, 'text/html');
		expect(document.head.querySelectorAll('script')).toHaveLength(0);
		expect(document.querySelectorAll('script')).toHaveLength(1);
		expect(document.querySelector('script')?.hasAttribute('src')).toBe(false);
		expect(document.querySelector('ins')?.nextElementSibling?.tagName).toBe('SCRIPT');
		expect([...document.querySelector('ins')!.attributes].map(attribute => [attribute.name, attribute.value])).toEqual([['data-publisher-id', '123456789'], ['data-type', 'series'], ['data-id', '12345'], ['data-width', '100%'], ['data-height', '100%'], ['data-season', '2'], ['data-episodes', '5'], ['data-voiceover', '42'], ['data-voiceover-only', 'true']]);
		expect(document.querySelectorAll('iframe')).toHaveLength(0);
		expect(vibixPlayerSandbox.split(' ')).toEqual(['allow-scripts', 'allow-forms', 'allow-presentation']);
		expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
	});
	it('starts the primary SDK after the complete INS exists and does not load the fallback after success', () => {
		const harness = sdkHarness();
		harness.start();
		expect(harness.attempts.map(script => script.src)).toEqual(sdkUrls.slice(0, 1));
		expect(harness.attempts[0].async).toBe(true);
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('loading');
		harness.succeed();
		harness.start();
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('ready');
		expect(harness.attempts).toHaveLength(1);
		expect(harness.pending).toHaveLength(0);
	});
	it('loads one fallback only after the primary fails, ignoring stale and repeated callbacks', () => {
		const harness = sdkHarness();
		harness.start();
		const primary = harness.attempts[0];
		const staleError = primary.onerror!;
		const staleLoad = primary.onload!;
		harness.start();
		expect(harness.attempts).toHaveLength(1);
		harness.fail();
		expect(primary.remove).toHaveBeenCalledOnce();
		expect(harness.attempts.map(script => script.src)).toEqual(sdkUrls);
		staleError.call(primary, new Event('error'));
		staleLoad.call(primary, new Event('load'));
		expect(harness.attempts).toHaveLength(2);
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('loading');
		harness.succeed();
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('ready');
		expect(harness.pending).toHaveLength(0);
	});
	it('retries a failed primary/fallback pair only once with a bounded delay, then stops', () => {
		const harness = sdkHarness();
		harness.start();
		harness.fail();
		const fallback = harness.attempts[1];
		const staleError = fallback.onerror!;
		harness.fail();
		expect(harness.attempts).toHaveLength(2);
		expect(harness.pending.map(timer => timer.delay)).toEqual([800]);
		staleError.call(fallback, new Event('error'));
		expect(harness.pending).toHaveLength(1);
		harness.pending.shift()!.callback();
		expect(harness.attempts.map(script => script.src)).toEqual([...sdkUrls, sdkUrls[0]]);
		harness.fail();
		harness.fail();
		harness.start();
		expect(harness.attempts.map(script => script.src)).toEqual([...sdkUrls, ...sdkUrls]);
		expect(harness.pending).toHaveLength(0);
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('failed');
		for (const script of harness.attempts) expect(script.remove).toHaveBeenCalledOnce();
	});
	it('accepts success on the single retry without starting another fallback or retry', () => {
		const harness = sdkHarness();
		harness.start();
		harness.fail();
		harness.fail();
		harness.pending.shift()!.callback();
		const primary = harness.attempts[2];
		const staleError = primary.onerror!;
		harness.succeed();
		staleError.call(primary, new Event('error'));
		expect(harness.attempts).toHaveLength(3);
		expect(harness.pending).toHaveLength(0);
		expect(harness.document.documentElement.dataset.vibixSdkState).toBe('ready');
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
