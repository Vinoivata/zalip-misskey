/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkPostForm from '@/components/MkPostForm.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({
	api: vi.fn(), apiWithDialog: vi.fn(), popup: vi.fn(), menu: vi.fn(), confirm: vi.fn(), upload: vi.fn(), addFiles: vi.fn(), abort: vi.fn(), dispose: vi.fn(), choosePc: vi.fn(), chooseDrive: vi.fn(), inputDatetime: vi.fn(), drafts: new Map<string, string>(),
	account: { id: 'viewer', username: 'viewer', name: 'Viewer name', host: null, avatarUrl: '/avatar.png', isSilenced: false, policies: { scheduledNoteLimit: 10 } },
}));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account, notesCount: 10, incNotesCount: vi.fn() }));
vi.mock('@/instance.js', () => ({ instance: { maxNoteTextLength: 1000 } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/drive.js', () => ({ chooseDriveFile: controls.chooseDrive }));
vi.mock('@/utility/autocomplete.js', () => ({ Autocomplete: class { detach(): void {} } }));
vi.mock('@/accounts.js', () => ({ getAccounts: vi.fn().mockResolvedValue([]), getAccountMenu: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utility/achievements.js', () => ({ claimAchievement: vi.fn() }));
vi.mock('@/plugin.js', () => ({ getPluginHandlers: () => [] }));
vi.mock('@/utility/emoji-picker.js', () => ({ emojiPicker: { show: vi.fn() } }));
vi.mock('@/utility/mfm-function-picker.js', () => ({ mfmFunctionPicker: vi.fn() }));
vi.mock('@/utility/tour.js', () => ({ startTour: vi.fn() }));
vi.mock('@/os.js', () => ({ popup: controls.popup, popupMenu: controls.menu, apiWithDialog: controls.apiWithDialog, confirm: controls.confirm, chooseFileFromPc: controls.choosePc, inputDatetime: controls.inputDatetime, alert: vi.fn(), selectUser: vi.fn(), actions: vi.fn() }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: (key: string) => controls.drafts.get(key) ?? null, setItem: (key: string, value: string) => controls.drafts.set(key, value) } }));
vi.mock('@/preferences.js', () => ({ prefer: { s: { rememberNoteVisibility: false, defaultNoteVisibility: 'public', defaultNoteLocalOnly: false, keepCw: false, animation: false, enableQuickAddMfmFunction: false }, commit: vi.fn() } }));
vi.mock('@/store.js', async () => {
	const { ref } = await import('vue');
	return { store: { s: { showPreview: false, reactionAcceptance: null, visibility: 'public', localOnly: false }, r: { tips: ref({ postForm: true }) }, set: vi.fn(), model: (key: string) => ref(key === 'postFormWithHashtags' ? false : '') } };
});
vi.mock('@/composables/use-uploader.js', async () => {
	const { ref } = await import('vue');
	return { useUploader: () => ({ items: ref([]), uploading: ref(false), readyForUpload: ref(true), allItemsUploaded: ref(true), events: { on: vi.fn() }, upload: controls.upload, addFiles: controls.addFiles, removeItem: vi.fn(), reset: vi.fn(), abortAll: controls.abort, dispose: controls.dispose }) };
});
vi.mock('@/components/MkPollEditor.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue', 'destroyed'], template: '<div data-testid="composer-poll"><button @click="$emit(\'destroyed\')">Remove poll</button></div>' } }));
vi.mock('@/components/MkPostFormAttaches.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue', 'detach'], template: '<div data-testid="composer-files"><span v-for="file in modelValue" :key="file.id">{{ file.name }}</span></div>' } }));
vi.mock('@/components/MkNotePreview.vue', () => ({ default: { template: '<div data-testid="composer-preview" />' } }));
vi.mock('@/components/MkNoteSimple.vue', () => ({ default: { props: ['note'], template: '<div data-testid="composer-context">{{ note.text }}</div>' } }));
vi.mock('@/components/ZalipShareCard.vue', () => ({ default: { props: ['share'], template: '<div data-testid="composer-title">{{ share.title }}</div>' } }));
vi.mock('@/components/MkUploaderItems.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkPostForm.TextCounter.vue', () => ({ default: { template: '<div />' } }));

