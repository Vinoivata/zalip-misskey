/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick, reactive } from 'vue';
import ChatForm from '@/pages/chat/room.form.vue';
import { i18n } from '@/i18n.js';
import { chatDraftKey, readChatDrafts } from '@/utility/zalip-chat-types.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), upload: vi.fn(), selectFile: vi.fn(), account: null as any, store: new Map<string, string>(), get: vi.fn(), set: vi.fn(), media: vi.fn() }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/os.js', () => ({ launchUploader: controls.upload }));
vi.mock('@/utility/drive.js', () => ({ selectFile: controls.selectFile }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: controls.get, setItem: controls.set } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { 'chat.sendOnEnter': true } } }));
vi.mock('@/utility/autocomplete.js', () => ({ Autocomplete: class { detach() {} } }));
vi.mock('@/utility/emoji-picker.js', () => ({ emojiPicker: { show: vi.fn() } }));
vi.mock('@/drag-and-drop.js', () => ({ getDragData: vi.fn() }));

const peer = { id: 'peer', name: 'Peer', username: 'peer', host: null, canChat: true } as any;
const file = { id: 'file', name: 'Photo.jpg', type: 'image/jpeg' } as any;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }
function setup(props: Record<string, unknown> = {}) { return render(ChatForm, { props: { user: peer, ...props } }); }

