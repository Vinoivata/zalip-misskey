/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkZalipReplyPreview from '@/components/MkZalipReplyPreview.vue';
import { replyPreviewCache } from '@/utility/zalip-reply-preview.js';

const api = vi.hoisted(() => ({ request: vi.fn(), account: { id: 'viewer', token: 'fixture-token', mutedWords: [] as Array<string | string[]>, hardMutedWords: [] as Array<string | string[]> } }));
vi.mock('@/i.js', async () => {
	const { reactive } = await import('vue');
	api.account = reactive(api.account);
	return { $i: api.account };
});
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: api.request }));

let visible: IntersectionObserverCallback[] = [];
let resizes: Array<{ callback: ResizeObserverCallback; elements: Element[]; disconnect: () => void }> = [];
let footers: HTMLElement[] = [];

function activate(): void {
	for (const callback of visible) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

function reply(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'reply', replyId: 'parent', text: 'Real visible answer', cw: null, userId: 'author', user: { id: 'author', name: 'Answer Author', username: 'answer' }, files: [], ...patch } as Misskey.entities.Note;
}

function setup(props: { noteId?: string; replyCount?: number; replyAnchor?: HTMLElement | null } = {}) {
	return render(MkZalipReplyPreview, { props: { noteId: 'parent', replyCount: 1, ...props }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		MkAvatar: defineComponent({ setup: () => () => h('span', { 'data-testid': 'reply-avatar' }) }),
		MkUserName: defineComponent({ props: ['user'], setup: props => () => h('span', props.user.name) }),
		Mfm: defineComponent({ props: ['text'], setup: props => () => h('span', props.text) }),
	} } });
}

function anchorFixture() {
	const footer = document.createElement('footer');
	const reaction = document.createElement('div');
	const anchor = document.createElement('button');
	const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	anchor.append(icon); footer.append(reaction, anchor); document.body.append(footer); footers.push(footer);
	let left = 150;
	vi.spyOn(icon, 'getBoundingClientRect').mockImplementation(() => ({ left, width: 20, right: left + 20 } as DOMRect));
	return { footer, reaction, anchor, setLeft: (value: number): void => { left = value; } };
}

function measureBubble(view: ReturnType<typeof setup>, left = 100, width = 112): HTMLAnchorElement {
	const bubble = view.getByRole('link') as HTMLAnchorElement;
	vi.spyOn(bubble, 'getBoundingClientRect').mockImplementation(() => ({ left, width, right: left + width } as DOMRect));
	return bubble;
}

function notifyResize(index = resizes.length - 1): void {
	resizes[index].callback([], {} as ResizeObserver);
}

