/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import ZalipDiscussionPanel from '@/components/ZalipDiscussionPanel.vue';
import panelSource from '@/components/ZalipDiscussionPanel.vue?raw';
import { globalEvents } from '@/events.js';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), account: { id: 'viewer', token: 'fixture-token' } }));
vi.mock('@/i.js', () => ({ $i: controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/components/MkZalipCommentThread.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return { default: defineComponent({ props: ['note'], emits: ['reply'], setup: (props, { emit }) => () => h('button', { type: 'button', onClick: () => emit('reply', props.note) }, props.note.text) }) };
});
vi.mock('@/components/ZalipCommentForm.vue', () => ({ default: { props: ['rootNote', 'replyTo'], template: '<form data-testid="comment-form" :data-reply-id="replyTo.id" />' } }));

function note(id: string, patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, userId: 'author', user: { id: 'author', username: 'author' }, text: `Comment ${id}`, ...patch } as Misskey.entities.Note;
}

function setup() {
	return render(ZalipDiscussionPanel, { props: { noteId: 'root', heading: 'Long discussion heading' }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		MkLoading: true,
	} } });
}

async function settle(): Promise<void> { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => {
	vi.clearAllMocks();
	controls.api.mockImplementation(async (endpoint: string) => endpoint === 'notes/show' ? note('root') : [note('child', { replyId: 'root' })]);
});
afterEach(cleanup);

describe('content and episode discussion panel', () => {
	it('removes a deleted top-level comment and returns its selected reply target to the discussion root', async () => {
		const view = setup(); await settle();
		await fireEvent.click(view.getByRole('button', { name: 'Comment child' }));
		expect(view.getByTestId('comment-form').getAttribute('data-reply-id')).toBe('child');
		globalEvents.emit('noteDeleted', 'child'); await settle();
		expect(view.queryByText('Comment child')).toBeNull();
		expect(view.getByTestId('comment-form').getAttribute('data-reply-id')).toBe('root');
		expect(view.getByText(i18n.ts.zalip.commentsEmpty)).toBeTruthy();
	});

	it('does not restore a deleted discussion root from an old in-flight response', async () => {
		let finish!: (root: Misskey.entities.Note) => void;
		controls.api.mockImplementation((endpoint: string) => endpoint === 'notes/show' ? new Promise<Misskey.entities.Note>(resolve => { finish = resolve; }) : Promise.resolve([]));
		const view = setup();
		expect(view.getByRole('status', { name: i18n.ts.loading })).toBeTruthy();
		globalEvents.emit('noteDeleted', 'root'); finish(note('root')); await settle();
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip.commentsError);
		expect(view.queryByTestId('comment-form')).toBeNull();
		expect(view.queryByRole('status')).toBeNull();
	});

	it('keeps sort and thread controls reachable when the heading must wrap on a narrow panel', async () => {
		const view = setup(); await settle();
		expect(view.getByRole('combobox', { name: i18n.ts.sort })).toBeTruthy();
		const thread = view.getByRole('link', { name: i18n.ts.continueThread });
		expect(thread.getAttribute('href')).toBe('/notes/root/replies');
		expect(panelSource).toMatch(/\.header\s*\{[^}]*flex-wrap: wrap;/u);
		expect(panelSource).toContain('.heading { flex: 1 1 160px; min-width: 0; }');
		expect(panelSource).toContain('overflow-wrap: anywhere;');
		expect(panelSource).toMatch(/\.threadLink\s*\{[^}]*width: 44px;[^}]*height: 44px;/u);
	});
});
