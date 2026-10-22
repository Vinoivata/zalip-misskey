/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { ImportRun, ImportWorkState } from '@/utility/zalip-importer.js';
import type { ImportPlayerRefreshResult } from '@/utility/zalip-importer-player-refresh.js';
import Importer from '@/pages/zalip/importer.vue';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { importerFieldLabel, importerSources } from '@/utility/zalip-importer.js';

vi.mock('@/i.js', async () => { const { reactive } = await import('vue'); return { iAmAdmin: true, $i: reactive({ id: 'admin1', token: 'fixture-token' }) }; });
vi.mock('@/page.js', () => ({ definePage: vi.fn() }));
vi.mock('@/os.js', () => ({ confirm: vi.fn() }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
vi.mock('@/pages/zalip/importer-artwork-settings.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/pages/zalip/importer-artwork-picker.vue', () => ({ default: { template: '<div />' } }));

const state: ImportWorkState = { workId: 'work1', title: 'Existing title', locks: ['title'], playbackRevision: 'a'.repeat(64), fields: [] };
const run: ImportRun = { id: 'run1', mode: 'availability', state: 'queued', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', total: 1, completed: 0, failed: 0, error: null, profileId: null };
const response = (status: ImportPlayerRefreshResult['status'] = 'queued'): ImportPlayerRefreshResult => ({ workId: 'work1', source: 'vibix', status, runId: status === 'queued' ? 'run1' : null, playbackRevision: 'a'.repeat(64) });

function setup() {
	return render(Importer, { global: { stubs: {
		PageWithHeader: defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) }),
		MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

async function loadState(view: ReturnType<typeof setup>) {
	view.getByText(i18n.ts.zalip._importer.persistedProtection, { selector: 'summary' }).closest('details')!.open = true;
	await fireEvent.update(view.getByLabelText(i18n.ts.zalip._importer.workId), 'work1');
	await fireEvent.click(view.getByRole('button', { name: i18n.ts.zalip._importer.loadWorkState }));
	await view.findByRole('heading', { name: 'Existing title' });
}

function refreshButton(view: ReturnType<typeof setup>) { return view.getByRole('button', { name: i18n.ts.zalip._importer.refreshVibixPlayers }); }

function refreshCalls() { return vi.mocked(misskeyApiZalip).mock.calls.filter(([endpoint]) => endpoint === 'zalip/admin/importer/work-state/refresh-players'); }

beforeEach(() => {
	vi.clearAllMocks();
	Object.assign($i!, { id: 'admin1', token: 'fixture-token' });
	vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
	vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
		if (endpoint === 'zalip/admin/importer/sources') return { sources: importerSources.map(source => ({ source, configured: true, capabilities: { search: true, collections: false, updates: false }, dailyLimit: null })) };
		if (endpoint === 'zalip/admin/importer/taxonomy/list') return { entries: [] };
		if (endpoint === 'zalip/admin/importer/schedules/list') return { profiles: [] };
		if (endpoint === 'zalip/admin/importer/runs/list') return { runs: [run] };
		if (endpoint === 'zalip/admin/importer/runs/show') return { run, items: [{ id: 'item1', position: 0, state: 'pending', ref: { source: 'vibix', externalId: '690593', mediaType: 'movie' }, workId: 'work1', error: null, warnings: [] }] };
		if (endpoint === 'zalip/admin/importer/work-state/show') return structuredClone(state);
		if (endpoint === 'zalip/admin/importer/work-state/refresh-players') return response();
		throw new Error('Unexpected fixture endpoint');
	});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Vibix player refresh in the existing work-state panel', () => {
	it('sends only the bound revision and opens the normal availability journal without saving locks or importing a title', async () => {
		const view = setup(); await loadState(view);
		await fireEvent.click(refreshButton(view));
		await view.findByText(i18n.ts.zalip._importer.refreshVibixPlayersQueued);
		await view.findByRole('button', { name: new RegExp(`${i18n.ts.zalip._importer.availabilityMode}.*run1`) });
		expect(refreshCalls()).toEqual([['zalip/admin/importer/work-state/refresh-players', { workId: 'work1', source: 'vibix', expected: 'a'.repeat(64) }]]);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/create' || endpoint === 'zalip/admin/importer/work-state/save')).toBe(false);
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/admin/importer/runs/show', { runId: 'run1' });
	});
	it.each(['unconfigured', 'players-locked', 'unsaved-locks', 'missing-revision'] as const)('blocks %s state before dispatch', async reason => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => {
			if (reason === 'unconfigured' && endpoint === 'zalip/admin/importer/sources') return { sources: importerSources.map(source => ({ source, configured: source !== 'vibix', capabilities: { search: true, collections: false, updates: false }, dailyLimit: null })) };
			if (endpoint === 'zalip/admin/importer/work-state/show') return { ...state, ...(reason === 'players-locked' ? { locks: ['title', 'players'] } : {}), ...(reason === 'missing-revision' ? { playbackRevision: undefined } : {}) };
			return original(endpoint, params);
		});
		const view = setup(); await loadState(view);
		if (reason === 'unsaved-locks') await fireEvent.click(within(view.getByLabelText(i18n.ts.zalip._importer.workId).closest('details')!).getByRole('checkbox', { name: importerFieldLabel('title') }));
		expect(refreshButton(view).hasAttribute('disabled')).toBe(true);
		await fireEvent.click(refreshButton(view));
		expect(refreshCalls()).toHaveLength(0);
	});
	it.each([
		['stale', 'repairVoicesStale'], ['locked', 'repairVoicesLocked'],
		['unsupported', 'refreshVibixPlayersUnsupported'], ['ambiguous', 'refreshVibixPlayersAmbiguous'], ['busy', 'refreshVibixPlayersBusy'],
	] as const)('shows the closed %s result without creating another job', async (status, message) => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => endpoint === 'zalip/admin/importer/work-state/refresh-players' ? response(status) : original(endpoint, params));
		const view = setup(); await loadState(view); await fireEvent.click(refreshButton(view));
		await view.findByText(i18n.ts.zalip._importer[message]);
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/show')).toBe(false);
	});
	it.each(['route', 'account', 'token', 'target', 'unmount'] as const)('ignores a queued result after the %s changes', async change => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		let resolve!: (value: ImportPlayerRefreshResult) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => endpoint === 'zalip/admin/importer/work-state/refresh-players' ? new Promise<ImportPlayerRefreshResult>(done => { resolve = done; }) : original(endpoint, params));
		const view = setup(); await loadState(view); await fireEvent.click(refreshButton(view));
		expect(refreshButton(view).hasAttribute('disabled')).toBe(true);
		if (change === 'route') await view.rerender({ workId: 'work2' });
		if (change === 'account') $i!.id = 'admin2';
		if (change === 'token') $i!.token = 'different-fixture-token';
		if (change === 'target') await fireEvent.update(view.getByLabelText(i18n.ts.zalip._importer.workId), 'work2');
		if (change === 'unmount') view.unmount();
		resolve(response());
		await new Promise(done => setTimeout(done, 0));
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(([endpoint]) => endpoint === 'zalip/admin/importer/runs/show')).toBe(false);
		expect(view.queryByText(i18n.ts.zalip._importer.refreshVibixPlayersQueued)).toBeNull();
	});
	it('prevents duplicate clicks and shows only the closed API failure message', async () => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		let reject!: (error: Error) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => endpoint === 'zalip/admin/importer/work-state/refresh-players' ? new Promise<ImportPlayerRefreshResult>((_done, fail) => { reject = fail; }) : original(endpoint, params));
		const view = setup(); await loadState(view); await fireEvent.click(refreshButton(view)); await fireEvent.click(refreshButton(view));
		expect(refreshCalls()).toHaveLength(1);
		reject(new Error('private upstream fixture detail'));
		await view.findByText(i18n.ts.zalip._importer.errorGeneric);
		expect(view.queryByText('private upstream fixture detail')).toBeNull();
		expect(refreshButton(view).hasAttribute('disabled')).toBe(false);
	});
	it('does not select an old journal after navigation while journal details are loading', async () => {
		const original = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		let resolve!: (value: { run: ImportRun; items: [] }) => void;
		vi.mocked(misskeyApiZalip).mockImplementation(async (endpoint, params) => endpoint === 'zalip/admin/importer/runs/show' ? new Promise<{ run: ImportRun; items: [] }>(done => { resolve = done; }) : original(endpoint, params));
		const view = setup(); await loadState(view); await fireEvent.click(refreshButton(view));
		await view.findByText(i18n.ts.zalip._importer.refreshVibixPlayersQueued);
		await view.rerender({ workId: 'work2' });
		resolve({ run, items: [] });
		await new Promise(done => setTimeout(done, 0));
		expect(view.queryByRole('heading', { name: i18n.ts.zalip._importer.runsHeading })).toBeNull();
		expect(view.getByRole('heading', { name: 'Existing title' })).toBeTruthy();
	});
});
