/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkZalipCommentThread from '@/components/MkZalipCommentThread.vue';
import MkNoteSub from '@/components/MkNoteSub.vue';
import commentSource from '@/components/MkZalipCommentThread.vue?raw';
import { globalEvents } from '@/events.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), react: vi.fn(), renote: vi.fn(), menu: vi.fn(), share: vi.fn(), muted: false, hardMuted: false, account: { id: 'viewer', token: 'fixture-token', mutedWords: [], hardMutedWords: [] } }));
vi.mock('@/i.js', () => ({ $i: controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/zalip-note-share.js', () => ({ openZalipNoteShare: controls.share }));
vi.mock('@/os.js', () => ({ popup: vi.fn() }));
vi.mock('@/composables/use-note.js', async () => {
	const { ref, reactive, computed } = await import('vue');
	return { useNote: (props: { note: Misskey.entities.Note }) => ({ appearNote: props.note, $appearNote: reactive(props.note), hideByPlugin: ref(false), hardMuted: ref(controls.hardMuted), muted: ref(controls.muted), isDeleted: ref(false), showContent: ref(false), collapsed: ref(true), parsed: ref(null), canRenote: computed(() => ['public', 'home'].includes(props.note.visibility)), renote: controls.renote, toggleReact: controls.react, showMenu: controls.menu, reactViaMfmEmoji: vi.fn() }) };
});
vi.mock('@/components/MkCwButton.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue'], template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)">Toggle CW</button>' } }));
vi.mock('@/components/MkMediaList.vue', () => ({ default: { props: ['layout'], template: '<div data-testid="comment-media" :data-layout="layout" />' } }));
vi.mock('@/components/MkPoll.vue', () => ({ default: { template: '<div data-testid="comment-poll" />' } }));
vi.mock('@/components/MkNoteSimple.vue', () => ({ default: { template: '<div data-testid="comment-quote" />' } }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { template: '<span data-testid="comment-reaction" />' } }));
vi.mock('@/components/ZalipShareCard.vue', () => ({ default: { template: '<div data-testid="comment-share" />' } }));

function note(id = '000', patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, createdAt: '2026-10-18T00:00:00Z', text: `Comment ${id}`, cw: null, userId: 'author', user: { id: 'author', name: 'Comment Author', username: 'author', host: null, badgeRoles: [] }, visibility: 'public', reactions: {}, reactionEmojis: {}, reactionCount: 0, myReaction: null, repliesCount: 2, renoteCount: 0, files: [], ...patch } as Misskey.entities.Note;
}

const stubs = {
	Mfm: defineComponent({ props: ['text'], setup: props => () => h('span', props.text) }),
	MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	MkAvatar: defineComponent({ setup: () => () => h('span', { 'data-testid': 'comment-avatar' }) }),
	MkUserName: defineComponent({ props: ['user'], setup: props => () => h('span', props.user.name) }),
	MkTime: defineComponent({ setup: () => () => h('span', '1h') }),
	MkAcct: true,
	I18n: true,
};

function setup(fixture = note(), props: Record<string, unknown> = {}, sub = false) {
	return render(sub ? MkNoteSub : MkZalipCommentThread, { props: { note: fixture, ...props }, global: { stubs, directives: { 'user-preview': {}, tooltip: {} } } });
}

async function settle(): Promise<void> { for (let index = 0; index < 10; index++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.api.mockResolvedValue([]); controls.muted = false; controls.hardMuted = false; controls.account.id = 'viewer'; });
afterEach(cleanup);

