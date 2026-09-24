<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div :class="$style.root">
	<button type="button" class="_button" :class="$style.search" @click="openZalipSearch()"><MkZalipIcon name="search"/><span>{{ i18n.ts.zalip.search }}</span></button>
	<section :class="$style.panel">
		<h2>{{ i18n.ts.zalip.mySpace }}</h2>
		<template v-if="$i">
			<MkA :to="`/@${$i.username}`" :class="$style.account"><MkAvatar :user="$i" :class="$style.avatar"/><span><strong>{{ $i.name || $i.username }}</strong><small>@{{ $i.username }}</small></span></MkA>
			<MkA to="/library" :class="$style.link"><i class="ti ti-bookmark"></i>{{ navbarItemDef.library.title }}<i class="ti ti-chevron-right"></i></MkA>
			<MkA to="/updates" :class="$style.link"><i class="ti ti-bell"></i>{{ navbarItemDef.updates.title }}<i class="ti ti-chevron-right"></i></MkA>
			<MkA to="/settings/profile" :class="$style.link"><i class="ti ti-user-edit"></i>{{ i18n.ts.editProfile }}<i class="ti ti-chevron-right"></i></MkA>
		</template>
		<template v-else>
			<p>{{ i18n.ts.zalip.onboardingLibraryTitle }}</p>
			<button type="button" class="_button" :class="$style.join" @click="openZalipSignup">{{ i18n.ts.signup }}</button>
			<button type="button" class="_button" :class="$style.signIn" @click="signIn">{{ i18n.ts.login }}</button>
		</template>
	</section>
	<section v-if="works.length" :class="$style.panel">
		<h2>{{ i18n.ts.zalip.discoverTitles }}</h2>
		<MkA v-for="work in works" :key="work.id" :to="`/zalip/${work.slug}`" :class="$style.work">
			<img v-if="work.posterPath" :src="`https://image.tmdb.org/t/p/w185${work.posterPath}`" alt="" loading="lazy">
			<i v-else class="ti ti-movie" :class="$style.placeholder"></i>
			<span><strong>{{ work.title }}</strong><small>{{ kindLabels[work.kind] }}<template v-if="work.releaseYear"> · {{ work.releaseYear }}</template></small></span>
		</MkA>
		<MkA to="/catalog" :class="$style.link">{{ navbarItemDef.catalogue.title }}<i class="ti ti-chevron-right"></i></MkA>
	</section>
</div>
</template>

<script lang="ts" setup>
import { onMounted, ref } from 'vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { openZalipSearch } from '@/utility/zalip-search.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { navbarItemDef } from '@/navbar.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { openZalipSignup } from '@/utility/zalip-signup.js';

type Work = { id: string; slug: string; title: string; posterPath: string | null; releaseYear: number | null; kind: 'movie' | 'series' | 'anime' | 'animation' };
const works = ref<Work[]>([]);
const kindLabels = { movie: i18n.ts.zalip.searchMovies, series: i18n.ts.zalip.searchSeries, anime: i18n.ts.zalip.searchAnime, animation: i18n.ts.zalip.searchAnimation };

function signIn(): void { void pleaseLogin(); }

onMounted(async () => {
	try {
		works.value = await misskeyApiZalip<Work[]>('zalip/works/list', { limit: 4 });
	} catch {
		// Discovery is optional; the main catalogue has its own retry state.
		works.value = [];
	}
});
</script>

<style lang="scss" module>
.root { display: grid; gap: 16px; margin-bottom: 16px; }
.panel { padding: 24px; border: 1px solid var(--zalip-social-border); border-radius: 20px; background: var(--zalip-social-panel); }
.search { display: flex; align-items: center; gap: 12px; height: 44px; padding: 0 18px; border: 1px solid var(--zalip-social-border); border-radius: 99px; background: var(--zalip-social-panel); color: var(--zalip-social-muted); font-size: 16px; > svg { width: 20px; height: 20px; } }
.panel h2 { margin: 0 0 16px; font-size: 1.2rem; }
.panel p { line-height: 1.6; color: var(--MI_THEME-fgTransparentWeak); }
.account, .work { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; color: var(--MI_THEME-fg); text-decoration: none; }
.account > span, .work > span { display: grid; gap: 4px; min-width: 0; }
.account small, .work small { color: var(--MI_THEME-fgTransparentWeak); }
.avatar { flex: 0 0 44px; height: 44px; }
.work img, .placeholder { flex: 0 0 48px; width: 48px; height: 72px; border-radius: var(--zalip-radius-small); object-fit: cover; }
.work strong { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.4; }
.link { display: flex; align-items: center; gap: 10px; min-height: 44px; color: var(--MI_THEME-fg); text-decoration: none; }
.link i:last-child { margin-left: auto; }
.join, .signIn { display: block; width: 100%; min-height: 44px; border-radius: var(--zalip-radius); font-weight: 700; }
.join { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.signIn { margin-top: 8px; background: var(--MI_THEME-panelHighlight); }
</style>
