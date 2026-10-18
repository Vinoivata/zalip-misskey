/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../src');
const stylesheet = readFileSync(resolve(sourceDirectory, 'style.scss'), 'utf8');

describe('shared Zalip typography preference', () => {
	it('provides Inter with the existing CJK and emoji fallbacks at document scope', () => {
		expect(stylesheet).toMatch(/:root\s*\{\s*--zalip-font-family:\s*Inter,/);
		const stack = stylesheet.match(/--zalip-font-family:\s*(Inter[^;]+);/)?.[1];
		for (const fallback of ['Hiragino Maru Gothic Pro', 'BIZ UDGothic', 'Roboto', 'HelveticaNeue', 'Arial', 'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji']) expect(stack).toContain(fallback);
	});
	it('applies the document font to teleported sheets and lets the system-font preference override the shared variable', () => {
		const htmlRule = stylesheet.slice(stylesheet.indexOf('\nhtml {'), stylesheet.indexOf('\nhtml._themeChanging_'));
		expect(htmlRule).toContain('font-family: var(--zalip-font-family);');
		expect(htmlRule).toMatch(/&\.useSystemFont\s*\{\s*--zalip-font-family:\s*system-ui;/);
		expect(htmlRule).toContain('font-size: 14px;');
		expect(htmlRule).toContain('line-height: 1.35;');
	});
	it.each(['ui/universal.vue', 'ui/_common_/navbar.vue', 'components/ZalipCommentForm.vue'])('%s follows the same preference rather than forcing its own Inter stack', path => {
		const source = readFileSync(resolve(sourceDirectory, path), 'utf8');
		expect(source).toContain('font-family: var(--zalip-font-family);');
		expect(source).not.toMatch(/font-family:\s*Inter,/);
	});
});
