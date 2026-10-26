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
const globals = { stubs: { MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }), MkTime: true } };
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
	it('keeps one event date, names both independent actions, and has no nested links', async () => {
		const view = setup();
		await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		expect(view.container.querySelectorAll('mk-time-stub')).toHaveLength(1);
		expect(view.container.querySelector('mk-time-stub')?.getAttribute('time')).toBe(release.createdAt);
		expect(view.getAllByRole('link')).toHaveLength(3);
		expect(view.container.querySelector('a a')).toBeNull();
		expect(view.getByText(i18n.ts._notification.zalipEpisodeReleased)).toBeTruthy();
		expect(view.getByText('New episode')).toBeTruthy();
	});
	it('can omit the event date in native compact contexts without hiding the new episode', () => {
		const view = render(MkZalipReleaseNotification, { props: { notification: release, withProgress: false, withTime: false }, global: globals });
		expect(view.container.querySelector('mk-time-stub')).toBeNull();
		expect(view.container.querySelector('a[href="/zalip/series/watch?season=2&episode=8"]')).not.toBeNull();
	});
	it('presents several actual releases under one source and one personal action while retaining every date and target', async () => {
		const previous = { ...release, id: 'previous', episodeNumber: 7, episodeTitle: 'Previous episode', createdAt: '2026-10-25T23:30:00Z' };
		const view = render(MkZalipReleaseNotification, { props: { notification: release, notifications: [release, previous] }, global: globals });
		const resume = await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		expect(resume.getAttribute('href')).toContain('episode=5&provider=kodik&translation=voice-2');
		expect(view.getAllByRole('link', { name: 'Series' })).toHaveLength(1);
		expect(view.getAllByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toHaveLength(1);
		expect(view.container.querySelectorAll('img')).toHaveLength(1);
		expect(view.container.querySelectorAll('mk-time-stub')).toHaveLength(2);
		expect([...view.container.querySelectorAll('mk-time-stub')].map(time => time.getAttribute('time'))).toEqual([release.createdAt, previous.createdAt]);
		expect(view.container.querySelector('a[href="/zalip/series/watch?season=2&episode=8"]')).not.toBeNull();
		expect(view.container.querySelector('a[href="/zalip/series/watch?season=2&episode=7"]')).not.toBeNull();
		expect(view.container.querySelector('[data-scroll-anchor="previous"]')?.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=7');
		expect(view.container.querySelectorAll('[data-notification-id]')).toHaveLength(2);
		expect(view.getByText('Previous episode')).toBeTruthy();
		expect(view.getByText(i18n.ts.zalip.updatesHeading)).toBeTruthy();
		expect(misskeyApiZalip).toHaveBeenCalledExactlyOnceWith('zalip/progress/batch', { workIds: ['work'] });
	});
	it('does not let an unrelated or differently typed grouped item relabel a release', () => {
		const view = render(MkZalipReleaseNotification, { props: { notification: release, notifications: [release, { ...release, id: 'foreign', workId: 'other', workSlug: 'other', workTitle: 'Other work' }, { type: 'zalipAllohaAvailable', id: 'availability', createdAt: release.createdAt, workId: 'work', workSlug: 'series', workTitle: 'Series', seasonNumber: 2, episodeNumber: 6, translationCount: 2 }], withProgress: false }, global: globals });
		expect(view.container.querySelectorAll('mk-time-stub')).toHaveLength(1);
		expect(view.getByText(i18n.ts._notification.zalipEpisodeReleased)).toBeTruthy();
		expect(view.queryByText('Other work')).toBeNull();
		expect(view.container.querySelector('a[href*="episode=6"]')).toBeNull();
	});
	it('orders actual episodes newest first, initially shows three, and retains all collapsed links and one personal action', async () => {
		const received = [39, 41, 42, 43, 44, 45, 46, 47, 40];
		const notifications = Object.freeze(received.map(number => Object.freeze({ ...release, id: `release${number}`, seasonNumber: 1, episodeNumber: number, episodeTitle: `Episode ${number}` })));
		const view = render(MkZalipReleaseNotification, { props: { notification: notifications[0], notifications }, global: globals });
		const resume = await view.findByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) });
		const details = view.container.querySelector('details')!;
		const visible = details.previousElementSibling!;
		const ids = (element: Element) => [...element.querySelectorAll('[data-notification-id]')].map(link => link.getAttribute('data-notification-id'));
		expect(ids(visible)).toEqual(['release47', 'release46', 'release45']);
		expect(details.hasAttribute('open')).toBe(false);
		expect(ids(details)).toEqual(['release44', 'release43', 'release42', 'release41', 'release40', 'release39']);
		expect(view.getByText(`${i18n.ts.showMore} (6)`)).toBeTruthy();
		expect([...view.container.querySelectorAll('[data-notification-id]')].map(link => link.getAttribute('href'))).toEqual([47, 46, 45, 44, 43, 42, 41, 40, 39].map(number => `/zalip/series/watch?season=1&episode=${number}`));
		expect(view.container.querySelectorAll('mk-time-stub')).toHaveLength(9);
		expect(view.container.querySelectorAll('[data-scroll-anchor]')).toHaveLength(8);
		expect(details.contains(resume)).toBe(false);
		expect(resume.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=5&provider=kodik&translation=voice-2');
		await fireEvent.click(details.querySelector('summary')!);
		expect(details.open).toBe(true);
		expect(ids(view.container)).toEqual(['release47', 'release46', 'release45', 'release44', 'release43', 'release42', 'release41', 'release40', 'release39']);
		expect(view.getAllByRole('link', { name: i18n.tsx.zalip._progress.continueTitle({ title: 'Series' }) })).toHaveLength(1);
		expect(notifications.map(item => item.episodeNumber)).toEqual(received);
	});
	it('orders season and episode coordinates without moving unknown/movie slots or fabricating missing episodes', () => {
		const availability = { type: 'zalipAllohaAvailable' as const, id: 'availability', createdAt: release.createdAt, workId: 'work', workSlug: 'series', workTitle: 'Series', translationCount: 2 };
		const notifications = [
			{ ...availability, id: 'season1', seasonNumber: 1, episodeNumber: 47 },
			{ ...availability, id: 'unknown', seasonNumber: null, episodeNumber: null },
			{ ...availability, id: 'season2', seasonNumber: 2, episodeNumber: 1 },
			{ ...availability, id: 'special', seasonNumber: 0, episodeNumber: 0 },
			{ ...availability, id: 'unknown2', seasonNumber: null, episodeNumber: null },
		];
		const view = render(MkZalipReleaseNotification, { props: { notification: notifications[0], notifications, withProgress: false }, global: globals });
		expect([...view.container.querySelectorAll('[data-notification-id]')].map(link => link.getAttribute('data-notification-id'))).toEqual(['season2', 'unknown', 'season1', 'special', 'unknown2']);
		expect(view.container.querySelector('[data-notification-id="unknown"]')?.getAttribute('href')).toBe('/zalip/series/watch?provider=alloha');
		expect(view.container.querySelector('[data-notification-id="special"]')?.getAttribute('href')).toBe('/zalip/series/watch?season=0&episode=0&provider=alloha');
		expect(view.container.querySelectorAll('[data-notification-id]')).toHaveLength(5);
	});
	it('keeps a focused received episode accessible when a newer event moves it into the collapsed remainder', async () => {
		const notifications = [47, 46, 45, 44].map(number => ({ ...release, id: `release${number}`, episodeNumber: number }));
		const view = render(MkZalipReleaseNotification, { props: { notification: notifications[0], notifications, withProgress: false }, global: globals });
		const focused = view.container.querySelector<HTMLAnchorElement>('[data-notification-id="release45"]')!;
		focused.focus();
		const incoming = { ...release, id: 'release48', episodeNumber: 48 };
		await view.rerender({ notification: incoming, notifications: [incoming, ...notifications], withProgress: false });
		const retained = view.container.querySelector<HTMLAnchorElement>('[data-notification-id="release45"]')!;
		expect(document.activeElement).toBe(retained);
		expect(view.container.querySelector('details')?.open).toBe(true);
		expect(retained.getAttribute('href')).toBe('/zalip/series/watch?season=2&episode=45');
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
		expect(view.getByText(i18n.ts.zalip.releaseAvailable)).toBeTruthy();
		expect(view.container.textContent).not.toContain('Alloha');
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
