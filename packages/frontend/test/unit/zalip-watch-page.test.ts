/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import Watch from '@/pages/zalip/watch.vue';

const state = vi.hoisted(() => ({ path: '', mounts: 0, listeners: new Set<(event: { fullPath: string; resolved: { route: { name: string }; props: Map<string, string> } }) => void>() }));
const router = vi.hoisted(() => ({
	current: { route: { name: 'zalipWatch' }, props: new Map([['slug', 'serial']]) },
	getCurrentFullPath: () => state.path,
	useListener: (_: string, listener: Parameters<typeof state.listeners.add>[0]) => { state.listeners.add(listener); },
	replaceByPath: (path: string) => {
		state.path = path;
		for (const listener of state.listeners) listener({ fullPath: path, resolved: router.current });
	},
}));
vi.mock('@/router.js', () => ({ useRouter: () => router }));
vi.mock('@/pages/zalip/work.vue', () => ({ default: defineComponent({
	props: ['slug', 'initialSeason', 'initialEpisode', 'initialProvider', 'initialTranslation', 'watchPage'],
	emits: ['watchSelection'],
	setup: (props, { emit }) => {
		state.mounts++;
		return () => h('div', [
			h('p', { 'data-testid': 'target' }, `${props.slug}:${props.initialSeason}:${props.initialEpisode}:${props.initialProvider}:${props.initialTranslation}`),
			h('input', { 'aria-label': 'Draft comment' }),
			h('button', { onClick: () => emit('watchSelection', { seasonNumber: 2, episodeNumber: 3, provider: 'collaps', translationId: 'voice' }) }, 'Next episode'),
		]);
	},
}) }));

beforeEach(() => {
	state.listeners.clear();
	state.mounts = 0;
	state.path = '/zalip/serial/watch?season=2&episode=1&provider=alloha&translation=first#discussion';
	router.current = { route: { name: 'zalipWatch' }, props: new Map([['slug', 'serial']]) };
});
afterEach(cleanup);

it('updates the canonical watch URL without resetting the player request or comment draft', async () => {
	const view = render(Watch, { props: { slug: 'serial' } });
	await fireEvent.update(view.getByLabelText('Draft comment'), 'Unsent reply');
	await fireEvent.click(view.getByRole('button', { name: 'Next episode' }));
	expect(state.path).toBe('/zalip/serial/watch?season=2&episode=3&provider=collaps&translation=voice#discussion');
	expect(view.getByTestId('target').textContent).toBe('serial:2:1:alloha:first');
	expect((view.getByLabelText('Draft comment') as HTMLInputElement).value).toBe('Unsent reply');
	expect(state.mounts).toBe(1);
});

it('applies an external same-title route change while preserving the mounted page', async () => {
	const view = render(Watch, { props: { slug: 'serial' } });
	router.replaceByPath('/zalip/serial/watch?season=2&episode=3&provider=collaps&translation=voice');
	await view.findByText('serial:2:3:collaps:voice');
	expect(state.mounts).toBe(1);
});

it('ignores late selections from an inactive cached watch page', async () => {
	const view = render(Watch, { props: { slug: 'serial' } });
	router.current = { route: { name: 'zalipWork' }, props: new Map([['slug', 'another-title']]) };
	state.path = '/zalip/another-title';
	await fireEvent.click(view.getByRole('button', { name: 'Next episode' }));
	expect(state.path).toBe('/zalip/another-title');
});
