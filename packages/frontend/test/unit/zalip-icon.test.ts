/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import MkZalipIcon, { zalipIconNames } from '@/components/MkZalipIcon.vue';

afterEach(cleanup);

describe('shared Zalip outline icons', () => {
	it('shares a bounded, immutable registry with distinct supported names', () => {
		expect(zalipIconNames).toHaveLength(22);
		expect(new Set(zalipIconNames).size).toBe(zalipIconNames.length);
		expect(Object.isFrozen(zalipIconNames)).toBe(true);
	});
	it.each(zalipIconNames)('keeps %s outlined even when a legacy caller requests filled state', async name => {
		const view = render(MkZalipIcon, { props: { name, filled: true } });
		const svg = view.container.querySelector('svg')!;
		expect(svg.getAttribute('fill')).toBe('none');
		expect(svg.getAttribute('stroke')).toBe('currentColor');
		expect(svg.getAttribute('stroke-linecap')).toBe('round');
		expect(svg.getAttribute('stroke-linejoin')).toBe('round');
		expect(svg.getAttribute('viewBox')).toBe(name === 'reply' ? '0 0 18 18' : '0 0 24 24');
		expect(svg.getAttribute('stroke-width')).toBe(name === 'reply' ? '1.25' : '1.7');
		const paths = Array.from(svg.querySelectorAll('path'));
		expect(paths.length).toBeGreaterThan(0);
		expect(paths.every(path => !!path.getAttribute('d') && !path.hasAttribute('fill'))).toBe(true);
		await view.rerender({ name, filled: false });
		expect(svg.getAttribute('fill')).toBe('none');
	});
	it('keeps decorative SVGs outside the accessibility tree and keyboard focus order', () => {
		const view = render({
			components: { MkZalipIcon },
			template: '<button type="button" aria-label="Bookmark" aria-pressed="true"><MkZalipIcon name="bookmark" :filled="true"/></button>',
		});
		expect(view.getByRole('button', { name: 'Bookmark', pressed: true })).toBeTruthy();
		const svg = view.container.querySelector('svg')!;
		expect(svg.getAttribute('aria-hidden')).toBe('true');
		expect(svg.getAttribute('focusable')).toBe('false');
		expect(svg.hasAttribute('tabindex')).toBe(false);
		expect(view.queryByRole('img')).toBeNull();
	});
	it('updates the actual glyph without adding a wrapper or losing caller styling', async () => {
		const view = render(MkZalipIcon, { props: { name: 'heart' }, attrs: { class: 'caller-color' } });
		const svg = view.container.firstElementChild!;
		const heartPath = svg.querySelector('path')?.getAttribute('d');
		expect(svg.tagName.toLowerCase()).toBe('svg');
		expect(svg.classList.contains('caller-color')).toBe(true);
		await view.rerender({ name: 'bookmark', filled: true });
		expect(svg.querySelector('path')?.getAttribute('d')).not.toBe(heartPath);
		expect(svg.getAttribute('fill')).toBe('none');
		expect(svg.classList.contains('caller-color')).toBe(true);
		expect(view.container.childElementCount).toBe(1);
	});
});
