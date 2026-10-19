/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/** Kinopoisk's machine age keys are presentation aliases, not text for the title page. */
export function zalipAgeRatingLabel(value: string | null | undefined): string | null {
	const label = value?.trim();
	if (!label) return null;
	const age = /^age(0|6|12|16|18)$/iu.exec(label)?.[1];
	return age ? `${age}+` : label;
}
