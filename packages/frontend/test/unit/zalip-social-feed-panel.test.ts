/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import type { MenuItem } from '@/types/menu.js';
import type { ZalipReview } from '@/utility/zalip-reviews.js';
import type { ZalipSocialFeedItem } from '@/components/zalip-social-feed.js';
import MkZalipSocialFeed from '@/components/MkZalipSocialFeed.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), login: vi.fn(), menu: vi.fn(), confirm: vi.fn(), form: vi.fn(), report: vi.fn(), account: null as { id: string } | null }));
vi.mock('@/i.js', () => ({ get $i() { return controls.account; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, confirm: controls.confirm, form: controls.form, popup: controls.report }));
vi.mock('@/components/global/MkAvatar.vue', () => ({ default: { props: ['user', 'link'], template: '<span data-testid="avatar" />' } }));
vi.mock('@/components/MkAbuseReportWindow.vue', () => ({ default: { props: ['user', 'initialComment'], template: '<div />' } }));
vi.mock('@/components/MkNote.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['note', 'withHardMute', 'hideNestedPreviews'], setup: p => { const note = p.note; return () => h('article', { 'data-testid': 'native-note', 'data-author': note.user.id, 'data-hard-mute': String(p.withHardMute), 'data-hide-nested-previews': String(p.hideNestedPreviews) }, note.text); } }) };
});

