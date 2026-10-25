<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<ZalipWork :slug="slug" v-bind="requested" watchPage @watchSelection="selectionChanged"/>
</template>

<script lang="ts" setup>
import { shallowRef } from 'vue';
import type { PlaybackProvider } from '@/utility/zalip-playback.js';
import ZalipWork from '@/pages/zalip/work.vue';
import { useRouter } from '@/router.js';
import { parseZalipWatchQuery, zalipWatchRoute } from '@/utility/zalip-work-route.js';

const props = defineProps<{ slug: string }>();
const router = useRouter();
const requested = shallowRef(parseZalipWatchQuery(router.getCurrentFullPath()));
let writingSelection = false;

// Query fields deliberately are not route props. Updating the selected series
// must preserve the mounted iframe, controller, discussion draft and page scroll.
router.useListener('change', ({ resolved, fullPath }) => {
	if (writingSelection || resolved.route.name !== 'zalipWatch' || resolved.props.get('slug') !== props.slug) return;
	requested.value = parseZalipWatchQuery(fullPath);
});

function selectionChanged(selection: { seasonNumber: number | null; episodeNumber: number | null; provider: PlaybackProvider | null; translationId: string | null }): void {
	if (router.current.route.name !== 'zalipWatch' || router.current.props.get('slug') !== props.slug) return;
	const hash = router.getCurrentFullPath().split('#')[1];
	// Guest pages cannot load private editions. Preserve a sanitized requested
	// edition through login instead of replacing it with an invented default.
	const provider = selection.provider ?? requested.value.initialProvider;
	const translation = selection.provider == null ? requested.value.initialTranslation : selection.translationId;
	const path = zalipWatchRoute(props.slug, selection.seasonNumber, selection.episodeNumber, provider, translation) + (hash ? `#${hash}` : '');
	if (path === router.getCurrentFullPath()) return;
	writingSelection = true;
	try { router.replaceByPath(path); } finally { writingSelection = false; }
}
</script>
