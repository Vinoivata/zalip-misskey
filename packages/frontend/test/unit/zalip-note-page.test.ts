/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick, reactive } from 'vue';
import type * as Misskey from 'misskey-js';
import NotePage from '@/pages/note.vue';

type Account = { id: string; token: string };
const controls = vi.hoisted(() => ({ api: vi.fn(), login: vi.fn(), context: null as Misskey.entities.Note | null, state: null as { account: Account | null } | null }));
vi.mock('@/i.js', () => ({ get $i() { return controls.state?.account ?? null; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { animation: false } } }));
vi.mock('@/filters/date.js', () => ({ dateString: (value: string) => value }));
vi.mock('@/server-context.js', () => ({ get serverContext() { return { note: controls.context }; }, assertServerContext: () => controls.context != null }));
vi.mock('@/utility/paginator.js', () => ({ Paginator: class { initialId: string; constructor(_endpoint: string, options: { initialId: string }) { this.initialId = options.initialId; } } }));
vi.mock('@/components/MkNoteDetailed.vue', () => ({ default: { props: ['note'], template: '<article data-testid="note">{{ note.id }} {{ note.text }}</article>' } }));
vi.mock('@/components/MkNotesTimeline.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkClipPreview.vue', () => ({ default: { props: ['clip'], template: '<div data-testid="clip">{{ clip.name }}</div>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button><slot /></button>' } }));

function note(id: string, patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, createdAt: '2026-10-20T12:00:00.000Z', userId: 'author', user: { id: 'author', name: 'Author', username: 'author' }, text: `Text ${id}`, clippedCount: 0, ...patch } as Misskey.entities.Note;
}

