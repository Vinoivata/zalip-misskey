/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import Home from '@/pages/zalip/index.vue';
import ShareCard from '@/components/ZalipShareCard.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { enablePullToRefresh: false } } }));
vi.mock('@/components/MkZalipFeed.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('@/pages/zalip/continue-rail.vue', () => ({ default: { template: '<div></div>' } }));
vi.mock('@/composables/use-zalip-horizontal-drag.js', () => ({ useZalipHorizontalDrag: () => ({}) }));

const stubs = {
	PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
	MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	MkZalipIcon: true,
};
const works = Array.from({ length: 5 }, (_, index) => ({ id: String(index), slug: `work-${index}`, kind: 'movie' as const, title: `Title ${index}`, originalTitle: null, description: 'Description', releaseYear: 2026, posterPath: `/poster-${index}.jpg`, posterThumbnailUrl: `https://social.example/files/thumb-${index}`, backdropPath: `/cover-${index}.jpg`, logoPath: `/logo-${index}.png`, trailerYoutubeKey: null, genres: [], communityRating: null, ratingCount: 0 }));

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => endpoint === 'zalip/works/list' ? works : []);
});
afterEach(cleanup);

describe('home image request budget', () => {
	it('reserves the hero while loading without requesting fallback images, then loads the active slide and neighbours', async () => {
		let finish!: (value: unknown) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(endpoint => endpoint === 'zalip/works/list' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([]));
		const view = render(Home, { global: { stubs } });
		expect(view.getByRole('status').getAttribute('aria-busy')).toBe('true');
		expect(view.container.querySelector('img[src]')).toBeNull();
		finish(works);
		await waitFor(() => expect(view.container.querySelectorAll('picture img')).toHaveLength(5));
		const images = [...view.container.querySelectorAll('picture img')];
		expect(images.map(image => image.hasAttribute('src'))).toEqual([true, true, true, false, false]);
		expect(images[1].getAttribute('loading')).toBe('eager');
		expect(images[1].getAttribute('fetchpriority')).toBe('high');
		expect(images.every(image => image.getAttribute('decoding') === 'async')).toBe(true);
		expect(view.container.querySelectorAll('picture source')).toHaveLength(3);
		expect(view.container.querySelectorAll('img[src*="logo-"]')).toHaveLength(3);
		expect(view.container.querySelector('img[src*="onboarding/"]')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.tsx.zalip.onboardingDot({ number: '5' }) }));
		expect(images.map(image => image.hasAttribute('src'))).toEqual([false, false, false, true, true]);
		expect(images[4].getAttribute('loading')).toBe('eager');
		expect(view.container.querySelectorAll('img[src*="logo-"]')).toHaveLength(2);
	});
	it('only shows onboarding artwork after an actual empty response', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue([]);
		const view = render(Home, { global: { stubs } });
		await waitFor(() => expect(view.container.querySelectorAll('picture img[src]')).toHaveLength(3));
		expect(view.container.querySelector('img[src*="onboarding/"]')).toBeTruthy();
	});
	it('keeps a failed initial catalogue request usable with the real fallback carousel', async () => {
		vi.mocked(misskeyApiZalip).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([]);
		const view = render(Home, { global: { stubs } });
		await waitFor(() => expect(view.container.querySelectorAll('picture img[src]')).toHaveLength(3));
		expect(view.queryByRole('status')).toBeNull();
		expect(view.getByRole('button', { name: i18n.tsx.zalip.onboardingDot({ number: '5' }) })).toBeTruthy();
	});
	it('uses a small-card thumbnail and falls back to the exact original on image failure', async () => {
		const view = render(ShareCard, { props: { share: works[0] }, global: { stubs } });
		const image = view.container.querySelector('img')!;
		expect(image.getAttribute('src')).toBe(works[0].posterThumbnailUrl);
		expect(image.getAttribute('loading')).toBe('lazy');
		expect(image.getAttribute('decoding')).toBe('async');
		expect(image.getAttribute('width')).toBe('300');
		await fireEvent.error(image);
		expect(image.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w342/poster-0.jpg');
		await fireEvent.error(image);
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.container.querySelector('.ti-movie')).toBeTruthy();
	});
});
