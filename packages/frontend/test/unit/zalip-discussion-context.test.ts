/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import MkZalipDiscussionCard from '@/components/MkZalipDiscussionCard.vue';
import { zalipDiscussionContext, zalipDiscussionRoute } from '@/utility/zalip-discussion-context.js';
import type { ZalipDiscussionContext } from '@/utility/zalip-discussion-context.js';
import { i18n } from '@/i18n.js';

const context: ZalipDiscussionContext = { workId: 'work', rootNoteId: 'root', slug: 'sample-title', title: 'A canonical cinema title', posterPath: null, isRoot: true, episodeId: null, episodeNumber: null, seasonNumber: null };
afterEach(cleanup);

describe('canonical cinema comment context', () => {
	it('never substitutes a hidden or deleted note with exposed content metadata', () => {
		expect(zalipDiscussionContext({ isHidden: true, zalipDiscussion: context })).toBeNull();
		expect(zalipDiscussionContext({ deletedAt: '2026-10-19T00:00:00Z', zalipDiscussion: context })).toBeNull();
		expect(zalipDiscussionContext({})).toBeNull();
		expect(zalipDiscussionContext({ zalipDiscussion: context })).toEqual(context);
	});
	it('links a title and its exact special episode to their own discussion', () => {
		expect(zalipDiscussionRoute(context)).toBe('/zalip/sample-title#discussion');
		expect(zalipDiscussionRoute({ ...context, episodeId: 'special', seasonNumber: 0, episodeNumber: 2 })).toBe('/zalip/sample-title/watch?season=0&episode=2#discussion');
	});
	it('renders the title identity without technical account names or profile links', () => {
		const view = render(MkZalipDiscussionCard, { props: { context }, global: { stubs: {
			MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		} } });
		expect(view.getByRole('link').getAttribute('href')).toBe('/zalip/sample-title#discussion');
		expect(view.getByText(context.title)).toBeTruthy();
		expect(view.getByText(i18n.ts.zalip.contentDiscussionLabel)).toBeTruthy();
		expect(view.container.querySelector('[href^="/@"]')).toBeNull();
	});
});
