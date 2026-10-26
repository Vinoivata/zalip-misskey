/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/vue';
import { defineComponent, h, nextTick, reactive } from 'vue';
import Universal from '@/ui/universal.vue';
import { i18n } from '@/i18n.js';

const state = vi.hoisted(() => ({ route: null as { name?: string; path: string } | null, fullPath: '', metadataReceiver: null as ((getter: () => Record<string, unknown>) => void) | null }));
vi.mock('@/router.js', () => ({ mainRouter: { currentRoute: { get value() { return state.route; } }, getCurrentFullPath: () => state.fullPath, on: vi.fn(), push: vi.fn() } }));
vi.mock('@/page.js', () => ({ provideMetadataReceiver: (receiver: typeof state.metadataReceiver) => { state.metadataReceiver = receiver; }, provideReactiveMetadata: vi.fn() }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/theme.js', () => ({ isPreviewMode: false }));
vi.mock('@/os.js', () => ({ contextMenu: vi.fn(), popupMenu: vi.fn() }));
vi.mock('@/store.js', () => ({ store: { s: { darkMode: false }, r: { darkMode: { value: false } } } }));
vi.mock('@/preferences.js', () => ({ prefer: { r: { showTitlebar: { value: false } }, s: { 'experimental.stackingRouterView': false } } }));
vi.mock('@/preferences/utility.js', () => ({ shouldSuggestRestoreBackup: false }));
vi.mock('@/utility/reload-suggest.js', () => ({ shouldSuggestReload: false }));
vi.mock('@/utility/device-kind.js', () => ({ deviceKind: 'desktop' }));
vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItem: () => null } }));
vi.mock('@/utility/zalip-theme.js', () => ({ applyZalipAppearance: vi.fn(), getZalipAccent: () => null, getZalipAppearanceMenu: () => [] }));
vi.mock('@/utility/zalip-search.js', () => ({ openZalipSearch: vi.fn() }));
vi.mock('@/utility/zalip-create.js', () => ({ openZalipCreateMenu: vi.fn() }));
vi.mock('@/ui/_common_/common.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/PreferenceRestore.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/ReloadSuggestion.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/ThemePreviewing.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/titlebar.vue', () => ({ default: { render: () => null } }));
vi.mock('@/ui/_common_/navbar.vue', () => ({ default: { template: '<nav aria-label="Shared navigation"/>' } }));
vi.mock('@/ui/_common_/mobile-footer-menu.vue', () => ({ default: { template: '<nav aria-label="Floating navigation"/>' } }));

function navigate(path: string, name?: string, fullPath = path): void {
	state.fullPath = fullPath;
	Object.assign(state.route!, { path, name });
}
function resize(width: number): void {
	Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
	window.dispatchEvent(new Event('resize'));
}
function setup() {
	return render(Universal, { global: { stubs: {
		RouterView: defineComponent({ setup: () => () => h('main', { 'data-testid': 'native-page' }) }),
		XStatusBars: true,
		MkZalipIcon: true,
		MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	} } });
}

beforeEach(() => {
	state.route = reactive({ name: undefined, path: '/timeline' });
	state.fullPath = '/timeline';
	state.metadataReceiver = null;
	resize(1440);
});
afterEach(cleanup);

describe('shared cinema and social navigation', () => {
	it.each([390, 1024, 1440])('gives only the named watch route a dedicated viewport at %ipx', async width => {
		resize(width);
		navigate('/zalip/:slug/watch', 'zalipWatch', '/zalip/series/watch?season=1&episode=3&provider=kodik');
		const view = setup();
		expect(view.queryByRole('navigation', { name: 'Shared navigation' })).toBeNull();
		expect(view.queryByRole('navigation', { name: 'Floating navigation' })).toBeNull();
		expect(view.container.querySelector('header')).toBeNull();
		expect(view.getByTestId('native-page')).toBeTruthy();
		// Cached page metadata must not restore shared chrome around a watch page.
		state.metadataReceiver?.(() => ({ title: 'Wide watch', needWideArea: true }));
		await nextTick();
		expect(view.container.querySelector('header')).toBeNull();
	});

	it.each([390, 1440])('restores ordinary navigation after leaving watch at %ipx', async width => {
		resize(width);
		navigate('/zalip/:slug/watch', 'zalipWatch', '/zalip/series/watch?episode=3');
		const view = setup();
		navigate('/timeline', undefined, '/timeline?next=/zalip/series/watch');
		await nextTick();
		expect(view.container.querySelector('header')).not.toBeNull();
		expect(view.getByRole('navigation', { name: width < 1100 ? 'Floating navigation' : 'Shared navigation' })).toBeTruthy();
		if (width >= 1100) expect(view.getByRole('search')).toBeTruthy();
	});

	it.each(['/catalog', '/search'])('retains desktop actions without a second search field on %s', path => {
		navigate(path, undefined, `${path}?q=/zalip/fake/watch`);
		const view = setup();
		expect(view.queryByRole('search')).toBeNull();
		expect(view.getByRole('button', { name: i18n.ts.zalip.appearanceTitle })).toBeTruthy();
		expect(view.getByRole('button', { name: i18n.ts.create })).toBeTruthy();
		expect(view.getByRole('navigation', { name: 'Shared navigation' })).toBeTruthy();
	});

	it('keeps title navigation even when the slug or query contains watch', () => {
		navigate('/zalip/:slug', 'zalipWork', '/zalip/watch?next=/zalip/series/watch');
		const view = setup();
		expect(view.getByRole('navigation', { name: 'Shared navigation' })).toBeTruthy();
		expect(view.getByRole('search')).toBeTruthy();
	});

	it('keeps the mobile catalogue header without a second search opener', () => {
		resize(390);
		navigate('/catalog');
		const view = setup();
		expect(view.queryByRole('button', { name: i18n.ts.zalip.search })).toBeNull();
		expect(view.getByRole('button', { name: i18n.ts.zalip.appearanceDark })).toBeTruthy();
		expect(view.getByRole('navigation', { name: 'Floating navigation' })).toBeTruthy();
	});

	it('does not suppress search by a partial route match', () => {
		navigate('/:(*)', undefined, '/search-other');
		expect(setup().getByRole('search')).toBeTruthy();
	});

	it('keeps the existing mobile chat header boundary and floating navigation', () => {
		resize(768);
		navigate('/chat');
		const view = setup();
		expect(view.container.querySelector('header')).toBeNull();
		expect(view.getByRole('navigation', { name: 'Floating navigation' })).toBeTruthy();
	});
});
