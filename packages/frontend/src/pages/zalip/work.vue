<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="refreshWork" :class="$style.viewport">
		<div :class="$style.page">
			<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Загружаем тайтл…</div>
			<div v-else-if="work == null" :class="$style.state"><i class="ti ti-movie-off" aria-hidden="true"></i> Тайтл не найден или ещё не опубликован.</div>
			<article v-else :class="$style.work">
				<section :class="[$style.hero, { [$style.hasLogo]: work.logoPath, [$style.hasMobilePoster]: work.posterPath }]">
					<div v-if="work.backdropPath" :class="$style.heroBackground" aria-hidden="true"><img :src="tmdbBackdrop(work.backdropPath)" alt="" decoding="async" width="1280" height="720"></div>
					<div :class="$style.mobileArtwork">
						<div v-if="work.backdropPath || work.posterPath" :class="$style.mobileArtworkBackdrop" aria-hidden="true"><img :src="work.backdropPath ? tmdbBackdrop(work.backdropPath) : tmdbImage(work.posterPath!)" alt="" decoding="async" width="1280" height="720"></div>
						<img v-if="work.posterPath" :class="$style.mobileArtworkPoster" :src="tmdbImage(work.posterPath)" :alt="work.title" width="500" height="750" fetchpriority="high" decoding="async">
						<div v-else-if="!work.backdropPath" :class="$style.missingArtwork"><i class="ti ti-movie" aria-hidden="true"></i><span>{{ work.title }}</span></div>
					</div>
					<div :class="$style.heroInner">
						<nav :class="$style.breadcrumb" :aria-label="i18n.ts.zalip.catalogueHeading"><MkA to="/catalog">{{ i18n.ts.zalip.catalogueHeading }}</MkA><i class="ti ti-chevron-right" aria-hidden="true"></i><span>{{ work.title }}</span></nav>
						<div v-if="work.logoPath" :class="$style.titleLogo"><img :src="tmdbImage(work.logoPath)" :alt="work.title" decoding="async"></div>
						<div :class="$style.heroContent">
							<aside :class="$style.sidebar">
								<div :class="$style.poster"><img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" :alt="work.title" width="500" height="750" decoding="async"><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
								<div :class="$style.sidebarActions">
									<button type="button" class="_button" :class="$style.watchButton" @click="openPlayer"><i class="ti ti-player-play-filled" aria-hidden="true"></i>{{ i18n.ts.zalip.watchTitle }}</button>
									<button type="button" class="_button" :class="$style.sideButton" @click="focusDiscussion">{{ i18n.ts.zalip.discussTitle }}</button>
								</div>
							</aside>
							<div :class="$style.info">
								<p :class="$style.kind">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span></p>
								<h1>{{ work.title }}</h1>
								<div :class="$style.ratings">
									<span v-if="work.communityRating != null" :class="$style.communityRating" :aria-label="i18n.tsx.zalip.communityRating({ rating: work.communityRating.toFixed(1) })"><i class="ti ti-star" aria-hidden="true"></i><strong>{{ work.communityRating.toFixed(1) }}</strong><small>{{ i18n.tsx.zalip.workRatingCount({ count: work.ratingCount }) }}</small></span>
									<span v-else :class="$style.original">{{ i18n.ts.zalip.workNoRating }}</span>
									<span v-for="rating in work.externalRatings ?? []" :key="rating.source" :class="$style.original">{{ rating.source.toUpperCase() }} {{ rating.value.toFixed(1) }}</span>
									<span v-if="work.originalTitle && work.originalTitle !== work.title" :class="$style.original">{{ work.originalTitle }}</span>
								</div>
								<div :class="$style.compactFacts"><p>{{ [work.releaseYear, ...work.genres].filter(Boolean).join(', ') }}</p><p>{{ [kindLabel(work.kind), work.runtimeMinutes ? runtimeLabel(work.runtimeMinutes, work.kind) : null].filter(Boolean).join(' · ') }}</p></div>
								<dl :class="$style.facts">
									<template v-if="work.releaseYear"><dt>{{ i18n.ts.zalip.workYear }}</dt><dd>{{ work.releaseYear }}</dd></template>
									<dt>{{ i18n.ts.zalip.workType }}</dt><dd>{{ kindLabel(work.kind) }}</dd>
									<template v-if="work.countries?.length"><dt>{{ i18n.ts.zalip._importer.workCountries }}</dt><dd>{{ work.countries.join(', ') }}</dd></template>
									<template v-if="work.ageRating"><dt>{{ i18n.ts.zalip._importer.workAgeRating }}</dt><dd>{{ work.ageRating }}</dd></template>
									<template v-if="work.runtimeMinutes"><dt>{{ i18n.ts.zalip.workDuration }}</dt><dd>{{ runtimeLabel(work.runtimeMinutes, work.kind) }}</dd></template>
									<template v-if="work.seasons.length"><dt>{{ i18n.ts.zalip.workSeasons }}</dt><dd>{{ work.seasons.filter(season => season.seasonNumber > 0).length }}</dd></template>
									<template v-if="work.genres.length"><dt>{{ i18n.ts.zalip.catalogueGenres }}</dt><dd :class="$style.genres"><MkA v-for="genre in work.genres" :key="genre" :to="genreLink(genre)">{{ genre }}</MkA></dd></template>
								</dl>
							</div>
						</div>
					</div>
				</section>
				<div v-if="libraryLoadFailed" :class="$style.libraryWarning" role="alert"><span>{{ i18n.ts.zalip.workLibraryLoadFailed }}</span><button type="button" class="_button" :disabled="libraryPending" @click="retryPersonalLibrary">{{ i18n.ts.retry }}</button></div>
				<div :class="$style.actionStrip" role="group" :aria-label="i18n.ts.zalip.workActions">
					<button type="button" class="_button" :disabled="personalActionsDisabled" :aria-label="personalRating == null ? i18n.ts.zalip.workRateAction : `${i18n.ts.zalip.myRating}: ${ratingLabel}`" @click="choosePersonalRating"><span :class="$style.actionSymbol"><span v-if="personalRating != null" :class="$style.ratingBadge"><i class="ti ti-star-filled" aria-hidden="true"></i>{{ personalRating }}</span><i v-else class="ti ti-star" aria-hidden="true"></i></span><span>{{ personalRating == null ? i18n.ts.zalip.workRateAction : i18n.ts.zalip.myRating }}</span></button>
					<button type="button" class="_button" :class="{ [$style.actionActive]: saved || isFavorite }" :disabled="personalActionsDisabled" aria-haspopup="menu" @click="showLibraryMenu"><span :class="$style.actionSymbol"><i :class="saved ? libraryStatusIcon(libraryStatus) : isFavorite ? 'ti ti-bookmark' : 'ti ti-bookmark-plus'" aria-hidden="true"></i></span><span>{{ saved ? libraryStatusText(libraryStatus) : isFavorite ? i18n.ts.zalip.inBookmarks : i18n.ts.zalip.addToList }}</span></button>
					<button type="button" class="_button" @click="shareWork"><span :class="$style.actionSymbol"><i class="ti ti-repeat" aria-hidden="true"></i></span><span>{{ i18n.ts.zalip.workRepost }}</span></button>
					<button ref="moreTrigger" type="button" class="_button" :aria-label="i18n.ts.zalip.more" :disabled="personalActionsDisabled" aria-haspopup="dialog" :aria-expanded="workMenuOpen" @click="showWorkMenu"><span :class="$style.actionSymbol"><i class="ti ti-dots" aria-hidden="true"></i></span><span>{{ i18n.ts.zalip.more }}</span></button>
				</div>
				<p v-if="work.description" :class="$style.description">{{ work.description }}</p>
				<div :class="$style.content">
					<section ref="playerSection" :class="$style.player" :aria-label="i18n.ts.zalip.playerTab">
						<div v-if="$i && savedWatchProgress && !savedWatchProgress.completed" :class="$style.resumeBar">
							<div><strong>{{ i18n.ts.zalip.libraryContinue }}</strong><span v-if="savedWatchProgress.seasonNumber != null && savedWatchProgress.episodeNumber != null">{{ i18n.tsx.zalip.releaseSeason({ number: String(savedWatchProgress.seasonNumber) }) }} · {{ i18n.tsx.zalip.releaseEpisode({ number: String(savedWatchProgress.episodeNumber) }) }}</span></div>
							<button type="button" class="_button" :disabled="resumingWatch" @click="resumeWatch">{{ savedWatchProgress.positionSeconds != null && savedWatchProgress.positionSeconds > 0 ? i18n.tsx.zalip._progress.resumeAt({ time: watchTimeLabel(savedWatchProgress.positionSeconds) }) : i18n.ts.zalip._progress.resume }}</button>
							<button type="button" class="_button" :disabled="resumingWatch" @click="restartWatch">{{ i18n.ts.zalip._progress.startOver }}</button>
						</div>
						<p v-if="watchProgressError" :class="$style.availableNotice" role="status">{{ watchProgressError }}</p>
						<div v-if="availablePlaybackSources.length" :class="$style.playerTabs" role="group" :aria-label="i18n.ts.zalip._importer.workSources"><button v-for="source in availablePlaybackSources" :key="source.source" type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: selectedProvider === source.source }]" :aria-pressed="selectedProvider === source.source" @click="selectProvider(source.source)">{{ source.label }}</button></div>
						<p v-if="activePlayback && !activeTranslations.length" :class="$style.availableNotice">{{ i18n.ts.zalip._importer.nativeVoicesHint }}</p>
						<div :class="$style.playerTabs">
							<button type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'player' }]" :aria-pressed="playerView === 'player'" @click="playerView = 'player'"><i class="ti ti-list" aria-hidden="true"></i><span>{{ work.seasons.length ? i18n.ts.zalip.workEpisodes : i18n.ts.zalip.playerTab }}</span></button>
							<button v-if="work.trailerYoutubeKey" type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: playerView === 'trailer' }]" :aria-pressed="playerView === 'trailer'" @click="openTrailer"><i class="ti ti-player-play" aria-hidden="true"></i><span>{{ i18n.ts.zalip.trailerTab }}</span></button>
							<button type="button" class="_button" :class="$style.playerTab" @click="focusDiscussion"><i class="ti ti-messages" aria-hidden="true"></i><span>{{ i18n.ts.zalip.comments }}</span></button>
						</div>
						<div v-if="showReleaseSubscription" :class="$style.subscriptionBar">
							<button type="button" class="_button" :class="[$style.subscribeButton, { [$style.subscribed]: releaseSubscribed }]" :disabled="personalActionsDisabled" :aria-pressed="releaseSubscribed" @click="toggleReleaseSubscription"><i :class="releaseSubscribed ? 'ti ti-bell-check' : 'ti ti-bell-plus'" aria-hidden="true"></i><span>{{ releaseSubscribed ? i18n.ts.zalip.releaseSubscribed : releaseSubscriptionLabel }}</span></button>
							<small>{{ releaseSubscribed ? i18n.ts.zalip.releaseUnsubscribeHint : i18n.ts.zalip.releaseSubscribeHint }}</small>
						</div>
						<p v-else :class="$style.availableNotice"><i class="ti ti-circle-check" aria-hidden="true"></i>{{ i18n.ts.zalip.movieAlreadyAvailable }}</p>
						<div v-if="work.trailerYoutubeKey && playerView === 'trailer'" :class="$style.playerFrame"><iframe :src="youtubeEmbed(work.trailerYoutubeKey)" :title="i18n.ts.zalip.trailerTab + ': ' + work.title" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
						<template v-if="playerView === 'player'">
							<div ref="watchFrame" :class="$style.watchFrame">
								<div v-if="$i && playerOpen && activePlayerIframe" :class="$style.playerFrame"><iframe :key="`${activePlayerIframeKey}:${resumeFrameRevision}`" ref="playbackIframe" :src="resumeIframeUrl ?? activePlayerIframe" :title="i18n.ts.zalip.playerTab + ': ' + work.title" loading="lazy" referrerpolicy="origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
								<div v-else :class="$style.playerPreview">
									<img v-if="selectedEpisode?.stillPath || work.backdropPath" :src="tmdbBackdrop(selectedEpisode?.stillPath || work.backdropPath!)" alt="" width="1280" height="720" loading="lazy" decoding="async">
									<button v-if="$i && activePlayback && selectedEpisodeAvailable" type="button" class="_button" :class="$style.playOverlay" :aria-label="i18n.ts.zalip.watchTitle" @click="openSelectedPlayer"><i class="ti ti-player-play-filled" aria-hidden="true"></i></button>
									<button v-else-if="!$i" type="button" class="_button" :class="$style.playerState" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i>{{ i18n.ts.zalip.playerSignIn }}</button>
									<p v-else-if="kodikEpisodeContextBlocked && episodesPending" :class="$style.playerState" role="status"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
									<p v-else-if="activePlayback && !selectedEpisodeAvailable" :class="$style.playerState" role="status"><i class="ti ti-info-circle" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodeUnavailable }}</p>
									<p v-else :class="$style.playerState"><i class="ti ti-clock" aria-hidden="true"></i>{{ i18n.ts.zalip.playerUnavailable }}</p>
								</div>
								<div :class="$style.playerToolbar">
									<div v-if="work.seasons.length" :class="$style.episodeControls">
										<button type="button" class="_button" :disabled="previousEpisode == null" :aria-label="i18n.ts.zalip.playerPreviousEpisode" @click="selectRelativeEpisode(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="!episodes.length" aria-haspopup="dialog" :aria-expanded="episodeMenuOpen" @click="openEpisodeMenu">{{ selectedEpisode ? i18n.tsx.zalip.playerEpisodeNumber({ number: selectedEpisode.episodeNumber }) : i18n.ts.zalip.workEpisodes }}<i class="ti ti-chevron-down" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="nextEpisode == null" :aria-label="i18n.ts.zalip.playerNextEpisode" @click="selectRelativeEpisode(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
									</div>
									<button v-if="$i && selectedEpisodeProgress != null" type="button" class="_button" :class="[$style.watched, { [$style.actionActive]: episodeWatched }]" :disabled="personalActionsDisabled || episodeWatched" @click="markEpisodeWatched"><i :class="episodeWatched ? 'ti ti-eye-check' : 'ti ti-eye'" aria-hidden="true"></i>{{ episodeWatched ? i18n.ts.zalip.playerWatched : i18n.ts.zalip.playerMarkWatched }}</button>
									<button v-if="$i && activePlayback && (activeTranslations.length || availablePlaybackSources.length > 1)" type="button" class="_button" :class="$style.voiceButton" :aria-label="`${i18n.ts.zalip.playerVoices}: ${selectedVoiceLabel}`" aria-haspopup="dialog" :aria-expanded="voiceMenuOpen" @click="openVoiceMenu"><span>{{ selectedVoiceLabel }}</span><i class="ti ti-volume" aria-hidden="true"></i></button>
									<span v-else-if="$i && activePlayback" :class="$style.voiceButton">{{ selectedProviderLabel }}</span>
								</div>
							</div>
							<p v-if="$i && playerOpen && (watchTracker.mode.value === 'episode' || !watchPlayerContext)" :class="$style.availableNotice">{{ episodeOnlyProgressHint }}</p>
						<p v-else-if="$i && playerOpen && watchTracker.mode.value === 'time' && selectedProvider === 'collaps'" :class="$style.availableNotice">{{ i18n.ts.zalip._progress.collapsTimingHint }}</p>
							<div v-if="work.seasons.length" :class="$style.playerEpisodes">
								<div v-if="work.seasons.length > 1" :class="$style.seasonPicker"><span>{{ i18n.ts.zalip.workSeason }}</span><div><button v-for="season in work.seasons" :key="season.id" type="button" class="_button" :class="{ [$style.selectedSeasonPill]: selectedSeasonNumber === season.seasonNumber }" :aria-pressed="selectedSeasonNumber === season.seasonNumber" @click="selectSeason(season)">{{ season.seasonNumber === 0 ? i18n.ts.zalip.releaseSpecial : season.seasonNumber }}</button></div></div>
								<p v-if="episodesPending" :class="$style.episodeRailState"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
								<p v-else-if="!episodes.length" :class="$style.episodeRailState">{{ i18n.ts.zalip.playerEpisodesEmpty }}</p>
								<div v-else ref="episodeRail" :class="$style.episodeRail" :aria-label="i18n.ts.zalip.workEpisodes" @pointerdown="episodeDrag.onPointerDown" @pointermove="episodeDrag.onPointerMove" @pointerup="episodeDrag.onPointerUp" @pointercancel="episodeDrag.onPointerCancel" @click.capture="episodeDrag.onClickCapture">
									<button v-for="episode in episodes" :key="episode.id" :data-episode-id="episode.id" type="button" class="_button" :class="[$style.episodeTile, { [$style.selectedEpisodeTile]: selectedEpisode?.id === episode.id }]" :aria-pressed="selectedEpisode?.id === episode.id" @click="selectEpisode(episode)">
										<span :class="$style.episodeThumb"><img v-if="episode.stillPath" :src="tmdbGalleryImage(episode.stillPath)" alt="" width="480" height="270" loading="lazy" decoding="async"><i v-else class="ti ti-device-tv" aria-hidden="true"></i><span v-if="selectedEpisode?.id === episode.id" :class="$style.selectedPlay"><i class="ti ti-player-play-filled" aria-hidden="true"></i></span></span>
										<strong>{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}</strong>
										<small>{{ episode.title }}</small>
									</button>
								</div>
							</div>
						</template>
					</section>
					<section v-if="selectedEpisode" :class="$style.episodeGuide" @touchstart.passive="startEpisodeSwipe" @touchend.passive="finishEpisodeSwipe" @touchcancel="episodeSwipeStart = null">
						<img v-if="selectedEpisode.stillPath" :key="selectedEpisode.id" :class="$style.episodeGuideStill" :src="tmdbGalleryImage(selectedEpisode.stillPath)" alt="" width="480" height="270" loading="lazy" decoding="async">
						<div :class="$style.episodeGuideContent" aria-live="polite">
							<p>{{ i18n.ts.zalip.episodeInformation }}</p>
							<div :class="$style.guideNavigation"><button type="button" class="_button" :disabled="!previousEpisode" :aria-label="i18n.ts.zalip.playerPreviousEpisode" @click="selectRelativeEpisode(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button><span>{{ i18n.ts.zalip.episodeSwipeHint }}</span><button type="button" class="_button" :disabled="!nextEpisode" :aria-label="i18n.ts.zalip.playerNextEpisode" @click="selectRelativeEpisode(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>
							<h2>{{ episodeLabel(selectedEpisode) }}</h2>
							<span v-if="selectedEpisode.runtimeMinutes || selectedEpisode.airDate">{{ episodeMeta(selectedEpisode) }}</span>
							<p v-if="selectedEpisode.description">{{ selectedEpisode.description }}</p>
							<button type="button" class="_button" :class="$style.episodeDiscussButton" @click="selectDiscussionScope('episode')"><i class="ti ti-messages" aria-hidden="true"></i> {{ selectedEpisode.discussionNoteId ? i18n.ts.zalip.episodeComments : i18n.ts.zalip.discussEpisode }}</button>
						</div>
					</section>
					<section v-if="work.galleryPaths.length" :class="$style.gallery">
						<h2><i class="ti ti-photo" aria-hidden="true"></i> {{ i18n.ts.images }}</h2>
						<MkZalipImageGallery :images="work.galleryPaths.map(path => ({ url: importerImageUrl(path, 'original') ?? '', thumbnailUrl: tmdbGalleryImage(path), alt: work!.title }))" :label="work.title"/>
					</section>
					<section v-for="section in catalogueSections" :key="section.id" :class="$style.catalogueSection" :aria-labelledby="`${work.id}-taxonomy-${section.id}`">
						<header :class="$style.catalogueHeading">
							<h2 :id="`${work.id}-taxonomy-${section.id}`">{{ taxonomySectionLabel(section.id) }}</h2>
							<button v-if="section.entries.length > catalogueLimit(section.id)" type="button" class="_button" :class="$style.catalogueExpand" :aria-expanded="expandedCatalogue.includes(section.id)" :aria-controls="`${work.id}-taxonomy-cards-${section.id}`" @click="toggleCatalogueSection(section.id)">{{ expandedCatalogue.includes(section.id) ? i18n.ts.zalip._taxonomy.showLess : i18n.tsx.zalip._taxonomy.showAll({ count: String(section.entries.length) }) }}</button>
						</header>
						<div :id="`${work.id}-taxonomy-cards-${section.id}`" :class="[$style.catalogueRail, { [$style.catalogueExpanded]: expandedCatalogue.includes(section.id), [$style.catalogueLandscapes]: section.id === 'categories' || section.id === 'collections' }]" @pointerdown="catalogueDrag.onPointerDown" @pointermove="catalogueDrag.onPointerMove" @pointerup="catalogueDrag.onPointerUp" @pointercancel="catalogueDrag.onPointerCancel" @click.capture="catalogueDrag.onClickCapture">
							<MkA v-for="card in expandedCatalogue.includes(section.id) ? section.entries : section.entries.slice(0, catalogueLimit(section.id))" :key="card.entry.id" :to="`/zalip/taxonomy/${card.entry.type}/${card.entry.slug}`" :class="[$style.catalogueCard, { [$style.cataloguePerson]: card.entry.type === 'person', [$style.catalogueStudio]: card.entry.type === 'studio' }]">
								<div :class="$style.catalogueArtwork">
									<img v-if="catalogueImage(card.entry.imageUrl)" :src="catalogueImage(card.entry.imageUrl)!" alt="" loading="lazy" decoding="async" draggable="false" :width="card.entry.type === 'person' ? 256 : 480" :height="card.entry.type === 'person' ? 384 : card.entry.type === 'studio' ? 480 : 270" @error="catalogueImageFailed(card.entry.imageUrl)">
									<i v-else :class="taxonomyTypeIcon(card.entry.type)" aria-hidden="true"></i>
								</div>
								<h3>{{ card.entry.name }}</h3>
								<p v-if="card.credits.length" :class="$style.catalogueCaption">{{ taxonomyCreditCaption(card.credits) }}</p>
								<p v-else-if="card.entry.description" :class="$style.catalogueCaption">{{ card.entry.description }}</p>
								<p v-else :class="$style.catalogueCaption">{{ taxonomyProfileLabel(card.entry.type) }}</p>
							</MkA>
						</div>
					</section>
					<section ref="discussionSection" :class="$style.discussionArea">
						<div v-if="work.seasons.length" :class="$style.discussionScope" role="group" :aria-label="i18n.ts.zalip.discussionContext">
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'work' }]" :aria-pressed="discussionScope === 'work'" @click="selectDiscussionScope('work')"><i class="ti ti-movie" aria-hidden="true"></i> {{ i18n.ts.zalip.workDiscussionScope }}</button>
							<button v-if="selectedEpisode" type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionScope === 'episode' }]" :aria-pressed="discussionScope === 'episode'" @click="selectDiscussionScope('episode')"><i class="ti ti-device-tv" aria-hidden="true"></i> {{ episodeLabel(selectedEpisode) }}</button>
						</div>
						<ZalipDiscussionPanel v-if="activeDiscussionNoteId" :noteId="activeDiscussionNoteId" :heading="activeDiscussionHeading"/>
						<section v-else :class="$style.discussionPending">
							<p v-if="!discussionError"><i class="ti ti-messages" aria-hidden="true"></i> {{ activeDiscussionEmptyText }}</p>
							<button v-if="$i" type="button" class="_button" :class="$style.openDiscussion" :disabled="openingDiscussionScope != null" @click="openActiveDiscussion"><i :class="openingDiscussionScope != null ? 'ti ti-loader-2 ti-spin' : 'ti ti-message-plus'" aria-hidden="true"></i> {{ openingDiscussionScope != null ? i18n.ts.zalip.openingDiscussion : i18n.ts.zalip.startDiscussion }}</button>
							<button v-else type="button" class="_button" :class="$style.openDiscussion" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i> {{ i18n.ts.zalip.loginToComment }}</button>
							<p v-if="discussionError" :class="$style.discussionError">{{ discussionError }}</p>
						</section>
					</section>
				</div>
			</article>
		</div>
	</component>

	<Teleport to="body">
		<ZalipRatingDialog v-if="ratingDialogOpen" :initialRating="personalRating ?? 0" :saving="saving" :error="ratingError" :title="work?.title" :subtitle="work?.releaseYear?.toString()" :posterUrl="work?.posterPath ? tmdbImage(work.posterPath) : undefined" :workId="work?.id" :ratedWorks="ratingLibrary" :relatedPending="ratingLibraryPending" :relatedError="ratingLibraryError" @save="savePersonalRating" @retry="loadRatingLibrary" @closed="closeRatingDialog"/>
		<MkModal v-if="workMenuOpen && work" ref="workModal" :preferType="viewportWidth <= 600 ? 'drawer' : 'dialog'" :returnFocusTo="moreTrigger" @click="closeWorkMenu" @esc="closeWorkMenu" @closed="workMenuOpen = false">
			<section :class="$style.workSheet" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.more">
				<div :class="$style.sheetHandle" aria-hidden="true"></div>
				<button type="button" class="_button" :class="$style.sheetClose" :disabled="saving" :aria-label="i18n.ts.close" @click="closeWorkMenu"><i class="ti ti-x" aria-hidden="true"></i></button>
				<header :class="$style.sheetTitle"><div :class="$style.sheetPoster"><img v-if="work.posterPath" :src="tmdbImage(work.posterPath)" alt=""><i v-else class="ti ti-movie" aria-hidden="true"></i><span v-if="work.communityRating != null">{{ work.communityRating.toFixed(1) }}</span></div><div><h2>{{ work.title }}</h2><p>{{ workSubtitle }}</p></div></header>
				<div v-if="workMenuLists" :class="$style.sheetRows">
					<button type="button" class="_button" :class="$style.sheetRow" @click="workMenuLists = false"><i class="ti ti-arrow-left" aria-hidden="true"></i><span>{{ i18n.ts.zalip.more }}</span></button>
					<button v-for="status in libraryStatuses" :key="status" type="button" class="_button" :class="$style.sheetRow" :disabled="saving" :aria-pressed="libraryStatus === status" @click="setLibraryStatus(libraryStatus === status ? null : status)"><i :class="libraryStatusIcon(status)" aria-hidden="true"></i><span>{{ libraryStatusText(status) }}</span><i v-if="libraryStatus === status" class="ti ti-check" aria-hidden="true"></i></button>
				</div>
				<div v-else :class="$style.sheetRows">
					<button type="button" class="_button" :class="$style.sheetRow" @click="workMenuLists = true"><i class="ti ti-folder-plus" aria-hidden="true"></i><span>{{ i18n.ts.zalip.addToList }}<small v-if="saved">{{ libraryStatusText(libraryStatus) }}</small></span><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
					<button type="button" class="_button" :class="$style.sheetRow" :disabled="saving" :aria-pressed="isFavorite" @click="toggleFavorite"><i class="ti ti-bookmark" aria-hidden="true"></i><span>{{ isFavorite ? i18n.ts.zalip.removeContentBookmark : i18n.ts.zalip.addContentBookmark }}</span><i v-if="isFavorite" class="ti ti-check" aria-hidden="true"></i></button>
					<button type="button" class="_button" :class="$style.sheetRow" :disabled="saving" :aria-pressed="libraryStatus === 'dropped'" @click="setLibraryStatus(libraryStatus === 'dropped' ? null : 'dropped')"><i class="ti ti-circle-minus" aria-hidden="true"></i><span>{{ i18n.ts.zalip.workNotInterested }}<small>{{ i18n.ts.zalip.workNotInterestedHint }}</small></span><i v-if="libraryStatus === 'dropped'" class="ti ti-check" aria-hidden="true"></i></button>
					<button type="button" class="_button" :class="$style.sheetRow" :disabled="saving" :aria-pressed="libraryStatus === 'completed'" @click="setLibraryStatus(libraryStatus === 'completed' ? null : 'completed')"><i class="ti ti-eye" aria-hidden="true"></i><span>{{ i18n.ts.zalip.playerWatched }}</span><i v-if="libraryStatus === 'completed'" class="ti ti-check" aria-hidden="true"></i></button>
					<button v-if="showReleaseSubscription" type="button" class="_button" :class="$style.sheetRow" :disabled="saving" :aria-pressed="releaseSubscribed" @click="toggleReleaseSubscription"><i class="ti ti-bell" aria-hidden="true"></i><span>{{ releaseSubscriptionLabel }}</span><i v-if="releaseSubscribed" class="ti ti-check" aria-hidden="true"></i></button>
				</div>
			</section>
		</MkModal>
		<MkModal v-if="episodeMenuOpen" ref="episodeModal" v-slot="{ maxHeight }" :class="$style.voiceOverlay" preferType="popup" :anchorElement="episodeAnchor" @click="episodeModal?.close()" @esc="episodeModal?.close()" @closed="episodeMenuOpen = false">
			<section :class="$style.episodeMenu" :style="maxHeight == null ? undefined : { maxHeight: `min(${maxHeight}px, 55dvh)` }" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.workEpisodes">
				<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="episodeQuery" type="search" :placeholder="i18n.ts.zalip.playerEpisodeSearch" :aria-label="i18n.ts.zalip.playerEpisodeSearch" @keydown.esc.stop.prevent="episodeModal?.close()"></label>
				<div :class="$style.episodeChoices">
					<button v-for="episode in filteredEpisodes" :key="episode.id" type="button" class="_button" :class="{ [$style.menuSelected]: selectedEpisodeId === episode.id }" :aria-pressed="selectedEpisodeId === episode.id" @click="selectEpisode(episode)">{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}<i v-if="selectedEpisodeId === episode.id" class="ti ti-check" aria-hidden="true"></i></button>
					<p v-if="!filteredEpisodes.length">{{ i18n.ts.zalip.searchNoResults }}</p>
				</div>
			</section>
		</MkModal>
		<MkModal v-if="voiceMenuOpen" ref="voiceModal" :class="$style.voiceOverlay" preferType="dialog" :returnFocusTo="voiceAnchor" @click="voiceModal?.close()" @esc="voiceModal?.close()" @closed="voiceMenuOpen = false">
			<section :class="$style.voiceDrawer" :style="viewportWidth <= 600 ? undefined : voicePanelPosition" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.playerVoices">
				<header><h2>{{ i18n.ts.zalip.playerTab }}</h2><button type="button" class="_button" :aria-label="i18n.ts.close" @click="voiceModal?.close()"><i class="ti ti-x" aria-hidden="true"></i></button></header>
				<div :class="$style.providerChoices" role="group" :aria-label="i18n.ts.zalip._importer.workSources"><button v-for="source in availablePlaybackSources" :key="source.source" type="button" class="_button" :class="[$style.playerTab, { [$style.playerTabActive]: selectedProvider === source.source }]" :aria-pressed="selectedProvider === source.source" @click="selectProvider(source.source)">{{ source.label }}</button></div>
				<template v-if="activeTranslations.length">
					<h3>{{ i18n.ts.zalip.playerVoices }}</h3>
					<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="voiceQuery" type="search" :placeholder="i18n.ts.zalip.playerVoiceSearch" :aria-label="i18n.ts.zalip.playerVoiceSearch" @keydown.esc.stop.prevent="voiceModal?.close()"></label>
					<div :class="$style.voiceList">
						<button v-for="translation in filteredTranslations" :key="translation.id" type="button" class="_button" :class="{ [$style.menuSelected]: selectedTranslationId === translation.id }" :aria-pressed="selectedTranslationId === translation.id" @click="selectTranslation(translation.id)"><span>{{ playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles) }}</span><small v-if="translation.quality">{{ translation.quality }}</small><i v-if="selectedTranslationId === translation.id" class="ti ti-check" aria-hidden="true"></i></button>
						<p v-if="!filteredTranslations.length">{{ i18n.ts.zalip.searchNoResults }}</p>
					</div>
				</template>
				<p v-else :class="$style.availableNotice">{{ i18n.ts.zalip._importer.nativeVoicesHint }}</p>
			</section>
		</MkModal>
	</Teleport>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, useTemplateRef, watch } from 'vue';