function deferred<T>() {
	let resolve!: (result: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

function setup(noteId = 'a') {
	return render(NotePage, { props: { noteId }, global: { stubs: {
		PageWithHeader: { template: '<div><slot /></div>' },
		Transition: { template: '<div><slot /></div>' },
		MkLoading: { template: '<div data-testid="loading" />' },
		MkError: { emits: ['retry'], template: '<button aria-label="retry" @click="$emit(\'retry\')">Error</button>' },
	} } });
}

async function settle(): Promise<void> { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => {
	vi.clearAllMocks();
	controls.state = reactive({ account: { id: 'viewer', token: 'fixture-token' } });
	controls.context = null;
	controls.login.mockResolvedValue(false);
});
afterEach(cleanup);

describe('post detail request ownership', () => {
	it('ignores a late A response after route B has loaded', async () => {
		const a = deferred<Misskey.entities.Note>(); const b = deferred<Misskey.entities.Note>();
		controls.api.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
		const view = setup(); await view.rerender({ noteId: 'b' });
		b.resolve(note('b')); await settle();
		a.resolve(note('a')); await settle();
		expect(view.getByTestId('note').textContent).toBe('b Text b');
		expect(controls.api).toHaveBeenNthCalledWith(1, 'notes/show', { noteId: 'a' }, 'fixture-token');
		expect(controls.api).toHaveBeenNthCalledWith(2, 'notes/show', { noteId: 'b' }, 'fixture-token');
	});

	it('does not show an old auth error or open its sign-in dialog on a new route', async () => {
		const old = deferred<Misskey.entities.Note>();
		controls.api.mockReturnValueOnce(old.promise).mockResolvedValueOnce(note('b'));
		const view = setup(); await view.rerender({ noteId: 'b' }); await settle();
		old.reject({ id: 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' }); await settle();
		expect(view.getByTestId('note').textContent).toBe('b Text b');
		expect(view.queryByRole('button', { name: 'retry' })).toBeNull();
		expect(controls.login).not.toHaveBeenCalled();
	});

	it('retains the current auth error and opens only its own sign-in prompt', async () => {
		controls.login.mockRejectedValueOnce(new Error('Dialog canceled'));
		controls.api.mockRejectedValueOnce({ id: 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' });
		const view = setup(); await settle();
		expect(view.getByRole('button', { name: 'retry' })).toBeTruthy();
		expect(controls.login).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ openOnRemote: { type: 'lookup', url: expect.stringMatching(/\/notes\/a$/u) } }));
	});

	it('clears an old error immediately and allows a current failure to be retried', async () => {
		controls.api.mockRejectedValueOnce(new Error('Offline'));
		const view = setup(); await settle();
		expect(view.getByRole('button', { name: 'retry' })).toBeTruthy();
		const pending = deferred<Misskey.entities.Note>(); controls.api.mockReturnValueOnce(pending.promise);
		await fireEvent.click(view.getByRole('button', { name: 'retry' }));
		expect(view.queryByRole('button', { name: 'retry' })).toBeNull();
		expect(view.getByTestId('loading')).toBeTruthy();
		pending.resolve(note('a')); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Text a');
	});

	it('clears loaded clips on navigation and rejects a delayed old clip response', async () => {
		const oldClips = deferred<Misskey.entities.Clip[]>();
		controls.api.mockResolvedValueOnce(note('a', { clippedCount: 1 })).mockReturnValueOnce(oldClips.promise);
		const view = setup(); await settle();
		controls.api.mockResolvedValueOnce(note('b'));
		await view.rerender({ noteId: 'b' }); await settle();
		oldClips.resolve([{ id: 'old-clip', name: 'Stale clip' } as Misskey.entities.Clip]); await settle();
		expect(view.queryByTestId('clip')).toBeNull();
		controls.api.mockResolvedValueOnce(note('c', { clippedCount: 1 })).mockResolvedValueOnce([{ id: 'clip-c', name: 'Current clip' }]);
		await view.rerender({ noteId: 'c' }); await settle();
		expect(view.getByTestId('clip').textContent).toBe('Current clip');
		controls.api.mockResolvedValueOnce(note('d'));
		await view.rerender({ noteId: 'd' });
		expect(view.queryByTestId('clip')).toBeNull();
		await settle();
	});

	it('contains an optional clip failure without hiding the loaded post', async () => {
		controls.api.mockResolvedValueOnce(note('a', { clippedCount: 1 })).mockRejectedValueOnce(new Error('Clips offline'));
		const view = setup(); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Text a');
		expect(view.queryByRole('button', { name: 'retry' })).toBeNull();
	});

	it.each(['account', 'token'] as const)('invalidates old notes and clips after %s changes', async change => {
		const oldClips = deferred<Misskey.entities.Clip[]>();
		controls.api.mockResolvedValueOnce(note('a', { clippedCount: 1 })).mockReturnValueOnce(oldClips.promise);
		const view = setup(); await settle();
		const current = deferred<Misskey.entities.Note>(); controls.api.mockReturnValueOnce(current.promise);
		controls.state!.account = { id: change === 'account' ? 'another-viewer' : 'viewer', token: 'new-token' }; await settle();
		expect(view.queryByTestId('note')).toBeNull();
		oldClips.resolve([{ id: 'private', name: 'PRIVATE OLD ACCOUNT' } as Misskey.entities.Clip]); await settle();
		expect(view.queryByTestId('clip')).toBeNull();
		current.resolve(note('a', { text: 'Current account' })); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Current account');
	});

	it('discards a note response from an old account before opening an auth prompt', async () => {
		const old = deferred<Misskey.entities.Note>();
		controls.api.mockReturnValueOnce(old.promise).mockResolvedValueOnce(note('a', { text: 'Current account' }));
		const view = setup();
		controls.state!.account = { id: 'other', token: 'other-token' }; await settle();
		old.reject({ id: '145f88d2-b03d-4087-8143-a78928883c4b' }); await settle();
		expect(controls.login).not.toHaveBeenCalled();
		expect(view.getByTestId('note').textContent).toBe('a Current account');
	});

	it('does not display a delayed old-account note while the current response is pending', async () => {
		const old = deferred<Misskey.entities.Note>(); const current = deferred<Misskey.entities.Note>();
		controls.api.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const view = setup();
		controls.state!.account = { id: 'other', token: 'other-token' }; await settle();
		old.resolve(note('a', { text: 'PRIVATE OLD ACCOUNT', clippedCount: 1 })); await settle();
		expect(view.queryByTestId('note')).toBeNull();
		expect(controls.api).toHaveBeenCalledTimes(2);
		current.resolve(note('a', { text: 'Current account' })); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Current account');
	});

	it('waits for a refreshed account token without falling back to anonymous context', async () => {
		controls.state!.account = null; controls.context = note('a', { text: 'Guest context' });
		const view = setup(); await settle();
		controls.state!.account = { id: 'viewer', token: '' }; await settle();
		expect(view.queryByTestId('note')).toBeNull();
		expect(controls.api).not.toHaveBeenCalled();
		controls.api.mockResolvedValueOnce(note('a', { text: 'Authenticated' }));
		controls.state!.account.token = 'refreshed-token'; await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/show', { noteId: 'a' }, 'refreshed-token');
		expect(view.getByTestId('note').textContent).toBe('a Authenticated');
	});

	it.each(['success', 'failure'] as const)('ignores late %s after unmount', async outcome => {
		const pending = deferred<Misskey.entities.Note>(); controls.api.mockReturnValueOnce(pending.promise);
		const view = setup(); view.unmount();
		if (outcome === 'success') pending.resolve(note('a', { clippedCount: 1 }));
		else pending.reject({ id: 'fbcc002d-37d9-4944-a6b0-d9e29f2d33ab' });
		await settle();
		expect(controls.api).toHaveBeenCalledTimes(1);
		expect(controls.login).not.toHaveBeenCalled();
	});

	it('uses anonymous server context only on its matching guest route, not after signing in', async () => {
		controls.state!.account = null; controls.context = note('a', { text: 'Guest context' });
		const view = setup(); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Guest context');
		expect(controls.api).not.toHaveBeenCalled();
		controls.api.mockResolvedValueOnce(note('a', { text: 'Signed-in response' }));
		controls.state!.account = { id: 'viewer', token: 'signed-in-token' }; await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/show', { noteId: 'a' }, 'signed-in-token');
		expect(view.getByTestId('note').textContent).toBe('a Signed-in response');
	});

	it('never displays mismatched anonymous context and fetches the requested guest note', async () => {
		controls.state!.account = null; controls.context = note('other', { text: 'Wrong context' });
		const pending = deferred<Misskey.entities.Note>(); controls.api.mockReturnValueOnce(pending.promise);
		const view = setup();
		expect(view.queryByTestId('note')).toBeNull();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/show', { noteId: 'a' }, null);
		pending.resolve(note('a')); await settle();
		expect(view.getByTestId('note').textContent).toBe('a Text a');
	});
});
