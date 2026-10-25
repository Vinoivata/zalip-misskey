/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/vue';
import { defineComponent, h, ref } from 'vue';
import MkZalipReleaseNotification from '@/components/MkZalipReleaseNotification.vue';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { i18n } from '@/i18n.js';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';

const auth = vi.hoisted(() => ({ state: null as { value: { id: string; token: string } | null } | null }));
vi.mock('@/i.js', () => ({ get $i() { return auth.state?.value ?? null; } }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApiZalip: vi.fn() }));

const release = { type: 'zalipEpisodeReleased' as const, id: 'release', createdAt: '2026-10-26T00:00:00Z', workId: 'work', workSlug: 'series', workTitle: 'Series', seasonNumber: 2, episodeNumber: 8, episodeTitle: 'New episode', posterThumbnailUrl: 'https://social.example/files/poster-thumb', posterPath: 'https://social.example/files/poster-original' };
const saved: WatchProgress = { workId: 'work', episodeId: 'episode5', seasonNumber: 2, episodeNumber: 5, provider: 'kodik', translationId: 'voice-2', mode: 'time', positionSeconds: 754, durationSeconds: 1440, completed: false, lastPlayedAt: '2026-10-26T00:00:00Z' };
const globals = { stubs: { MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } };
const setup = (notification: InstanceType<typeof MkZalipReleaseNotification>['$props']['notification'] = release, withProgress = true) => render(MkZalipReleaseNotification, { props: { notification, withProgress }, global: globals });
let accountVersion = 0;

beforeEach(() => {
	vi.clearAllMocks(); auth.state = ref({ id: `viewer-${++accountVersion}`, token: 'fixture' });
	vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [saved] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('release notification event and personal playback are separate targets', () => {
	it('links the newly released episode separately from the saved episode and exact edition', async () => {
		const view = setup();
		const resume = await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		expect(resume.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=5&provider=kodik&translation=voice-2');
		const event = view.getByRole('link', { name: `${i18n.ts.zalip.watchTitle}: Series · ${i18n.tsx.zalip.releaseSeason({ number: '2' })} · ${i18n.tsx.zalip.releaseEpisode({ number: '8' })}: New episode` });
		expect(event.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=8');
		expect(view.getByText(i18n.tsx.zalip._progress.stoppedAt({ target: `${i18n.tsx.zalip.releaseSeason({ number: '2' })} · ${i18n.tsx.zalip.releaseEpisode({ number: '5' })} · 12:34` }))).toBeTruthy();
		expect(view.queryByText(i18n.ts.zalip.playerWatched)).toBeNull();
		expect(misskeyApiZalip).toHaveBeenCalledExactlyOnceWith('zalip/progress/batch', { workIds: ['work'] });
		expect(view.container.querySelector('a[href*="seconds="]')).toBeNull();
	});
	it('uses the packed small poster, falls back to the original, and keeps the event usable after both fail', async () => {
		const view = setup(release, false);
		const image = view.container.querySelector('img')!;
		expect(image.getAttribute('src')).toBe(release.posterThumbnailUrl);
		await fireEvent.error(image); expect(image.getAttribute('src')).toBe(release.posterPath);
		await fireEvent.error(image); expect(view.container.querySelector('img')).toBeNull();
		expect(view.getByRole('link', { name: 'Series' }).getAttribute('href')).toBe('/zalip/series');
		expect(misskeyApiZalip).not.toHaveBeenCalled();
	});
	it('does not describe absent or failed history as never watched or invent a resume target', async () => {
		vi.mocked(misskeyApiZalip).mockRejectedValue(new Error('offline'));
		const view = setup(); await waitFor(() => expect(misskeyApiZalip).toHaveBeenCalledTimes(1));
		expect(view.queryByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toBeNull();
		expect(view.container.querySelector('a[href="/zalip/series/watch?season=2&episode=8"]')).not.toBeNull();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe(release.posterThumbnailUrl);
	});
	it('never fabricates seconds for an episode-only selection', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...saved, mode: 'episode', positionSeconds: null, durationSeconds: null }] });
		const view = setup(); await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		expect(view.getByText(`${i18n.ts.zalip._progress.episodeOnly} · ${i18n.tsx.zalip.releaseSeason({ number: '2' })} · ${i18n.tsx.zalip.releaseEpisode({ number: '5' })}`)).toBeTruthy();
		expect(view.container.textContent).not.toContain('0:00');
	});
	it('does not resurrect a history poster when the native visibility projection has no artwork', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...saved, work: { posterPath: 'https://social.example/files/stale-art' } }] });
		const view = setup({ ...release, posterPath: null, posterThumbnailUrl: null });
		await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		expect(view.container.querySelector('img')).toBeNull();
	});
	it('shares one private progress request across multiple notification rows', async () => {
		const view = render(defineComponent({ setup: () => () => h('div', Array.from({ length: 8 }, (_, index) => h(MkZalipReleaseNotification, { key: index, notification: { ...release, id: `r${index}` } }))) }), { global: globals });
		await waitFor(() => expect(view.getAllByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toHaveLength(8));
		expect(misskeyApiZalip).toHaveBeenCalledTimes(1);
	});
	it('does not request or show another account history when signed out', async () => {
		auth.state!.value = null;
		const view = setup();
		expect(misskeyApiZalip).not.toHaveBeenCalled();
		expect(view.queryByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toBeNull();
	});
	it('removes an already displayed private resume target immediately on logout', async () => {
		const view = setup();
		await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		auth.state!.value = null;
		await waitFor(() => expect(view.queryByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toBeNull());
		expect(view.container.textContent).not.toContain('12:34');
		expect(misskeyApiZalip).toHaveBeenCalledTimes(1);
	});
	it('distinguishes movie availability from a saved movie position without invented episode coordinates', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...saved, episodeId: null, seasonNumber: null, episodeNumber: null, provider: 'collaps', translationId: 'movie-voice' }] });
		const view = render(MkZalipReleaseNotification, { props: { notification: { type: 'zalipAllohaAvailable', id: 'film', createdAt: release.createdAt, workId: 'work', workSlug: 'series', workTitle: 'Film', seasonNumber: null, episodeNumber: null, translationCount: 2 } }, global: globals });
		const resume = await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Film' }) });
		expect(resume.getAttribute('href')).toBe('/zalip/series/watch?provider=collaps&translation=movie-voice');
		expect(view.getByText(i18n.tsx.zalip._progress.stoppedAtMovie({ time: '12:34' }))).toBeTruthy();
		expect(view.getByRole('link', { name: `${i18n.ts.zalip.watchTitle}: Film` }).getAttribute('href')).toBe('/zalip/series/watch?provider=alloha');
	});
	it('shows a completed last playback target without confusing it with the new release or claiming the whole title was watched', async () => {
		vi.mocked(misskeyApiZalip).mockResolvedValue({ items: [{ ...saved, completed: true, positionSeconds: 1440 }] });
		const view = setup();
		const last = await view.findByRole('link', { name: `${i18n.ts.zalip._progress.lastPlayedAction}: Series` });
		expect(last.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=5&provider=kodik&translation=voice-2');
		expect(view.getByText(i18n.tsx.zalip._progress.lastPlayed({ target: `${i18n.tsx.zalip.releaseSeason({ number: '2' })} · ${i18n.tsx.zalip.releaseEpisode({ number: '5' })} · 24:00` }))).toBeTruthy();
		expect(view.container.querySelector('a[href="/zalip/series/watch?season=2&episode=8"]')).not.toBeNull();
		expect(view.queryByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toBeNull();
		expect(view.queryByText(i18n.ts.zalip.playerWatched)).toBeNull();
	});
});