import type { RatedLibraryEntry } from '@/components/ZalipRatingDialog.vue';
import type { TaxonomyLink as CatalogLink, TaxonomySectionId } from '@/utility/zalip-taxonomy.js';
import type { LegacyAllohaPlayback, PlaybackProvider, PlaybackProviderSetting, PlaybackSource } from '@/utility/zalip-playback.js';
import type { WatchProgress } from '@/utility/zalip-watch-progress.js';
import MkModal from '@/components/MkModal.vue';
import MkZalipImageGallery from '@/components/MkZalipImageGallery.vue';
import MkPullToRefresh from '@/components/MkPullToRefresh.vue';
import { prefer } from '@/preferences.js';
import { getEpisodeProgress } from '@/utility/zalip-episode-progress.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import * as os from '@/os.js';
import { definePage } from '@/page.js';
import ZalipDiscussionPanel from '@/components/ZalipDiscussionPanel.vue';
import ZalipRatingDialog from '@/components/ZalipRatingDialog.vue';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { importerImageUrl } from '@/utility/zalip-importer.js';
import { playbackEpisodeAvailable, playbackTranslationLabel, selectablePlaybackTranslations, workPlaybackIframe, workPlaybackSources } from '@/utility/zalip-playback.js';
import { zalipEpisodeQuery } from '@/utility/zalip-work-route.js';
import { taxonomyCreditCaption, taxonomyLinkSections, taxonomyProfileLabel, taxonomySectionLabel, taxonomyTypeIcon } from '@/utility/zalip-taxonomy.js';
import { sameWatchTarget, watchTimeLabel } from '@/utility/zalip-watch-progress.js';
import { useZalipWatchProgress } from '@/composables/use-zalip-watch-progress.js';

