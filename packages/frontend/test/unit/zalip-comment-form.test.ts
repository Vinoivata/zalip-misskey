/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
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
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/create', { text: 'Draft reply', replyId: 'root', visibility: 'public', localOnly: false });
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true);
		const posted = note('created', { userId: 'viewer', replyId: 'root' });
		pending.resolve({ createdNote: posted }); await settle();
		expect(view.emitted().posted).toEqual([[posted]]);
		expect(emitted).toHaveBeenCalledExactlyOnceWith('notePosted', posted);
		expect(controls.increment).toHaveBeenCalledTimes(1);
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
		expect((view.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(false);
	});

	it.each(['root', 'reply', 'account', 'unmount'] as const)('discards a late success after %s changes without emitting or incrementing the new context', async change => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const emitted = vi.spyOn(globalEvents, 'emit');
		const view = setup(); await submit(view);
		if (change === 'root') { const other = note('other-root'); await view.rerender({ rootNote: other, replyTo: other }); }
		if (change === 'reply') await view.rerender({ rootNote: view.root, replyTo: note('other-reply', { replyId: 'root' }) });
		if (change === 'account') { $i!.id = 'other-viewer'; await settle(); }
		if (change === 'unmount') view.unmount();
		pending.resolve({ createdNote: note('private-old-result', { userId: 'viewer', replyId: 'root', visibility: 'specified', text: 'PRIVATE OLD ACCOUNT' }) });
		await settle();
		expect(view.emitted().posted).toBeUndefined();
		expect(emitted).not.toHaveBeenCalled();
		expect(controls.increment).not.toHaveBeenCalled();
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
	});

	it.each(['root', 'reply', 'account', 'unmount'] as const)('does not expose a late submission error after %s changes', async change => {
		const pending = deferred(); controls.api.mockReturnValueOnce(pending.promise);
		const view = setup(); await submit(view);
		if (change === 'root') { const other = note('other-root'); await view.rerender({ rootNote: other, replyTo: other }); }
		if (change === 'reply') await view.rerender({ rootNote: view.root, replyTo: note('other-reply', { replyId: 'root' }) });
		if (change === 'account') { $i!.id = 'other-viewer'; await settle(); }
		if (change === 'unmount') view.unmount();
		pending.reject(new Error('Old-context failure')); await settle();
		expect(view.queryByText(i18n.ts.zalip.commentError)).toBeNull();
		expect(view.emitted().posted).toBeUndefined();
		expect(controls.increment).not.toHaveBeenCalled();
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
	});
});
