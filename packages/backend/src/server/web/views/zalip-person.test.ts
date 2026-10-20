/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { expect, test } from 'vitest';
import type { Config } from '@/config.js';
import type { CommonData } from './_.js';
import { ZalipPersonPage } from './zalip-person.js';

test('person HTML escapes visible fields and emits parseable HTML-safe JSON-LD with canonical URL', async () => {
	const common: CommonData = {
		version: 'test', config: { url: 'https://social.example' } as Config, langs: ['ru-RU'], instanceName: 'Zalip', instanceUrl: 'https://social.example', icon: null, appleTouchIcon: null, themeColor: null,
		serverErrorImageUrl: '', infoImageUrl: '', notFoundImageUrl: '', now: 0, federationEnabled: false,
		frontendViteFiles: { entryJs: 'test.js', css: [], modulePreloads: [] }, frontendBootloaderJs: null, frontendBootloaderCss: null,
		frontendEmbedViteFiles: null, frontendEmbedBootloaderJs: null, frontendEmbedBootloaderCss: null,
	};
	const name = 'Person </title><script>unsafe()</script>';
	const html = await ZalipPersonPage({
		...common,
		entry: { id: 'person1', type: 'person', slug: 'person-tmdb-63', name, description: 'Biography "quoted" <script>unsafe()</script>', imageUrl: 'https://social.example/files/photo.webp', externalIds: { tmdb: '63' }, data: {}, parentId: null },
		works: [{ slug: 'movie-1', title: 'Movie <script>unsafe()</script>', releaseYear: 2000 }],
	});
	// Attribute values are independently quote-escaped by Kita; text children require its safe flag.
	expect(/<title>([\s\S]*?)<\/title>/u.exec(html)?.[1]).toBe('Person &lt;/title>&lt;script>unsafe()&lt;/script> | Zalip');
	expect(/<h1>([\s\S]*?)<\/h1>/u.exec(html)?.[1]).not.toContain('<script>');
	expect(/<p>(Biography[\s\S]*?)<\/p>/u.exec(html)?.[1]).not.toContain('<script>');
	expect(/href="\/zalip\/movie-1">([\s\S]*?)<\/a>/u.exec(html)?.[1]).not.toContain('<script>');
	expect(html).toContain('rel="canonical" href="https://social.example/zalip/taxonomy/person/person-tmdb-63"');
	const serialized = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/u.exec(html)?.[1];
	expect(serialized).toBeDefined();
	expect(JSON.parse(serialized!)).toMatchObject({ '@type': 'Person', name });
	expect(html).toContain('property="og:type" content="profile"');
	expect(html).toContain('href="/zalip/movie-1"');
});
