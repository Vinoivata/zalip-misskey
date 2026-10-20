/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { nextTick, reactive } from 'vue';
import Search from '@/pages/chat/room.search.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), account: null as any }));
vi.mock('@/i.js', () => ({ ensureSignin: () => controls.account }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/components/MkButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));
vi.mock('@/components/MkFoldableSection.vue', () => ({ default: { template: '<section><slot name="header"/><slot /></section>' } }));
vi.mock('@/pages/chat/XMessage.vue', () => ({ default: { props: ['message'], template: '<p>{{ message.text }}</p>' } }));

async function settle() { for (let index = 0; index < 8; index++) { await Promise.resolve(); await nextTick(); } }
function setup() { return render(Search, { props: { userId: 'peer' }, global: { stubs: { MkLoading: true, MkResult: true } } }); }
beforeEach(() => { vi.clearAllMocks(); controls.account = reactive({ id: 'me' }); controls.api.mockResolvedValue([]); });
afterEach(cleanup);

describe('Zalip chat message search', () => {
	it('gives the real search input an accessible name', async () => {
		const view = setup(); const input = view.getByRole('searchbox', { name: i18n.ts.zalip._chatUi.searchMessages }); await fireEvent.update(input, 'Cinema'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.search })); await settle();
		expect(controls.api).toHaveBeenCalledWith('chat/messages/search', { query: 'Cinema', userId: 'peer', roomId: undefined, limit: 50 });
	});
	it('does not apply a search result after switching the account or target', async () => {
		let resolve!: (value: unknown[]) => void; controls.api.mockReturnValue(new Promise(done => { resolve = done; })); const view = setup();
		await fireEvent.update(view.getByRole('searchbox'), 'Secret'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.search })); controls.account.id = 'another-account'; await view.rerender({ userId: 'other' });
		resolve([{ id: 'private', text: 'Private old result' }]); await settle(); expect(view.queryByText('Private old result')).toBeNull();
	});
	it('shows an actionable error and retries without a stuck pending state', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline')); const view = setup(); await fireEvent.update(view.getByRole('searchbox'), 'Cinema'); await fireEvent.click(view.getByRole('button', { name: i18n.ts.search })); await settle();
		expect(view.getByRole('alert')).toBeTruthy(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle(); expect(controls.api).toHaveBeenCalledTimes(2); expect(view.queryByRole('alert')).toBeNull();
	});
});