const work = { id: 'work', slug: 'a film/one', title: 'A Film', kind: 'movie' as const, posterPath: null, releaseYear: 2026 };
function reviewItem(id = 'one', patch: Partial<ZalipReview> = {}): Exclude<ZalipSocialFeedItem, { type: 'comment' }> {
	const review = { id, workId: work.id, user: { id: 'author', username: 'author', name: 'Review Author' }, format: 'review', title: null, body: 'A thoughtful review of the film and its characters.', isSpoiler: false, sentiment: 'positive', rating: 8, helpfulCount: 2, unhelpfulCount: 0, myVote: null, createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', canEdit: false, canDelete: false, ...patch } as ZalipReview;
	return { type: review.format, key: `${review.format}:${id}`, id, createdAt: review.createdAt, work, review };
}
function commentItem(): ZalipSocialFeedItem {
	return { type: 'comment', key: 'comment:comment', id: 'comment', createdAt: '2026-10-22T00:00:00Z', work,
		note: { id: 'comment', text: 'The player does not load on my tablet.', user: { id: 'genuine-reader', username: 'reader' }, zalipDiscussion: { workId: work.id } } as unknown as Extract<ZalipSocialFeedItem, { type: 'comment' }>['note'],
		discussion: { rootNoteId: 'canonical-root', episodeId: null, episodeNumber: null, seasonNumber: null } };
}
function setup(section: 'discussions' | 'essays' = 'discussions') {
	return render(MkZalipSocialFeed, { props: { section }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (p, { slots }) => () => h('a', { href: p.to }, slots.default?.()) }),
		MkTime: defineComponent({ props: ['time'], setup: p => () => h('time', p.time) }), MkLoading: true,
	} } });
}
async function settle(): Promise<void> { for (let count = 0; count < 10; count++) { await Promise.resolve(); await nextTick(); } }
function menuAction(text: string) {
	const menu = controls.menu.mock.calls.at(-1)![0] as MenuItem[];
	const item = menu.find(value => typeof value === 'object' && value && 'text' in value && value.text === text);
	if (!item || typeof item !== 'object' || !('action' in item)) throw new Error(`Missing action ${text}`);
	return item.action;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Vue ignores synthetic events whose same-ms timestamp predates attachment.
	let eventTime = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => ++eventTime);
	controls.account = reactive({ id: 'viewer' });
	controls.api.mockImplementation(async (endpoint: string, params: { section?: string; value?: string | null }) => endpoint === 'zalip/feed/list'
		? { items: params.section === 'essays' ? [reviewItem('essay', { format: 'essay', title: 'A separate essay' })] : [commentItem(), reviewItem()], nextCursor: null }
		: reviewItem('one', { helpfulCount: params.value ? 3 : 2, myVote: params.value as ZalipReview['myVote'] ?? null }).review);
	controls.confirm.mockResolvedValue({ canceled: false }); controls.menu.mockResolvedValue(undefined);
	controls.form.mockResolvedValue({ canceled: true }); controls.report.mockReturnValue({ dispose: vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('native content discussions/essays feed', () => {
	it('renders genuine comment Notes and native review cards with canonical work context', async () => {
		const view = setup(); await settle();
		expect(controls.api).toHaveBeenCalledWith('zalip/feed/list', { section: 'discussions', hideSpoilers: true, limit: 20 });
		expect(view.getByTestId('native-note').getAttribute('data-author')).toBe('genuine-reader');
		expect(view.getByTestId('native-note').getAttribute('data-hard-mute')).toBe('true');
		expect(view.getByTestId('native-note').getAttribute('data-hide-nested-previews')).toBe('true');
		expect(view.container.querySelector('#review-one')).not.toBeNull();
		expect(view.getByRole('link', { name: 'Review Author' }).getAttribute('href')).toBe('/@author');
		expect(view.getByRole('link', { name: /A Film/ }).getAttribute('href')).toBe('/zalip/a%20film%2Fone');
		expect(controls.api.mock.calls.every(([endpoint]) => endpoint === 'zalip/feed/list')).toBe(true);
	});

	it('guests can read but cannot send votes or open owner actions', async () => {
		controls.account = null;
		const view = setup(); await settle();
		expect(view.queryByRole('button', { name: i18n.ts.more })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._reviews.useful }));
		expect(controls.login).toHaveBeenCalledTimes(1);
		expect(controls.api.mock.calls.filter(([endpoint]) => endpoint !== 'zalip/feed/list')).toHaveLength(0);
	});

	it('remounts native snapshot cards on refresh rather than retaining stale packed content', async () => {
		const original = commentItem();
		if (original.type !== 'comment') throw new Error('fixture');
		const updated = { ...original, note: { ...original.note, text: 'The player works after the update.' } };
		controls.api.mockResolvedValueOnce({ items: [original], nextCursor: null }).mockResolvedValue({ items: [updated], nextCursor: null });
		const view = setup(); await settle(); expect(view.getByTestId('native-note').textContent).toContain('does not load');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reload })); await settle();
		expect(view.getByTestId('native-note').textContent).toBe('The player works after the update.');
	});

	it('conceals spoiler title/body until explicit reveal and resets reveal across account changes', async () => {
		controls.api.mockResolvedValue({ items: [reviewItem('spoiler', { isSpoiler: true, title: 'Secret ending', body: 'The secret ending contains a major character reveal.' })], nextCursor: null });
		const view = setup(); await settle(); expect(view.container.textContent).not.toContain('Secret ending');
		await fireEvent.click(view.getByRole('checkbox', { name: i18n.ts.zalip._reviews.hideSpoilers })); await settle();
		expect(view.container.textContent).not.toContain('Secret ending'); expect(view.container.textContent).not.toContain('major character');
		await fireEvent.click(view.getByRole('button', { name: new RegExp(i18n.ts.zalip._reviews.showSpoiler) }));
		expect(view.getByText('Secret ending')).toBeTruthy();
		controls.account!.id = 'another-viewer'; await settle();
		expect(view.container.textContent).not.toContain('Secret ending');
	});

	it('toggles votes off and guards duplicate and stale account responses', async () => {
		const view = setup(); await settle();
		let button = view.getByRole('button', { name: i18n.ts.zalip._reviews.useful });
		await fireEvent.click(button); await settle(); expect(button.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(button); await settle(); expect(button.getAttribute('aria-pressed')).toBe('false');
		expect(controls.api.mock.calls.filter(([endpoint]) => endpoint === 'zalip/reviews/vote').map(([, params]) => params.value)).toEqual(['helpful', null]);
		let finish!: (value: ZalipReview) => void;
		controls.api.mockImplementation((endpoint: string) => endpoint === 'zalip/feed/list' ? Promise.resolve({ items: [reviewItem()], nextCursor: null }) : new Promise<ZalipReview>(resolve => { finish = resolve; }));
		await fireEvent.click(button); await fireEvent.click(button);
		expect(controls.api.mock.calls.filter(([endpoint]) => endpoint === 'zalip/reviews/vote')).toHaveLength(3);
		controls.account!.id = 'second'; await settle(); finish(reviewItem('one', { helpfulCount: 999, myVote: 'helpful' }).review); await settle();
		button = view.getByRole('button', { name: i18n.ts.zalip._reviews.useful });
		expect(button.getAttribute('aria-pressed')).toBe('false'); expect(button.textContent).not.toContain('999');
	});

	it('edits only the selected essay format and omits shared rating from text-only updates', async () => {
		const own = reviewItem('essay', { format: 'essay', title: 'Original essay', user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true, canDelete: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/feed/list' ? { items: [own], nextCursor: null } : { ...own.review, body: 'A revised essay with a completely independent argument.' });
		controls.form.mockResolvedValue({ result: { title: '  Revised essay  ', body: '  A revised essay with a completely independent argument.  ', sentiment: 'neutral', isSpoiler: false, rating: 1 } });
		const view = setup('essays'); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		menuAction(i18n.ts.edit)(new PointerEvent('click')); await settle();
		const params = controls.api.mock.calls.find(([endpoint]) => endpoint === 'zalip/reviews/upsert')?.[1];
		expect(params).toEqual({ workId: 'work', format: 'essay', title: 'Revised essay', body: 'A revised essay with a completely independent argument.', sentiment: 'neutral', isSpoiler: false });
		expect(params).not.toHaveProperty('rating'); expect(params).not.toHaveProperty('userId');
		expect(controls.form.mock.calls[0][1]).not.toHaveProperty('format');
	});

	it('keeps a failed edit draft for retry but never submits a form after changing account', async () => {
		const own = reviewItem('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true });
		controls.api.mockImplementation(async (endpoint: string) => { if (endpoint === 'zalip/feed/list') return { items: [own], nextCursor: null }; throw new Error('offline'); });
		const result = { title: '', body: 'A revised review which must survive a server failure.', sentiment: 'positive', isSpoiler: false };
		controls.form.mockResolvedValueOnce({ result }).mockResolvedValue({ canceled: true });
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		menuAction(i18n.ts.edit)(new PointerEvent('click')); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._reviews.saveError);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); menuAction(i18n.ts.edit)(new PointerEvent('click')); await settle();
		expect(controls.form.mock.calls.at(-1)![1].body.default).toBe(result.body);
		let finishForm!: (value: { result: typeof result }) => void;
		controls.form.mockImplementationOnce(() => new Promise(resolve => { finishForm = resolve; }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more })); menuAction(i18n.ts.edit)(new PointerEvent('click')); await settle();
		controls.account!.id = 'second'; await settle(); finishForm({ result }); await settle();
		expect(controls.api.mock.calls.filter(([endpoint]) => endpoint === 'zalip/reviews/upsert')).toHaveLength(1);
	});

	it('never deletes when confirmation completes after section navigation, and stale menu actions are inert', async () => {
		const own = reviewItem('own', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canEdit: true, canDelete: true });
		controls.api.mockResolvedValue({ items: [own], nextCursor: null });
		let finish!: (value: { canceled: boolean }) => void;
		controls.confirm.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		const staleEdit = menuAction(i18n.ts.edit); menuAction(i18n.ts.delete)(new PointerEvent('click')); await settle();
		await view.rerender({ section: 'essays' }); await settle(); finish({ canceled: false }); staleEdit(new PointerEvent('click')); await settle();
		expect(controls.api.mock.calls.filter(([endpoint]) => endpoint === 'zalip/reviews/delete')).toHaveLength(0); expect(controls.form).not.toHaveBeenCalled();
	});

	it('deletes a review after native confirmation without removing a same-ID native comment', async () => {
		const own = reviewItem('comment', { user: { id: 'viewer', username: 'viewer' } as ZalipReview['user'], canDelete: true });
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'zalip/feed/list' ? { items: [commentItem(), own], nextCursor: null } : undefined);
		const view = setup(); await settle(); await fireEvent.click(within(view.container.querySelector('#review-comment') as HTMLElement).getByRole('button', { name: i18n.ts.more }));
		menuAction(i18n.ts.delete)(new PointerEvent('click')); await settle();
		expect(controls.confirm).toHaveBeenCalledWith({ type: 'warning', text: i18n.ts.zalip._reviews.deleteConfirm });
		expect(controls.api).toHaveBeenCalledWith('zalip/reviews/delete', { reviewId: 'comment' });
		expect(view.container.querySelector('#review-comment')).toBeNull(); expect(view.getByTestId('native-note')).toBeTruthy();
	});

	it('reports the real author with a canonical title permalink instead of the feed URL', async () => {
		const view = setup(); await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		await menuAction(i18n.ts.zalip._reviews.report)(new PointerEvent('click')); await settle();
		expect(controls.report.mock.calls[0][1]).toMatchObject({ user: { id: 'author' } });
		expect(controls.report.mock.calls[0][1].initialComment).toContain('/zalip/a%20film%2Fone#review-one');
		expect(controls.report.mock.calls[0][1].initialComment).not.toContain('/timeline'); expect(controls.report.mock.calls[0][1].initialComment).not.toContain('thoughtful review');
	});

	it('provides error retry and explicitly refreshes the active section from the beginning', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ items: [], nextCursor: null });
		const view = setup('essays'); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._socialFeed.loadError);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle(); expect(view.getByText(i18n.ts.zalip._socialFeed.emptyEssays)).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reload })); await settle();
		expect(controls.api.mock.calls.at(-1)?.[1]).toEqual({ section: 'essays', limit: 20, hideSpoilers: true });
	});
	it('discards pending pages and actions while deactivated and reloads fresh native state on activation', async () => {
		let late!: (value: { items: ZalipSocialFeedItem[]; nextCursor: null }) => void;
		controls.api.mockImplementationOnce(() => new Promise(resolve => { late = resolve; })).mockResolvedValue({ items: [reviewItem('fresh')], nextCursor: null });
		const visible = ref(true);
		const view = render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => visible.value ? h(MkZalipSocialFeed, { section: 'discussions' }) : null }) }), { global: { stubs: { MkA: true, MkTime: true, MkLoading: true } } });
		await settle(); expect(controls.api).toHaveBeenCalledTimes(1);
		visible.value = false; await settle();
		late({ items: [reviewItem('stale')], nextCursor: null }); await settle();
		expect(view.container.querySelector('#review-stale')).toBeNull();
		visible.value = true; await settle();
		expect(controls.api).toHaveBeenCalledTimes(2);
		expect(view.container.querySelector('#review-fresh')).toBeTruthy();
		expect(view.container.querySelector('#review-stale')).toBeNull();
	});
});