beforeEach(() => {
	visible = [];
	resizes = [];
	footers = [];
	replyPreviewCache.clear();
	api.request.mockReset().mockResolvedValue([reply()]);
	api.account.id = 'viewer';
	api.account.mutedWords = [];
	api.account.hardMutedWords = [];
	vi.stubGlobal('IntersectionObserver', class {
		constructor(callback: IntersectionObserverCallback) { visible.push(callback); }
		observe(): void { /* Activated explicitly by each test. */ }
		disconnect(): void { /* No external resources in this fixture. */ }
	});
	vi.stubGlobal('ResizeObserver', class {
		private record: typeof resizes[number];
		constructor(callback: ResizeObserverCallback) { this.record = { callback, elements: [], disconnect: vi.fn() }; resizes.push(this.record); }
		observe(element: Element): void { this.record.elements.push(element); }
		disconnect(): void { this.record.disconnect(); }
	});
});
afterEach(() => { cleanup(); for (const footer of footers) footer.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('viewport-only real reply bubble', () => {
	it('requests one reply only on activation, then exposes real author/avatar and a keyboard-accessible thread link', async () => {
		const view = setup();
		await settle();
		expect(api.request).not.toHaveBeenCalled();
		activate(); await settle();
		expect(api.request).toHaveBeenCalledExactlyOnceWith('notes/replies', { noteId: 'parent', limit: 1 }, 'fixture-token');
		expect(view.getAllByTestId('reply-avatar')).toHaveLength(2);
		expect(view.getByRole('link').getAttribute('href')).toContain('/notes/reply');
		expect(view.getByRole('link').getAttribute('aria-label')).toContain('Answer Author');
		expect(view.getByText('Real visible answer')).toBeTruthy();
		expect(view.emitted().visible).toEqual([[false], [true]]);
	});
	it('never loads a zero-reply post and deduplicates a repeated visible card', async () => {
		setup({ replyCount: 0 }); setup(); setup();
		await settle(); activate(); await settle();
		expect(api.request).toHaveBeenCalledTimes(1);
	});
	it('does not reveal CW body, media or nested parent content', async () => {
		api.request.mockResolvedValue([reply({ cw: 'Spoiler warning', text: 'SECRET spoiler', files: [{ id: 'image' } as Misskey.entities.DriveFile], reply: reply({ text: 'SECRET parent' }) })]);
		const view = setup(); await settle(); activate(); await settle();
		expect(view.getByText(/Spoiler warning/)).toBeTruthy();
		expect(view.queryByText(/SECRET/)).toBeNull();
		expect(view.container.querySelector('img, video, iframe')).toBeNull();
	});
	it.each(['mutedWords', 'hardMutedWords'] as const)('respects %s before drawing a preview', async field => {
		api.account[field] = [['visible']];
		const view = setup(); await settle(); activate(); await settle();
		expect(view.queryByTestId('reply-avatar')).toBeNull();
		expect(view.emitted().visible).toEqual([[false]]);
	});
	it('quietly omits inaccessible replies without retries or a fake rail signal', async () => {
		api.request.mockRejectedValue(new Error('not-visible'));
		const view = setup(); await settle(); activate(); await settle(); activate(); await settle();
		expect(api.request).toHaveBeenCalledTimes(1);
		expect(view.queryByRole('link')).toBeNull();
		expect(view.emitted().visible).toEqual([[false]]);
	});
	it('does not apply a stale post response or an old-account response', async () => {
		let resolve!: (rows: Misskey.entities.Note[]) => void;
		api.request.mockImplementationOnce(() => new Promise<Misskey.entities.Note[]>(done => { resolve = done; }));
		const view = setup(); await settle(); activate(); await settle();
		await view.rerender({ noteId: 'other', replyCount: 0 });
		resolve([reply()]); await settle();
		expect(view.queryByRole('link')).toBeNull();
		api.request.mockImplementationOnce(() => new Promise<Misskey.entities.Note[]>(done => { resolve = done; }));
		await view.rerender({ noteId: 'third', replyCount: 1 }); await settle();
		api.account.id = 'another-viewer';
		resolve([reply({ replyId: 'third' })]); await settle();
		expect(view.queryByRole('link')).toBeNull();
	});
	it('anchors the tail to the real reply icon and recalculates when reaction width or the viewport changes', async () => {
		const fixture = anchorFixture();
		const view = setup({ replyAnchor: fixture.anchor }); await settle();
		expect(resizes).toHaveLength(0);
		activate(); await settle();
		expect(resizes).toHaveLength(1);
		const bubble = measureBubble(view);
		expect(resizes[0].elements).toEqual(expect.arrayContaining([view.container.firstElementChild, bubble, fixture.anchor, fixture.footer, fixture.reaction]));
		notifyResize(); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('60px');
		fixture.reaction.textContent = '12 345'; fixture.setLeft(178); notifyResize(); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('88px');
		fixture.setLeft(162); window.dispatchEvent(new Event('resize')); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('72px');
		fixture.setLeft(500); notifyResize(); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('100px');
		fixture.setLeft(0); notifyResize(); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('12px');
		expect(api.request).toHaveBeenCalledTimes(1);
	});
	it('does not create a tail or geometry observers without a real reply and a live anchor', async () => {
		const fixture = anchorFixture();
		const empty = setup({ replyAnchor: fixture.anchor, replyCount: 0 }); await settle(); activate(); await settle();
		expect(empty.queryByRole('link')).toBeNull(); expect(resizes).toHaveLength(0);
		empty.unmount();
		const noAnchor = setup(); await settle(); activate(); await settle();
		expect(noAnchor.getByRole('link').style.getPropertyValue('--reply-tip-offset')).toBe('');
		expect(noAnchor.getByRole('link').className).not.toContain('withTip');
		expect(resizes).toHaveLength(0);
	});
	it('disconnects replaced anchors and ignores late callbacks from the previous geometry', async () => {
		const first = anchorFixture();
		const second = anchorFixture(); second.setLeft(120);
		const view = setup({ replyAnchor: first.anchor }); await settle(); activate(); await settle();
		const bubble = measureBubble(view); notifyResize(); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('60px');
		const old = resizes[0];
		await view.rerender({ replyAnchor: second.anchor }); await settle();
		expect(old.disconnect).toHaveBeenCalledTimes(1);
		expect(resizes.at(-1)!.elements).toContain(second.anchor);
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('30px');
		first.setLeft(500); old.callback([], {} as ResizeObserver); await settle();
		expect(bubble.style.getPropertyValue('--reply-tip-offset')).toBe('30px');
		view.unmount(); expect(resizes.at(-1)!.disconnect).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new Event('resize')); old.callback([], {} as ResizeObserver);
		expect(api.request).toHaveBeenCalledTimes(1);
	});
	it('clears the caret and observers when the parent or account changes, without applying a late reply', async () => {
		const fixture = anchorFixture();
		const view = setup({ replyAnchor: fixture.anchor }); await settle(); activate(); await settle();
		measureBubble(view); notifyResize(); await settle();
		const first = resizes[0];
		await view.rerender({ noteId: 'other', replyCount: 0 }); await settle();
		expect(first.disconnect).toHaveBeenCalledTimes(1); expect(view.queryByRole('link')).toBeNull();
		api.request.mockResolvedValueOnce([reply({ replyId: 'other' })]);
		await view.rerender({ replyCount: 1 }); await settle();
		measureBubble(view); notifyResize(); await settle();
		const second = resizes.at(-1)!;
		let finish!: (notes: Misskey.entities.Note[]) => void;
		api.request.mockImplementationOnce(() => new Promise<Misskey.entities.Note[]>(resolve => { finish = resolve; }));
		api.account.id = 'other-account'; await settle();
		expect(second.disconnect).toHaveBeenCalledTimes(1); expect(view.queryByRole('link')).toBeNull();
		view.unmount(); finish([reply({ replyId: 'other' })]); await settle();
		expect(resizes.at(-1)).toBe(second);
	});
});
