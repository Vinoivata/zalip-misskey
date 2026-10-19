/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { useZalipImages, zalipHeroImageNearby, zalipPosterCandidates } from '@/utility/zalip-image.js';

describe('Zalip small artwork sources', () => {
	it('uses the existing thumbnail before the unchanged chosen original, without invented proxy sizes', () => {
		const work = { posterPath: 'https://social.example/files/original', posterThumbnailUrl: 'https://social.example/files/thumbnail' };
		expect(zalipPosterCandidates(work)).toEqual([work.posterThumbnailUrl, work.posterPath]);
		expect(work.posterPath).toBe('https://social.example/files/original');
	});
	it('keeps legacy TMDB size fallback and rejects executable or credentialed URLs', () => {
		expect(zalipPosterCandidates({ posterPath: '/poster.jpg' }, 'w185')).toEqual(['https://image.tmdb.org/t/p/w185/poster.jpg']);
		expect(zalipPosterCandidates({ posterPath: '/poster.jpg', posterThumbnailUrl: 'javascript:alert(1)' })).toEqual(['https://image.tmdb.org/t/p/w342/poster.jpg']);
		expect(zalipPosterCandidates({ posterPath: 'https://secret@example.test/p.jpg', posterThumbnailUrl: 'data:image/png,abc' })).toEqual([]);
	});
	it('deduplicates identical alternatives and remembers only failed sources', async () => {
		const images = useZalipImages();
		const work = { posterPath: 'https://social.example/files/original', posterThumbnailUrl: 'https://social.example/files/thumbnail' };
		const image = document.createElement('img');
		image.addEventListener('error', images.failed);
		expect(images.poster(work)).toBe(work.posterThumbnailUrl);
		image.src = images.poster(work)!;
		image.dispatchEvent(new Event('error'));
		await nextTick();
		expect(images.poster(work)).toBe(work.posterPath);
		image.src = images.poster(work)!;
		image.dispatchEvent(new Event('error'));
		expect(images.poster(work)).toBeNull();
		expect(images.poster({ posterPath: '/other.jpg' })).toContain('/other.jpg');
		expect(zalipPosterCandidates({ posterPath: work.posterPath, posterThumbnailUrl: work.posterPath })).toEqual([work.posterPath]);
	});
	it('only requests the visible horizontal hero and its immediate neighbours', () => {
		expect([0, 1, 2, 3, 4].filter(index => zalipHeroImageNearby(index, 1))).toEqual([0, 1, 2]);
		expect([0, 1, 2, 3, 4].filter(index => zalipHeroImageNearby(index, 4))).toEqual([3, 4]);
	});
	it('only hides the text fallback for the exact successfully loaded logo, and restores it on failure', () => {
		const images = useZalipImages();
		const image = document.createElement('img');
		image.addEventListener('load', images.loaded);
		image.addEventListener('error', images.failed);
		image.src = images.source('/logo.png')!;
		expect(images.ready('/logo.png')).toBe(false);
		image.dispatchEvent(new Event('load'));
		expect(images.ready('/logo.png')).toBe(true);
		expect(images.ready('/another-logo.png')).toBe(false);
		image.dispatchEvent(new Event('error'));
		expect(images.ready('/logo.png')).toBe(false);
		expect(images.source('/logo.png')).toBeNull();
		expect(images.source('/logo.png', 'original')).toContain('/original/logo.png');
		expect(images.source('javascript:alert(1)')).toBeNull();
	});
});