beforeEach(() => {
	vi.clearAllMocks(); controls.store.clear();
	controls.account = reactive({ id: 'me', policies: { chatAvailability: 'available' } });
	controls.get.mockImplementation((key: string) => controls.store.get(key) ?? null);
	controls.set.mockImplementation((key: string, value: string) => { controls.store.set(key, value); });
	controls.api.mockResolvedValue({ id: 'sent', text: 'Hello', fromUserId: 'me', reactions: [] });
	controls.upload.mockResolvedValue([file]); controls.selectFile.mockResolvedValue(file);
	vi.stubGlobal('MediaRecorder', undefined);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Zalip chat composer', () => {
	it('uses account-scoped drafts and safely ignores malformed legacy data', () => {
		expect(chatDraftKey('first', { userId: 'peer' })).not.toBe(chatDraftKey('second', { userId: 'peer' }));
		expect(readChatDrafts('{broken')).toEqual({}); expect(readChatDrafts('[]')).toEqual({});
		controls.store.set('chatMessageDrafts', '{broken'); const view = setup();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
	});
	it('continues to compose when device storage is disabled', async () => {
		controls.get.mockImplementation(() => { throw new Error('storage disabled'); }); const view = setup();
		await fireEvent.update(view.getByRole('textbox'), 'Hello'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.send })); await settle();
		expect(controls.api).toHaveBeenCalledTimes(1); expect(view.emitted().sent).toHaveLength(1);
	});
	it('deduplicates repeated Enter while sending', async () => {
		const pending = deferred<any>(); controls.api.mockReturnValue(pending.promise); const view = setup();
		const input = view.getByRole('textbox'); await fireEvent.update(input, 'Hello');
		await fireEvent.keyDown(input, { key: 'Enter' }); await fireEvent.keyDown(input, { key: 'Enter' });
		expect(controls.api).toHaveBeenCalledTimes(1); pending.resolve({ id: 'sent', fromUserId: 'me', reactions: [] }); await settle();
		expect((input as HTMLTextAreaElement).value).toBe('');
	});
	it('preserves a failed draft and permits explicit retry', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')); const view = setup(); const input = view.getByRole('textbox');
		await fireEvent.update(input, 'Try again'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.send })); await settle();
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._chatUi.sendError); expect((input as HTMLTextAreaElement).value).toBe('Try again');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.send })); await settle(); expect(controls.api).toHaveBeenCalledTimes(2);
	});
	it('assigns an uploaded drop and warns that Drive links are shareable', async () => {
		const view = setup(); const attachment = new File(['image'], 'Photo.jpg', { type: 'image/jpeg' });
		await fireEvent.drop(view.container.firstElementChild!, { dataTransfer: { files: [attachment] } }); await settle();
		expect(view.getByText('Photo.jpg')).toBeTruthy(); expect(view.getByText(i18n.ts.zalip._chatUi.privateFilesHint)).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.send })); await settle(); expect(controls.api).toHaveBeenCalledWith('chat/messages/create-to-user', expect.objectContaining({ toUserId: 'peer', fileId: 'file' }));
	});
	it('ignores an old upload after target or account changes', async () => {
		const pending = deferred<any[]>(); controls.upload.mockReturnValue(pending.promise); const view = setup();
		await fireEvent.drop(view.container.firstElementChild!, { dataTransfer: { files: [new File(['x'], 'Photo.jpg')] } });
		await view.rerender({ user: { ...peer, id: 'other' } }); controls.account.id = 'another-account'; await settle(); pending.resolve([file]); await settle();
		expect(view.queryByText('Photo.jpg')).toBeNull(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('does not clear the next target draft after an old send finishes', async () => {
		const pending = deferred<any>(); controls.api.mockReturnValue(pending.promise); const view = setup();
		await fireEvent.update(view.getByRole('textbox'), 'First'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.send }));
		await view.rerender({ user: { ...peer, id: 'other' } }); await fireEvent.update(view.getByRole('textbox'), 'New draft');
		pending.resolve({ id: 'old', fromUserId: 'me', reactions: [] }); await settle();
		expect((view.getByRole('textbox') as HTMLTextAreaElement).value).toBe('New draft'); expect(view.emitted().sent).toBeUndefined();
	});
	it('keeps a reopened draft when an unmounted send resolves', async () => {
		const pending = deferred<any>(); controls.api.mockReturnValue(pending.promise); const first = setup();
		await fireEvent.update(first.getByRole('textbox'), 'Sending'); await fireEvent.click(first.getByRole('button', { name: i18n.ts.send })); first.unmount();
		const second = setup(); await fireEvent.update(second.getByRole('textbox'), 'Reopened draft'); pending.resolve({ id: 'old', fromUserId: 'me', reactions: [] }); await settle();
		expect((second.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Reopened draft'); expect(readChatDrafts(controls.store.get('chatMessageDrafts') ?? null)['me:user:peer'].text).toBe('Reopened draft');
	});
	it('sends canonical reply IDs and edits without replacing attachments', async () => {
		const view = setup({ replyTo: { id: 'reply', text: 'Original' } }); await fireEvent.update(view.getByRole('textbox'), 'Answer'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.send })); await settle();
		expect(controls.api).toHaveBeenLastCalledWith('chat/messages/create-to-user', expect.objectContaining({ replyId: 'reply', text: 'Answer' }));
		await view.rerender({ replyTo: null, editingMessage: { id: 'edit', text: 'Caption', file } }); await settle(); await fireEvent.update(view.getByRole('textbox'), 'Edited'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await settle();
		expect(controls.api).toHaveBeenLastCalledWith('chat/messages/edit', { messageId: 'edit', text: 'Edited' });
	});
	it('blocks excessive messages and inactive sends', async () => {
		const view = setup(); await fireEvent.update(view.getByRole('textbox'), 'x'.repeat(2001)); expect((view.getByRole('button', { name: i18n.ts.send }) as HTMLButtonElement).disabled).toBe(true);
		await view.rerender({ active: false }); await fireEvent.keyDown(view.getByRole('textbox'), { key: 'Enter' }); expect(controls.api).not.toHaveBeenCalled();
	});
	it('stops a permission result arriving after collapse without recording or uploading', async () => {
		const pending = deferred<MediaStream>(); const track = { stop: vi.fn() }; controls.media.mockReturnValue(pending.promise);
		vi.stubGlobal('MediaRecorder', class {}); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: controls.media } });
		const view = setup(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._chatUi.recordVoice })); view.unmount();
		pending.resolve({ getTracks: () => [track] } as unknown as MediaStream); await settle(); expect(track.stop).toHaveBeenCalledTimes(1); expect(controls.upload).not.toHaveBeenCalled();
	});
});
