/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import ZalipShareCard from '@/components/ZalipShareCard.vue';
import source from '@/components/ZalipShareCard.vue?raw';

afterEach(cleanup);

const share = {
	slug: 'a-long-shared-title',
	kind: 'movie' as const,
	title: 'Человек-паук: Через вселенные — очень длинное название для узкого ответа',
	description: 'Описание тайтла должно оставаться читаемым под постером, а не превращаться в узкую полосу текста.',
	releaseYear: 2026,
	genres: ['Фантастика', 'Приключения'],
	posterPath: 'https://social.example/files/poster',
};

describe('shared title cards inside nested replies', () => {
	it('keeps its actual title route and content inside a local size container', () => {
		const view = render(ZalipShareCard, { props: { share }, global: { stubs: {
			MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
		} } });
		const link = view.getByRole('link');
		expect(link.getAttribute('href')).toBe('/zalip/a-long-shared-title');
		expect(view.getByText(share.title)).toBeTruthy();
		expect(view.getByText(share.description)).toBeTruthy();
		expect(link.parentElement).toBe(view.container.firstElementChild);
		expect(source).toContain('container: zalip-share-card / inline-size');
	});

	it('switches the whole card to one column based on its own width, not the outer viewport', () => {
		expect(source).toContain('@container zalip-share-card (max-width: 280px)');
		expect(source).toMatch(/@container zalip-share-card \(max-width: 220px\)\s*\{\s*\.card \{ grid-template-columns: minmax\(0, 1fr\); \}/u);
		expect(source).toContain('.poster img { object-fit: contain; }');
		expect(source).toMatch(/\.poster\s*\{[^}]*min-width: 0;[^}]*width: 100%;/u);
		expect(source).toContain('overflow-wrap: anywhere;');
	});
});
