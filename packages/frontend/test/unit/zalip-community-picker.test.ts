/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick } from 'vue';
import type { Ref } from 'vue';
import type * as Misskey from 'misskey-js';
import MkZalipCommunityPicker from '@/components/MkZalipCommunityPicker.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), close: vi.fn(), session: null as Ref<{ id: string; token: string } | null> | null }));
vi.mock('@/i.js', async () => { const { ref } = await import('vue'); controls.session = ref({ id: 'viewer', token: 'fixture-token' }); return { get $i() { return controls.session!.value; } }; });
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/components/MkModalWindow.vue', () => ({ default: { props: ['width', 'height'], emits: ['close', 'closed', 'esc', 'click'], setup: (_props: unknown, { expose }: { expose: (value: unknown) => void }) => { expose({ close: controls.close }); }, template: '<section><header><slot name="header"/></header><slot/></section>' } }));

function channel(id: string, patch: Partial<Misskey.entities.Channel> = {}): Misskey.entities.Channel { return { id, name: id, description: id + ' description', isArchived: false, bannerUrl: null, ...patch } as Misskey.entities.Channel; }

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }

beforeEach(() => { vi.clearAllMocks(); controls.session!.value = { id: 'viewer', token: 'fixture-token' }; controls.api.mockResolvedValue([channel('Cinema club')]); });
afterEach(cleanup);

describe('optional native community picker', () => {
	it('always allows personal posting without a required community and performs no mutation', async () => {
		const view = render(MkZalipCommunityPicker); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/followed', { limit: 21 }, 'fixture-token');
		await fireEvent.click(view.getByRole('button', { name: new RegExp(i18n.ts.zalip._communities.personal) }));
		expect(view.emitted().selected).toEqual([[null]]); expect(controls.close).toHaveBeenCalledTimes(1);
		expect(controls.api.mock.calls.every(call => ['channels/followed', 'channels/search'].includes(call[0]))).toBe(true);
	});
	it('returns the exact selected native channel and exposes the public audience warning', async () => {
		const selected = channel('Cinema club'); controls.api.mockResolvedValue([selected]);
		const view = render(MkZalipCommunityPicker, { props: { currentChannelId: selected.id } }); await settle();
		expect(view.getByText(i18n.ts.zalip._communities.publicNotice)).toBeTruthy();
		const item = view.getByRole('button', { name: /Cinema club/ }); expect(item.getAttribute('aria-pressed')).toBe('true');
		await fireEvent.click(item); expect(view.emitted().selected).toEqual([[selected]]); expect(controls.close).toHaveBeenCalledTimes(1);
	});
	it('searches all public communities, not only followed ones, without changing a subscription', async () => {
		const view = render(MkZalipCommunityPicker); await settle(); controls.api.mockClear();
		await fireEvent.update(view.getByRole('searchbox'), '  Movies  '); await fireEvent.submit(view.getByRole('searchbox').closest('form')!); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/search', { limit: 21, query: 'Movies', type: 'nameAndDescription' }, 'fixture-token');
		expect(view.emitted().selected).toBeUndefined();
	});
	it('does not select archived channels and keeps a failed request retryable', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([channel('Archived', { isArchived: true })]);
		const view = render(MkZalipCommunityPicker); await settle(); expect(view.getByRole('alert').textContent).toBe(i18n.ts.zalip._communities.loadError);
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle(); const item = view.getByRole('button', { name: /Archived/ }); expect((item as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.click(item); expect(view.emitted().selected).toBeUndefined();
	});
	it('uses public discovery as a guest and offers no authenticated directory mode', async () => {
		controls.session!.value = null; const view = render(MkZalipCommunityPicker); await settle();
		expect(controls.api).toHaveBeenCalledExactlyOnceWith('channels/search', { limit: 21, query: '', type: 'nameAndDescription' }, null); expect(view.queryByRole('button', { name: i18n.ts.zalip._communities.following })).toBeNull();
	});
});