type ZalipWork = {
	id: string;
	slug: string;
	kind: 'movie' | 'series' | 'anime' | 'animation';
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	genres: string[];
	countries?: string[];
	ageRating?: string | null;
	externalRatings?: { source: string; value: number; votes: number | null }[];
	runtimeMinutes: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	logoPath: string | null;
	communityRating: number | null;
	ratingCount: number;
	galleryPaths: string[];
	trailerYoutubeKey: string | null;
	seasons: Array<{
		id: string;
		seasonNumber: number;
		title: string;
		originalTitle: string | null;
		description: string | null;
		posterPath: string | null;
		airDate: string | null;
		episodeCount: number | null;
	}>;
};

type ZalipSeason = ZalipWork['seasons'][number];

type ZalipEpisode = {
	id: string;
	episodeNumber: number;
	title: string;
	originalTitle: string | null;
	description: string | null;
	airDate: string | null;
	stillPath: string | null;
	runtimeMinutes: number | null;
	discussionNoteId: string | null;
};

type LibraryStatus = 'watching' | 'planned' | 'completed' | 'on_hold' | 'dropped';

type LibraryEntry = {
	status: LibraryStatus | null;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	isReleaseSubscribed: boolean;
	work: { id: string };
};

type LibraryUpdate = Pick<LibraryEntry, 'status' | 'episodesWatched' | 'personalRating' | 'isFavorite' | 'isReleaseSubscribed'>;