const stubs = {
	MkUserName: defineComponent({ props: ['user'], setup: props => () => h('span', props.user.name) }),
	MkAcct: defineComponent({ props: ['user'], setup: props => () => h('span', `@${props.user.username}`) }),
	MkInfo: defineComponent({ setup: (_, { slots }) => () => h('aside', slots.default?.()) }),
	MkTime: defineComponent({ setup: () => () => h('time', 'Scheduled time') }),
	I18n: defineComponent({ setup: (_, { slots }) => () => h('span', slots.x?.()) }),
	MkEllipsis: true,
	MkTip: true,
};

function setup(props: Record<string, unknown> = {}) {
	return render(MkPostForm, { props: { autofocus: false, instant: true, ...props }, global: { stubs, directives: { tooltip: {}, 'click-anime': {} } } });
}

async function settle(): Promise<void> { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }

function note(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'root', userId: 'author', user: { id: 'author', username: 'author', name: 'Author', host: null }, text: 'Reply context', visibility: 'public', files: [], ...patch } as Misskey.entities.Note;
}

beforeEach(() => {
	vi.clearAllMocks(); controls.drafts.clear();
	controls.api.mockResolvedValue({ createdNote: note({ id: 'created', text: 'Created' }) });
	controls.apiWithDialog.mockResolvedValue({ id: 'draft' });
	controls.confirm.mockResolvedValue({ canceled: false });
	controls.inputDatetime.mockResolvedValue({ canceled: false, result: new Date(Date.now() + 60_000) });
	controls.choosePc.mockResolvedValue([]); controls.chooseDrive.mockResolvedValue([]);
});
afterEach(cleanup);

