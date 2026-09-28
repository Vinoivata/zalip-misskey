/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import MkZalipBookmarkTabs from '@/components/MkZalipBookmarkTabs.vue';
import { i18n } from '@/i18n.js';

afterEach(cleanup);
describe('Shared bookmark navigation', () => {
	it('keeps both destinations and changes only the active state', async () => {
		const view = render(MkZalipBookmarkTabs, { props: { active: 'posts' }, global: { stubs: { MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) } } });
		const posts = view.getByRole('link', { name: i18n.ts.zalip.postBookmarks });
		const content = view.getByRole('link', { name: i18n.ts.zalip.bookmarkContentTab });
		expect(posts.getAttribute('href')).toBe('/my/favorites');
		expect(content.getAttribute('href')).toBe('/library?filter=favorites');
		expect(posts.getAttribute('aria-current')).toBe('page');
		expect(content.hasAttribute('aria-current')).toBe(false);
		await view.rerender({ active: 'content' });
		expect(content.getAttribute('aria-current')).toBe('page');
		expect(posts.hasAttribute('aria-current')).toBe(false);
	});
});
