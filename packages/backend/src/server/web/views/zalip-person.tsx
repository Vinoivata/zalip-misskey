/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { htmlSafeJsonStringify } from '@/misc/json-stringify-html-safe.js';
import { zalipPersonSeo } from '@/misc/zalip-person-seo.js';
import type { PackedZalipCatalogEntry } from '@/core/ZalipTaxonomyService.js';
import type { CommonProps } from '@/server/web/views/_.js';
import { Layout } from '@/server/web/views/base.js';

export function ZalipPersonPage(props: CommonProps<{
	entry: PackedZalipCatalogEntry;
	works: { slug: string; title: string; releaseYear: number | null }[];
}>) {
	const seo = zalipPersonSeo(props.entry, props.config.url, props.instanceName);
	const safePersonJson = htmlSafeJsonStringify(seo.structuredData);
	return (
		<Layout
			{...props}
			titleSlot={<title safe>{seo.title}</title>}
			desc={seo.description}
			metaSlot={<>
				<link rel="canonical" href={seo.canonical} />
				<script type="application/ld+json">{safePersonJson}</script>
			</>}
			ogSlot={<>
				<meta property="og:type" content="profile" />
				<meta property="og:title" content={props.entry.name} />
				<meta property="og:description" content={seo.description} />
				<meta property="og:url" content={seo.canonical} />
				{seo.image ? <meta property="og:image" content={seo.image} /> : null}
				<meta name="twitter:card" content={seo.image ? 'summary_large_image' : 'summary'} />
			</>}
		>
			<noscript>
				<article>
					<h1 safe>{props.entry.name}</h1>
					<p safe>{seo.description}</p>
					<ul>{props.works.map(work => <li><a safe href={`/zalip/${encodeURIComponent(work.slug)}`}>{work.title}</a>{work.releaseYear ? ` (${work.releaseYear})` : ''}</li>)}</ul>
				</article>
			</noscript>
		</Layout>
	);
}
