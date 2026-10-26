/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StoryObj } from '@storybook/vue3';
import MkZalipReleaseNotification from './MkZalipReleaseNotification.vue';

export const Default = {
	render(args) { return { components: { MkZalipReleaseNotification }, setup: () => ({ args }), template: '<div style="container-type: inline-size; max-width: 600px; padding: 16px; background: var(--zalip-social-panel)"><MkZalipReleaseNotification v-bind="args"/></div>' }; },
	args: { notification: { type: 'zalipEpisodeReleased', id: 'release-story', createdAt: '2026-10-26T00:00:00Z', workId: 'story-work', workSlug: 'story-title', workTitle: 'Сериал с длинным названием, которое переносится на узком экране', seasonNumber: 2, episodeNumber: 8, episodeTitle: 'Название новой серии' }, withProgress: false },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkZalipReleaseNotification>;

export const MovieAvailability = { ...Default, args: { ...Default.args, notification: { type: 'zalipAllohaAvailable', id: 'movie-story', createdAt: '2026-10-26T00:00:00Z', workId: 'story-movie', workSlug: 'story-film', workTitle: 'Фильм', seasonNumber: null, episodeNumber: null, translationCount: 2 } } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
export const SeveralEpisodes = {
	...Default,
	args: {
		...Default.args,
		notifications: [Default.args.notification, { ...Default.args.notification, id: 'previous-release', episodeNumber: 7, episodeTitle: 'Другая серия', createdAt: '2026-10-25T23:00:00Z' }],
	},
} satisfies StoryObj<typeof MkZalipReleaseNotification>;
export const WithoutDate = { ...Default, args: { ...Default.args, withTime: false } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
export const Mobile = { ...Default, parameters: { layout: 'padded', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
export const Tablet = { ...Default, parameters: { layout: 'padded', viewport: { defaultViewport: 'tablet' } } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
