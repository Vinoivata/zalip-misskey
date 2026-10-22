/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { ZalipReview } from '@/utility/zalip-reviews.js';
import MkZalipReviewCard from '@/components/MkZalipReviewCard.vue';
import { i18n } from '@/i18n.js';

const network = vi.hoisted(() => ({ imports: 0, api: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => {
	network.imports++;
	return { misskeyApi: network.api, misskeyApiZalip: network.api };
});
vi.mock('@/components/global/MkAvatar.vue', () => ({ default: { props: ['user', 'link'], template: '<span data-testid="avatar" />' } }));

function opinion(id = 'one', patch: Partial<ZalipReview> = {}): ZalipReview {
	return {
		id, workId: 'work', user: { id: 'author', username: 'author', name: 'Review Author', host: null, avatarUrl: '/static-assets/avatar.png', avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown' },
		format: 'review', title: null, body: 'A thoughtful review of this film and its characters.', isSpoiler: false,
		sentiment: 'positive', rating: 8, helpfulCount: 2, unhelpfulCount: 1, myVote: null,
		createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z', canEdit: false, canDelete: false,
		...patch,
	};
}

type CardProps = {
	review?: ZalipReview;
	viewerId?: string | null;
	revealed?: boolean;
	pending?: boolean;
	disabled?: boolean;
	work?: { slug: string; title: string; releaseYear: number | null };
	onMenu?: (event: MouseEvent) => void;
};

function setup(props: CardProps = {}) {
	return render(MkZalipReviewCard, { props: { review: opinion(), ...props }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) }),
		MkTime: defineComponent({ props: ['time'], setup: p => () => h('time', { datetime: p.time }, p.time) }),
	} } });
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(globalThis, 'fetch');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('presentational canonical review card', () => {
	it('renders genuine author, format, timestamp, shared rating and vote counts', () => {
		const view = setup({ review: opinion('essay', { format: 'essay', title: 'The character arc', sentiment: 'neutral' }), viewerId: 'viewer' });
		expect(view.container.querySelector('article')?.id).toBe('review-essay');
		expect(view.container.querySelector('article')?.getAttribute('data-review-format')).toBe('essay');
		expect(view.getByRole('link', { name: 'Review Author' }).getAttribute('href')).toBe('/@author');
		expect(view.getByRole('heading', { name: 'The character arc' })).toBeTruthy();
		expect(view.getByText(i18n.ts.zalip._reviews.essays)).toBeTruthy();
		expect(view.getByText(i18n.ts.zalip._reviews.neutral)).toBeTruthy();
		expect(view.container.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-22T00:00:00.000Z');
		expect(view.container.querySelector('.ti-star')?.parentElement?.textContent?.trim()).toBe('8');
		expect(view.getByRole('button', { name: i18n.ts.zalip._reviews.useful }).textContent?.trim()).toBe('2');
		expect(view.getByRole('button', { name: i18n.ts.zalip._reviews.notUseful }).textContent?.trim()).toBe('1');
	});

	it('never mounts spoiler title or body in DOM or attributes until the parent controls reveal', async () => {
		const secret = opinion('spoiler', { title: 'PRIVATE-SPOILER-TITLE', body: 'PRIVATE-SPOILER-BODY '.repeat(50), isSpoiler: true });
		const view = setup({ review: secret });
		const hidden = () => {
			expect(view.container.innerHTML).not.toContain('PRIVATE-SPOILER-TITLE');
			expect(view.container.innerHTML).not.toContain('PRIVATE-SPOILER-BODY');
			expect(view.queryByRole('heading')).toBeNull();
			expect(view.queryByRole('button', { name: i18n.ts.showMore })).toBeNull();
		};
		hidden();
		await fireEvent.click(view.getByText(i18n.ts.zalip._reviews.showSpoiler).closest('button')!);
		expect(view.emitted().reveal).toEqual([[]]);
		hidden();
		await view.rerender({ revealed: true });
		expect(view.getByRole('heading', { name: secret.title! })).toBeTruthy();
		expect(view.container.textContent).toContain('PRIVATE-SPOILER-BODY');
		await view.rerender({ revealed: false });
		hidden();
	});

	it('renders opinion text and title as escaped text, not HTML or script', () => {
		const title = '<img src=x onerror=alert(1)> Title';
		const body = '<script>alert(1)</script><img src=x onerror=alert(1)> Actual opinion.';
		const view = setup({ review: opinion('unsafe', { title, body }) });
		expect(view.getByRole('heading', { name: title })).toBeTruthy();
		expect(view.container.textContent).toContain(body);
		expect(view.container.querySelector('script, img, [onerror]')).toBeNull();
	});

	it('hides the guest menu and delegates a guest vote without authentication or network side effects', async () => {
		const view = setup();
		expect(view.queryByRole('button', { name: i18n.ts.more })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.useful }));
		expect(view.emitted().vote).toEqual([['helpful']]);
		expect(network.imports).toBe(0);
		expect(network.api).not.toHaveBeenCalled();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it.each(['own', 'pending', 'disabled'] as const)('disables both vote controls when %s and emits no mutation intent', async state => {
		const view = setup({ viewerId: state === 'own' ? 'author' : 'viewer', pending: state === 'pending', disabled: state === 'disabled' });
		for (const label of [i18n.ts.zalip._reviews.useful, i18n.ts.zalip._reviews.notUseful]) {
			const button = view.getByRole('button', { name: label }) as HTMLButtonElement;
			expect(button.disabled).toBe(true);
			await fireEvent.click(button);
		}
		expect(view.emitted().vote).toBeUndefined();
		expect((view.getByRole('button', { name: i18n.ts.more }) as HTMLButtonElement).disabled).toBe(state === 'disabled');
	});

	it('passes a synchronous menu event anchored to its actual button, even when the icon is clicked', async () => {
		let anchor: EventTarget | null = null;
		let target: EventTarget | null = null;
		const onMenu = vi.fn((event: MouseEvent) => { anchor = event.currentTarget; target = event.target; });
		const view = setup({ viewerId: 'viewer', onMenu });
		const button = view.getByRole('button', { name: i18n.ts.more });
		const icon = button.querySelector('i')!;
		await fireEvent.click(icon);
		expect(onMenu).toHaveBeenCalledTimes(1);
		expect(anchor).toBe(button);
		expect(target).toBe(icon);
		expect(view.emitted().menu).toHaveLength(1);
	});

	it('uses controlled vote state and does not optimistically mutate the opinion', async () => {
		const source = opinion('voted', { myVote: 'helpful' });
		const view = setup({ review: source, viewerId: 'viewer' });
		const helpful = view.getByRole('button', { name: i18n.ts.zalip._reviews.useful });
		const unhelpful = view.getByRole('button', { name: i18n.ts.zalip._reviews.notUseful });
		expect(helpful.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(helpful);
		await fireEvent.click(unhelpful);
		expect(view.emitted().vote).toEqual([['helpful'], ['unhelpful']]);
		expect(source.myVote).toBe('helpful');
		expect(source.helpfulCount).toBe(2);
		await view.rerender({ review: { ...source, myVote: 'unhelpful' } });
		expect(helpful.getAttribute('aria-pressed')).toBe('false');
		expect(unhelpful.getAttribute('aria-pressed')).toBe('true');
	});

	it('omits an absent rating instead of inventing zero or an independent vote', async () => {
		const view = setup({ review: opinion('unrated', { rating: null }) });
		expect(view.container.querySelector('.ti-star')).toBeNull();
		expect(view.container.textContent).not.toContain('null');
		expect(view.container.textContent).not.toContain('undefined');
		await view.rerender({ review: opinion('unrated', { rating: 7 }) });
		expect(view.container.querySelector('.ti-star')?.parentElement?.textContent?.trim()).toBe('7');
	});

	it('links catalogue context through the encoded canonical work slug without adding autoplay or raw query syntax', () => {
		const view = setup({ work: { slug: 'dustfall/season?x=1#draft', title: 'Dustfall', releaseYear: 2026 } });
		expect(view.getByRole('link', { name: 'Dustfall · 2026' }).getAttribute('href')).toBe('/zalip/dustfall%2Fseason%3Fx%3D1%23draft');
		expect(view.getAllByRole('link')).toHaveLength(2);
	});

	it('does not render a missing work context or a missing year as placeholder data', async () => {
		const view = setup();
		expect(view.getAllByRole('link')).toHaveLength(1);
		await view.rerender({ work: { slug: 'dustfall', title: 'Dustfall', releaseYear: null } });
		expect(view.getByRole('link', { name: 'Dustfall' }).getAttribute('href')).toBe('/zalip/dustfall');
		expect(view.container.textContent).not.toMatch(/undefined|null/u);
	});

	it('only offers expansion above 800 characters and exposes its controlled disclosure state', async () => {
		const view = setup({ review: opinion('long', { body: 'x'.repeat(800) }) });
		expect(view.queryByRole('button', { name: i18n.ts.showMore })).toBeNull();
		await view.rerender({ review: opinion('long', { body: 'x'.repeat(801) }) });
		const expand = view.getByRole('button', { name: i18n.ts.showMore });
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(expand);
		expect(view.getByRole('button', { name: i18n.ts.showLess }).getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.showLess }));
		expect(view.getByRole('button', { name: i18n.ts.showMore }).getAttribute('aria-expanded')).toBe('false');
	});

	it.each(['reviewId', 'workId', 'body', 'viewerId', 'spoiler'] as const)('resets expanded text when %s changes during component reuse', async transition => {
		const source = opinion('long', { body: 'A'.repeat(801) });
		const view = setup({ review: source, viewerId: 'viewer', revealed: true });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.showMore }));
		expect(view.getByRole('button', { name: i18n.ts.showLess })).toBeTruthy();
		const next: CardProps = {};
		if (transition === 'reviewId') next.review = { ...source, id: 'other' };
		if (transition === 'workId') next.review = { ...source, workId: 'other-work' };
		if (transition === 'body') next.review = { ...source, body: 'B'.repeat(801) };
		if (transition === 'viewerId') next.viewerId = 'other-viewer';
		if (transition === 'spoiler') next.review = { ...source, isSpoiler: true };
		await view.rerender(next);
		expect(view.getByRole('button', { name: i18n.ts.showMore }).getAttribute('aria-expanded')).toBe('false');
	});

	it('imports no API client and performs no network calls while mounting or emitting card actions', async () => {
		const view = setup({ review: opinion('spoiler', { isSpoiler: true }), viewerId: 'viewer' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.notUseful }));
		await fireEvent.click(view.getByText(i18n.ts.zalip._reviews.showSpoiler).closest('button')!);
		expect(network.imports).toBe(0);
		expect(network.api).not.toHaveBeenCalled();
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});
});
