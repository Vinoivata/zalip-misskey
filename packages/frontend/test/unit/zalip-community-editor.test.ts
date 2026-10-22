/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type { Ref } from 'vue';
import CommunityEditor from '@/pages/channel-editor.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), push: vi.fn(), success: vi.fn(), selectFile: vi.fn(), inputText: vi.fn(), session: null as Ref<{ id: string; token: string; policies: { canCreateChannel: boolean } } | null> | null }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref(null); return { get $i() { return controls.session!.value; }, iAmModerator: false }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/drive.js', () => ({ selectFile: controls.selectFile }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: controls.push }) }));
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/os.js', () => ({ success: controls.success, confirm: vi.fn(), inputText: controls.inputText }));
vi.mock('@/components/MkDraggable.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkColorInput.vue', () => ({ default: { template: '<div/>' } }));
vi.mock('@/components/MkInput.vue', () => ({ default: { props: ['modelValue', 'disabled'], emits: ['update:modelValue'], template: '<label><slot name="label"/><input :value="modelValue" :disabled="disabled" @input="$emit(\'update:modelValue\', $event.target.value)"></label>' } }));
vi.mock('@/components/MkTextarea.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue'], template: '<label><slot name="label"/><textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea></label>' } }));
vi.mock('@/components/MkSwitch.vue', () => ({ default: { template: '<div><slot name="label"/></div>' } }));
vi.mock('@/components/MkFolder.vue', () => ({ default: { template: '<div><slot/></div>' } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { props: ['disabled', 'wait'], emits: ['click'], template: '<button :disabled="disabled || wait" @click="$emit(\'click\', $event)"><slot/></button>' } }));
const stubs = { PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }), MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) };

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.session!.value = { id: 'ordinary-user', token: 'fixture-token', policies: { canCreateChannel: true } }; controls.api.mockResolvedValue({ id: 'new-community' }); });
afterEach(cleanup);

describe('native public community editor', () => {
	it('uses the community-specific Russian repost label rather than the untranslated native channel label', () => {
		const directory = dirname(fileURLToPath(import.meta.url));
		const editor = readFileSync(resolve(directory, '../../src/pages/channel-editor.vue'), 'utf8');
		const locale = readFileSync(resolve(directory, '../../../../locales/ja-JP.yml'), 'utf8');
		const communityLocale = locale.split('  _communities:')[1].split('  _importer:')[0];
		expect(editor).toContain('i18n.ts.zalip._communities.allowRenoteToExternal');
		expect(editor).not.toContain('i18n.ts._channel.allowRenoteToExternal');
		expect(communityLocale).toContain('allowRenoteToExternal: "Разрешить репосты и цитаты вне сообщества"');
	});
	it.each(['banner', 'pin-dialog', 'pin-read'] as const)('ignores an old %s result after switching to another editable community', async kind => {
		let finishFile!: (file: { id: string }) => void; let finishDialog!: (result: { canceled: boolean; result: string }) => void; let finishNote!: (note: { id: string }) => void;
		const fixture = (id: string) => ({ id, name: 'Community ' + id, userId: 'ordinary-user', description: '', bannerId: null, bannerUrl: null, pinnedNoteIds: [], color: '#000', isSensitive: false, allowRenoteToExternal: true });
		controls.api.mockImplementation((endpoint, params) => endpoint === 'channels/show' ? Promise.resolve(fixture(params.channelId)) : endpoint === 'notes/show' ? new Promise(resolve => { finishNote = resolve; }) : Promise.resolve(fixture(params.channelId)));
		controls.selectFile.mockReturnValue(new Promise(resolve => { finishFile = resolve; }));
		controls.inputText.mockReturnValue(kind === 'pin-dialog' ? new Promise(resolve => { finishDialog = resolve; }) : Promise.resolve({ canceled: false, result: 'old-note' }));
		const view = render(CommunityEditor, { props: { channelId: 'a' }, global: { stubs } }); await settle();
		if (kind === 'banner') await fireEvent.click(view.getByRole('button', { name: i18n.ts._channel.setBanner }));
		else await fireEvent.click(view.getByRole('button', { name: i18n.ts.add }));
		await settle(); await view.rerender({ channelId: 'b' }); await settle();
		if (kind === 'banner') finishFile({ id: 'old-banner' });
		if (kind === 'pin-dialog') finishDialog({ canceled: false, result: 'old-note' });
		if (kind === 'pin-read') finishNote({ id: 'old-note' });
		await settle(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.save })); await settle();
		expect(controls.api).toHaveBeenCalledWith('channels/update', expect.objectContaining({ channelId: 'b', bannerId: null, pinnedNoteIds: [] }), 'fixture-token');
		if (kind === 'pin-dialog') expect(controls.api.mock.calls.some(call => call[0] === 'notes/show')).toBe(false);
	});
	it('lets an ordinary capable user create a public group without any role or administrator operation', async () => {
		const view = render(CommunityEditor, { global: { stubs } }); await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.name }), '  Cinema club  ');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.create })); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/create', { name: 'Cinema club', description: null, bannerId: null, color: '#000', isSensitive: false, allowRenoteToExternal: true }, 'fixture-token'); expect(controls.push).toHaveBeenCalledExactlyOnceWith('/channels/:channelId', { params: { channelId: 'new-community' } });
	});
	it('respects disabled native creation capability instead of silently granting permissions', async () => {
		controls.session!.value!.policies.canCreateChannel = false; const view = render(CommunityEditor, { global: { stubs } });
		expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._communities.createUnavailable); expect(view.queryByRole('button', { name: i18n.ts.zalip._communities.create })).toBeNull(); expect(controls.api).not.toHaveBeenCalled();
	});
	it('prevents duplicate creates and keeps an API failure editable and retryable', async () => {
		let reject!: (error: Error) => void; controls.api.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
		const view = render(CommunityEditor, { global: { stubs } }); await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.name }), 'Cinema club');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.create })); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.create })); expect(controls.api).toHaveBeenCalledTimes(1);
		reject(new Error('offline')); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.somethingHappened); expect((view.getByRole('textbox', { name: i18n.ts.name }) as HTMLInputElement).value).toBe('Cinema club');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.create })); await settle(); expect(controls.api).toHaveBeenCalledTimes(2);
	});
	it('rejects an overlong name locally and exposes no edit controls to a different ordinary user', async () => {
		const view = render(CommunityEditor, { global: { stubs } }); await fireEvent.update(view.getByRole('textbox', { name: i18n.ts.name }), 'a'.repeat(129)); await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._communities.create })); expect(view.getByRole('alert').textContent).toBe(i18n.ts.invalidValue); expect(controls.api).not.toHaveBeenCalled(); view.unmount();
		controls.api.mockResolvedValue({ id: 'another', userId: 'someone-else', name: 'Other community', description: '', bannerId: null, bannerUrl: null, pinnedNoteIds: [], color: '#000' });
		const other = render(CommunityEditor, { props: { channelId: 'another' }, global: { stubs } }); await settle(); expect(other.getByRole('alert').textContent).toBe(i18n.ts.permissionDeniedErrorDescription); expect(other.queryByRole('button', { name: i18n.ts.save })).toBeNull();
	});
});
