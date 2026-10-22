/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import ZalipCommentForm from '@/components/ZalipCommentForm.vue';
import { globalEvents } from '@/events.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), increment: vi.fn(), compose: vi.fn(), account: { id: 'viewer', token: 'fixture-token' } }));
vi.mock('@/i.js', async () => { const { reactive } = await import('vue'); return { $i: reactive(controls.account), incNotesCount: controls.increment }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/instance.js', () => ({ instance: { maxNoteTextLength: 1000 } }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: vi.fn() }));
vi.mock('@/os.js', () => ({ post: controls.compose }));
vi.mock('@/components/global/MkAvatar.vue', () => ({ default: { template: '<span />' } }));

function note(id: string, patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, userId: 'author', user: { id: 'author', name: 'Author', username: 'author' }, visibility: 'public', localOnly: false, ...patch } as Misskey.entities.Note;
}

function deferred() {
	let resolve!: (result: { createdNote: Misskey.entities.Note }) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<{ createdNote: Misskey.entities.Note }>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

async function settle(): Promise<void> { for (let index = 0; index < 5; index++) { await Promise.resolve(); await nextTick(); } }

function setup() {
	const root = note('root');
	return { root, ...render(ZalipCommentForm, { props: { rootNote: root, replyTo: root } }) };
}

async function submit(view: ReturnType<typeof setup>, text = ' Draft reply '): Promise<void> {
	await fireEvent.update(view.getByRole('textbox'), text);
	await fireEvent.submit(view.container.querySelector('form')!);
}

beforeEach(() => {
	vi.clearAllMocks();
	$i!.id = 'viewer';
	$i!.token = 'fixture-token';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('comment submission context guards', () => {
	it('addresses a canonical content root, but still addresses the real author of a nested reply', async () => {
		const root = note('root', { user: { ...note('root').user, id: 'technical-owner', username: 'Admin', name: 'Admin' }, zalipDiscussion: { workId: 'work', slug: 'sample', title: 'A film', posterPath: null, rootNoteId: 'root', isRoot: true, episodeId: null, episodeNumber: null, seasonNumber: null } } as Partial<Misskey.entities.Note>);
		const view = render(ZalipCommentForm, { props: { rootNote: root, replyTo: root } });
		expect(view.getByRole('textbox').getAttribute('placeholder')).toBe(i18n.tsx.zalip.contentCommentPlaceholder({ title: 'A film' }));
		expect(view.queryByText('Admin')).toBeNull();
		await view.rerender({ rootNote: root, replyTo: note('child', { replyId: 'root' }) });
		expect(view.getByRole('textbox').getAttribute('placeholder')).toBe(i18n.tsx.zalip.replyPlaceholder({ name: 'Author' }));
	});

	it('submits a normal reply and emits exactly once without its own global-event echo', async () => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const emitted = vi.spyOn(globalEvents, 'emit');
		const view = setup(); await submit(view);
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/create', { text: 'Draft reply', replyId: 'root', visibility: 'public', localOnly: false }, 'fixture-token');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
		const posted = note('created', { userId: 'viewer', replyId: 'root' });
		pending.resolve({ createdNote: posted }); await settle();
		expect(view.emitted().posted).toEqual([[posted]]);
		expect(emitted).toHaveBeenCalledExactlyOnceWith('notePosted', posted);
		expect(controls.increment).toHaveBeenCalledTimes(1);
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
	});

	it.each(['root', 'account', 'token', 'unmount'] as const)('discards a late success after %s changes without emitting or incrementing the new context', async change => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const emitted = vi.spyOn(globalEvents, 'emit');
		const view = setup(); await submit(view);
		if (change === 'root') { const other = note('other-root'); await view.rerender({ rootNote: other, replyTo: other }); }
		if (change === 'account') { $i!.id = 'other-viewer'; await settle(); }
		if (change === 'token') { $i!.token = 'other-token'; await settle(); }
		if (change === 'unmount') view.unmount();
		pending.resolve({ createdNote: note('private-old-result', { userId: 'viewer', replyId: 'root', visibility: 'specified', text: 'PRIVATE OLD ACCOUNT' }) });
		await settle();
		expect(view.emitted().posted).toBeUndefined();
		expect(emitted).not.toHaveBeenCalled();
		expect(controls.increment).not.toHaveBeenCalled();
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
	});

	it.each(['root', 'reply', 'account', 'token', 'unmount'] as const)('does not expose a late submission error after %s changes', async change => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const view = setup(); await submit(view);
		if (change === 'root') { const other = note('other-root'); await view.rerender({ rootNote: other, replyTo: other }); }
		if (change === 'reply') await view.rerender({ rootNote: view.root, replyTo: note('other-reply', { replyId: 'root' }) });
		if (change === 'account') { $i!.id = 'other-viewer'; await settle(); }
		if (change === 'token') { $i!.token = 'other-token'; await settle(); }
		if (change === 'unmount') view.unmount();
		pending.reject(new Error('Old-context failure')); await settle();
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
		expect(view.emitted().posted).toBeUndefined();
		expect(controls.increment).not.toHaveBeenCalled();
	});

	it('keeps a successful reply visible and counted if another target is selected while pending', async () => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const emitted = vi.spyOn(globalEvents, 'emit');
		const view = setup();
		const child = note('child', { replyId: 'root' });
		await view.rerender({ rootNote: view.root, replyTo: child });
		await submit(view);
		expect((view.getByRole('button', { name: i18n.ts.cancel }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.cancel }));
		expect(view.emitted().cancelReply).toBeUndefined();
		await view.rerender({ rootNote: view.root, replyTo: note('another-child', { replyId: 'root' }) });
		const posted = note('created', { userId: 'viewer', replyId: 'child' });
		pending.resolve({ createdNote: posted }); await settle();
		expect(view.emitted().posted).toEqual([[posted]]);
		expect(emitted).toHaveBeenCalledExactlyOnceWith('notePosted', posted);
		expect(controls.increment).toHaveBeenCalledTimes(1);
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/create', expect.objectContaining({ replyId: 'child' }), 'fixture-token');
	});

	it('does not erase a newer draft when the submitted reply succeeds', async () => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const view = setup(); await submit(view);
		// A parent/editor integration may update the draft even while native input is disabled.
		await fireEvent.update(view.getByRole('textbox'), 'A newer draft');
		pending.resolve({ createdNote: note('created', { userId: 'viewer', replyId: 'root' }) }); await settle();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('A newer draft');
		expect(view.emitted().posted).toHaveLength(1);
	});

	it('acknowledges success while a cached form is inactive and returns without a duplicate draft or focus', async () => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const emitted = vi.spyOn(globalEvents, 'emit');
		const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
		const shown = ref(true); const root = note('root'); const posted = vi.fn();
		const view = render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(ZalipCommentForm, { rootNote: root, replyTo: root, onPosted: posted }) : null }) }));
		await submit({ root, ...view });
		shown.value = false; await settle(); focus.mockClear();
		expect(view.queryByRole('textbox')).toBeNull();
		const created = note('created', { userId: 'viewer', replyId: 'root' });
		pending.resolve({ createdNote: created }); await settle();
		expect(posted).toHaveBeenCalledExactlyOnceWith(created);
		expect(emitted).toHaveBeenCalledExactlyOnceWith('notePosted', created);
		expect(controls.increment).toHaveBeenCalledTimes(1);
		expect(focus).not.toHaveBeenCalled();
		shown.value = true; await settle();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
		await fireEvent.submit(view.container.querySelector('form')!);
		expect(controls.api).toHaveBeenCalledTimes(1);
	});

	it('keeps an inactive failed draft for retry without surfacing errors or stealing focus', async () => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus');
		const shown = ref(true); const root = note('root'); const posted = vi.fn();
		const view = render(defineComponent({ setup: () => () => h(KeepAlive, null, { default: () => shown.value ? h(ZalipCommentForm, { rootNote: root, replyTo: root, onPosted: posted }) : null }) }));
		await submit({ root, ...view });
		shown.value = false; await settle(); focus.mockClear();
		pending.reject(new Error('Offline while cached')); await settle();
		expect(posted).not.toHaveBeenCalled();
		expect(controls.increment).not.toHaveBeenCalled();
		expect(focus).not.toHaveBeenCalled();
		shown.value = true; await settle();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(' Draft reply ');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
	});

	it('does not clear a new request pending flag when the old root response finishes', async () => {
		const old = deferred(); const current = deferred();
		controls.api.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const view = setup(); await submit(view);
		const nextRoot = note('next-root'); await view.rerender({ rootNote: nextRoot, replyTo: nextRoot });
		await submit(view, 'Current reply');
		old.resolve({ createdNote: note('old', { userId: 'viewer', replyId: 'root' }) }); await settle();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Current reply');
		expect(view.emitted().posted).toBeUndefined();
		const posted = note('current', { userId: 'viewer', replyId: 'next-root' });
		current.resolve({ createdNote: posted }); await settle();
		expect(view.emitted().posted).toEqual([[posted]]);
		expect(controls.increment).toHaveBeenCalledTimes(1);
	});

	it('shows a normal current-context failure and permits an explicit retry', async () => {
		controls.api.mockRejectedValueOnce(new Error('Offline'));
		const view = setup(); await submit(view); await settle();
		expect(view.getByText(i18n.ts.zalip.commentError)).toBeTruthy();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe(' Draft reply ');
		expect(view.emitted().posted).toBeUndefined();
		const posted = note('retried', { userId: 'viewer', replyId: 'root' });
		controls.api.mockResolvedValueOnce({ createdNote: posted });
		await fireEvent.submit(view.container.querySelector('form')!); await settle();
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
		expect(view.emitted().posted).toEqual([[posted]]);
		expect(controls.api).toHaveBeenCalledTimes(2);
	});
});
