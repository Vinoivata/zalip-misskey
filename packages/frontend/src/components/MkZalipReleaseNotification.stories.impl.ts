/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StoryObj } from '@storybook/vue3';
import MkZalipReleaseNotification from './MkZalipReleaseNotification.vue';

export const Default = {
	render(args) { return { components: { MkZalipReleaseNotification }, setup: () => ({ args }), template: '<div style="max-width: 600px"><MkZalipReleaseNotification v-bind="args"/></div>' }; },
	args: { notification: { type: 'zalipEpisodeReleased', id: 'release-story', createdAt: '2026-10-26T00:00:00Z', workId: 'story-work', workSlug: 'story-title', workTitle: 'A new episode has a different target from your saved position', seasonNumber: 2, episodeNumber: 8, episodeTitle: 'New episode' }, withProgress: false },
	parameters: { layout: 'padded' },
} satisfies StoryObj<typeof MkZalipReleaseNotification>;

export const MovieAvailability = { ...Default, args: { ...Default.args, notification: { type: 'zalipAllohaAvailable', id: 'movie-story', createdAt: '2026-10-26T00:00:00Z', workId: 'story-movie', workSlug: 'story-film', workTitle: 'A movie now available in Alloha', seasonNumber: null, episodeNumber: null, translationCount: 2 } } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
export const Mobile = { ...Default, parameters: { layout: 'padded', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipReleaseNotification>;
