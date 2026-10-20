/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import type * as Misskey from 'misskey-js';
import RoomInfo from '@/pages/chat/room.info.vue';
import Invitations from '@/pages/chat/home.invitations.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), confirm: vi.fn(), push: vi.fn(), changed: vi.fn(), account: null as any, inbox: [] as any[] }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/os.js', () => ({ confirm: controls.confirm }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: controls.push }) }));
vi.mock('@/utility/zalip-chat-types.js', () => ({ chatConversationEvents: { emit: controls.changed } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));
vi.mock('@/components/MkFolder.vue', () => ({ default: { template: '<section><slot name="label"/><slot/><slot name="footer"/></section>' } }));
vi.mock('@/components/MkInput.vue', () => ({ default: defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit, slots }) => () => h('label', [slots.label?.(), h('input', { value: props.modelValue, disabled: props.disabled, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })]) }) }));
vi.mock('@/components/MkTextarea.vue', () => ({ default: defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit, slots }) => () => h('label', [slots.label?.(), h('textarea', { value: props.modelValue, disabled: props.disabled, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) })]) }) }));
vi.mock('@/components/MkSwitch.vue', () => ({ default: defineComponent({ props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit, slots }) => () => h('label', [slots.label?.(), h('input', { type: 'checkbox', checked: props.modelValue, disabled: props.disabled, onClick: (event: Event) => { event.preventDefault(); emit('update:modelValue', !props.modelValue); } })]) }) }));

const room = { id: 'room', ownerId: 'me', name: 'Original room', description: 'Original description', isMuted: false } as Misskey.entities.ChatRoom;
const invitation = { id: 'invitation', createdAt: '2026-10-20T00:00:00Z', room: { ...room, ownerId: 'peer', owner: { id: 'peer', username: 'peer' } } };
const globals = { stubs: { MkAvatar: true, MkTime: true, MkLoading: true, MkResult: true, MkError: defineComponent({ emits: ['retry'], setup: (_, { emit }) => () => h('button', { onClick: () => emit('retry') }, 'Retry fixture') }) } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let index = 0; index < 10; index++) { await Promise.resolve(); await nextTick(); } }
function calls(endpoint: string) { return controls.api.mock.calls.filter(call => call[0] === endpoint); }
function info(override: Partial<Misskey.entities.ChatRoom> = {}) { return render(RoomInfo, { props: { room: { ...room, ...override } }, global: globals }); }
function invitations() { return render(Invitations, { global: globals }); }

beforeEach(() => {
	vi.clearAllMocks(); controls.inbox = [invitation];
	controls.account = reactive({ id: 'me', isAdmin: false, isModerator: false, policies: { chatAvailability: 'available' } });
	controls.confirm.mockResolvedValue({ canceled: false });
	controls.api.mockImplementation(async (endpoint: string, params: any) => {
		if (endpoint === 'chat/rooms/invitations/inbox') return controls.inbox;
		if (endpoint === 'chat/rooms/update') return { ...room, ...params };
		return undefined;
	});
});
afterEach(cleanup);

