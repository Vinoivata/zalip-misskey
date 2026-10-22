/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import type { ZalipReview, ZalipReviewsResponse } from '@/utility/zalip-reviews.js';
import type { MenuItem } from '@/types/menu.js';
import MkZalipReviewsPanel from '@/components/MkZalipReviewsPanel.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), login: vi.fn(), menu: vi.fn(), confirm: vi.fn(), report: vi.fn(), account: null as { id: string } | null }));
vi.mock('@/i.js', () => ({ get $i() { return controls.account; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, confirm: controls.confirm, popup: controls.report }));
vi.mock('@/components/global/MkAvatar.vue', () => ({ default: { props: ['user', 'link'], template: '<span data-testid="avatar" />' } }));
vi.mock('@/components/MkAbuseReportWindow.vue', () => ({ default: { props: ['user', 'initialComment'], template: '<div />' } }));

function review(id: string, patch: Partial<ZalipReview> = {}): ZalipReview {
	return { id, workId: 'work', user: { id: 'author', username: 'author', name: 'Review Author', host: null, avatarUrl: null }, body: 'A thoughtful review of this film and its characters.', format: 'review', sentiment: 'positive', title: null, isSpoiler: false, rating: 8, helpfulCount: 2, unhelpfulCount: 0, myVote: null, createdAt: '2026-10-19T00:00:00.000Z', updatedAt: '2026-10-19T00:00:00.000Z', canEdit: false, canDelete: false, ...patch } as ZalipReview;
}

function response(items: ZalipReview[], myReview: ZalipReview | null = null, total = items.length): ZalipReviewsResponse {
	return { items, total, summary: { reviewCount: total, positiveCount: total, neutralCount: 0, negativeCount: 0, averageRating: 8, ratingCount: 2, histogram: [0, 0, 0, 0, 0, 0, 0, 2, 0, 0] }, myReview };
}

function setup(props: { workId?: string; personalRating?: number | null } = {}) {
	return render(MkZalipReviewsPanel, { props: { workId: 'work', workTitle: 'A Film', ...props }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) }),
		MkTime: defineComponent({ props: ['time'], setup: p => () => h('time', p.time) }), MkLoading: true,
	} } });
}

async function settle(): Promise<void> { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => {
	vi.clearAllMocks();
	controls.account = reactive({ id: 'viewer' });
	controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/reviews/list' ? response([review('one')]) : review('saved', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'] }));
	controls.confirm.mockResolvedValue({ canceled: false });
	controls.report.mockReturnValue({ dispose: vi.fn() });
});
afterEach(cleanup);

