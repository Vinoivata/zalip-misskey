/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, nextTick, ref } from 'vue';
import ContinueRail from '@/pages/zalip/continue-rail.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';

const auth = vi.hoisted(() => ({ signedIn: true, user: { id: 'viewer' } }));
vi.mock('@/i.js', () => ({ get $i() { return auth.signedIn ? auth.user : null; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));
const item = { workId: 'work', episodeId: 'episode', seasonNumber: 2, episodeNumber: 3, provider: 'kodik', translationId: 'serial-123', mode: 'time', positionSeconds: 120, durationSeconds: 600, completed: false, lastPlayedAt: '2026-10-17T10:00:00Z', work: { id: 'work', title: 'Saved title', slug: 'saved-title', backdropPath: '/cover.jpg', posterPath: '/poster.jpg' }, episode: { id: 'episode', title: 'Third episode', stillPath: '/still.jpg' } };
const setup = () => render(defineComponent({ setup() {
	const rail = ref<InstanceType<typeof ContinueRail> | null>(null);
	return () => h('div', [h('button', { onClick: () => { void rail.value?.refresh(); } }, 'refresh-history'), h(ContinueRail, { ref: rail })]);
} }), { global: { stubs: { MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } });
beforeEach(() => {
	vi.clearAllMocks(); auth.signedIn = true;
	vi.mocked(misskeyApiZalip).mockImplementation(async endpoint => {
		if (endpoint === 'zalip/progress/continue') return { items: [item], nextCursor: null };
		if (endpoint === 'zalip/progress/reset') return { cleared: true };
		throw new Error('Unexpected endpoint');
	});
});
afterEach(cleanup);

describe('continue watching rail', () => {
	it('shows real server history and exact episode navigation without starting playback', async () => {
		const view = setup();
		const link = await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: item.work.title }) });
		expect(link.getAttribute('href')).toBe('/zalip/saved-title?season=2&episode=3');
		expect(view.getByRole('progressbar').getAttribute('value')).toBe('20');
		expect(view.getByText('2:00 / 10:00')).toBeTruthy();
		expect(misskeyApiZalip).toHaveBeenCalledTimes(1);
	});
	it('does not request private history for a signed-out viewer', async () => {
		auth.signedIn = false;
		const view = setup();
		await Promise.resolve();
		expect(misskeyApiZalip).not.toHaveBeenCalled();
		expect(view.queryByRole('region')).toBeNull();
	});
	it('keeps backend last-played order, removes duplicates/completed items and does not invent seconds', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...item, workId: 'newest', mode: 'episode', positionSeconds: null, durationSeconds: null }, item, item, { ...item, workId: 'completed', completed: true }], nextCursor: null });
		const view = setup();
		await waitFor(() => expect(view.getAllByRole('link')).toHaveLength(2));
		expect(view.getAllByRole('progressbar')).toHaveLength(1);
		expect(view.getByText(i18n.ts.zalip._progress.episodeOnly)).toBeTruthy();
	});
	it('resets private history with a separate accessible button, leaving library statuses alone', async () => {
		const view = setup();
		const reset = await view.findByRole('button', { name: i18n.tsx.zalip._progress.removeTitle({ title: item.work.title }) });
		expect(reset.closest('a')).toBeNull();
		await fireEvent.click(reset);
		await waitFor(() => expect(view.queryByRole('link')).toBeNull());
		expect(misskeyApiZalip).toHaveBeenCalledWith('zalip/progress/reset', { workId: 'work' });
		expect(vi.mocked(misskeyApiZalip).mock.calls.some(call => call[0] === 'zalip/library/update')).toBe(false);
	});
	it('falls back from a failed episode still to the cover then poster, not a foreign image', async () => {
		const view = setup();
		const image = await view.findByRole('img', { hidden: true });
		expect(image.getAttribute('src')).toContain('/still.jpg');
		await fireEvent.error(image);
		expect(image.getAttribute('src')).toContain('/cover.jpg');
		await fireEvent.error(image);
		expect(image.getAttribute('src')).toContain('/poster.jpg');
		await fireEvent.error(image);
		expect(view.queryByRole('img', { hidden: true })).toBeNull();
	});
	it('uses the existing small poster rendition only when no episode still or backdrop is available', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...item, episode: null, work: { ...item.work, backdropPath: null, posterThumbnailUrl: 'https://social.example/files/thumbnail-poster' } }], nextCursor: null });
		const view = setup();
		const image = await view.findByRole('img', { hidden: true });
		expect(image.getAttribute('src')).toBe('https://social.example/files/thumbnail-poster');
		await fireEvent.error(image);
		expect(image.getAttribute('src')).toContain('/poster.jpg');
	});
	it('does not let a concurrent refresh resurrect a successfully reset history card', async () => {
		let finishReset!: (result: unknown) => void;
		const previous = vi.mocked(misskeyApiZalip).getMockImplementation()!;
		vi.mocked(misskeyApiZalip).mockImplementation((endpoint, params) => endpoint === 'zalip/progress/reset' ? new Promise(resolve => { finishReset = resolve; }) : previous(endpoint, params));
		const view = setup();
		const reset = await view.findByRole('button', { name: i18n.tsx.zalip._progress.removeTitle({ title: item.work.title }) });
		await nextTick();
		await fireEvent.click(reset);
		await fireEvent.click(view.getByRole('button', { name: 'refresh-history' }));
		expect(vi.mocked(misskeyApiZalip).mock.calls.filter(call => call[0] === 'zalip/progress/continue')).toHaveLength(1);
		finishReset({ cleared: true });
		await waitFor(() => expect(view.queryByRole('link')).toBeNull());
	});
});
