/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type * as Misskey from 'misskey-js';
import type { MenuButton, MenuItem } from '@/types/menu.js';
import { getNoteMenu } from '@/utility/get-note-menu.js';
import { i18n } from '@/i18n.js';
import { noteBookmarkState } from '@/utility/zalip-note-bookmarks.js';

const controls = vi.hoisted(() => ({
	account: null as { id: string; token: string; isAdmin: boolean; isModerator: boolean; pinnedNoteIds: string[]; policies: { canUseTranslator: boolean } } | null,
	api: vi.fn(), dialog: vi.fn(), confirm: vi.fn(), select: vi.fn(), popup: vi.fn(), post: vi.fn(), copy: vi.fn(), emitted: vi.fn(), alert: vi.fn(),
	state: { isFavorited: false, isMutedThread: false },
	author: { id: 'author', isMuted: false, isBlocking: false },
}));
vi.mock('@/i.js', () => ({ get $i() { return controls.account; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/os.js', () => ({ apiWithDialog: controls.dialog, alert: controls.alert, confirm: controls.confirm, select: controls.select, popupAsyncWithDialog: controls.popup, post: controls.post, pageWindow: vi.fn() }));
vi.mock('@/utility/achievements.js', () => ({ claimAchievement: vi.fn() }));
vi.mock('@/utility/copy-to-clipboard.js', () => ({ copyToClipboard: controls.copy }));
vi.mock('@/utility/get-user-menu.js', () => ({ getUserMenu: () => ({ menu: [], cleanup: vi.fn() }) }));
vi.mock('@/utility/get-embed-code.js', () => ({ genEmbedCode: vi.fn() }));
vi.mock('@/utility/navigator.js', () => ({ isSupportShare: () => true }));
vi.mock('@/plugin.js', () => ({ getPluginHandlers: () => [] }));
vi.mock('@/events.js', () => ({ globalEvents: { emit: controls.emitted } }));
vi.mock('@/cache.js', () => ({ clipsCache: { fetch: vi.fn() }, favoritedChannelsCache: { fetch: vi.fn() } }));

function note(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'note-one', userId: 'author', user: { id: 'author', username: 'author', name: 'Author', host: 'remote.example' }, text: 'Existing note', createdAt: '2020-01-01T00:00:00Z', visibility: 'followers', localOnly: true, uri: 'https://remote.example/objects/note-one', ...patch } as Misskey.entities.Note;
}

function menu(value = note(), compact = true) {
	return getNoteMenu({ note: value, translation: ref(null), translating: ref(false), ...(compact ? { appearance: 'zalip-note' as const } : {}) });
}

async function items(value: ReturnType<typeof menu>): Promise<MenuItem[]> { return Promise.all(value.menu); }
function labels(value: MenuItem[]): string[] { return value.flatMap(item => 'text' in item && typeof item.text === 'string' ? [item.text] : []); }
function button(value: MenuItem[], text: string): MenuButton { return value.find(item => 'text' in item && item.text === text) as MenuButton; }
async function click(value: MenuButton): Promise<void> { await value.action(new PointerEvent('click')); await Promise.resolve(); }
async function settle(): Promise<void> { for (let i = 0; i < 6; i++) await Promise.resolve(); }

beforeEach(() => {
	vi.clearAllMocks();
	noteBookmarkState.clear();
	controls.account = { id: 'viewer', token: 'unit-token', isAdmin: false, isModerator: false, pinnedNoteIds: [], policies: { canUseTranslator: false } };
	controls.state = { isFavorited: false, isMutedThread: false }; controls.author = { id: 'author', isMuted: false, isBlocking: false };
	controls.api.mockImplementation(async (endpoint: string) => endpoint === 'notes/state' ? controls.state : endpoint === 'users/show' ? controls.author : undefined);
	controls.dialog.mockResolvedValue(undefined); controls.confirm.mockResolvedValue({ canceled: false }); controls.select.mockResolvedValue({ canceled: false, result: 'indefinitely' });
});

describe('opt-in compact post actions', () => {
	it('keeps useful direct actions without federation, copying, sharing or technical tools, and does not write on open', async () => {
		const value = menu(); const resolved = await items(value);
		expect(labels(resolved)).toEqual([i18n.ts.favorite, i18n.ts.muteThread, i18n.ts.mute, i18n.ts.block, i18n.ts.reportAbuse]);
		expect(controls.api.mock.calls.map(call => call[0]).sort()).toEqual(['notes/state', 'users/show']);
		expect(controls.api).toHaveBeenCalledWith('users/show', { userId: 'author' }, 'unit-token');
		expect(controls.dialog).not.toHaveBeenCalled(); expect(controls.post).not.toHaveBeenCalled(); expect(controls.copy).not.toHaveBeenCalled();
		expect(button(resolved, i18n.ts.reportAbuse).danger).toBe(true);
		value.cleanup();
	});
	it('retains authoritative bookmark/thread reversal and native mute/block reversal', async () => {
		controls.state = { isFavorited: true, isMutedThread: true }; controls.author = { id: 'author', isMuted: true, isBlocking: true };
		const value = menu(); const resolved = await items(value);
		await click(button(resolved, i18n.ts.unfavorite)); expect(controls.api).toHaveBeenCalledWith('notes/favorites/delete', { noteId: 'note-one' }, 'unit-token');
		expect(noteBookmarkState.peek('note-one')?.state?.isFavorited).toBe(false);
		await click(button(resolved, i18n.ts.unmuteThread)); expect(controls.dialog).toHaveBeenCalledWith('notes/thread-muting/delete', { noteId: 'note-one' });
		await click(button(resolved, i18n.ts.unmute)); expect(controls.dialog).toHaveBeenCalledWith('mute/delete', { userId: 'author' }, 'unit-token');
		await click(button(resolved, i18n.ts.unblock)); expect(controls.confirm).toHaveBeenCalledWith({ type: 'warning', text: i18n.ts.unblockConfirm });
		expect(controls.dialog).toHaveBeenCalledWith('blocking/delete', { userId: 'author' }, 'unit-token'); value.cleanup();
	});
	it('keeps own editing, pinning and confirmed deletion, while ordinary viewers cannot delete others', async () => {
		const own = menu(note({ userId: 'viewer' })); const resolved = await items(own);
		expect(labels(resolved)).toEqual([i18n.ts.favorite, i18n.ts.deleteAndEdit, i18n.ts.pin, i18n.ts.muteThread, i18n.ts.delete]);
		expect(controls.api.mock.calls.filter(call => call[0] === 'users/show')).toHaveLength(0);
		await click(button(resolved, i18n.ts.pin)); expect(controls.dialog).toHaveBeenCalledWith('i/pin', { noteId: 'note-one' }, undefined, expect.any(Object));
		await click(button(resolved, i18n.ts.delete)); await settle(); expect(controls.confirm).toHaveBeenCalledWith({ type: 'warning', text: i18n.ts.noteDeleteConfirm });
		expect(controls.api).toHaveBeenCalledWith('notes/delete', { noteId: 'note-one' }); own.cleanup();
		const ordinary = menu(); expect(labels(await items(ordinary))).not.toContain(i18n.ts.delete); ordinary.cleanup();
		controls.account!.isModerator = true; const staff = menu(); const staffItems = await items(staff); expect(button(staffItems, i18n.ts.delete).danger).toBe(true); staff.cleanup();
	});
	it('does not submit a block after account changes while confirmation is pending, but permits normal menu-close before confirmation', async () => {
		let finish!: (result: { canceled: boolean }) => void;
		controls.confirm.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
		const value = menu(); const resolved = await items(value); const pending = click(button(resolved, i18n.ts.block)); value.cleanup();
		controls.account = { ...controls.account!, id: 'other', token: 'other-token' }; finish({ canceled: false }); await pending;
		expect(controls.dialog).not.toHaveBeenCalled();
		const current = menu(); const currentItems = await items(current); const valid = click(button(currentItems, i18n.ts.block)); current.cleanup(); finish({ canceled: false }); await valid;
		expect(controls.dialog).toHaveBeenCalledExactlyOnceWith('blocking/create', { userId: 'author' }, 'other-token');
	});
	it('keeps native mute duration selection and rejects an old account after the selection', async () => {
		controls.select.mockResolvedValue({ canceled: false, result: 'oneHour' }); const value = menu(); const resolved = await items(value);
		const now = vi.spyOn(Date, 'now').mockReturnValue(1000); await click(button(resolved, i18n.ts.mute));
		expect(controls.dialog).toHaveBeenCalledWith('mute/create', { userId: 'author', expiresAt: 3_601_000 }, 'unit-token'); now.mockRestore(); value.cleanup();
		controls.dialog.mockClear(); let finish!: (value: { canceled: boolean; result: string }) => void;
		controls.select.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const stale = menu(); const staleItems = await items(stale); const pending = click(button(staleItems, i18n.ts.mute));
		controls.account = null; finish({ canceled: false, result: 'indefinitely' }); await pending; expect(controls.dialog).not.toHaveBeenCalled(); stale.cleanup();
	});
	it('fails closed on unavailable author/state, stale resolved callbacks and signed-out access', async () => {
		controls.api.mockRejectedValue(new Error('offline')); const failed = menu(); const failedItems = await items(failed);
		expect(failedItems.filter(item => 'type' in item && item.type === 'label')).toHaveLength(4); expect(controls.dialog).not.toHaveBeenCalled(); failed.cleanup();
		controls.api.mockImplementation(async (endpoint: string) => endpoint === 'notes/state' ? controls.state : controls.author);
		const closed = menu(); const resolved = await items(closed); closed.cleanup(); await click(button(resolved, i18n.ts.favorite)); expect(controls.dialog).not.toHaveBeenCalled();
		controls.account = null; controls.api.mockClear(); const guest = menu(); expect(labels(await items(guest))).toEqual([i18n.ts.signinRequired]); expect(controls.api).not.toHaveBeenCalled(); guest.cleanup();
	});
	it('does not remove the original full generic menu when compact appearance is absent', async () => {
		const value = menu(note(), false); const resolved = await items(value);
		expect(labels(resolved)).toEqual(expect.arrayContaining([i18n.ts.copyContent, i18n.ts.copyLink, i18n.ts.copyRemoteLink, i18n.ts.showOnRemote])); value.cleanup();
	});
	it('resolves unavailable bookmark and thread state as labels in the full generic menu', async () => {
		controls.api.mockRejectedValue(new Error('offline'));
		const value = menu(note(), false);
		const resolved = await items(value);
		expect(resolved.filter(item => 'type' in item && item.type === 'label' && item.text === i18n.ts.cannotLoad)).toHaveLength(2);
		expect(labels(resolved)).not.toContain(i18n.ts.favorite);
		expect(labels(resolved)).not.toContain(i18n.ts.muteThread);
		expect(controls.dialog).not.toHaveBeenCalled();
		value.cleanup();
	});
});
