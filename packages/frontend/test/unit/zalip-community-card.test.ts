/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h } from 'vue';
import type * as Misskey from 'misskey-js';
import { compileString } from 'sass-embedded';
import ChannelPreview from '@/components/MkChannelPreview.vue';
import { i18n } from '@/i18n.js';

vi.mock('@/local-storage.js', () => ({ miLocalStorage: { getItemAsJson: () => null } }));
vi.mock('@/components/MkChannelFollowButton.vue', () => ({ default: { template: '<button type="button">Follow fixture</button>' } }));

const stubs = { MkA: defineComponent({ props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }) };
const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/components/MkChannelPreview.vue'), 'utf8');
const css = compileString(source.match(/<style lang="scss" module>([\s\S]*?)<\/style>/)![1]).css;

function channel(bannerUrl: string | null = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="220" height="600"/>'): Misskey.entities.Channel {
	return { id: 'portrait', name: 'Tall banner community', description: 'Description remains below the cropped image.', bannerUrl, isFollowing: true, isFavorited: false, lastNotedAt: '2026-10-22T00:00:00Z', usersCount: 2, notesCount: 3, isArchived: false, isSensitive: false } as Misskey.entities.Channel;
}

afterEach(cleanup);

describe('community card banner containment', () => {
	it('keeps every source aspect ratio out of intrinsic grid sizing inside a clipped 120px frame', () => {
		const frame = css.match(/\.banner\s*\{([^}]+)\}/)![1];
		const image = css.match(/\.banner > img\s*\{([^}]+)\}/)![1];
		expect(frame).toMatch(/position:\s*relative;/);
		expect(frame).toMatch(/height:\s*120px;/);
		expect(frame).toMatch(/overflow:\s*hidden;/);
		expect(image).toMatch(/position:\s*absolute;/);
		expect(image).toMatch(/inset:\s*0;/);
		expect(image).toMatch(/width:\s*100%;/);
		expect(image).toMatch(/height:\s*100%;/);
		expect(image).toMatch(/object-fit:\s*cover;/);
	});

	it('renders a portrait banner without placing heading, description or follow action in the image frame', () => {
		const view = render(ChannelPreview, { props: { channel: channel() }, global: { stubs } });
		const image = view.container.querySelector('img')!;
		const frame = image.parentElement!;
		expect(image.src).toContain('height="600"');
		expect(image.loading).toBe('lazy');
		expect(image.getAttribute('decoding')).toBe('async');
		expect(frame.contains(view.getByRole('heading', { name: 'Tall banner community' }))).toBe(false);
		expect(frame.contains(view.getByText('Description remains below the cropped image.'))).toBe(false);
		expect(frame.contains(view.getByRole('button', { name: 'Follow fixture' }))).toBe(false);
		expect(view.getByRole('link').getAttribute('href')).toBe('/channels/portrait');
		expect(frame.querySelector(`[aria-label="${i18n.ts.unread}"]`)).not.toBeNull();
	});

	it('preserves the centered fallback icon and unread marker after a banner fails to load', async () => {
		const view = render(ChannelPreview, { props: { channel: channel() }, global: { stubs } });
		await fireEvent.error(view.container.querySelector('img')!);
		expect(view.container.querySelector('img')).toBeNull();
		expect(view.container.querySelector('.ti-users')).not.toBeNull();
		expect(view.container.querySelector(`[aria-label="${i18n.ts.unread}"]`)).not.toBeNull();
		expect(view.getByRole('heading', { name: 'Tall banner community' })).toBeTruthy();
		expect(css.match(/\.banner\s*\{([^}]+)\}/)![1]).toMatch(/place-items:\s*center;/);
		expect(css.match(/\.unread\s*\{([^}]+)\}/)![1]).toMatch(/position:\s*absolute;/);
	});
});