const playbackSources = ref<PlaybackSource[]>([]);
const playbackProviders = ref<PlaybackProviderSetting[]>();
const selectedProvider = ref<PlaybackProvider>('alloha');
const selectedProviderVoices = ref<Partial<Record<PlaybackProvider, string>>>({});
const catalogueLinks = ref<CatalogLink[]>([]);
const catalogueSections = computed(() => taxonomyLinkSections(catalogueLinks.value));
const expandedCatalogue = ref<TaxonomySectionId[]>([]);
const catalogueBrokenImages = ref(new Set<string>());
const catalogueDrag = useZalipHorizontalDrag();

function catalogueLimit(section: TaxonomySectionId): number { return section === 'cast' || section === 'creators' ? 16 : 12; }

function toggleCatalogueSection(section: TaxonomySectionId): void {
	expandedCatalogue.value = expandedCatalogue.value.includes(section) ? expandedCatalogue.value.filter(value => value !== section) : [...expandedCatalogue.value, section];
}

function catalogueImage(value: string | null): string | null {
	const url = importerImageUrl(value);
	return url && !catalogueBrokenImages.value.has(url) ? url : null;
}

function catalogueImageFailed(value: string | null): void {
	const url = importerImageUrl(value);
	if (url) catalogueBrokenImages.value = new Set([...catalogueBrokenImages.value, url]);
}

watch(catalogueLinks, () => { expandedCatalogue.value = []; catalogueBrokenImages.value = new Set(); });

function selectProvider(source: PlaybackProvider): void {
	if (!availablePlaybackSources.value.some(candidate => candidate.source === source)) return;
	if (selectedProvider.value === source) {
		if (playerView.value === 'trailer') {
			playerView.value = 'player';
			playerOpen.value = true;
		}
		return;
	}
	selectedProvider.value = source;
	const translations = activeTranslations.value;
	selectedTranslationId.value = translations.find(translation => translation.id === selectedProviderVoices.value[source])?.id ?? translations[0]?.id ?? null;
	voiceQuery.value = '';
	if (playerView.value === 'trailer') playerOpen.value = true;
	playerView.value = 'player';
}

const viewportWidth = ref(window.innerWidth);

function updateViewport(): void {
	viewportWidth.value = window.innerWidth;
	if (voiceMenuOpen.value) void nextTick(updateVoicePanelPosition);
}

window.addEventListener('resize', updateViewport, { passive: true });
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));
const voiceMenuOpen = ref(false);
const episodeMenuOpen = ref(false);
const voiceAnchor = ref<HTMLElement | null>(null);
const episodeAnchor = ref<HTMLElement | null>(null);
const voiceModal = useTemplateRef('voiceModal');
const episodeModal = useTemplateRef('episodeModal');
const workModal = useTemplateRef('workModal');
const moreTrigger = useTemplateRef('moreTrigger');
const workMenuOpen = ref(false);
const workMenuLists = ref(false);
const libraryStatuses = ['planned', 'watching', 'on_hold', 'completed', 'dropped'] as const;
const watchFrame = useTemplateRef('watchFrame');
const playbackIframe = useTemplateRef('playbackIframe');
const savedWatchProgress = ref<WatchProgress | null>(null);
const resumeSelection = ref<WatchProgress | null>(null);
const resumingWatch = ref(false);
const watchActionError = ref<string | null>(null);
let watchHistoryGeneration = 0;
const voicePanelPosition = ref<{ top: string; left: string; width: string; height: string }>();
const episodeQuery = ref('');
const props = defineProps<{ slug: string; initialSeason?: string; initialEpisode?: string }>();
const work = ref<ZalipWork | null>(null);
const workSubtitle = computed(() => [work.value?.originalTitle, work.value?.releaseYear].filter(Boolean).join(', '));
const pending = ref(true);
const saving = ref(false);
const libraryReady = ref(!$i);
const libraryPending = ref(false);
const libraryLoadFailed = ref(false);
const personalActionsDisabled = computed(() => saving.value || (!!$i && !libraryReady.value));
let workRequest = 0;
let discussionRequest = 0;
let libraryWriteRequest = 0;
const libraryStatus = ref<LibraryStatus | null>(null);
const saved = computed(() => libraryStatus.value != null);
const episodesWatched = ref(0);
const personalRating = ref<number | null>(null);
const isFavorite = ref(false);
const releaseSubscribed = ref(false);
// Menu switches must remain clickable when selected. `active` menu buttons intentionally do not.
const favoriteSwitch = computed({ get: () => isFavorite.value, set: () => { void toggleFavorite(); } });
const episodic = computed(() => work.value?.kind === 'series' || !!work.value?.seasons.length);
const showReleaseSubscription = computed(() => episodic.value || releaseSubscribed.value || activePlayback.value == null);
const releaseSubscriptionLabel = computed(() => episodic.value ? i18n.ts.zalip.subscribeEpisodes : i18n.ts.zalip.subscribePremiere);
const playerView = ref<'player' | 'trailer'>('player');
const legacyPlayback = ref<LegacyAllohaPlayback | null>(null);
const availablePlaybackSources = computed(() => workPlaybackSources(playbackSources.value, legacyPlayback.value, playbackProviders.value));
const activePlayback = computed(() => availablePlaybackSources.value.find(item => item.source === selectedProvider.value) ?? null);
const selectedProviderLabel = computed(() => activePlayback.value?.label ?? selectedProvider.value.toUpperCase());
const activeTranslations = computed(() => selectablePlaybackTranslations(activePlayback.value));
const playerOpen = ref(false);
const selectedTranslationId = ref<string | null>(null);
const voiceQuery = ref('');
const filteredTranslations = computed(() => activeTranslations.value.filter(translation => playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles).toLocaleLowerCase('ru').includes(voiceQuery.value.trim().toLocaleLowerCase('ru'))));
const selectedVoiceLabel = computed(() => {
	const translation = activeTranslations.value.find(item => item.id === selectedTranslationId.value);
	return translation ? playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles) : selectedProviderLabel.value;
});
const discussionNoteId = ref<string | null>(null);
const discussionError = ref<string | null>(null);
const discussionScope = ref<'work' | 'episode'>('work');
const openingDiscussionScope = ref<'work' | 'episode' | null>(null);
const discussionSection = ref<HTMLElement | null>(null);
const playerSection = ref<HTMLElement | null>(null);
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodeRequestId = ref(0);
const selectedEpisodeId = ref<string | null>(null);
const ratingDialogOpen = ref(false);
const ratingLibrary = ref<RatedLibraryEntry[]>([]);
const ratingLibraryPending = ref(false);
const ratingLibraryError = ref(false);
let ratingLibraryRequest = 0;
const ratingError = ref<string | null>(null);
onDeactivated(() => {
	// Cached pages remain mounted; their body teleports must not trap the next page.
	workMenuOpen.value = false;
	ratingDialogOpen.value = false;
	episodeMenuOpen.value = false;
	voiceMenuOpen.value = false;
	playerOpen.value = false;
});
const episodeDrag = useZalipHorizontalDrag();
const episodeRail = useTemplateRef('episodeRail');
let episodeSwipeStart: { x: number; y: number } | null = null;
const selectedEpisode = computed(() => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null);

