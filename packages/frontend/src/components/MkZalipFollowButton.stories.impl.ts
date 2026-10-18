/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { userDetailed } from '../../.storybook/fakes.js';
import MkZalipFollowButton from './MkZalipFollowButton.vue';
import type { StoryObj } from '@storybook/vue3';

export const Default = {
	render(args) { return { components: { MkZalipFollowButton }, setup: () => ({ args }), template: '<MkZalipFollowButton v-bind="args" />' }; },
	args: { user: { ...userDetailed(), id: 'follow-story-author' }, mock: true },
	parameters: { layout: 'centered' },
} satisfies StoryObj<typeof MkZalipFollowButton>;

export const Mobile = { ...Default, parameters: { layout: 'centered', viewport: { defaultViewport: 'mobile1' } } } satisfies StoryObj<typeof MkZalipFollowButton>;