describe('Notr-style native post composer', () => {
	it('has labelled controls and keeps the selected author, private audience and text/CW state visible without posting', async () => {
		const view = setup({ initialText: 'Private draft', initialCw: 'Spoilers', initialVisibility: 'followers' });
		expect(view.getByText('Viewer name')).toBeTruthy();
		expect(view.getByRole('button', { name: `${i18n.ts.visibility}: ${i18n.ts._visibility.followers}` }).textContent).toContain(i18n.ts._visibility.followers);
		expect((view.getByRole('textbox', { name: i18n.ts.annotation }) as HTMLInputElement).value).toBe('Spoilers');
		expect((view.getByRole('textbox', { name: i18n.ts.note }) as HTMLTextAreaElement).value).toBe('Private draft');
		await settle(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('keeps CW, hashtags, polls, upload and other native tools interactive and individually labelled', async () => {
		const view = setup();
		const cw = view.getByRole('button', { name: i18n.ts.useCw });
		expect(cw.getAttribute('aria-pressed')).toBe('false'); await fireEvent.click(cw);
		expect(cw.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.hashtags }));
		expect(view.getByRole('combobox', { name: i18n.ts.hashtags })).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.poll })); expect(view.getByTestId('composer-poll')).toBeTruthy();
		await fireEvent.click(view.getByRole('button', { name: 'Remove poll' })); expect(view.queryByTestId('composer-poll')).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.attachFile} (${i18n.ts.upload})` }));
		expect(controls.choosePc).toHaveBeenCalledExactlyOnceWith({ multiple: true });
		await fireEvent.click(view.getByRole('button', { name: `${i18n.ts.attachFile} (${i18n.ts.fromDrive})` }));
		expect(controls.chooseDrive).toHaveBeenCalledExactlyOnceWith({ multiple: true });
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('preserves the exact native post privacy, reply, CW and file payload behind explicit submit', async () => {
		const recipient = { id: 'recipient', username: 'recipient', host: null };
		const view = setup({ initialText: 'Private reply', reply: note(), initialCw: 'Spoilers', initialVisibility: 'specified', initialVisibleUsers: [recipient], initialFiles: [{ id: 'file', name: 'Photo' }] });
		await settle(); controls.api.mockClear();
		await fireEvent.click(view.getByTestId('post-form-submit')); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('notes/create', expect.objectContaining({ text: '@author ', replyId: 'root', cw: 'Spoilers', fileIds: ['file'], visibility: 'specified', visibleUserIds: ['recipient'], localOnly: false }), undefined);
		expect(view.emitted().posted).toHaveLength(1);
	});
	it('retains schedule and server-draft actions in the native settings menu', async () => {
		const view = setup({ initialText: 'Scheduled content' });
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.other }));
		const items = controls.menu.mock.calls[0][0] as Array<{ text?: string; action?: () => Promise<void> }>;
		await items.find(item => item.text === i18n.ts._drafts.saveToDraft)?.action?.();
		expect(controls.apiWithDialog).toHaveBeenCalledWith('notes/drafts/create', expect.objectContaining({ text: 'Scheduled content', isActuallyScheduled: false }));
		await items.find(item => item.text === `${i18n.ts.schedulePost}...`)?.action?.(); await settle();
		expect(view.getByText('Scheduled time')).toBeTruthy();
		controls.apiWithDialog.mockClear();
		await fireEvent.click(view.getByTestId('post-form-submit')); await settle();
		expect(controls.apiWithDialog).toHaveBeenCalledExactlyOnceWith('notes/drafts/create', expect.objectContaining({ text: 'Scheduled content', isActuallyScheduled: true, scheduledAt: expect.any(Number) }));
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('restores and updates a local draft without discarding native CW, files, visibility or poll state', async () => {
		controls.drafts.set('drafts', JSON.stringify({ 'note:viewer': { updatedAt: new Date().toISOString(), data: { text: 'Saved text', useCw: true, cw: 'Saved warning', visibility: 'followers', localOnly: true, files: [{ id: 'file', name: 'Saved photo' }], poll: { choices: ['Yes', 'No'], multiple: false, expiresAt: null, expiredAfter: null }, quoteId: null, reactionAcceptance: 'likeOnly', scheduledAt: null } } }));
		const view = setup({ instant: false }); await settle();
		expect((view.getByTestId('post-form-text') as HTMLTextAreaElement).value).toBe('Saved text');
		expect((view.getByRole('textbox', { name: i18n.ts.annotation }) as HTMLInputElement).value).toBe('Saved warning');
		expect(view.getByText('Saved photo')).toBeTruthy(); expect(view.getByTestId('composer-poll')).toBeTruthy();
		await fireEvent.update(view.getByTestId('post-form-text'), 'Updated text'); await settle();
		expect(JSON.parse(controls.drafts.get('drafts')!)['note:viewer'].data).toEqual(expect.objectContaining({ text: 'Updated text', cw: 'Saved warning', useCw: true, visibility: 'followers', localOnly: true, files: [{ id: 'file', name: 'Saved photo' }], poll: expect.objectContaining({ choices: ['Yes', 'No'] }) }));
		expect(controls.api).not.toHaveBeenCalled();
	});
	it('keeps mock previews read-only and leaves the native IME Escape guard intact', async () => {
		const view = setup({ mock: true, initialText: 'Preview' });
		expect((view.getByTestId('post-form-submit') as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(view.getByTestId('post-form-submit')); expect(controls.api).not.toHaveBeenCalled();
		const text = view.getByTestId('post-form-text');
		await fireEvent.keyDown(text, { key: 'Escape', isComposing: true }); expect(view.emitted().esc).toBeUndefined();
		await fireEvent.keyUp(text, { key: 'Escape' }); await fireEvent.keyDown(text, { key: 'Escape' });
		expect(view.emitted().esc).toHaveLength(1);
	});
});
