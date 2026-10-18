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
vi.mock('@/i.js', () => ({ $i: api.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: api.request }));

let visible: IntersectionObserverCallback[] = [];

function activate(): void {
	for (const callback of visible) callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

function reply(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'reply', replyId: 'parent', text: 'Real visible answer', cw: null, userId: 'author', user: { id: 'author', name: 'Answer Author', username: 'answer' }, files: [], ...patch } as Misskey.entities.Note;
}

function setup(props: { noteId?: string; replyCount?: number } = {}) {
	return render(MkZalipReplyPreview, { props: { noteId: 'parent', replyCount: 1, ...props }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		MkAvatar: defineComponent({ setup: () => () => h('span', { 'data-testid': 'reply-avatar' }) }),
		MkUserName: defineComponent({ props: ['user'], setup: props => () => h('span', props.user.name) }),
		Mfm: defineComponent({ props: ['text'], setup: props => () => h('span', props.text) }),
	} } });
}

beforeEach(() => {
	visible = [];
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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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
});