describe('native chat room settings', () => {
	it('emits the authoritative updated room and deduplicates save submissions', async () => {
		const pending = deferred<Misskey.entities.ChatRoom>(); controls.api.mockReturnValueOnce(pending.promise);
		const view = info(); await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.name }), 'New room');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await fireEvent.click(view.getByRole('button', { name: i18n.ts.save }));
		expect(calls('chat/rooms/update')).toHaveLength(1);
		const updated = { ...room, name: 'Canonical room', description: 'Canonical description' }; pending.resolve(updated); await settle();
		expect(view.emitted('updated')).toEqual([[updated]]); expect((view.getByRole('textbox', { name: i18n.ts.name }) as HTMLInputElement).value).toBe('Canonical room');
	});
	it('preserves edited settings after failure and allows retry', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')); const view = info();
		await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.name }), 'Retry room'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await settle();
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._chatUi.actionError); expect((view.getByRole('textbox', { name: i18n.ts.name }) as HTMLInputElement).value).toBe('Retry room');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await settle(); expect(view.emitted('updated')).toHaveLength(1); expect(view.queryByRole('alert')).toBeNull();
	});
	it('does not apply a previous room/account response or a stale delete confirmation', async () => {
		const pending = deferred<Misskey.entities.ChatRoom>(); controls.api.mockReturnValueOnce(pending.promise); const view = info();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await view.rerender({ room: { ...room, id: 'next', name: 'Next room' } });
		pending.resolve({ ...room, name: 'Old response' }); await settle(); expect(view.emitted('updated')).toBeUndefined(); expect(view.queryByDisplayValue('Old response')).toBeNull();
		const confirmation = deferred<{ canceled: boolean }>(); controls.confirm.mockReturnValueOnce(confirmation.promise); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.deleteGroup })); controls.account.id = 'another'; await settle();
		confirmation.resolve({ canceled: false }); await settle(); expect(calls('chat/rooms/delete')).toHaveLength(0); expect(controls.push).not.toHaveBeenCalled();
	});
	it('keeps a failed mute unchecked and emits successful changes, without mutations on readonly accounts', async () => {
		const view = info({ ownerId: 'peer' }); controls.api.mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(view.getByRole('checkbox')); await settle(); expect((view.getByRole('checkbox') as HTMLInputElement).checked).toBe(false); expect(view.getByRole('alert')).toBeTruthy();
		await fireEvent.click(view.getByRole('checkbox')); await settle(); expect(view.emitted('updated')).toEqual([[expect.objectContaining({ isMuted: true })]]);
		controls.account.policies.chatAvailability = 'readonly'; await settle(); expect((view.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
	});
});

describe('native chat room invitations', () => {
	it('deduplicates join/ignore clicks and refreshes conversation metadata after a successful join', async () => {
		const view = invitations(); await settle(); const pending = deferred<void>(); controls.api.mockReturnValueOnce(pending.promise);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.joinGroup })); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.joinGroup })); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.ignoreInvitation }));
		expect(calls('chat/rooms/join')).toHaveLength(1); expect(calls('chat/rooms/invitations/ignore')).toHaveLength(0);
		controls.inbox = []; pending.resolve(); await settle(); expect(controls.changed).toHaveBeenCalledWith('changed'); expect(calls('chat/rooms/invitations/inbox')).toHaveLength(2); expect(controls.push).toHaveBeenCalledWith('/chat/room/:roomId', { params: { roomId: 'room' } });
	});
	it('retains a failed invitation and supports an explicit retry', async () => {
		const view = invitations(); await settle(); controls.api.mockRejectedValueOnce(new Error('offline'));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.ignoreInvitation })); await settle(); expect(view.getByRole('alert')).toBeTruthy(); expect(view.getByRole('button', { name: i18n.ts.zalip._chatUi.ignoreInvitation }).hasAttribute('disabled')).toBe(false);
		controls.inbox = []; await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.ignoreInvitation })); await settle(); expect(view.queryByRole('alert')).toBeNull(); expect(view.queryByRole('button', { name: i18n.ts.zalip._chatUi.ignoreInvitation })).toBeNull(); expect(controls.push).not.toHaveBeenCalled(); expect(controls.changed).toHaveBeenCalledWith('changed');
	});
	it('clears private invitations and ignores pending actions after an account switch', async () => {
		const view = invitations(); await settle(); const pending = deferred<void>(); controls.api.mockReturnValueOnce(pending.promise);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.joinGroup })); controls.inbox = []; controls.account.id = 'another'; await settle(); expect(view.queryByText('Original room')).toBeNull();
		pending.resolve(); await settle(); expect(controls.push).not.toHaveBeenCalled(); expect(controls.changed).not.toHaveBeenCalled();
	});
	it('ignores a stale inbox response after switching accounts or unmounting', async () => {
		const pending = deferred<any[]>(); controls.api.mockReturnValueOnce(pending.promise); const view = invitations(); await settle(); controls.inbox = []; controls.account.id = 'another'; await settle(); pending.resolve([invitation]); await settle(); expect(view.queryByText('Original room')).toBeNull();
		view.unmount(); expect(controls.push).not.toHaveBeenCalled();
	});
	it('disables invitation mutations under readonly policy and permits inbox load retry', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')); const view = invitations(); await settle(); await fireEvent.click(view.getByText('Retry fixture')); await settle();
		controls.account.policies.chatAvailability = 'readonly'; await settle(); expect(view.getByRole('button', { name: i18n.ts.zalip._chatUi.joinGroup }).hasAttribute('disabled')).toBe(true); expect(calls('chat/rooms/join')).toHaveLength(0);
	});
});