describe('native content review panel', () => {
	it('loads content-bound reviews, shared rating summary and author links', async () => {
		const view = setup(); await settle();
		expect(controls.api).toHaveBeenCalledWith('zalip/reviews/list', { workId: 'work', sort: 'newest', hideSpoilers: false, limit: 20, offset: 0 });
		expect(view.getByRole('link', { name: 'Review Author' }).getAttribute('href')).toBe('/@author');
		expect(view.getByText('8.0')).toBeTruthy();
		expect(view.getByRole('img', { name: /10: 0.*8: 2/u })).toBeTruthy();
		expect(view.container.querySelector('#review-one')).toBeTruthy();
	});

	it('does not leak spoiler text or title into the DOM before explicit reveal and renders text safely', async () => {
		controls.api.mockResolvedValue(response([review('spoiler', { title: 'Hidden ending', body: '<img src=x onerror=alert(1)> Hidden body', isSpoiler: true })]));
		const view = setup(); await settle();
		expect(view.queryByText('Hidden ending')).toBeNull();
		expect(view.container.textContent).not.toContain('Hidden body');
		await fireEvent.click(view.getByRole('button', { name: new RegExp(i18n.ts.zalip._reviews.showSpoiler) }));
		expect(view.getByText('Hidden ending')).toBeTruthy();
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.container.textContent).toContain('<img src=x onerror=alert(1)>');
	});

	it('offers sign-in to guests and never opens an authenticated composer or sends votes', async () => {
		controls.account = null;
		const view = setup(); await settle();
		expect(view.queryByRole('button', { name: i18n.ts.zalip._reviews.write })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.login }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.useful }));
		expect(controls.login).toHaveBeenCalledTimes(2);
		expect(controls.api.mock.calls.filter(call => call[0] !== 'zalip/reviews/list')).toHaveLength(0);
	});

	it('saves one edited review and preserves the existing personal rating unless changed', async () => {
		const own = review('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true, canDelete: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/reviews/list' ? response([own], own) : { ...own, rating: 9 });
		const view = setup({ personalRating: 8 }); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'An updated review with plenty of detail for readers.');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.save })); await settle();
		const payload = controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1];
		expect(payload).toMatchObject({ workId: 'work', format: 'review', body: 'An updated review with plenty of detail for readers.' });
		expect(payload).not.toHaveProperty('rating');
		expect(view.emitted().ratingChanged).toEqual([[9]]);
		expect(view.queryByRole('textbox')).toBeNull();
	});

	it('edits independent review and essay drafts without carrying one text or title into the other', async () => {
		const ownUser = { id: 'viewer', username: 'viewer' } as ZalipReview['user'];
		const own = review('own', { user: ownUser, canEdit: true, canDelete: true });
		const essay = review('essay', { user: ownUser, format: 'essay', title: 'My independent essay', body: 'A separate detailed essay about the themes of this film.', canEdit: true, canDelete: true });
		controls.api.mockResolvedValue({ ...response([own, essay], own), myReviews: [own, essay] });
		const view = setup({ personalRating: 8 }); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		const body = view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement;
		expect(body.value).toBe(own.body);
		await fireEvent.update(body, 'An unsaved review draft, independent of the essay.');
		const type = view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format });
		await fireEvent.update(type, 'essay');
		expect(body.value).toBe(essay.body);
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.titleLabel }) as HTMLInputElement).value).toBe(essay.title);
		await fireEvent.update(body, 'An unsaved essay draft, independent of the review.');
		await fireEvent.update(view.getByRole('combobox', { name: i18n.ts.zalip._reviews.ratingLabel }), '7');
		await fireEvent.update(type, 'review');
		expect(body.value).toBe('An unsaved review draft, independent of the essay.');
		expect(view.queryByRole('textbox', { name: i18n.ts.zalip._reviews.titleLabel })).toBeNull();
		await fireEvent.update(type, 'essay');
		expect(body.value).toBe('An unsaved essay draft, independent of the review.');
		expect((view.getByRole('combobox', { name: i18n.ts.zalip._reviews.ratingLabel }) as HTMLSelectElement).value).toBe('7');
	});

	it('opens a new essay from its tab even when the author already has a review', async () => {
		const own = review('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true, canDelete: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/reviews/list' ? { ...response([own], own), myReviews: [own] } : review('new-essay', { format: 'essay' }));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.essays })); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe('');
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'An independently created essay about the same film.');
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.titleLabel }), 'A second kind of opinion');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1]).toMatchObject({ format: 'essay', title: 'A second kind of opinion', body: 'An independently created essay about the same film.' });
		expect(own.body).toBe('A thoughtful review of this film and its characters.');
	});

	it('does not replace an existing singular essay when a cached new client encounters an old server', async () => {
		const essay = review('legacy-essay', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], format: 'essay', title: 'Legacy essay', canEdit: true });
		controls.api.mockResolvedValue(response([essay], essay));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		const type = view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format }) as HTMLSelectElement;
		expect(type.disabled).toBe(true); expect(type.value).toBe('essay');
		await fireEvent.update(type, 'review');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.save })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1].format).toBe('essay');
	});

	it('an essay edit menu opens that exact format instead of the default review', async () => {
		const ownUser = { id: 'viewer', username: 'viewer' } as ZalipReview['user'];
		const own = review('own', { user: ownUser, canEdit: true });
		const essay = review('essay', { user: ownUser, format: 'essay', title: 'Specific essay', body: 'The exact essay selected from its own three-dot menu.', canEdit: true });
		controls.api.mockResolvedValue({ ...response([own, essay], own), myReviews: [own, essay] });
		const view = setup(); await settle();
		await fireEvent.click(within(view.container.querySelector('#review-essay') as HTMLElement).getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const edit = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.edit);
		if (!edit || typeof edit !== 'object' || !('action' in edit)) throw new Error('Missing edit action');
		await edit.action(new PointerEvent('click')); await settle();
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe(essay.body);
		expect((view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format }) as HTMLSelectElement).value).toBe('essay');
	});

	it('deleting one own format leaves an open draft of the other format intact', async () => {
		const ownUser = { id: 'viewer', username: 'viewer' } as ZalipReview['user'];
		const own = review('own', { user: ownUser, canEdit: true, canDelete: true });
		const essay = review('essay', { user: ownUser, format: 'essay', title: 'Surviving essay', canEdit: true, canDelete: true });
		let removed = false;
		controls.api.mockImplementation(async (endpoint: string) => {
			if (endpoint === 'zalip/reviews/delete') { removed = true; return undefined; }
			return { ...response(removed ? [essay] : [own, essay], removed ? essay : own), myReviews: removed ? [essay] : [own, essay] };
		});
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		await fireEvent.update(view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format }), 'essay');
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A still unsaved essay while a different review is removed.');
		await fireEvent.click(within(view.container.querySelector('#review-own') as HTMLElement).getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const remove = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.delete);
		if (!remove || typeof remove !== 'object' || !('action' in remove)) throw new Error('Missing delete action');
		await remove.action(new PointerEvent('click')); await settle();
		expect(controls.api).toHaveBeenCalledWith('zalip/reviews/delete', { reviewId: own.id });
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe('A still unsaved essay while a different review is removed.');
		expect(view.container.querySelector('#review-essay')).not.toBeNull();
		expect(view.container.querySelector('#review-own')).toBeNull();
	});

	it('saving one format preserves the other unsaved text until an explicit cancel', async () => {
		const ownUser = { id: 'viewer', username: 'viewer' } as ZalipReview['user'];
		const own = review('own', { user: ownUser, canEdit: true });
		const essay = review('essay', { user: ownUser, format: 'essay', title: 'Independent essay', canEdit: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/reviews/list' ? { ...response([own, essay], own), myReviews: [own, essay] } : essay);
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'An unfinished review which must survive saving an essay.');
		await fireEvent.update(view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format }), 'essay');
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A completed essay which I choose to publish separately.');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.save })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1].format).toBe('essay');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe('An unfinished review which must survive saving an essay.');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.cancel }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe(own.body);
	});

	it('deleting the selected essay does not discard an inactive review draft', async () => {
		const ownUser = { id: 'viewer', username: 'viewer' } as ZalipReview['user'];
		const own = review('own', { user: ownUser, canEdit: true, canDelete: true });
		const essay = review('essay', { user: ownUser, format: 'essay', title: 'Removed essay', canEdit: true, canDelete: true });
		let removed = false;
		controls.api.mockImplementation(async (endpoint: string) => {
			if (endpoint === 'zalip/reviews/delete') { removed = true; return undefined; }
			return { ...response(removed ? [own] : [own, essay], own), myReviews: removed ? [own] : [own, essay] };
		});
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A review draft kept while I remove my published essay.');
		await fireEvent.update(view.getByRole('combobox', { name: i18n.ts.zalip._reviews.format }), 'essay');
		await fireEvent.click(within(view.container.querySelector('#review-essay') as HTMLElement).getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const remove = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.delete);
		if (!remove || typeof remove !== 'object' || !('action' in remove)) throw new Error('Missing delete action');
		await remove.action(new PointerEvent('click')); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.editOwn }));
		expect((view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }) as HTMLTextAreaElement).value).toBe('A review draft kept while I remove my published essay.');
	});

	it('validates review length and essay title and writes an explicit changed rating', async () => {
		const view = setup({ personalRating: 8 }); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'Too short');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit }));
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._reviews.bodyInvalid);
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A review long enough to validate and save without issues.');
		const rating = view.getByRole('combobox', { name: i18n.ts.zalip._reviews.ratingLabel });
		await fireEvent.update(rating, '7');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1].rating).toBe(7);
	});

	it('can clear a rating explicitly but does not overwrite a quick rating changed while composing', async () => {
		const view = setup({ personalRating: 8 }); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		const rating = view.getByRole('combobox', { name: i18n.ts.zalip._reviews.ratingLabel }) as HTMLSelectElement;
		await view.rerender({ personalRating: 9 }); await settle();
		expect(rating.value).toBe('9');
		await fireEvent.update(rating, i18n.ts.zalip._reviews.noRating);
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A review which intentionally removes my previous rating.');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1].rating).toBeNull();
	});

	it('requires a nonblank essay title and preserves author-only editing from filters', async () => {
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.essays })); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A long essay exploring how the story develops its characters.');
		await fireEvent.submit(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }).closest('form')!);
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._reviews.essayTitleInvalid);
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.titleLabel }), '  The character arc  ');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'zalip/reviews/upsert')?.[1]).toMatchObject({ format: 'essay', title: 'The character arc' });
	});

	it('keeps failed drafts for retry and prevents duplicate upserts while saving', async () => {
		let rejectSave!: (error: Error) => void;
		controls.api.mockImplementation((endpoint: string) => endpoint === 'zalip/reviews/list' ? Promise.resolve(response([])) : new Promise<ZalipReview>((_, reject) => { rejectSave = reject; }));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		const text = view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel });
		await fireEvent.update(text, 'A draft which should survive an unavailable server.');
		const submit = view.getByRole('button', { name: i18n.ts.zalip._reviews.submit });
		await fireEvent.click(submit); await fireEvent.click(submit);
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/reviews/upsert')).toHaveLength(1);
		rejectSave(new Error('offline')); await settle();
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._reviews.saveError);
		expect((text as HTMLTextAreaElement).value).toContain('survive');
		expect((submit as HTMLButtonElement).disabled).toBe(false);
	});

	it('toggles helpful votes off on a second click, and own reviews cannot be voted on', async () => {
		const own = review('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'] });
		controls.api.mockImplementation(async (endpoint: string, params: { value?: 'helpful' | null }) => endpoint === 'zalip/reviews/list' ? response([review('one'), own], own) : review('one', { helpfulCount: params.value ? 3 : 2, myVote: params.value ?? null }));
		const view = setup(); await settle();
		const votes = view.getAllByRole('button', { name: i18n.ts.zalip._reviews.useful });
		expect((votes[1] as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(votes[0]); await settle();
		expect(votes[0].getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(votes[0]); await settle();
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/reviews/vote').map(call => call[1].value)).toEqual(['helpful', null]);
	});

	it('does not apply an in-flight vote after an account change or submit it twice', async () => {
		let finishVote!: (value: ZalipReview) => void;
		controls.api.mockImplementation((endpoint: string) => endpoint === 'zalip/reviews/list' ? Promise.resolve(response([review('one')])) : new Promise<ZalipReview>(resolve => { finishVote = resolve; }));
		const view = setup(); await settle();
		const button = view.getByRole('button', { name: i18n.ts.zalip._reviews.useful });
		await fireEvent.click(button); await fireEvent.click(button);
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/reviews/vote')).toHaveLength(1);
		controls.account!.id = 'second-account'; await settle();
		finishVote(review('one', { myVote: 'helpful', helpfulCount: 99 })); await settle();
		expect(view.getByRole('button', { name: i18n.ts.zalip._reviews.useful }).getAttribute('aria-pressed')).toBe('false');
		expect(view.container.textContent).not.toContain('99');
	});

	it('shows an actionable page-load error and recovers without losing the selected filters', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(response([]));
		const view = setup(); await settle();
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._reviews.loadError);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle();
		expect(view.queryByRole('alert')).toBeNull();
		expect(view.getByText(i18n.ts.zalip._reviews.empty)).toBeTruthy();
	});

	it('resets pagination and spoiler/filter requests when the user changes views', async () => {
		controls.api.mockResolvedValueOnce(response(Array.from({ length: 20 }, (_, index) => review(String(index))), null, 25)).mockResolvedValue(response([]));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.more })); await settle();
		expect(controls.api.mock.calls[1][1].offset).toBe(20);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.essays })); await settle();
		expect(controls.api.mock.calls.at(-1)?.[1]).toMatchObject({ offset: 0, format: 'essay' });
		await fireEvent.click(view.getByRole('checkbox', { name: i18n.ts.zalip._reviews.hideSpoilers })); await settle();
		expect(controls.api.mock.calls.at(-1)?.[1].hideSpoilers).toBe(true);
		expect(view.getByText(i18n.ts.zalip._reviews.filteredEmpty)).toBeTruthy();
	});

	it('discards old work data and an old successful save after navigation', async () => {
		let finishSave!: (value: ZalipReview) => void;
		controls.api.mockImplementation((endpoint: string, params: { workId: string }) => endpoint === 'zalip/reviews/list' ? Promise.resolve(response([review(params.workId, { workId: params.workId })])) : new Promise<ZalipReview>(resolve => { finishSave = resolve; }));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.write }));
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.zalip._reviews.bodyLabel }), 'A sufficiently detailed review for the old film.');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.submit }));
		await view.rerender({ workId: 'next-work' }); await settle();
		finishSave(review('old-save')); await settle();
		expect(view.emitted().ratingChanged).toBeUndefined();
		expect(view.container.querySelector('#review-next-work')).toBeTruthy();
		expect(view.container.querySelector('#review-work')).toBeNull();
		expect(view.queryByRole('textbox')).toBeNull();
	});

	it('deletes only after native confirmation through the owner menu', async () => {
		const own = review('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true, canDelete: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/reviews/list' ? response([own], own) : undefined);
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const deleteItem = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.delete);
		if (!deleteItem || typeof deleteItem !== 'object' || !('action' in deleteItem)) throw new Error('Missing delete action');
		await deleteItem.action(new PointerEvent('click')); await settle();
		expect(controls.confirm).toHaveBeenCalledWith({ type: 'warning', text: i18n.ts.zalip._reviews.deleteConfirm });
		expect(controls.api).toHaveBeenCalledWith('zalip/reviews/delete', { reviewId: 'own' });
	});

	it('does not delete if confirmation arrives after navigation to a different title', async () => {
		let finishConfirm!: (value: { canceled: boolean }) => void;
		controls.confirm.mockImplementation(() => new Promise<{ canceled: boolean }>(resolve => { finishConfirm = resolve; }));
		const own = review('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canDelete: true });
		controls.api.mockResolvedValue(response([own], own));
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const deleteItem = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.delete);
		if (!deleteItem || typeof deleteItem !== 'object' || !('action' in deleteItem)) throw new Error('Missing delete action');
		void deleteItem.action(new PointerEvent('click'));
		await view.rerender({ workId: 'next-work' }); await settle();
		finishConfirm({ canceled: false }); await settle();
		expect(controls.api.mock.calls.filter(call => call[0] === 'zalip/reviews/delete')).toHaveLength(0);
	});

	it('reports the review author through the native abuse dialog with a safe review permalink', async () => {
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		const menu = controls.menu.mock.calls[0][0] as MenuItem[];
		const reportItem = menu.find(item => typeof item === 'object' && item && 'text' in item && item.text === i18n.ts.zalip._reviews.report);
		if (!reportItem || typeof reportItem !== 'object' || !('action' in reportItem)) throw new Error('Missing report action');
		await reportItem.action(new PointerEvent('click')); await settle();
		expect(controls.report).toHaveBeenCalledTimes(1);
		expect(controls.report.mock.calls[0][1]).toMatchObject({ user: { id: 'author' } });
		expect(controls.report.mock.calls[0][1].initialComment).toContain('#review-one');
		expect(controls.report.mock.calls[0][1].initialComment).not.toContain('A thoughtful review');
	});
});
