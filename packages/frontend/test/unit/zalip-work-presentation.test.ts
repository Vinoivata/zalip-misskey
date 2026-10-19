/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import { zalipAgeRatingLabel } from '@/utility/zalip-work-presentation.js';

describe('title metadata presentation', () => {
	it.each([['age0', '0+'], ['age6', '6+'], ['age12', '12+'], ['age16', '16+'], [' AGE18 ', '18+'], ['TV-MA', 'TV-MA'], ['18+', '18+'], ['PG-13', 'PG-13'], ['', null], [null, null], [undefined, null]])('formats %s as %s without replacing other rating systems', (input, expected) => {
		expect(zalipAgeRatingLabel(input)).toBe(expected);
	});
});