describe('shared Threads-style comments', () => {
	it('does not fetch child branches on mount, preserves real actions and emits the selected reply target', async () => {
		const fixture = note();
		const view = setup(fixture);
		await settle(); expect(controls.api).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reaction }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.reply }));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.renote }));
		expect(view.queryByRole('button', { name: i18n.ts.share })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.more }));
		expect(controls.react).toHaveBeenCalledTimes(1); expect(controls.renote).toHaveBeenCalledTimes(1); expect(controls.menu).toHaveBeenCalledTimes(1);
		expect(view.emitted().reply).toEqual([[fixture]]);
		expect(controls.share).not.toHaveBeenCalled();
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('keeps real audience information but omits the federation status and dedicated send action', () => {
		const view = setup(note('000', { visibility: 'followers', localOnly: true }));
		expect(view.getByRole('img', { name: i18n.ts._visibility.followers })).toBeTruthy();
		expect(view.container.querySelector('.ti-lock')).toBeTruthy();
		expect(view.container.querySelector('.ti-rocket-off, .ti-send')).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.share })).toBeNull();
		expect(commentSource).not.toContain('openZalipNoteShare');
		expect(commentSource).not.toContain('shareButton');
	});
	it('keeps the three native actions ordered and the compact dots inside an accessible menu target', () => {
		const view = setup();
		const actions = view.container.querySelector('footer')!;
		expect(Array.from(actions.querySelectorAll('button'), button => button.getAttribute('aria-label'))).toEqual([i18n.ts.reaction, i18n.ts.reply, i18n.ts.renote]);
		const menu = view.getByRole('button', { name: i18n.ts.more });
		expect(menu.querySelector('.ti-dots')).toBeTruthy();
		expect(commentSource).toContain('flex: 0 0 44px; width: 44px; height: 44px;');
		expect(commentSource).toContain('width: 18px; height: 18px; font-size: 18px;');
	});
	it('provides a programmatic focus return target for native menus and reaction pickers', async () => {
		const view = setup();
		const root = view.container.querySelector<HTMLElement>('[data-comment-id="000"]')!;
		expect(root.getAttribute('tabindex')).toBe('-1');
		view.getByRole('button', { name: i18n.ts.reaction }).focus();
		root.focus();
		expect(document.activeElement).toBe(root);
	});
	it('only draws a connector for loaded real replies and does not automatically fetch grandchildren', async () => {
		controls.api.mockResolvedValue([note('001', { replyId: '000' })]);
		const view = setup();
		expect(view.container.querySelector('[class*="_rail_"]')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/replies', { noteId: '000', limit: 10, sinceId: '0' }, 'fixture-token');
		expect(view.getByText('Comment 001')).toBeTruthy();
		expect(view.container.querySelector('[class*="rail"]')).not.toBeNull();
		expect(view.getAllByRole('button', { name: i18n.ts.loadReplies })).toHaveLength(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.showLess }));
		expect(view.queryByText('Comment 001')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		expect(controls.api).toHaveBeenCalledTimes(1);
	});
	it('scales real branch geometry from the 32px root and 28px nested avatars with 20px actions', async () => {
		controls.api.mockResolvedValue([note('001', { replyId: '000', repliesCount: 0 })]);
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		const parent = view.container.querySelector('[data-comment-id="000"]')!;
		const child = view.container.querySelector('[data-comment-id="001"]')!;
		expect(parent.className).not.toContain('nested');
		expect(child.className).toContain('nested');
		expect(commentSource).toContain('--comment-avatar: 32px;');
		expect(commentSource).toContain('.nested { --comment-avatar: 28px;');
		expect(commentSource).toContain('grid-template-columns: var(--comment-avatar) minmax(0, 1fr)');
		expect(commentSource).toContain('left: calc(var(--comment-avatar) / 2 - .5px)');
		expect(commentSource).toContain('height: calc(12px + var(--comment-child-avatar) / 2)');
		expect(commentSource).toContain('> svg { width: 20px; height: 20px; }');
	});
	it('retains pagination affordances and allows an explicit retry after a failed expansion', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([note('001', { replyId: '000', repliesCount: 0 })]);
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		expect(view.getByRole('alert')).toBeTruthy(); expect(controls.api).toHaveBeenCalledTimes(1);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle();
		expect(view.getByText('Comment 001')).toBeTruthy(); expect(view.queryByRole('alert')).toBeNull();
	});
	it('preserves CW, full media outside the text expander, carousel attachments and native private renote restrictions', async () => {
		const view = setup(note('000', { text: 'SECRET body', cw: 'Warning', visibility: 'followers', files: [{ id: 'image' } as Misskey.entities.DriveFile] }));
		const media = view.getByTestId('comment-media');
		expect(media.parentElement?.style.display).toBe('none');
		expect(media.getAttribute('data-layout')).toBe('carousel');
		expect((view.getByRole('button', { name: i18n.ts.renote }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(view.getByRole('button', { name: 'Toggle CW' }));
		expect(media.parentElement?.style.display).not.toBe('none');
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('uses a real direct thread link at the depth cap instead of hidden recursive requests', async () => {
		const view = setup(note(), { depth: 4 }); await settle();
		expect(view.queryByRole('button', { name: i18n.ts.loadReplies })).toBeNull();
		expect(view.getByRole('link', { name: i18n.ts.continueThread }).getAttribute('href')).toContain('/notes/000');
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('does not apply an old-account response and does not reveal hard-muted or hidden comments', async () => {
		let finish!: (notes: Misskey.entities.Note[]) => void;
		controls.api.mockImplementationOnce(() => new Promise<Misskey.entities.Note[]>(resolve => { finish = resolve; }));
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies }));
		controls.account.id = 'other'; finish([note('001', { replyId: '000' })]); await settle();
		expect(view.queryByText('Comment 001')).toBeNull();
		cleanup(); controls.hardMuted = true;
		expect(setup().queryByText('Comment 000')).toBeNull();
		cleanup(); controls.hardMuted = false;
		expect(setup(note('000', { isHidden: true })).queryByText('Comment 000')).toBeNull();
	});
	it('can reveal native soft-muted text without fetching and preserves compatibility through MkNoteSub detail', async () => {
		controls.muted = true;
		const view = setup();
		expect(view.queryByText('Comment 000')).toBeNull();
		await fireEvent.click(view.getByRole('button')); expect(view.getByText('Comment 000')).toBeTruthy();
		cleanup(); controls.muted = false;
		const detail = setup(note(), { detail: true }, true); await settle();
		expect(detail.getByRole('button', { name: i18n.ts.reaction })).toBeTruthy(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('only inserts own trusted local direct replies into an already expanded branch', async () => {
		const view = setup();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		globalEvents.emit('notePosted', note('001', { replyId: '000', userId: 'foreign' }));
		globalEvents.emit('notePosted', note('002', { replyId: 'foreign', userId: 'viewer' }));
		globalEvents.emit('notePosted', note('003', { replyId: '000', userId: 'viewer', repliesCount: 0 })); await settle();
		expect(view.queryByText('Comment 001')).toBeNull(); expect(view.queryByText('Comment 002')).toBeNull();
		expect(view.getByText('Comment 003')).toBeTruthy(); expect(controls.api).toHaveBeenCalledTimes(1);
		globalEvents.emit('noteDeleted', '003'); await settle(); expect(view.queryByText('Comment 003')).toBeNull();
	});

	it('reveals a newly posted own reply under its closed parent without loading unrelated or older replies', async () => {
		controls.api.mockResolvedValue([note('001', { replyId: '000', repliesCount: 0 })]);
		const view = setup(note('000', { repliesCount: 1 }));
		globalEvents.emit('notePosted', note('foreign', { replyId: '000', userId: 'someone-else' }));
		globalEvents.emit('notePosted', note('wrong-parent', { replyId: 'other', userId: 'viewer' }));
		globalEvents.emit('notePosted', note('002', { replyId: '000', userId: 'viewer', repliesCount: 0 })); await settle();
		expect(view.getByText('Comment 002')).toBeTruthy();
		expect(view.queryByText('Comment foreign')).toBeNull();
		expect(view.queryByText('Comment wrong-parent')).toBeNull();
		expect(view.queryByText('Comment 001')).toBeNull();
		expect(controls.api).not.toHaveBeenCalled();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.loadReplies })); await settle();
		expect(view.getByText('Comment 001')).toBeTruthy();
		expect(view.getByText('Comment 002')).toBeTruthy();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/replies', { noteId: '000', limit: 10, sinceId: '0' }, 'fixture-token');
	});

	it('keeps a Dustfall-shaped chain and content-share sibling attached to their actual parents', async () => {
		const first = 'asmwhz8mfwle001e';
		const second = 'asmwlq1cfwle001f';
		const third = 'asmwmim6fwle001h';
		const fourth = 'asmwn30yfwle001j';
		const sibling = 'asmwqg1sfwle001n';
		const fixtures = new Map<string, Misskey.entities.Note[]>([
			[first, [note(second, { replyId: first, repliesCount: 1 }), note(sibling, { replyId: first, text: null, repliesCount: 0, zalipShare: { slug: 'shared-title', title: 'Shared title' } as Misskey.entities.Note['zalipShare'] })]],
			[second, [note(third, { replyId: second, repliesCount: 1 })]],
			[third, [note(fourth, { replyId: third, repliesCount: 0 })]],
		]);
		controls.api.mockImplementation(async (_endpoint: string, params: { noteId: string }) => fixtures.get(params.noteId) ?? []);
		const view = setup(note(first, { repliesCount: 2 }));
		for (const id of [first, second, third]) {
			const parent = view.container.querySelector(`[data-comment-id="${id}"]`)!;
			const expand = Array.from(parent.querySelectorAll('button')).find(button => button.textContent === i18n.ts.loadReplies)!;
			await fireEvent.click(expand); await settle();
		}
		const parentOf = (id: string) => view.container.querySelector(`[data-comment-id="${id}"]`)?.parentElement?.closest('[data-comment-id]')?.getAttribute('data-comment-id');
		expect(parentOf(second)).toBe(first);
		expect(parentOf(third)).toBe(second);
		expect(parentOf(fourth)).toBe(third);
		expect(parentOf(sibling)).toBe(first);
		expect(view.container.querySelector(`[data-comment-id="${third}"]`)?.getAttribute('data-comment-depth')).toBe('2');
		expect(view.container.querySelector(`[data-comment-id="${fourth}"]`)?.className).toContain('deep');
		expect(commentSource).toContain('.deep > .branch { margin-left: 0; }');
		expect(commentSource).toContain('@container (max-width: 600px)');
		expect(view.container.querySelector(`[data-comment-id="${sibling}"] [data-testid="comment-share"]`)).toBeTruthy();
		expect(controls.api.mock.calls.map(call => call[1].noteId)).toEqual([first, second, third]);
		globalEvents.emit('notePosted', note('new-leaf', { replyId: third, userId: 'viewer', repliesCount: 0 })); await settle();
		expect(parentOf('new-leaf')).toBe(third);
		expect(parentOf(sibling)).toBe(first);
		expect(controls.api).toHaveBeenCalledTimes(3);
	});

	it('keeps the depth limit for newly posted replies instead of creating an unbounded recursive tree', async () => {
		const view = setup(note('000', { repliesCount: 0 }), { depth: 4 });
		globalEvents.emit('notePosted', note('001', { replyId: '000', userId: 'viewer', repliesCount: 0 })); await settle();
		expect(view.queryByText('Comment 001')).toBeNull();
		expect(view.getByRole('link', { name: i18n.ts.continueThread })).toBeTruthy();
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('counts multiple new direct replies once and clears the count when they are deleted', async () => {
		const view = setup(note('000', { repliesCount: 0 }));
		const first = note('001', { userId: 'viewer', replyId: '000', repliesCount: 0 });
		const second = note('002', { userId: 'viewer', replyId: '000', repliesCount: 0 });
		globalEvents.emit('notePosted', first); globalEvents.emit('notePosted', first); globalEvents.emit('notePosted', second); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.reply })[0].textContent).toBe('2');
		globalEvents.emit('noteDeleted', '001'); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.reply })[0].textContent).toBe('1');
		globalEvents.emit('noteDeleted', '002'); globalEvents.emit('notePosted', second); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.reply })[0].textContent).toBe('0');
		expect(view.queryByRole('button', { name: i18n.ts.loadReplies })).toBeNull();
	});
	it('does not apply a local count delta again after a refreshed server count', async () => {
		const view = setup(note('000', { repliesCount: 0 }));
		const own = note('001', { userId: 'viewer', replyId: '000', repliesCount: 0 });
		globalEvents.emit('notePosted', own); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.reply })[0].textContent).toBe('1');
		await view.rerender({ note: note('000', { repliesCount: 1 }) }); await settle();
		globalEvents.emit('notePosted', own); await settle();
		expect(view.getAllByRole('button', { name: i18n.ts.reply })[0].textContent).toBe('1');
	});
});
