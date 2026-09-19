/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Theme } from '@@/js/theme.js';
import darkAmber from '@@/themes/d-zalip-amber.json5';
import darkEmerald from '@@/themes/d-zalip-emerald.json5';
import darkSapphire from '@@/themes/d-zalip-sapphire.json5';
import darkViolet from '@@/themes/d-zalip-violet.json5';
import lightAmber from '@@/themes/l-zalip-amber.json5';
import lightEmerald from '@@/themes/l-zalip-emerald.json5';
import lightSapphire from '@@/themes/l-zalip-sapphire.json5';
import lightViolet from '@@/themes/l-zalip-violet.json5';
import type { MenuItem } from '@/types/menu.js';
import { i18n } from '@/i18n.js';
import { prefer } from '@/preferences.js';
import { store } from '@/store.js';
import { isDeviceDarkmode } from '@/utility/is-device-darkmode.js';

export type ZalipAppearanceMode = 'system' | 'light' | 'dark';
export type ZalipAccent = 'sapphire' | 'violet' | 'emerald' | 'amber';

const accents: readonly ZalipAccent[] = ['sapphire', 'violet', 'emerald', 'amber'];

const themes: Record<ZalipAccent, { light: Theme; dark: Theme }> = {
	sapphire: { light: lightSapphire, dark: darkSapphire },
	violet: { light: lightViolet, dark: darkViolet },
	emerald: { light: lightEmerald, dark: darkEmerald },
	amber: { light: lightAmber, dark: darkAmber },
};

function isZalipTheme(theme: Theme | null): theme is Theme {
	return theme != null && Object.values(themes).some(pair => pair.light.id === theme.id || pair.dark.id === theme.id);
}

export function getZalipAppearanceMode(): ZalipAppearanceMode {
	if (prefer.s.syncDeviceDarkMode) return 'system';
	return store.s.darkMode ? 'dark' : 'light';
}

export function getZalipAccent(): ZalipAccent | null {
	const selected = store.s.darkMode ? prefer.s.darkTheme : prefer.s.lightTheme;
	if (!isZalipTheme(selected)) return null;
	return accents.find(accent => themes[accent].dark.id === selected.id || themes[accent].light.id === selected.id) ?? null;
}

export function applyZalipAppearance(mode: ZalipAppearanceMode, accent: ZalipAccent): void {
	prefer.commit('lightTheme', themes[accent].light);
	prefer.commit('darkTheme', themes[accent].dark);
	prefer.commit('syncDeviceDarkMode', mode === 'system');

	if (mode === 'system') {
		store.set('darkMode', isDeviceDarkmode());
	} else {
		store.set('darkMode', mode === 'dark');
	}
}

function modeLabel(mode: ZalipAppearanceMode): string {
	return ({
		system: i18n.ts.zalip.appearanceSystem,
		light: i18n.ts.zalip.appearanceLight,
		dark: i18n.ts.zalip.appearanceDark,
	})[mode];
}

function modeIcon(mode: ZalipAppearanceMode): string {
	return ({
		system: 'ti ti-device-desktop',
		light: 'ti ti-sun',
		dark: 'ti ti-moon',
	})[mode];
}

function accentLabel(accent: ZalipAccent): string {
	return ({
		sapphire: i18n.ts.zalip.appearancePaletteSapphire,
		violet: i18n.ts.zalip.appearancePaletteViolet,
		emerald: i18n.ts.zalip.appearancePaletteEmerald,
		amber: i18n.ts.zalip.appearancePaletteAmber,
	})[accent];
}

function accentIcon(accent: ZalipAccent): string {
	return ({
		sapphire: 'ti ti-diamond',
		violet: 'ti ti-flower',
		emerald: 'ti ti-leaf',
		amber: 'ti ti-sun',
	})[accent];
}

export function getZalipAppearanceMenu(): MenuItem[] {
	const currentMode = getZalipAppearanceMode();
	const currentAccent = getZalipAccent();

	return [
		{ type: 'label', text: i18n.ts.zalip.appearanceTitle },
		...(['system', 'light', 'dark'] as const).map(mode => ({
			text: modeLabel(mode),
			icon: modeIcon(mode),
			active: currentMode === mode,
			action: () => applyZalipAppearance(mode, currentAccent ?? 'sapphire'),
		})),
		{ type: 'divider' },
		{ type: 'label', text: i18n.ts.zalip.appearancePalette },
		...accents.map(accent => ({
			text: accentLabel(accent),
			icon: accentIcon(accent),
			active: currentAccent === accent,
			action: () => applyZalipAppearance(currentMode, accent),
		})),
		{ type: 'divider' },
		{ type: 'link', text: i18n.ts.zalip.appearanceSettings, icon: 'ti ti-settings', to: '/settings/theme' },
	];
}
