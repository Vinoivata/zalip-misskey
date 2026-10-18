/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import type * as Misskey from 'misskey-js';
import { useNote } from '@/composables/use-note.js';
import type { MenuButton, MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { globalEvents } from '@/events.js';
import { preferState } from '../setup.unit.js';

const controls = vi.hoisted(() => ({
	actor: { id: 'viewer', token: 'fixture-token', mutedWords: [], hardMutedWords: [] } as { id: string; token: string; mutedWords: []; hardMutedWords: [] } | null,
	api: vi.fn(), login: vi.fn(), menu: vi.fn(), post: vi.fn(), alert: vi.fn(), toast: vi.fn(), noteEmit: vi.fn(), subscribe: vi.fn(), reactionPicker: vi.fn(), confirm: vi.fn(), sound: vi.fn(),
}));
vi.mock('@/i.js', () => ({ get $i() { return controls.actor; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api, misskeyApiGet: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/utility/show-moved-dialog.js', () => ({ showMovedDialog: () => {} }));
vi.mock('@/utility/achievements.js', () => ({ claimAchievement: () => {} }));
vi.mock('@/utility/sound.js', () => ({ playMisskeySfx: controls.sound }));
vi.mock('@/utility/reaction-picker.js', () => ({ reactionPicker: { show: controls.reactionPicker } }));
vi.mock('@/utility/get-user-menu.js', () => ({ getUserMenu: () => [] }));
vi.mock('@/composables/use-tooltip.js', () => ({ useTooltip: () => {} }));
vi.mock('@/plugin.js', () => ({ getPluginHandlers: () => [] }));
vi.mock('@/store.js', () => ({ store: { s: { visibility: 'public', localOnly: false } } }));
vi.mock('@/cache.js', () => ({ clipsCache: { fetch: async () => [] }, favoritedChannelsCache: { fetch: async () => [] } }));
vi.mock('@/instance.js', () => ({ instance: { federation: 'all' } }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu, post: controls.post, alert: controls.alert, toast: controls.toast, confirm: controls.confirm, popup: vi.fn() }));
vi.mock('@/composables/use-note-capture.js', async () => {
	const { reactive } = await import('vue');
	return { noteEvents: { emit: controls.noteEmit }, useNoteCapture: ({ note }: { note: Misskey.entities.Note }) => ({ $note: reactive({ reactions: note.reactions, reactionCount: note.reactionCount, reactionEmojis: note.reactionEmojis, myReaction: note.myReaction, pollChoices: [] }), subscribe: controls.subscribe }) };
});

function note(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'comment', createdAt: '2026-10-18T00:00:00Z', userId: 'author', user: { id: 'author', name: 'Comment author', username: 'author', host: null }, text: 'A real content comment', replyId: 'discussion-root', visibility: 'home', localOnly: true, renoteCount: 0, repliesCount: 0, reactions: {}, reactionEmojis: {}, reactionCount: 0, myReaction: null, files: [], ...patch } as Misskey.entities.Note;
}

function setup(target = note(), mock = false) {
	let actions!: ReturnType<typeof useNote>;
	const view = render(defineComponent({ setup() {
		const rootEl = ref<HTMLElement | null>(null); const renoteButton = ref<HTMLElement | null>(null);
		actions = useNote({ note: target, mock }, { rootEl, renoteButton });
		return () => h('div', { ref: rootEl, tabindex: -1 }, [h('button', { ref: renoteButton }, 'Repost'), h('span', { 'data-testid': 'renote-count' }, actions.appearNote.renoteCount)]);
	} }));
	return { view, actions };
}

async function settle() { for (let i = 0; i < 5; i++) { await Promise.resolve(); await nextTick(); } }

function menuAction(label: string): MenuButton {
	const items = controls.menu.mock.calls.at(-1)?.[0] as MenuItem[];
	const item = items?.find(value => !(value instanceof Promise) && 'action' in value && 'text' in value && value.text === label);
	if (!item || !('action' in item)) throw new Error(`Missing fixture action: ${label}`);
	return item as MenuButton;
}

beforeEach(() => {
	vi.clearAllMocks();
	controls.actor = { id: 'viewer', token: 'fixture-token', mutedWords: [], hardMutedWords: [] };
	controls.login.mockResolvedValue(true); controls.menu.mockResolvedValue(undefined); controls.post.mockResolvedValue(undefined); controls.confirm.mockResolvedValue({ canceled: false }); controls.alert.mockResolvedValue(undefined);
	controls.api.mockImplementation(async (endpoint: string) => endpoint === 'notes/create' ? { createdNote: note({ id: 'own-pure-renote', userId: 'viewer', text: null, replyId: undefined, renoteId: 'comment', renote: note() }) } : []);
	preferState.animation = false; preferState.rememberNoteVisibility = false; preferState.defaultNoteVisibility = 'public'; preferState.defaultNoteLocalOnly = false; preferState.confirmOnReact = false; preferState.collapseRenotes = true;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('real shared note actions on content comments', () => {
	it('keeps comment reposts expanded while preserving ordinary own and reacted repost collapse', () => {
		const wrapper = (target: Misskey.entities.Note, userId = 'viewer') => note({ id: 'wrapper', userId, text: null, replyId: undefined, renoteId: target.id, renote: target });
		expect(setup(wrapper(note())).actions.renoteCollapsed.value).toBe(false);
		expect(setup(wrapper(note({ myReaction: '🔥' }), 'other')).actions.renoteCollapsed.value).toBe(false);
		expect(setup(wrapper(note({ replyId: undefined }))).actions.renoteCollapsed.value).toBe(true);
		expect(setup(wrapper(note({ replyId: undefined, myReaction: '🔥' }), 'other')).actions.renoteCollapsed.value).toBe(true);
		expect(setup(wrapper(note({ replyId: undefined }), 'other')).actions.renoteCollapsed.value).toBe(false);
	});
	it('reposts the comment itself and reconciles its visible count after success', async () => {
		const { actions, view } = setup();
		await actions.renote(); menuAction(i18n.ts.renote).action(new PointerEvent('click')); await settle();
		expect(controls.api).toHaveBeenCalledWith('notes/create', expect.objectContaining({ renoteId: 'comment', visibility: 'home' }), 'fixture-token');
		expect(view.getByTestId('renote-count').textContent).toBe('1');
	});
	it('updates each mounted copy once without mutating or sharing the original note object', async () => {
		const target = note(); const first = setup(target); const second = setup(target);
		await first.actions.renote(); menuAction(i18n.ts.renote).action(new PointerEvent('click')); await settle();
		expect(first.actions.appearNote.renoteCount).toBe(1); expect(second.actions.appearNote.renoteCount).toBe(1);
		expect(first.actions.appearNote).not.toBe(second.actions.appearNote); expect(target.renoteCount).toBe(0);
	});
	it('preserves quote and reply canonical targets rather than targeting the hidden discussion root', async () => {
		const { actions } = setup();
		await actions.renote(); menuAction(i18n.ts.quote).action(new PointerEvent('click')); await settle();
		expect(controls.post).toHaveBeenCalledWith(expect.objectContaining({ renote: expect.objectContaining({ id: 'comment' }) }));
		await actions.reply(); await settle(); expect(controls.post).toHaveBeenCalledWith(expect.objectContaining({ reply: expect.objectContaining({ id: 'comment' }) }));
	});
	it('does not execute an old menu after switching accounts', async () => {
		const { actions } = setup(); await actions.renote(); const repost = menuAction(i18n.ts.renote);
		controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] };
		repost.action(new PointerEvent('click')); await settle(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('does not run an old menu after its component is unmounted or its target is deleted', async () => {
		const first = setup(); await first.actions.renote(); const stale = menuAction(i18n.ts.renote); first.view.unmount();
		stale.action(new PointerEvent('click')); await settle(); expect(controls.api).not.toHaveBeenCalled();
		const second = setup(); await second.actions.renote(); const deleted = menuAction(i18n.ts.renote); globalEvents.emit('noteDeleted', 'comment');
		deleted.action(new PointerEvent('click')); await settle(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('keeps a single create request in flight and ignores a late success after an account change', async () => {
		let finish!: (result: { createdNote: Misskey.entities.Note }) => void;
		controls.api.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
		const { actions, view } = setup(); await actions.renote(); const repost = menuAction(i18n.ts.renote);
		repost.action(new PointerEvent('click')); repost.action(new PointerEvent('click')); await settle(); expect(controls.api).toHaveBeenCalledTimes(1);
		controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] };
		finish({ createdNote: note({ id: 'late', userId: 'viewer', renoteId: 'comment', text: null }) }); await settle();
		expect(view.getByTestId('renote-count').textContent).toBe('0'); expect(controls.toast).not.toHaveBeenCalled();
	});
	it('shows a typed localized create error without a fake success and allows an explicit retry', async () => {
		controls.api.mockRejectedValueOnce({ code: 'RATE_LIMIT_EXCEEDED', message: 'Never render private upstream details' });
		const { actions, view } = setup(); await actions.renote(); menuAction(i18n.ts.renote).action(new PointerEvent('click')); await settle();
		expect(controls.alert).toHaveBeenCalledWith({ type: 'error', text: i18n.ts.cannotPerformTemporaryDescription }); expect(controls.toast).not.toHaveBeenCalled(); expect(view.getByTestId('renote-count').textContent).toBe('0');
		await actions.renote(); menuAction(i18n.ts.renote).action(new PointerEvent('click')); await settle(); expect(view.getByTestId('renote-count').textContent).toBe('1');
	});
	it('preserves channel scope and refuses external renote/quote options for a closed channel', async () => {
		const channel = { id: 'channel', name: 'Channel', allowRenoteToExternal: false, isSensitive: false } as NonNullable<Misskey.entities.Note['channel']>;
		const { actions } = setup(note({ channelId: 'channel', channel })); await actions.renote();
		const items = controls.menu.mock.calls[0][0] as MenuItem[];
		expect(items.some(item => 'text' in item && item.text === i18n.ts.renote)).toBe(false);
		menuAction(i18n.ts.inChannelRenote).action(new PointerEvent('click')); await settle(); expect(controls.api).toHaveBeenCalledWith('notes/create', { channelId: 'channel', renoteId: 'comment' }, 'fixture-token');
	});
	it('keeps the native own pure-renote undo scoped to its wrapper, never its comment or quotes', async () => {
		const wrapper = note({ id: 'wrapper', userId: 'viewer', text: null, replyId: undefined, renoteId: 'comment', renote: note() });
		const { actions } = setup(wrapper); await actions.showRenoteMenu(); await menuAction(i18n.ts.unrenote).action(new PointerEvent('click')); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/delete', { noteId: 'wrapper' }, 'fixture-token'); expect(actions.isDeleted.value).toBe(true);
		controls.menu.mockClear(); const quote = setup({ ...wrapper, text: 'An actual quote' }); await quote.actions.showRenoteMenu(); expect(controls.menu).not.toHaveBeenCalled();
	});
	it('prevents a stale native undo menu from deleting under a different account', async () => {
		const { actions } = setup(note({ id: 'wrapper', userId: 'viewer', text: null, replyId: undefined, renoteId: 'comment', renote: note() })); await actions.showRenoteMenu(); const undo = menuAction(i18n.ts.unrenote);
		controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] }; await undo.action(new PointerEvent('click')); expect(controls.api).not.toHaveBeenCalled();
	});
	it('keeps quote and reply composer failures visible without issuing a note write', async () => {
		controls.post.mockRejectedValue(new Error('Fixture composer failed'));
		const { actions } = setup(); await actions.renote(); menuAction(i18n.ts.quote).action(new PointerEvent('click')); await settle();
		await actions.reply(); await settle(); expect(controls.alert).toHaveBeenCalledTimes(2); expect(controls.api).not.toHaveBeenCalled();
	});
	it('does not open a composer or menu after login resolves for a replaced account', async () => {
		let finish!: (loggedIn: boolean) => void; controls.login.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
		const { actions } = setup(); const pending = actions.reply();
		controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] }; finish(true); await pending;
		expect(controls.post).not.toHaveBeenCalled(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('creates and removes reactions against the comment with a captured token and captured actor', async () => {
		const { actions } = setup(note({ reactionAcceptance: 'likeOnly' })); await actions.react();
		expect(controls.api).toHaveBeenCalledWith('notes/reactions/create', { noteId: 'comment', reaction: '❤️' }, 'fixture-token'); expect(controls.noteEmit).toHaveBeenCalledWith('reacted:comment', { userId: 'viewer', reaction: '❤️' });
		actions.$appearNote.myReaction = '❤️'; actions.toggleReact(); await settle();
		expect(controls.api).toHaveBeenCalledWith('notes/reactions/delete', { noteId: 'comment' }, 'fixture-token'); expect(controls.noteEmit).toHaveBeenCalledWith('unreacted:comment', { userId: 'viewer', reaction: '❤️' });
	});
	it('suppresses duplicate reaction writes, late account events and false success feedback', async () => {
		let finish!: () => void; controls.api.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
		const { actions } = setup(note({ reactionAcceptance: 'likeOnly' })); const pending = actions.react(); await settle(); await actions.react(); expect(controls.api).toHaveBeenCalledTimes(1);
		controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] }; finish(); await pending; expect(controls.noteEmit).not.toHaveBeenCalled(); expect(controls.sound).not.toHaveBeenCalled();
	});
	it('catches reaction errors, retains the old reaction on failed undo and permits a later retry', async () => {
		controls.api.mockRejectedValueOnce({ code: 'ACCESS_DENIED' });
		const { actions } = setup(note({ myReaction: '🔥' })); actions.toggleReact(); await settle(); expect(actions.$appearNote.myReaction).toBe('🔥'); expect(controls.noteEmit).not.toHaveBeenCalled(); expect(controls.alert).toHaveBeenCalledWith({ type: 'error', text: i18n.ts.operationForbidden });
		actions.toggleReact(); await settle(); expect(controls.api).toHaveBeenCalledTimes(2);
	});
	it('guards reaction-picker callbacks both before and after the confirmation wait', async () => {
		preferState.confirmOnReact = true;
		const { actions } = setup(); await actions.react();
		const choose = controls.reactionPicker.mock.calls[0][2] as (reaction: string) => Promise<void>;
		let finish!: (result: { canceled: boolean }) => void; controls.confirm.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
		const pending = choose('🔥'); controls.actor = { id: 'other', token: 'other-fixture-token', mutedWords: [], hardMutedWords: [] }; finish({ canceled: false }); await pending;
		expect(controls.api).not.toHaveBeenCalled(); await choose('❤️'); expect(controls.confirm).toHaveBeenCalledTimes(1);
	});
	it('does not mutate mock or private comments even through programmatic action calls', async () => {
		const mocked = setup(note(), true); await mocked.actions.renote(); expect(controls.menu).not.toHaveBeenCalled();
		const hidden = setup(note({ visibility: 'specified' })); await hidden.actions.renote(); expect(controls.menu).not.toHaveBeenCalled(); expect(controls.api).not.toHaveBeenCalled();
	});
});