const filteredEpisodes = computed(() => episodes.value.filter(episode => `${episode.episodeNumber} ${episode.title}`.toLocaleLowerCase('ru').includes(episodeQuery.value.trim().toLocaleLowerCase('ru'))));
const selectedEpisodeProgress = computed(() => getEpisodeProgress(work.value?.seasons ?? [], selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
const episodeWatched = computed(() => selectedEpisodeProgress.value != null && episodesWatched.value >= selectedEpisodeProgress.value);

const kodikEpisodeContextBlocked = computed(() => activePlayback.value?.source === 'kodik' && (selectedSeasonNumber.value != null || !!work.value?.seasons.length) && (episodesPending.value || selectedEpisode.value == null));
const selectedEpisodeAvailable = computed(() => !kodikEpisodeContextBlocked.value && playbackEpisodeAvailable(activePlayback.value, selectedTranslationId.value, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
// Unknown anime/animation serials may have no cached coverage yet; retain their native selectors.
const fixedPlayerClip = computed(() => selectedEpisode.value != null || (!!work.value && !episodic.value && work.value.kind === 'movie'));
const activePlayerIframe = computed(() => selectedEpisodeAvailable.value ? workPlaybackIframe(activePlayback.value, selectedTranslationId.value, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null, fixedPlayerClip.value) : null);
const resumeIframeUrl = ref<string | null>(null);
const resumeFrameRevision = ref(0);

const activePlayerIframeKey = computed(() => [
	selectedSeasonNumber.value ?? 'movie',
	selectedEpisode.value?.id ?? 'title',
	selectedTranslationId.value ?? 'default',
	selectedProvider.value,
].join(':'));
watch(activePlayerIframeKey, () => { resumeSelection.value = null; resumeIframeUrl.value = null; resumeFrameRevision.value = 0; }, { flush: 'sync' });
watch(playerOpen, () => { resumeIframeUrl.value = null; resumeFrameRevision.value = 0; }, { flush: 'sync' });
const watchPlayerContext = computed(() => {
	if (!playerOpen.value || playerView.value !== 'player' || !activePlayerIframe.value || !work.value) return null;
	// Native-selector serials without canonical episode IDs remain playable, but cannot invent a progress target.
	if (!selectedEpisode.value && (episodic.value || activePlayback.value?.episodes.length || (selectedProvider.value === 'kodik' && new URL(activePlayerIframe.value).pathname.startsWith('/serial/')))) return null;
	const target = { workId: work.value.id, episodeId: selectedEpisode.value?.id ?? null, provider: selectedProvider.value, translationId: selectedTranslationId.value };
	const resume = resumeSelection.value && sameWatchTarget(resumeSelection.value, target) ? resumeSelection.value : null;
	return { ...target, iframeUrl: activePlayerIframe.value, seasonNumber: selectedSeasonNumber.value, episodeNumber: selectedEpisode.value?.episodeNumber ?? null,
										providerTranslationId: activeTranslations.value.find(translation => translation.id === selectedTranslationId.value)?.providerTranslationId ?? null,
										resumeSeconds: resume?.mode === 'time' ? resume.positionSeconds : null };
});
const watchTracker = useZalipWatchProgress(watchPlayerContext, playbackIframe, progress => { if (work.value?.id === progress.workId) { watchHistoryGeneration++; savedWatchProgress.value = progress; } }, async url => { resumeIframeUrl.value = url; resumeFrameRevision.value++; await nextTick(); });
const watchProgressError = computed(() => watchActionError.value ?? ({ failed: i18n.ts.zalip._progress.saveFailed, conflict: i18n.ts.zalip._progress.sessionConflict, unmapped: i18n.ts.zalip._progress.contextUnmapped } as Partial<Record<string, string>>)[watchTracker.state.value] ?? null);
const episodeOnlyProgressHint = computed(() => {
	if (fixedPlayerClip.value && selectedEpisode.value == null) {
		return selectedProvider.value === 'alloha' ? i18n.ts.zalip._progress.allohaMovieHint : i18n.ts.zalip._progress.movieHint;
	}
	return i18n.ts.zalip._progress.episodeHint;
});
const selectedEpisodeIndex = computed(() => selectedEpisode.value == null ? -1 : episodes.value.findIndex(episode => episode.id === selectedEpisode.value?.id));
const previousEpisode = computed(() => selectedEpisodeIndex.value > 0 ? episodes.value[selectedEpisodeIndex.value - 1] ?? null : null);
const nextEpisode = computed(() => selectedEpisodeIndex.value >= 0 ? episodes.value[selectedEpisodeIndex.value + 1] ?? null : null);
const activeDiscussionNoteId = computed(() => discussionScope.value === 'episode' ? selectedEpisode.value?.discussionNoteId ?? null : discussionNoteId.value);
const ratingLabel = computed(() => personalRating.value == null ? i18n.ts.zalip.ratingUnset : i18n.tsx.zalip.ratingValue({ rating: personalRating.value.toString() }));
const activeDiscussionHeading = computed(() => {
	if (discussionScope.value === 'episode' && selectedEpisode.value != null && work.value != null) return i18n.tsx.zalip.episodeDiscussionHeading({ title: work.value.title, episode: episodeLabel(selectedEpisode.value) });
	return work.value == null ? i18n.ts.zalip.comments : i18n.tsx.zalip.workDiscussionHeading({ title: work.value.title });
});
const activeDiscussionEmptyText = computed(() => discussionScope.value === 'episode' && selectedEpisode.value != null
	? i18n.tsx.zalip.emptyEpisodeDiscussion({ episode: episodeLabel(selectedEpisode.value) })
	: i18n.ts.zalip.emptyWorkDiscussion);

function tmdbImage(path: string): string {
	return importerImageUrl(path, 'w500') ?? '';
}

function tmdbBackdrop(path: string): string {
	return importerImageUrl(path, 'w1280') ?? '';
}

function tmdbGalleryImage(path: string): string {
	return importerImageUrl(path, 'w780') ?? '';
}

function youtubeEmbed(key: string): string {
	return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?rel=0&modestbranding=1`;
}

function kindLabel(kind: ZalipWork['kind']): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

function runtimeLabel(runtimeMinutes: number, kind: ZalipWork['kind']): string {
	return kind === 'movie' ? `${runtimeMinutes} мин.` : `~${runtimeMinutes} мин./эп.`;
}

function episodeLabel(episode: ZalipEpisode): string {
	return `Серия ${episode.episodeNumber}: ${episode.title}`;
}

function genreLink(genre: string): string {
	return `/catalog?genres=${encodeURIComponent(genre)}`;
}

function episodeMeta(episode: ZalipEpisode): string {
	return [episode.airDate ? new Date(episode.airDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : null, episode.runtimeMinutes != null ? `${episode.runtimeMinutes} мин.` : null].filter((value): value is string => value != null).join(' · ');
}

function libraryStatusText(status: LibraryStatus | null): string {
	if (status == null) return i18n.ts.zalip.addToList;
	return ({
		planned: i18n.ts.zalip.libraryPlanned,
		watching: i18n.ts.zalip.libraryWatching,
		on_hold: i18n.ts.zalip.libraryOnHold,
		completed: i18n.ts.zalip.libraryCompleted,
		dropped: i18n.ts.zalip.libraryDropped,
	})[status];
}

function libraryStatusCaption(status: LibraryStatus): string {
	return ({
		planned: i18n.ts.zalip.libraryPlannedCaption,
		watching: i18n.ts.zalip.libraryWatchingCaption,
		on_hold: i18n.ts.zalip.libraryOnHoldCaption,
		completed: i18n.ts.zalip.libraryCompletedCaption,
		dropped: i18n.ts.zalip.libraryDroppedCaption,
	})[status];
}

function libraryStatusIcon(status: LibraryStatus | null): string {
	if (status == null) return 'ti ti-bookmark-plus';
	return ({
		planned: 'ti ti-bookmark',
		watching: 'ti ti-eye',
		on_hold: 'ti ti-player-pause',
		completed: 'ti ti-check',
		dropped: 'ti ti-x',
	})[status];
}

async function load(): Promise<void> {
	const request = ++workRequest;
	discussionRequest++;
	libraryWriteRequest++;
	saving.value = false;
	workMenuOpen.value = false;
	ratingDialogOpen.value = false;
	voiceMenuOpen.value = false;
	episodeMenuOpen.value = false;
	pending.value = true;
	work.value = null;
	libraryStatus.value = null;
	episodesWatched.value = 0;
	personalRating.value = null;
	isFavorite.value = false;
	releaseSubscribed.value = false;
	libraryReady.value = !$i;
	libraryPending.value = false;
	libraryLoadFailed.value = false;
	playerView.value = 'player';
	legacyPlayback.value = null;
	playbackSources.value = [];
	playbackProviders.value = undefined;
	catalogueLinks.value = [];
	selectedProvider.value = 'alloha';
	selectedProviderVoices.value = {};
	playerOpen.value = false;
	savedWatchProgress.value = null;
	resumeSelection.value = null;
	resumingWatch.value = false;
	watchActionError.value = null;
	selectedTranslationId.value = null;
	discussionError.value = null;
	discussionScope.value = 'work';
	openingDiscussionScope.value = null;
	selectedSeasonNumber.value = null;
	episodes.value = [];
	selectedEpisodeId.value = null;
	episodeRequestId.value++;
	try {
		const loadedWork = await misskeyApiZalip<ZalipWork>('zalip/works/show', { slug: props.slug });
		if (request !== workRequest) return;
		work.value = loadedWork;
		if ($i) void loadWatchProgress(request, loadedWork.id);
		const [discussion, entries, playback, sources, links] = await Promise.all([
			misskeyApiZalip<{ noteId: string | null }>('zalip/discussions/show', { workId: loadedWork.id }).catch(() => null),
			$i ? misskeyApiZalip<LibraryEntry[]>('zalip/library/list').catch(() => null) : Promise.resolve([]),
			$i ? misskeyApiZalip<LegacyAllohaPlayback>('zalip/playback/alloha/show', { slug: work.value.slug }).catch(() => null) : Promise.resolve(null),
			$i ? misskeyApiZalip<{ sources: PlaybackSource[]; providers?: PlaybackProviderSetting[] }>('zalip/playback/sources', { workId: work.value.id }).catch(() => ({ sources: [], providers: undefined })) : Promise.resolve({ sources: [], providers: undefined }),
			misskeyApiZalip<{ entries: CatalogLink[] }>('zalip/taxonomy/show', { workId: work.value.id }).catch(() => ({ entries: [] })),
		]);
		if (request !== workRequest) return;
		discussionNoteId.value = discussion?.noteId ?? null;
		if (discussion == null) discussionError.value = i18n.ts.zalip.openWorkDiscussionFailed;
		libraryReady.value = entries != null;
		libraryLoadFailed.value = entries == null;
		const entry = entries?.find(candidate => candidate.work?.id === loadedWork.id);
		libraryStatus.value = entry?.status ?? null;
		episodesWatched.value = entry?.episodesWatched ?? 0;
		personalRating.value = entry?.personalRating ?? null;
		isFavorite.value = entry?.isFavorite ?? false;
		releaseSubscribed.value = entry?.isReleaseSubscribed ?? false;
		legacyPlayback.value = playback;
		playbackSources.value = sources.sources;
		playbackProviders.value = sources.providers;
		selectedProvider.value = availablePlaybackSources.value[0]?.source ?? 'alloha';
		catalogueLinks.value = links.entries;
		selectedTranslationId.value = activeTranslations.value[0]?.id ?? null;
		const requestedSeason = zalipEpisodeQuery(props.initialSeason, 0);
		const initialSeason = loadedWork.seasons.find(season => season.seasonNumber === requestedSeason)
			?? loadedWork.seasons.find(season => season.seasonNumber > 0) ?? loadedWork.seasons[0];
		if (initialSeason != null) await loadSeason(initialSeason, initialSeason.seasonNumber === requestedSeason ? zalipEpisodeQuery(props.initialEpisode, 0) : null);
	} catch {
		if (request === workRequest) {
			work.value = null;
			discussionNoteId.value = null;
		}
	} finally {
		if (request === workRequest) pending.value = false;
	}
}

async function loadWatchProgress(request: number, workId: string): Promise<void> {
	const historyGeneration = watchHistoryGeneration;
	const accountId = $i?.id;
	try {
		const result = await misskeyApiZalip<{ progress: WatchProgress | null }>('zalip/progress/show', { workId });
		if (request === workRequest && work.value?.id === workId && historyGeneration === watchHistoryGeneration && $i?.id === accountId) savedWatchProgress.value = result.progress;
	} catch { /* Optional private history must not hide a published title or its player. */ }
}

async function resumeWatch(): Promise<void> {
	const progress = savedWatchProgress.value;
	if (!$i || !work.value || !progress || resumingWatch.value) return;
	const request = workRequest;
	const workId = work.value.id;
	const accountId = $i.id;
	resumingWatch.value = true;
	watchActionError.value = null;
	playerOpen.value = false;
	try {
		const provider = availablePlaybackSources.value.find(source => source.source === progress.provider);
		if (!provider || (progress.translationId != null && !selectablePlaybackTranslations(provider).some(translation => translation.id === progress.translationId))) throw new Error('Unavailable edition');
		if (progress.episodeId != null) {
			const season = work.value.seasons.find(candidate => candidate.seasonNumber === progress.seasonNumber);
			if (!season) throw new Error('Unavailable season');
			await loadSeason(season, progress.episodeNumber);
			if (request !== workRequest || work.value?.id !== workId || $i?.id !== accountId) return;
			if (selectedEpisodeId.value !== progress.episodeId) throw new Error('Unavailable episode');
		} else if (episodic.value) throw new Error('Unknown canonical episode');
		if (!playbackEpisodeAvailable(provider, progress.translationId, progress.seasonNumber, progress.episodeNumber)) throw new Error('Unavailable edition episode');
		selectedProvider.value = progress.provider;
		selectedTranslationId.value = progress.translationId;
		resumeSelection.value = { ...progress };
		playerView.value = 'player';
		playerOpen.value = true;
		focusPlayer();
	} catch { if (request === workRequest) watchActionError.value = i18n.ts.zalip._progress.resumeUnavailable; } finally { if (request === workRequest) resumingWatch.value = false; }
}

async function restartWatch(): Promise<void> {
	if (!$i || !work.value || resumingWatch.value) return;
	const request = workRequest;
	const workId = work.value.id;
	const accountId = $i.id;
	resumingWatch.value = true;
	watchActionError.value = null;
	playerOpen.value = false;
	try {
		await misskeyApiZalip('zalip/progress/reset', { workId });
		if (request !== workRequest || work.value?.id !== workId || $i?.id !== accountId) return;
		watchHistoryGeneration++;
		savedWatchProgress.value = null;
		resumeSelection.value = null;
		openPlayer();
	} catch { if (request === workRequest) watchActionError.value = i18n.ts.zalip._progress.resetFailed; } finally { if (request === workRequest) resumingWatch.value = false; }
}

async function retryPersonalLibrary(): Promise<void> {
	if (!$i || work.value == null || libraryPending.value) return;
	const request = workRequest;
	const workId = work.value.id;
	libraryPending.value = true;
	try {
		const entries = await misskeyApiZalip<LibraryEntry[]>('zalip/library/list');
		if (request !== workRequest) return;
		const entry = entries.find(candidate => candidate.work?.id === workId);
		if (entry) applyLibraryEntry(entry);
		libraryReady.value = true;
		libraryLoadFailed.value = false;
	} catch {
		if (request === workRequest) libraryLoadFailed.value = true;
	} finally {
		if (request === workRequest) libraryPending.value = false;
	}
}

async function refreshWork(): Promise<void> {
	if (saving.value || pending.value || workMenuOpen.value || ratingDialogOpen.value) return;
	await load();
}

function startEpisodeSwipe(event: TouchEvent): void {
	episodeSwipeStart = null;
	if (event.touches.length !== 1 || (event.target instanceof Element && event.target.closest('button, a, input'))) return;
	episodeSwipeStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
}

function finishEpisodeSwipe(event: TouchEvent): void {
	const start = episodeSwipeStart;
	episodeSwipeStart = null;
	if (start == null || event.changedTouches.length !== 1) return;
	const dx = event.changedTouches[0].clientX - start.x;
	const dy = event.changedTouches[0].clientY - start.y;
	if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5) selectRelativeEpisode(dx < 0 ? 1 : -1);
}

watch([selectedEpisodeId, episodesPending, playerView, episodeRail], async () => {
	await nextTick();
	const rail = episodeRail.value;
	const selected = rail?.querySelector<HTMLElement>('[aria-pressed="true"]');
	if (!rail || !selected) return;
	const rect = rail.getBoundingClientRect();
	const tile = selected.getBoundingClientRect();
	// Scroll only the horizontal rail; scrollIntoView would also jump the whole page.
	const left = rail.scrollLeft + tile.left - rect.left - (rect.width - tile.width) / 2;
	rail.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}, { flush: 'post' });

async function loadSeason(season: ZalipSeason, initialEpisodeNumber: number | null = null): Promise<void> {
	if (work.value == null) return;
	const requestId = ++episodeRequestId.value;
	selectedSeasonNumber.value = season.seasonNumber;
	episodes.value = [];
	selectedEpisodeId.value = null;
	if (discussionScope.value === 'episode') discussionScope.value = 'work';
	episodesPending.value = true;
	try {
		const loadedEpisodes = await misskeyApiZalip<ZalipEpisode[]>('zalip/seasons/episodes', {
			slug: work.value.slug,
			seasonNumber: season.seasonNumber,
		});
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = loadedEpisodes;
			selectedEpisodeId.value = loadedEpisodes.find(episode => episode.episodeNumber === initialEpisodeNumber)?.id
				?? loadedEpisodes.find(episode => (getEpisodeProgress(work.value?.seasons ?? [], season.seasonNumber, episode.episodeNumber) ?? 0) > episodesWatched.value)?.id
				?? loadedEpisodes[0]?.id
				?? null;
		}
	} catch {
		if (selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId) {
			episodes.value = [];
		}
	} finally {
		if (episodeRequestId.value === requestId) episodesPending.value = false;
	}
}

async function selectSeason(season: ZalipSeason): Promise<void> {
	if (selectedSeasonNumber.value === season.seasonNumber && (episodes.value.length > 0 || episodesPending.value)) return;
	await loadSeason(season);
}

function selectEpisode(episode: ZalipEpisode): void {
	episodeModal.value?.close();
	selectedEpisodeId.value = episode.id;
	discussionScope.value = 'episode';
}

function selectRelativeEpisode(offset: -1 | 1): void {
	const episode = offset === -1 ? previousEpisode.value : nextEpisode.value;
	if (episode != null) selectEpisode(episode);
}

function openEpisodeMenu(event: MouseEvent): void {
	episodeAnchor.value = event.currentTarget as HTMLElement;
	episodeQuery.value = '';
	episodeMenuOpen.value = true;
}

function openVoiceMenu(event: MouseEvent): void {
	voiceAnchor.value = event.currentTarget as HTMLElement;
	voiceQuery.value = '';
	updateVoicePanelPosition();
	voiceMenuOpen.value = true;
}

function updateVoicePanelPosition(): void {
	const rect = watchFrame.value?.getBoundingClientRect();
	if (!rect) return;
	const width = Math.min(340, Math.max(280, rect.width * 0.42), window.innerWidth - 32);
	const height = Math.min(Math.max(320, rect.height), window.innerHeight - 32);
	voicePanelPosition.value = {
		top: `${Math.max(16, Math.min(rect.top, window.innerHeight - height - 16))}px`,
		left: `${Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16))}px`,
		width: `${width}px`,
		height: `${height}px`,
	};
}

function selectTranslation(id: string): void {
	if (!activeTranslations.value.some(translation => translation.id === id)) return;
	selectedTranslationId.value = id;
	selectedProviderVoices.value[selectedProvider.value] = id;
	playerView.value = 'player';
	voiceModal.value?.close();
}

async function markEpisodeWatched(): Promise<void> {
	if (!$i || personalActionsDisabled.value || selectedEpisodeProgress.value == null || episodeWatched.value) return;
	const context = personalStateContext();
	try {
		await updateLibrary({ episodesWatched: selectedEpisodeProgress.value, status: libraryStatus.value == null || libraryStatus.value === 'planned' ? 'watching' : libraryStatus.value });
	} catch {
		if (isCurrentPersonalState(context)) os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

function showWorkMenu(): void {
	workMenuLists.value = false;
	workMenuOpen.value = true;
}

function closeWorkMenu(): void {
	if (!saving.value) workModal.value?.close();
}

function openSelectedPlayer(): void {
	resumeSelection.value = null;
	if (activePlayback.value && selectedEpisodeAvailable.value) playerOpen.value = true;
}

async function selectDiscussionScope(scope: 'work' | 'episode'): Promise<void> {
	if (scope === 'episode' && selectedEpisode.value == null) return;
	discussionScope.value = scope;
	await nextTick();
	focusDiscussion();
}

function focusDiscussion(): void {
	discussionSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function focusPlayer(): void {
	playerSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openPlayer(): void {
	resumeSelection.value = null;
	playerView.value = 'player';
	focusPlayer();
	if ($i && activePlayback.value) playerOpen.value = true;
}

function openTrailer(): void {
	playerView.value = 'trailer';
	focusPlayer();
}

async function signInForDiscussion(): Promise<void> {
	await pleaseLogin({ path: window.location.pathname + window.location.search });
}

async function openActiveDiscussion(): Promise<void> {
	if (!$i || work.value == null || openingDiscussionScope.value != null) return;
	const scope = discussionScope.value;
	const episode = selectedEpisode.value;
	const workId = work.value.id;
	const workEpoch = workRequest;
	const request = ++discussionRequest;
	const account = $i.id;
	const current = () => request === discussionRequest && workEpoch === workRequest && $i?.id === account && work.value?.id === workId && discussionScope.value === scope && (scope !== 'episode' || selectedEpisode.value?.id === episode?.id);
	if (scope === 'episode' && episode == null) return;
	openingDiscussionScope.value = scope;
	discussionError.value = null;
	try {
		if (scope === 'episode' && episode != null) {
			const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/episodes/discussions/ensure', { episodeId: episode.id });
			if (!current()) return;
			episode.discussionNoteId = discussion.noteId;
		} else {
			const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/discussions/ensure', { workId });
			if (!current()) return;
			discussionNoteId.value = discussion.noteId;
		}
		await nextTick();
		if (current()) focusDiscussion();
	} catch {
		if (current()) discussionError.value = scope === 'episode' ? i18n.ts.zalip.openEpisodeDiscussionFailed : i18n.ts.zalip.openWorkDiscussionFailed;
	} finally {
		if (request === discussionRequest) openingDiscussionScope.value = null;
	}
}

function normalizedEpisodesWatched(): number {
	return Number.isFinite(episodesWatched.value) ? Math.max(0, Math.trunc(episodesWatched.value)) : 0;
}

function applyLibraryEntry(entry: LibraryEntry): void {
	libraryStatus.value = entry.status;
	episodesWatched.value = entry.episodesWatched;
	personalRating.value = entry.personalRating;
	isFavorite.value = entry.isFavorite;
	releaseSubscribed.value = entry.isReleaseSubscribed;
}

function personalStateContext(): { request: number; workId: string | undefined } {
	return { request: workRequest, workId: work.value?.id };
}

function isCurrentPersonalState(context: ReturnType<typeof personalStateContext>): boolean {
	return context.workId != null && context.request === workRequest && context.workId === work.value?.id;
}

async function updateLibrary(patch: Partial<LibraryUpdate> = {}): Promise<void> {
	if (work.value == null || !$i) return;
	if (!libraryReady.value) throw new Error('Personal library has not been loaded');
	const context = personalStateContext();
	const request = ++libraryWriteRequest;
	saving.value = true;
	try {
		const entry = await misskeyApiZalip<LibraryEntry>('zalip/library/update', {
			workId: context.workId,
			status: libraryStatus.value,
			episodesWatched: normalizedEpisodesWatched(),
			personalRating: personalRating.value,
			isFavorite: isFavorite.value,
			isReleaseSubscribed: releaseSubscribed.value,
			...patch,
		});
		if (isCurrentPersonalState(context) && request === libraryWriteRequest) applyLibraryEntry(entry);
	} finally {
		if (isCurrentPersonalState(context) && request === libraryWriteRequest) saving.value = false;
	}
}

async function showLibraryMenu(event: MouseEvent): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (work.value == null || personalActionsDisabled.value) return;
	void os.popupMenu([
		{ type: 'label', text: i18n.ts.zalip.libraryMenuTitle, caption: work.value.title },
		{
			type: 'switch',
			text: i18n.ts.zalip.favoriteTitle,
			caption: i18n.ts.zalip.favoriteCaption,
			icon: 'ti ti-bookmark',
			ref: favoriteSwitch,
			disabled: personalActionsDisabled,
		},
		null,
		{ type: 'label', text: i18n.ts.zalip.libraryStatusHeading },
		...libraryStatuses.map(status => ({
			type: 'switch' as const,
			text: libraryStatusText(status),
			caption: computed(() => libraryStatus.value === status ? i18n.ts.zalip.libraryRemoveStatusHint : libraryStatusCaption(status)),
			icon: libraryStatusIcon(status),
			ref: computed({ get: () => libraryStatus.value === status, set: checked => { void setLibraryStatus(checked ? status : null); } }),
			disabled: personalActionsDisabled,
		})),
	], event.currentTarget, { align: 'left', width: 320 });
}

async function setLibraryStatus(status: LibraryStatus | null): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (personalActionsDisabled.value) return;
	const context = personalStateContext();
	const previousStatus = libraryStatus.value;
	libraryStatus.value = status;
	try {
		await updateLibrary({ status });
	} catch {
		if (!isCurrentPersonalState(context)) return;
		libraryStatus.value = previousStatus;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function toggleFavorite(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (personalActionsDisabled.value) return;
	const context = personalStateContext();
	const previousFavorite = isFavorite.value;
	isFavorite.value = !isFavorite.value;
	try {
		await updateLibrary({ isFavorite: isFavorite.value });
	} catch {
		if (!isCurrentPersonalState(context)) return;
		isFavorite.value = previousFavorite;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function toggleReleaseSubscription(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (personalActionsDisabled.value) return;
	const context = personalStateContext();
	const previousSubscription = releaseSubscribed.value;
	releaseSubscribed.value = !releaseSubscribed.value;
	try {
		await updateLibrary({ isReleaseSubscribed: releaseSubscribed.value });
	} catch {
		if (!isCurrentPersonalState(context)) return;
		releaseSubscribed.value = previousSubscription;
		os.toast(i18n.ts.zalip.libraryUpdateFailed);
	}
}

async function choosePersonalRating(): Promise<void> {
	if (!$i) {
		await pleaseLogin({ path: window.location.pathname + window.location.search });
		return;
	}
	if (personalActionsDisabled.value) return;
	ratingDialogOpen.value = true;
	ratingError.value = null;
	void loadRatingLibrary();
}

async function loadRatingLibrary(): Promise<void> {
	const request = ++ratingLibraryRequest;
	ratingLibraryPending.value = true;
	ratingLibraryError.value = false;
	try {
		const entries = await misskeyApiZalip<RatedLibraryEntry[]>('zalip/library/list');
		if (request === ratingLibraryRequest) ratingLibrary.value = entries;
	} catch {
		if (request === ratingLibraryRequest) ratingLibraryError.value = true;
	} finally {
		if (request === ratingLibraryRequest) ratingLibraryPending.value = false;
	}
}

function closeRatingDialog(): void {
	ratingDialogOpen.value = false;
}

async function savePersonalRating(rating: number): Promise<void> {
	if (personalActionsDisabled.value) return;
	const context = personalStateContext();
	ratingError.value = null;
	try {
		await updateLibrary({ personalRating: rating });
		if (isCurrentPersonalState(context)) closeRatingDialog();
	} catch {
		if (isCurrentPersonalState(context)) ratingError.value = i18n.ts.zalip.libraryUpdateFailed;
	}
}

function shareWork(): void {
	if (work.value == null) return;
	const { id, slug, kind, title, description, releaseYear, genres, posterPath } = work.value;
	void os.post({
		zalipWork: { id, slug, kind, title, description, releaseYear, genres, posterPath },
	});
}

watch(() => [props.slug, props.initialSeason, props.initialEpisode], () => void load(), { immediate: true });

definePage(() => ({
	title: work.value?.title ?? 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.resumeBar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px; margin-bottom: 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-panelHighlight); > div { display: flex; flex: 1 1 180px; flex-direction: column; gap: 4px; span { font-size: .82em; opacity: .7; } } > button { padding: 10px 14px; border-radius: 999px; background: var(--MI_THEME-buttonBg); &:first-of-type { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; } } }
.viewport { container-type: inline-size; }
.page { max-width: 960px; margin: 0 auto; padding-bottom: 48px; min-width: 0; color: var(--zalip-social-fg); background: var(--zalip-social-panel); }
.work, .content { min-width: 0; }
.state { display: grid; place-content: center; gap: 12px; min-height: 300px; text-align: center; color: var(--zalip-social-muted); }
.libraryWarning { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin: 16px 24px 0; padding: 12px 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-infoWarnBg); color: var(--MI_THEME-infoWarnFg); font-size: 13px; }
.libraryWarning button { padding: 8px 12px; border-radius: var(--MI-radius); background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); }
.hero { position: relative; isolation: isolate; overflow: hidden; }
.heroBackground { position: absolute; z-index: -2; inset: 0; }
.heroBackground img { width: 100%; height: 100%; object-fit: cover; object-position: center top; }
.hero::after { content: ''; position: absolute; z-index: -1; inset: 0; background: linear-gradient(0deg, var(--zalip-social-panel) 0%, color-mix(in srgb, var(--zalip-social-panel) 78%, transparent) 35%, color-mix(in srgb, var(--zalip-social-panel) 45%, transparent) 100%); }
.heroInner { padding: 24px 28px 28px; }
.breadcrumb { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 12px; color: var(--zalip-social-muted); }
.breadcrumb span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.titleLogo { display: flex; justify-content: flex-end; align-items: center; height: 100px; margin: 10px 8px 12px; }
.titleLogo img { max-width: 220px; max-height: 80px; object-fit: contain; filter: brightness(0) drop-shadow(0 2px 8px var(--zalip-glass-shadow)); }
:global(html[data-color-scheme=dark]) .titleLogo img { filter: brightness(0) invert(1) drop-shadow(0 2px 8px var(--zalip-glass-shadow)); }
.heroContent { display: grid; grid-template-columns: minmax(160px, 30%) minmax(0, 1fr); gap: 28px; margin-top: 32px; align-items: start; }
.titleLogo + .heroContent { margin-top: 0; }
.sidebar, .info { min-width: 0; }
.poster { display: grid; place-items: center; aspect-ratio: 2 / 3; overflow: hidden; border-radius: 12px; background: var(--zalip-social-raised); box-shadow: 0 10px 35px var(--zalip-glass-shadow); }
.poster img { width: 100%; height: 100%; object-fit: cover; }
.poster > i { font-size: 48px; color: var(--zalip-social-muted); }
.sidebarActions { display: grid; gap: 7px; margin-top: 12px; }
.watchButton, .sideButton { display: flex; justify-content: center; align-items: center; gap: 8px; min-height: 40px; padding: 8px 12px; border-radius: 99px; font-size: 13px; font-weight: 650; }
.watchButton { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.sideButton { border: 1px solid var(--zalip-social-border); background: color-mix(in srgb, var(--zalip-social-panel) 60%, transparent); }
.kind { margin: 2px 0 8px; font-size: 12px; color: var(--zalip-social-muted); }
.info h1 { font-size: clamp(24px, 3.6cqi, 34px); letter-spacing: -.035em; line-height: 1.12; margin: 0; overflow-wrap: anywhere; }
.original { color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; }
.ratings { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin: 20px 0 24px; }
.compactFacts { display: none; }
.mobileArtwork { display: none; }
.missingArtwork { display: grid; place-content: center; justify-items: center; gap: 14px; width: min(220px, 65%); min-height: 240px; box-sizing: border-box; padding: 20px; border-radius: 16px; background: var(--zalip-social-raised); text-align: center; font-weight: 700; }
.missingArtwork i { font-size: 48px; color: var(--MI_THEME-accent); }
.communityRating { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.communityRating > i { color: var(--MI_THEME-accent); font-size: 23px; }
.communityRating strong { font-size: 22px; }
.communityRating small { color: var(--zalip-social-muted); font-size: 12px; }
.facts { display: grid; grid-template-columns: minmax(90px, .8fr) minmax(0, 1.5fr); gap: 12px 14px; margin: 0; font-size: 13px; line-height: 1.5; }
.facts dt { color: var(--zalip-social-muted); }
.facts dd { margin: 0; overflow-wrap: anywhere; }
.genres { display: flex; gap: 6px 10px; flex-wrap: wrap; }
.genres a { border-bottom: 1px solid var(--zalip-social-border); text-decoration: none; }
.actionStrip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; padding: 8px 24px 20px; }
.actionStrip button { display: grid; grid-template-rows: 32px auto; justify-items: center; align-content: start; gap: 8px; min-height: 76px; border-radius: 16px; padding: 14px 6px 8px; color: var(--zalip-social-muted); font-size: 12px; line-height: 1.4; text-align: center; }
.actionSymbol { display: flex; align-items: center; justify-content: center; height: 32px; min-width: 32px; }
.actionSymbol i { display: grid; place-items: center; width: 28px; height: 28px; font-size: 28px; line-height: 1; }
.actionSymbol i::before { font-size: 1em; }
.ratingBadge { display: inline-flex; align-items: center; justify-content: center; gap: 4px; min-width: 44px; height: 28px; box-sizing: border-box; padding: 0 8px; border-radius: 99px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 17px; font-weight: 750; }
.ratingBadge i { width: 17px; height: 17px; font-size: 17px; }
.actionStrip button:hover { background: var(--zalip-accent-wash); }
.actionStrip button:focus-visible, .subscribeButton:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.actionStrip .actionActive, .actionActive { color: var(--MI_THEME-accent); }
.description { margin: 0; padding: 0 28px 30px; line-height: 1.7; font-size: 15px; white-space: pre-line; }
.content { padding: 0 24px; }
.player { scroll-margin-top: 20px; }
.playerTabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-bottom: 18px; padding: 2px; }
.playerTab { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; padding: 10px 12px; border: 1px solid transparent; border-radius: 14px; color: var(--zalip-social-muted); font-weight: 600; font-size: 13px; }
.playerTabActive { color: var(--zalip-social-fg); background: var(--zalip-accent-wash); border-color: var(--zalip-accent-border); }
.subscriptionBar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; margin: 0 0 16px; }
.subscriptionBar small { flex: 1 1 180px; color: var(--zalip-social-muted); font-size: 11px; line-height: 1.5; }
.availableNotice { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-size: 12px; color: var(--zalip-social-muted); }
.availableNotice i { color: var(--MI_THEME-accent); }
.subscribeButton { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 10px 14px; border: 1px solid var(--zalip-social-border); border-radius: 99px; color: var(--zalip-social-fg); font-size: 12px; }
.subscribeButton i { flex-shrink: 0; }
.subscribeButton.subscribed { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); border-color: var(--zalip-accent-border); }
.subscribeButton:disabled { opacity: .6; }
.watchFrame { overflow: hidden; border-radius: 16px; background: var(--zalip-social-raised); }
.playerFrame, .playerPreview { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--zalip-social-bg); }
.playerFrame iframe { display: block; width: 100%; height: 100%; border: 0; }
.playerPreview { display: grid; place-items: center; }
.playerPreview > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.playOverlay { position: relative; display: grid; place-items: center; width: 72px; height: 72px; border: 2px solid var(--MI_THEME-fgOnAccent); border-radius: 8px; color: var(--MI_THEME-fgOnAccent); background: color-mix(in srgb, var(--MI_THEME-accent) 65%, transparent); -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.playOverlay i { font-size: 38px; }
.playerState { position: relative; display: flex; align-items: center; gap: 9px; max-width: 80%; box-sizing: border-box; margin: 0; padding: 16px; border-radius: 16px; background: color-mix(in srgb, var(--zalip-social-panel) 90%, transparent); color: var(--zalip-social-fg); line-height: 1.5; font-size: 13px; }
.playerToolbar { display: flex; align-items: center; gap: 8px; padding: 10px; flex-wrap: wrap; }
.episodeControls { display: flex; align-items: center; gap: 5px; }
.episodeControls button, .voiceButton { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 38px; padding: 9px 11px; border-radius: 12px; background: var(--zalip-social-hover); font-size: 12px; font-weight: 600; }
.episodeControls button:disabled { opacity: .35; }
.voiceButton { margin-left: auto; max-width: 52%; }
.voiceButton span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.voiceButton i { flex-shrink: 0; font-size: 18px; }
.watched { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 6px; font-size: 11px; }
.watched i { font-size: 18px; }
.playerEpisodes { margin-top: 12px; }
.seasonPicker { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 12px; color: var(--zalip-social-muted); }
.seasonPicker > div { display: flex; gap: 6px; overflow-x: auto; }
.seasonPicker button { min-width: 34px; padding: 8px 10px; border-radius: 10px; background: var(--zalip-social-raised); }
.seasonPicker .selectedSeasonPill { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.episodeRail { display: flex; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: thin; padding: 2px 0 12px; touch-action: pan-x pan-y; }
.episodeTile { flex: 0 0 132px; min-width: 0; text-align: left; }
.episodeThumb { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 10; overflow: hidden; border-radius: 12px; background: var(--zalip-social-raised); }
.episodeThumb > img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
.selectedPlay { position: absolute; inset: 0; display: grid; place-items: center; background: color-mix(in srgb, var(--zalip-social-panel) 20%, transparent); color: var(--MI_THEME-accent); font-size: 34px; }
.selectedPlay i { filter: drop-shadow(0 1px 3px var(--zalip-social-panel)); }
.episodeTile strong { display: block; margin-top: 8px; font-size: 13px; }
.episodeTile small { display: block; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--zalip-social-muted); font-size: 11px; }
.selectedEpisodeTile .episodeThumb { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }
.episodeRailState { color: var(--zalip-social-muted); font-size: 13px; }
.episodeGuide { display: flex; align-items: start; gap: 18px; margin: 28px 0; touch-action: pan-y; }
.episodeGuideStill { width: 32%; max-width: 240px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; }
.episodeGuideContent { min-width: 0; flex: 1; }
.guideNavigation { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.guideNavigation span { color: var(--zalip-social-muted); font-size: 11px; }
.guideNavigation button { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 99px; background: var(--zalip-social-raised); }
.guideNavigation button:disabled { opacity: .35; }
.episodeGuideContent > p:first-child { margin: 0 0 12px; font-weight: 700; font-size: 16px; color: var(--zalip-social-fg); }
.episodeGuideContent h2 { font-size: 15px; margin: 0 0 8px; }
.episodeGuideContent > span, .episodeGuideContent > p { font-size: 13px; color: var(--zalip-social-muted); line-height: 1.6; }
.episodeDiscussButton { display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; color: var(--MI_THEME-accent); font-size: 13px; }
.gallery { margin: 32px 0; }
.gallery h2 { font-size: 17px; }
.catalogueSection { min-width: 0; margin: 34px 0; }
.catalogueHeading { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 16px; }
.catalogueHeading h2 { margin: 0; font-size: 18px; }
.catalogueExpand { min-height: 36px; padding: 6px 10px; border-radius: var(--MI-radius); color: var(--MI_THEME-accent); font-size: 12px; font-weight: 600; }
.catalogueRail { display: flex; min-width: 0; gap: 16px; overflow-x: auto; padding: 3px 3px 10px; cursor: grab; scrollbar-width: thin; scrollbar-color: var(--MI_THEME-divider) transparent; }
.catalogueRail[data-dragging='true'] { cursor: grabbing; user-select: none; }
.catalogueCard { display: block; flex: 0 0 144px; min-width: 0; text-decoration: none; color: var(--MI_THEME-fg); }
.catalogueCard h3 { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; margin: 10px 0 5px; font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
.catalogueArtwork { display: grid; place-items: center; aspect-ratio: 16 / 9; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); overflow: clip; background: var(--MI_THEME-panelHighlight); }
.catalogueArtwork img { display: block; width: 100%; height: 100%; object-fit: cover; }
.catalogueArtwork > i { color: var(--MI_THEME-accent); font-size: 34px; }
.cataloguePerson { flex-basis: 128px; }
.cataloguePerson .catalogueArtwork { aspect-ratio: 2 / 3; }
.catalogueStudio .catalogueArtwork { aspect-ratio: 1; }
.catalogueStudio .catalogueArtwork img { box-sizing: border-box; padding: 16px; object-fit: contain; }
.catalogueCaption { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; margin: 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
.catalogueLandscapes .catalogueCard { flex-basis: 260px; }
.catalogueExpanded { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); overflow: visible; cursor: auto; }
.catalogueExpanded.catalogueLandscapes { grid-template-columns: repeat(auto-fill, minmax(min(220px, 100%), 1fr)); }
.catalogueCard:focus-visible, .catalogueExpand:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
@container (max-width: 600px) {
	.catalogueRail { gap: 12px; }
	.catalogueCard { flex-basis: 128px; }
	.cataloguePerson { flex-basis: 104px; }
	.catalogueLandscapes .catalogueCard { flex-basis: 220px; }
	.catalogueCard h3 { font-size: 13px; }
	.catalogueExpanded { grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); }
}
.discussionArea { margin-top: 30px; scroll-margin-top: 20px; }
.discussionScope { display: flex; gap: 8px; overflow-x: auto; margin-bottom: 16px; }
.scopeButton { flex: 0 0 auto; padding: 10px 13px; border-radius: 99px; background: var(--zalip-social-raised); color: var(--zalip-social-muted); font-size: 12px; }
.scopeButtonActive { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.discussionPending { padding: 20px; border: 1px solid var(--zalip-social-border); border-radius: 16px; color: var(--zalip-social-muted); font-size: 14px; }
.openDiscussion { padding: 10px 16px; border-radius: 99px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.discussionError { color: var(--MI_THEME-error); }
.episodeMenu, .voiceDrawer { box-sizing: border-box; background: var(--zalip-social-raised); color: var(--zalip-social-fg); box-shadow: 0 8px 40px var(--zalip-glass-shadow); }
.episodeMenu { width: min(250px, calc(100vw - 32px)); max-height: 55dvh; padding: 8px; border-radius: 16px; display: flex; flex-direction: column; }
.menuSearch { display: flex; flex-shrink: 0; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 12px; padding: 10px; background: var(--zalip-social-hover); color: var(--zalip-social-muted); }
.menuSearch:focus-within { border-color: var(--MI_THEME-accent); }
.menuSearch input { min-width: 0; width: 100%; border: 0; outline: none; padding: 0; color: var(--zalip-social-fg); background: transparent; font: inherit; font-size: 14px; }
.episodeChoices { overflow-y: auto; min-height: 0; padding-top: 6px; }
.episodeChoices button { display: flex; align-items: center; justify-content: space-between; width: 100%; padding: 12px 10px; border-radius: 10px; text-align: left; font-size: 14px; }
.episodeChoices p, .voiceList p { color: var(--zalip-social-muted); font-size: 13px; }
.voiceOverlay :global(._modalBg) { -webkit-backdrop-filter: none; backdrop-filter: none; }
.voiceDrawer { position: fixed; width: min(340px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; padding: 18px; border-radius: 16px; }
.voiceDrawer header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.voiceDrawer h2 { margin: 0; font-size: 18px; }
.voiceDrawer header button { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 12px; background: var(--zalip-social-hover); }
.providerChoices { display: flex; flex-wrap: wrap; gap: 6px; margin: 18px 0; }
.voiceDrawer h3 { margin: 0 0 14px; padding-top: 18px; border-top: 1px solid var(--zalip-social-border); font-size: 16px; }
.voiceList { display: grid; gap: 6px; margin-top: 12px; }
.voiceList button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 42px; padding: 10px 12px; box-sizing: border-box; border-radius: 12px; background: var(--zalip-social-hover); text-align: left; }
.voiceList button span { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; }
.voiceList small { color: var(--zalip-social-muted); font-size: 11px; }
.voiceList .menuSelected, .episodeChoices .menuSelected { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.workSheet { position: relative; box-sizing: border-box; width: min(520px, 100%); max-height: calc(100dvh - 24px); margin: auto; padding: 24px; overflow-y: auto; overscroll-behavior: contain; border-radius: 24px; background: var(--zalip-social-panel); color: var(--zalip-social-fg); box-shadow: 0 12px 50px var(--MI_THEME-shadow); }
.sheetHandle { width: 36px; height: 4px; margin: -12px auto 22px; border-radius: 99px; background: var(--zalip-social-subtle); }
.sheetClose { position: absolute; top: 16px; right: 16px; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: var(--zalip-social-raised); color: var(--zalip-social-muted); }
.sheetTitle { display: grid; grid-template-columns: 72px minmax(0, 1fr); align-items: center; gap: 18px; padding: 16px 24px 24px 0; }
.sheetTitle h2 { margin: 0 0 6px; font-size: 21px; line-height: 1.2; overflow-wrap: anywhere; }
.sheetTitle p { margin: 0; font-size: 13px; color: var(--zalip-social-muted); }
.sheetPoster { position: relative; display: grid; place-items: center; width: 72px; aspect-ratio: 2 / 3; background: var(--zalip-social-raised); }
.sheetPoster img { width: 100%; height: 100%; object-fit: cover; }
.sheetPoster span { position: absolute; top: 5px; left: 4px; padding: 3px 6px; border-radius: 4px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 11px; font-weight: 750; }
.sheetRows { border-top: 1px solid var(--zalip-social-border); }
.sheetRow { display: grid; grid-template-columns: 26px minmax(0, 1fr) 20px; align-items: center; gap: 14px; width: 100%; min-height: 64px; padding: 14px 0; text-align: left; border-bottom: 1px solid var(--zalip-social-border); font-size: 16px; font-weight: 600; }
.sheetRow:last-child { border-bottom: 0; }
.sheetRow > i { display: grid; place-items: center; width: 26px; height: 26px; font-size: 24px; line-height: 1; }
.sheetRow > i::before, .sheetClose i::before { font-size: 1em; line-height: 1; }
.sheetRow > i:last-child:not(:first-child) { width: 20px; height: 20px; font-size: 18px; }
.sheetRow small { display: block; margin-top: 4px; font-size: 11px; font-weight: 400; color: var(--zalip-social-muted); }
.sheetRow[aria-pressed=true] { color: var(--MI_THEME-accent); }
.sheetRow:hover { background: var(--zalip-social-hover); }
.sheetRow:focus-visible, .sheetClose:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
@container (max-width: 600px) {
	.mobileArtwork { position: relative; display: grid; place-items: center; aspect-ratio: 16 / 9; }
	.mobileArtworkBackdrop { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
	.mobileArtworkBackdrop img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
	.mobileArtworkPoster { position: relative; z-index: 2; display: block; width: min(250px, 68%); height: auto; aspect-ratio: 2 / 3; object-fit: cover; border-radius: var(--MI-radius); box-shadow: 0 8px 24px var(--MI_THEME-shadow); }
	.hasMobilePoster .mobileArtwork { aspect-ratio: auto; padding-top: 32px; }
	.hasMobilePoster .mobileArtworkBackdrop { bottom: -28px; }
	.hasMobilePoster .mobileArtworkBackdrop img { filter: blur(8px); transform: scale(1.1); }
	.hasMobilePoster .mobileArtworkPoster { margin-bottom: -28px; }
	.hasMobilePoster .heroInner { position: relative; padding-top: 52px; border-radius: 28px 28px 0 0; background: var(--zalip-social-panel); }
	.episodeGuide { flex-direction: column; gap: 12px; }
	.episodeGuideStill { width: 100%; max-width: none; }
	.heroInner { padding: 18px 18px 12px; }
	.breadcrumb, .sidebar, .kind, .facts { display: none; }
	.titleLogo { justify-content: center; height: auto; min-height: 56px; margin: 0 0 16px; }
	.titleLogo img { width: auto; max-width: 86%; max-height: 100px; }
	.heroContent { display: block; margin-top: 0; }
	.heroBackground { display: none; }
	.hero::after { display: none; }
	.info { width: 100%; text-align: center; }
	.info h1 { font-size: clamp(25px, 7cqi, 36px); line-height: 1.15; margin-bottom: 16px; }
	.hasLogo h1 { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
	.ratings { justify-content: center; gap: 5px 8px; margin: 0 0 5px; }
	.communityRating { gap: 5px; }
	.communityRating > i { display: none; }
	.communityRating strong { font-size: 15px; color: var(--MI_THEME-accent); }
	.communityRating small, .original { font-size: 12px; }
	.compactFacts { display: block; color: var(--zalip-social-muted); font-size: 13px; line-height: 1.5; }
	.compactFacts p { margin: 3px 0; }
	.actionStrip { padding: 0 12px 20px; gap: 2px; }
	.actionStrip button { font-size: 11px; padding-inline: 2px; }
	.subscriptionBar { gap: 6px; }
	.subscriptionBar small { flex-basis: 100%; }
	.description { padding: 0 18px 26px; font-size: 14px; }
	.content { padding: 0 12px; }
	.playerTabs { gap: 3px; }
	.playerTab { padding: 10px; font-size: 12px; }
	.playerToolbar { gap: 7px; padding: 10px; }
	.voiceButton { flex-basis: 100%; max-width: 100%; min-width: 0; }
	.watched { margin-left: auto; max-width: 40%; font-size: 10px; }
	.episodeControls { gap: 4px; }
	.episodeControls button { padding: 8px 9px; font-size: 11px; }
	.episodeTile { flex-basis: 112px; }
	.playOverlay { width: 58px; height: 58px; }
	.playerState { padding: 12px; font-size: 12px; }
}
@media (max-width: 600px) {
	.workSheet { width: 100%; max-height: calc(100dvh - 24px); padding: 24px 20px max(20px, env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; }
	.voiceDrawer { position: fixed; inset: 0 0 0 auto; width: min(360px, 90vw); max-height: none; height: 100dvh; padding: 18px 16px max(24px, env(safe-area-inset-bottom)); border-radius: 0; overscroll-behavior: contain; }
}
</style>
