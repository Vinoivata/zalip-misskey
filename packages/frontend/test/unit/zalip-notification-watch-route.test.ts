/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type { Notification } from 'misskey-js/entities.js';
import MkNotification from '@/components/MkNotification.vue';
import { i18n } from '@/i18n.js';

vi.mock('@/i.js', () => ({ $i: null, ensureSignin: () => ({ id: 'reader' }) }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn().mockResolvedValue({}), misskeyApiZalip: vi.fn().mockResolvedValue({ items: [] }) }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { render: () => null } }));
vi.mock('@/components/MkButton.vue', () => ({ default: { render: () => null } }));

afterEach(cleanup);

function renderNotification(notification: Notification) {
	return render(MkNotification, { props: { notification, withTime: true }, global: { stubs: {
		MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		MkAvatar: true, MkTime: true, Mfm: true, I18n: true,
	} } });
}

describe('native cinema notification playback links', () => {
	const base = { id: 'release', createdAt: '2026-10-26T00:00:00.000Z', workId: 'work', workSlug: 'a/b', workTitle: 'Canonical title', posterThumbnailUrl: 'https://social.example/files/poster-thumb' };
	const episodeTarget = (season: number, episode: number) => `${i18n.tsx.zalip.releaseSeason({ number: String(season) })} · ${i18n.tsx.zalip.releaseEpisode({ number: String(episode) })}`;

	it('opens the exact special episode on its playback page', () => {
		const view = renderNotification({ ...base, type: 'zalipEpisodeReleased', seasonNumber: 0, episodeNumber: 0, episodeTitle: 'Special' });
		expect(view.getByRole('link', { name: `${i18n.ts.zalip.watchTitle}: Canonical title · ${episodeTarget(0, 0)}: Special` }).getAttribute('href')).toBe('/zalip/a%2Fb/watch?season=0&episode=0');
		expect(view.getByRole('link', { name: 'Canonical title' }).getAttribute('href')).toBe('/zalip/a%2Fb');
		expect(view.getByText(i18n.ts._notification.zalipEpisodeReleased)).toBeTruthy();
		expect(view.container.querySelector('mk-avatar-stub')).toBeNull();
		expect(view.container.querySelector('img')?.getAttribute('src')).toBe(base.posterThumbnailUrl);
		expect(view.container.querySelector('mk-time-stub')?.getAttribute('time')).toBe(base.createdAt);
	});

	it('selects Alloha for its availability notice while preserving episode coordinates', () => {
		const view = renderNotification({ ...base, type: 'zalipAllohaAvailable', seasonNumber: 2, episodeNumber: 4, translationCount: 2 });
		expect(view.getByRole('link', { name: `${i18n.ts.zalip.watchTitle}: Canonical title · ${episodeTarget(2, 4)}` }).getAttribute('href')).toBe('/zalip/a%2Fb/watch?season=2&episode=4&provider=alloha');
	});

	it('opens film availability without inventing season or episode numbers', () => {
		const view = renderNotification({ ...base, type: 'zalipAllohaAvailable', seasonNumber: null, episodeNumber: null, translationCount: 1 });
		expect(view.getByRole('link', { name: `${i18n.ts.zalip.watchTitle}: Canonical title` }).getAttribute('href')).toBe('/zalip/a%2Fb/watch?provider=alloha');
	});
});
