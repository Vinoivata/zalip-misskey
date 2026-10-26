<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader hideHeader>
	<component :is="prefer.s.enablePullToRefresh ? MkPullToRefresh : 'div'" :refresher="refreshWork" :class="$style.viewport">
		<div :class="[$style.page, { [$style.watchCanvas]: watchPage }]">
			<div v-if="pending" :class="$style.state"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i> Загружаем тайтл…</div>
			<div v-else-if="work == null" :class="$style.state"><i class="ti ti-movie-off" aria-hidden="true"></i> Тайтл не найден или ещё не опубликован.</div>
			<article v-else :class="[$style.work, { [$style.watchPage]: watchPage }]">
				<header v-if="watchPage" :class="$style.watchHeader">
					<MkA :to="zalipWorkRoute(work.slug)" :class="$style.watchBack" :aria-label="i18n.ts.zalip.aboutTitle"><i class="ti ti-arrow-left" aria-hidden="true"></i></MkA>
					<img v-if="images.poster(work, 'w185')" :class="$style.watchPoster" :src="images.poster(work, 'w185')!" alt="" width="48" height="72" decoding="async" @error="images.failed">
					<div v-else :class="$style.watchPoster" aria-hidden="true"><i class="ti ti-movie"></i></div>
					<div :class="$style.watchHeading"><h1><MkA :to="zalipWorkRoute(work.slug)">{{ work.title }}</MkA></h1><p><span>{{ [kindLabel(work.kind), work.releaseYear].filter(Boolean).join(' · ') }}</span><span v-if="watchRating != null" :class="$style.watchRating"><i class="ti ti-star-filled" aria-hidden="true"></i>{{ watchRating.toFixed(1) }}</span></p></div>
					<div :class="$style.watchActions">
						<button v-if="work.trailerYoutubeKey" type="button" class="_button" :class="$style.watchTrailer" :aria-pressed="playerView === 'trailer'" :aria-label="i18n.ts.zalip.trailerTab" :title="i18n.ts.zalip.trailerTab" @click="playerView === 'trailer' ? playerView = 'player' : openTrailer()"><i class="ti ti-brand-youtube" aria-hidden="true"></i><span>{{ i18n.ts.zalip.trailerTab }}</span></button>
						<button v-if="showReleaseSubscription" type="button" class="_button" :class="[$style.watchNotify, { [$style.subscribed]: releaseSubscribed }]" :disabled="personalActionsDisabled" :aria-label="releaseSubscribed ? i18n.ts.zalip.releaseSubscribed : releaseSubscriptionLabel" :aria-pressed="releaseSubscribed" @click="toggleReleaseSubscription"><i :class="releaseSubscribed ? 'ti ti-bell-check' : 'ti ti-bell'" aria-hidden="true"></i><span>{{ i18n.ts.notifications }}</span></button>
						<button type="button" class="_button" :class="$style.watchLibrary" :disabled="personalActionsDisabled" aria-haspopup="menu" @click="showLibraryMenu"><i :class="saved ? libraryStatusIcon(libraryStatus) : isFavorite ? 'ti ti-bookmark' : 'ti ti-bookmark-plus'" aria-hidden="true"></i><span>{{ saved ? libraryStatusText(libraryStatus) : i18n.ts.zalip.addToList }}</span><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
					</div>
				</header>
				<section v-else :class="[$style.hero, { [$style.hasLogo]: images.ready(work.logoPath), [$style.hasMobilePoster]: images.source(work.posterPath) }]">
					<div v-if="images.source(work.backdropPath, 'w1280')" :class="$style.heroBackground" aria-hidden="true"><img :src="images.source(work.backdropPath, 'w1280')!" alt="" decoding="async" width="1280" height="720" @error="images.failed"></div>
					<div :class="$style.mobileArtwork">
						<div v-if="mobileArtworkSource" :class="$style.mobileArtworkBackdrop" aria-hidden="true"><img :src="mobileArtworkSource" alt="" decoding="async" width="1280" height="720" @error="images.failed"></div>
						<img v-if="images.source(work.posterPath)" :class="$style.mobileArtworkPoster" :src="images.source(work.posterPath)!" :alt="work.title" width="500" height="750" fetchpriority="high" decoding="async" @error="images.failed">
						<div v-else-if="!mobileArtworkSource" :class="$style.missingArtwork"><i class="ti ti-movie" aria-hidden="true"></i><span>{{ work.title }}</span></div>
					</div>
					<div :class="$style.heroInner">
						<nav :class="$style.breadcrumb" :aria-label="i18n.ts.zalip.catalogueHeading"><MkA to="/catalog">{{ i18n.ts.zalip.catalogueHeading }}</MkA><i class="ti ti-chevron-right" aria-hidden="true"></i><span>{{ work.title }}</span></nav>
						<div v-if="images.source(work.logoPath)" :class="$style.titleLogo"><img :key="work.logoPath!" :src="images.source(work.logoPath)!" :alt="work.title" decoding="async" @load="images.loaded" @error="images.failed"></div>
						<div :class="$style.heroContent">
							<aside :class="$style.sidebar">
								<div :class="$style.poster"><img v-if="images.source(work.posterPath)" :src="images.source(work.posterPath)!" :alt="work.title" width="500" height="750" decoding="async" @error="images.failed"><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
								<div :class="$style.sidebarActions">
									<MkA :to="watchEntryRoute" class="_button" :class="$style.watchButton"><i class="ti ti-player-play-filled" aria-hidden="true"></i>{{ i18n.ts.zalip.watchTitle }}</MkA>
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
								<div :class="$style.compactFacts"><p>{{ [work.releaseYear, ...work.genres].filter(Boolean).join(', ') }}</p><p>{{ [work.countries?.join(', '), work.runtimeMinutes ? runtimeLabel(work.runtimeMinutes, work.kind) : kindLabel(work.kind), zalipAgeRatingLabel(work.ageRating)].filter(Boolean).join(' · ') }}</p></div>
								<dl :class="$style.facts">
									<template v-if="work.releaseYear"><dt>{{ i18n.ts.zalip.workYear }}</dt><dd>{{ work.releaseYear }}</dd></template>
									<dt>{{ i18n.ts.zalip.workType }}</dt><dd>{{ kindLabel(work.kind) }}</dd>
									<template v-if="work.countries?.length"><dt>{{ i18n.ts.zalip._importer.workCountries }}</dt><dd>{{ work.countries.join(', ') }}</dd></template>
									<template v-if="work.ageRating"><dt>{{ i18n.ts.zalip._importer.workAgeRating }}</dt><dd>{{ zalipAgeRatingLabel(work.ageRating) }}</dd></template>
									<template v-if="work.runtimeMinutes"><dt>{{ i18n.ts.zalip.workDuration }}</dt><dd>{{ runtimeLabel(work.runtimeMinutes, work.kind) }}</dd></template>
									<template v-if="work.seasons.length"><dt>{{ i18n.ts.zalip.workSeasons }}</dt><dd>{{ work.seasons.filter(season => season.seasonNumber > 0).length }}</dd></template>
									<template v-if="work.genres.length"><dt>{{ i18n.ts.zalip.catalogueGenres }}</dt><dd :class="$style.genres"><MkA v-for="genre in work.genres" :key="genre" :to="genreLink(genre)">{{ genre }}</MkA></dd></template>
								</dl>
							</div>
						</div>
						<div :class="$style.mobilePrimaryActions" role="group" :aria-label="i18n.ts.zalip.watchTitle">
							<MkA :to="watchEntryRoute" class="_button" :class="$style.watchButton"><i class="ti ti-player-play-filled" aria-hidden="true"></i>{{ i18n.ts.zalip.watchTitle }}</MkA>
							<button type="button" class="_button" :class="$style.sideButton" @click="focusDiscussion"><i class="ti ti-message-circle" aria-hidden="true"></i>{{ i18n.ts.zalip.discussTitle }}</button>
						</div>
					</div>
				</section>
				<div v-if="libraryLoadFailed" :class="$style.libraryWarning" role="alert"><span>{{ i18n.ts.zalip.workLibraryLoadFailed }}</span><button type="button" class="_button" :disabled="libraryPending" @click="retryPersonalLibrary">{{ i18n.ts.retry }}</button></div>
				<div v-if="!watchPage" :class="$style.actionStrip" role="group" :aria-label="i18n.ts.zalip.workActions">
					<button type="button" class="_button" :disabled="personalActionsDisabled" :aria-label="personalRating == null ? i18n.ts.zalip.workRateAction : `${i18n.ts.zalip.myRating}: ${ratingLabel}`" @click="choosePersonalRating"><span :class="$style.actionSymbol"><span v-if="personalRating != null" :class="$style.ratingBadge"><i class="ti ti-star-filled" aria-hidden="true"></i>{{ personalRating }}</span><i v-else class="ti ti-star" aria-hidden="true"></i></span><span>{{ personalRating == null ? i18n.ts.zalip.workRateAction : i18n.ts.zalip.myRating }}</span></button>
					<button type="button" class="_button" :class="{ [$style.actionActive]: saved || isFavorite }" :disabled="personalActionsDisabled" aria-haspopup="menu" @click="showLibraryMenu"><span :class="$style.actionSymbol"><i :class="saved ? libraryStatusIcon(libraryStatus) : isFavorite ? 'ti ti-bookmark' : 'ti ti-bookmark-plus'" aria-hidden="true"></i></span><span>{{ saved ? libraryStatusText(libraryStatus) : isFavorite ? i18n.ts.zalip.inBookmarks : i18n.ts.zalip.addToList }}</span></button>
					<button type="button" class="_button" @click="shareWork"><span :class="$style.actionSymbol"><i class="ti ti-repeat" aria-hidden="true"></i></span><span>{{ i18n.ts.zalip.workRepost }}</span></button>
					<button ref="moreTrigger" type="button" class="_button" :aria-label="i18n.ts.zalip.more" :disabled="personalActionsDisabled" aria-haspopup="dialog" :aria-expanded="workMenuOpen" @click="showWorkMenu"><span :class="$style.actionSymbol"><i class="ti ti-dots" aria-hidden="true"></i></span><span>{{ i18n.ts.zalip.more }}</span></button>
				</div>
				<p v-if="!watchPage && work.description" :class="$style.description">{{ work.description }}</p>
				<div :class="$style.content">
					<div v-if="!watchPage && savedWatchProgress && !savedWatchProgress.completed" :class="$style.resumeBar"><div><strong>{{ i18n.ts.zalip.libraryContinue }}</strong><span v-if="savedWatchProgress.seasonNumber != null && savedWatchProgress.episodeNumber != null">{{ i18n.tsx.zalip.releaseSeason({ number: String(savedWatchProgress.seasonNumber) }) }} · {{ i18n.tsx.zalip.releaseEpisode({ number: String(savedWatchProgress.episodeNumber) }) }}</span></div><MkA :to="savedWatchRoute" :class="$style.watchButton">{{ i18n.ts.zalip.libraryContinue }}</MkA></div>
					<div v-if="!watchPage && showReleaseSubscription" :class="$style.subscriptionBar"><button type="button" class="_button" :class="[$style.subscribeButton, { [$style.subscribed]: releaseSubscribed }]" :disabled="personalActionsDisabled" :aria-pressed="releaseSubscribed" @click="toggleReleaseSubscription"><i :class="releaseSubscribed ? 'ti ti-bell-check' : 'ti ti-bell-plus'" aria-hidden="true"></i><span>{{ releaseSubscribed ? i18n.ts.zalip.releaseSubscribed : releaseSubscriptionLabel }}</span></button></div>
					<section v-if="watchPage" ref="playerSection" :class="$style.player" :aria-label="i18n.ts.zalip.playerTab">
						<p v-if="watchProgressError" :class="$style.availableNotice" role="status">{{ watchProgressError }}</p>
						<div :class="[$style.watchLayout, { [$style.watchLayoutWithEditions]: availablePlaybackSources.length }]">
								<div :class="$style.watchFrame">
								<div v-if="activePage && work.trailerYoutubeKey && playerView === 'trailer'" :class="$style.playerFrame"><iframe :src="youtubeEmbed(work.trailerYoutubeKey)" :title="i18n.ts.zalip.trailerTab + ': ' + work.title" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>
								<div v-else-if="activePage && $i && playerOpen && activePlayerIframe" :class="$style.playerFrame"><iframe :key="`${activePlayerIframeKey}:${resumeFrameRevision}`" ref="playbackIframe" :src="selectedProvider === 'vibix' ? undefined : resumeIframeUrl ?? activePlayerIframe" :srcdoc="activeVibixDocument ?? undefined" :sandbox="selectedProvider === 'vibix' ? vibixPlayerSandbox : undefined" :title="i18n.ts.zalip.playerTab + ': ' + work.title" loading="lazy" referrerpolicy="origin" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>
									<div v-else :class="$style.playerPreview">
										<p v-if="watchLinkUnavailable" :class="$style.playerState" role="alert"><i class="ti ti-alert-circle" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodeUnavailable }}</p>
										<button v-else-if="$i && activePlayback && selectedEpisodeAvailable" type="button" class="_button" :class="$style.playOverlay" :aria-label="i18n.ts.zalip.watchTitle" @click="openSelectedPlayer"><i class="ti ti-player-play-filled" aria-hidden="true"></i></button>
										<button v-else-if="!$i" type="button" class="_button" :class="$style.playerState" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i>{{ i18n.ts.zalip.playerSignIn }}</button>
										<p v-else-if="playerEpisodeContextBlocked && episodesPending" :class="$style.playerState" role="status"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
										<p v-else-if="playerEpisodeContextBlocked && episodesLoadFailed" :class="$style.playerState" role="status"><i class="ti ti-alert-circle" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoadFailed }}</p>
										<p v-else-if="activePlayback && !selectedEpisodeAvailable" :class="$style.playerState" role="status"><i class="ti ti-info-circle" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodeUnavailable }}</p>
										<p v-else :class="$style.playerState"><i class="ti ti-clock" aria-hidden="true"></i>{{ i18n.ts.zalip.playerUnavailable }}</p>
										<div v-if="$i && savedWatchProgress && !savedWatchProgress.completed && !playerOpen && playerView === 'player'" :class="$style.watchResume">
											<span v-if="savedWatchProgress.seasonNumber != null && savedWatchProgress.episodeNumber != null">{{ i18n.tsx.zalip.releaseSeason({ number: String(savedWatchProgress.seasonNumber) }) }} · {{ i18n.tsx.zalip.releaseEpisode({ number: String(savedWatchProgress.episodeNumber) }) }}</span>
											<button type="button" class="_button" :disabled="resumingWatch" @click="resumeWatch">{{ savedWatchProgress.positionSeconds != null && savedWatchProgress.positionSeconds > 0 ? i18n.tsx.zalip._progress.resumeAt({ time: watchTimeLabel(savedWatchProgress.positionSeconds) }) : i18n.ts.zalip._progress.resume }}</button>
											<button type="button" class="_button" :disabled="resumingWatch" :title="i18n.ts.zalip._progress.startOver" :aria-label="i18n.ts.zalip._progress.startOver" @click="restartWatch"><i class="ti ti-refresh" aria-hidden="true"></i></button>
										</div>
									</div>
									<button v-if="activePlayback" type="button" class="_button" :class="$style.editionTrigger" :aria-label="`${i18n.ts.zalip.playerVoices}: ${selectedVoiceLabel}, ${selectedProviderLabel}`" aria-haspopup="dialog" :aria-expanded="voiceMenuOpen" @click="openVoiceMenu">
										<span><strong>{{ selectedVoiceLabel }}</strong><small>{{ selectedProviderLabel }}</small></span><i class="ti ti-selector" aria-hidden="true"></i>
									</button>

								</div>
							<aside v-if="availablePlaybackSources.length" ref="editionPanel" :class="$style.editionPanel" :aria-label="i18n.ts.zalip.playerVoices">
									<h3>{{ i18n.ts.zalip.playerTab }}</h3>
									<div :class="$style.providerChoices" role="group" :aria-label="i18n.ts.zalip._importer.workSources"><button v-for="source in availablePlaybackSources" :key="source.source" type="button" class="_button" :class="{ [$style.menuSelected]: selectedProvider === source.source }" :aria-pressed="selectedProvider === source.source" @click="selectProvider(source.source)">{{ source.label }}</button></div>
									<template v-if="activeTranslations.length">
										<div :class="$style.translationTypes" role="group" :aria-label="i18n.ts.zalip.playerVoices">
											<button v-if="voiceTranslations.length" type="button" class="_button" :class="{ [$style.translationTypeSelected]: translationType === 'voice' }" :aria-pressed="translationType === 'voice'" @click="translationType = 'voice'">{{ i18n.ts.zalip.playerVoices }}<small>{{ voiceTranslations.length }}</small></button>
											<button v-if="subtitleTranslations.length" type="button" class="_button" :class="{ [$style.translationTypeSelected]: translationType === 'subtitles' }" :aria-pressed="translationType === 'subtitles'" @click="translationType = 'subtitles'">{{ i18n.ts.zalip.playerSubtitles }}<small>{{ subtitleTranslations.length }}</small></button>
										</div>
										<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="voiceQuery" type="search" :placeholder="i18n.ts.zalip.playerVoiceSearch" :aria-label="i18n.ts.zalip.playerVoiceSearch"></label>
										<div :class="$style.voiceList">
											<button v-for="translation in filteredTranslations" :key="translation.id" type="button" :title="playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles)" class="_button" :class="{ [$style.menuSelected]: selectedTranslationId === translation.id }" :aria-pressed="selectedTranslationId === translation.id" @click="selectTranslation(translation.id)"><span>{{ translation.name }}</span><small v-if="translation.quality">{{ translation.quality }}</small><i v-if="selectedTranslationId === translation.id" class="ti ti-check" aria-hidden="true"></i></button>
											<p v-if="!filteredTranslations.length">{{ i18n.ts.zalip.searchNoResults }}</p>
										</div>
									</template>
									<p v-else :class="$style.availableNotice">{{ i18n.ts.zalip._importer.nativeVoicesHint }}</p>
								</aside>
						</div>
						<template v-if="playerView === 'player'">
							<div :class="$style.playerNavigation">
								<div :class="$style.playerToolbar">
									<div v-if="work.seasons.length" :class="$style.episodeControls">
										<button type="button" class="_button" :disabled="previousEpisode == null" :aria-label="i18n.ts.zalip.playerPreviousEpisode" @click="selectRelativeEpisode(-1)"><i class="ti ti-chevron-left" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="!episodes.length" aria-haspopup="dialog" :aria-expanded="episodeMenuOpen" @click="openEpisodeMenu">{{ selectedEpisode ? i18n.tsx.zalip.playerEpisodeNumber({ number: selectedEpisode.episodeNumber }) : i18n.ts.zalip.workEpisodes }}<i class="ti ti-chevron-down" aria-hidden="true"></i></button>
										<button type="button" class="_button" :disabled="nextEpisode == null" :aria-label="i18n.ts.zalip.playerNextEpisode" @click="selectRelativeEpisode(1)"><i class="ti ti-chevron-right" aria-hidden="true"></i></button>
									</div>
									<button v-if="$i && selectedEpisodeProgress != null" type="button" class="_button" :class="[$style.watched, { [$style.actionActive]: episodeWatched }]" :disabled="personalActionsDisabled || episodeWatched" :aria-label="episodeWatched ? i18n.ts.zalip.playerWatched : i18n.ts.zalip.playerMarkWatched" :title="episodeWatched ? i18n.ts.zalip.playerWatched : i18n.ts.zalip.playerMarkWatched" @click="markEpisodeWatched"><i :class="episodeWatched ? 'ti ti-eye-check' : 'ti ti-eye'" aria-hidden="true"></i><span>{{ episodeWatched ? i18n.ts.zalip.playerWatched : i18n.ts.zalip.playerMarkWatched }}</span></button>
								</div>
								<div v-if="work.seasons.length" :class="[$style.playerEpisodes, { [$style.episodeRailFeedback]: episodesPending || episodesLoadFailed || !episodes.length }]">
									<label v-if="work.seasons.length > 1" :class="$style.watchSeason"><select :value="selectedSeasonNumber" :aria-label="i18n.ts.zalip.workSeason" @change="selectWatchSeason"><option v-for="season in work.seasons" :key="season.id" :value="season.seasonNumber">{{ season.seasonNumber === 0 ? i18n.ts.zalip.releaseSpecial : i18n.tsx.zalip.releaseSeason({ number: String(season.seasonNumber) }) }}</option></select></label>
									<p v-if="episodesPending" :class="$style.episodeRailState"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
									<div v-else-if="episodesLoadFailed" :class="$style.episodeRailState" role="alert"><span>{{ i18n.ts.zalip.playerEpisodesLoadFailed }}</span><button type="button" class="_button" :class="$style.episodeRetry" @click="retryEpisodes">{{ i18n.ts.retry }}</button></div>
									<p v-else-if="!episodes.length" :class="$style.episodeRailState">{{ i18n.ts.zalip.playerEpisodesEmpty }}</p>
									<div v-else ref="episodeRail" :class="$style.episodeRail" :aria-label="i18n.ts.zalip.workEpisodes">
										<button v-for="episode in episodes" :key="episode.id" :data-episode-id="episode.id" type="button" class="_button" :class="[$style.episodeTile, { [$style.selectedEpisodeTile]: selectedEpisode?.id === episode.id }]" :aria-pressed="selectedEpisode?.id === episode.id" :aria-label="episodeLabel(episode)" :title="episodeLabel(episode)" @click="selectEpisode(episode)">
										{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}
										</button>
									</div>
								</div>
							</div>
							<details v-if="$i && playerOpen && (watchTracker.mode.value === 'episode' || !watchPlayerContext)" :class="$style.watchProgressHelp"><summary><i class="ti ti-info-circle" aria-hidden="true"></i>{{ i18n.ts.info }}</summary><p>{{ episodeOnlyProgressHint }}</p></details>
							<details v-else-if="$i && playerOpen && watchTracker.mode.value === 'time' && selectedProvider === 'collaps'" :class="$style.watchProgressHelp"><summary><i class="ti ti-info-circle" aria-hidden="true"></i>{{ i18n.ts.info }}</summary><p>{{ i18n.ts.zalip._progress.collapsTimingHint }}</p></details>

						</template>
					</section>
					<details v-if="watchPage && selectedEpisode" :class="$style.episodeGuide" @touchstart.passive="startEpisodeSwipe" @touchend.passive="finishEpisodeSwipe" @touchcancel="episodeSwipeStart = null">
						<summary :class="$style.episodeGuideToggle"><span>{{ episodeLabel(selectedEpisode) }}</span><small>{{ episodeMeta(selectedEpisode) }}</small><i class="ti ti-chevron-down" aria-hidden="true"></i></summary>
						<div :class="$style.episodeGuideContent" aria-live="polite">
							<img v-if="episodeArtwork(selectedEpisode)" :key="selectedEpisode.id" :class="$style.episodeGuideStill" :src="episodeArtwork(selectedEpisode)!" alt="" width="480" height="270" loading="lazy" decoding="async" @error="images.failed">
							<p v-if="selectedEpisode.description">{{ selectedEpisode.description }}</p>
						</div>
					</details>
					<section id="discussion" ref="discussionSection" :class="$style.discussionArea">
						<div v-if="!watchPage" :class="$style.discussionScope" role="group" :aria-label="i18n.ts.zalip.discussionContext">
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionTab === 'comments' && discussionScope === 'work' }]" :aria-pressed="discussionTab === 'comments' && discussionScope === 'work'" @click="selectDiscussionScope('work')"><i class="ti ti-messages" aria-hidden="true"></i> {{ i18n.ts.zalip.comments }}</button>
							<button v-if="selectedEpisode" type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionTab === 'comments' && discussionScope === 'episode' }]" :aria-pressed="discussionTab === 'comments' && discussionScope === 'episode'" @click="selectDiscussionScope('episode')"><i class="ti ti-device-tv" aria-hidden="true"></i> {{ episodeLabel(selectedEpisode) }}</button>
							<button type="button" class="_button" :class="[$style.scopeButton, { [$style.scopeButtonActive]: discussionTab === 'reviews' }]" :aria-pressed="discussionTab === 'reviews'" @click="discussionTab = 'reviews'"><i class="ti ti-message-star" aria-hidden="true"></i> {{ i18n.ts.zalip._reviews.reviews }}</button>
						</div>
						<MkZalipReviewsPanel v-if="!watchPage && discussionTab === 'reviews'" :workId="work.id" :workTitle="work.title" :personalRating="personalRating" @ratingChanged="reviewRatingChanged"/>
						<ZalipDiscussionPanel v-else-if="activeDiscussionNoteId" :noteId="activeDiscussionNoteId" :heading="activeDiscussionHeading" :compact="watchPage"/>
						<section v-else :class="$style.discussionPending">
							<h2 v-if="watchPage">{{ i18n.ts.zalip.comments }}</h2>
							<p v-if="!watchPage && !discussionError"><i class="ti ti-messages" aria-hidden="true"></i> {{ activeDiscussionEmptyText }}</p>
							<button v-if="$i" type="button" class="_button" :class="$style.openDiscussion" :disabled="openingDiscussionScope != null || episodeDiscussionUnavailable" @click="openActiveDiscussion"><i :class="openingDiscussionScope != null ? 'ti ti-loader-2 ti-spin' : 'ti ti-message-plus'" aria-hidden="true"></i> {{ openingDiscussionScope != null ? i18n.ts.zalip.openingDiscussion : i18n.ts.zalip.startDiscussion }}</button>
							<button v-else type="button" class="_button" :class="$style.openDiscussion" @click="signInForDiscussion"><i class="ti ti-login" aria-hidden="true"></i> {{ i18n.ts.zalip.loginToComment }}</button>
							<p v-if="discussionError" :class="$style.discussionError">{{ discussionError }}</p>
						</section>
					</section>
					<template v-if="!watchPage">
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
					</template>
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
				<label v-if="work && work.seasons.length > 1" :class="$style.watchSeason"><select :value="selectedSeasonNumber" :aria-label="i18n.ts.zalip.workSeason" @change="selectWatchSeason"><option v-for="season in work.seasons" :key="season.id" :value="season.seasonNumber">{{ season.seasonNumber === 0 ? i18n.ts.zalip.releaseSpecial : i18n.tsx.zalip.releaseSeason({ number: String(season.seasonNumber) }) }}</option></select></label>
				<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="episodeQuery" type="search" :placeholder="i18n.ts.zalip.playerEpisodeSearch" :aria-label="i18n.ts.zalip.playerEpisodeSearch" @keydown.esc.stop.prevent="episodeModal?.close()"></label>
				<div :class="$style.episodeChoices">
					<p v-if="episodesPending" role="status">{{ i18n.ts.zalip.playerEpisodesLoading }}</p>
					<div v-else-if="episodesLoadFailed" :class="$style.episodeRailState" role="alert"><span>{{ i18n.ts.zalip.playerEpisodesLoadFailed }}</span><button type="button" class="_button" @click="retryEpisodes">{{ i18n.ts.retry }}</button></div>
					<template v-else>
						<button v-for="episode in filteredEpisodes" :key="episode.id" type="button" class="_button" :class="{ [$style.menuSelected]: selectedEpisodeId === episode.id }" :aria-pressed="selectedEpisodeId === episode.id" @click="selectEpisode(episode)">{{ i18n.tsx.zalip.playerEpisodeNumber({ number: episode.episodeNumber }) }}<i v-if="selectedEpisodeId === episode.id" class="ti ti-check" aria-hidden="true"></i></button>
						<p v-if="!filteredEpisodes.length">{{ i18n.ts.zalip.searchNoResults }}</p>
					</template>
				</div>
			</section>
		</MkModal>
		<MkModal v-if="voiceMenuOpen" ref="voiceModal" :class="$style.voiceOverlay" preferType="dialog" :returnFocusTo="voiceAnchor" @click="voiceModal?.close()" @esc="voiceModal?.close()" @closed="closeVoiceMenu">
			<section :class="$style.voiceDrawer" role="dialog" aria-modal="true" :aria-label="i18n.ts.zalip.playerVoices">
				<header><h2>{{ i18n.ts.zalip.playerTab }}</h2><button type="button" class="_button" :aria-label="i18n.ts.close" @click="voiceModal?.close()"><i class="ti ti-x" aria-hidden="true"></i></button></header>
				<div :class="$style.providerChoices" role="group" :aria-label="i18n.ts.zalip._importer.workSources"><button v-for="source in availablePlaybackSources" :key="source.source" type="button" class="_button" :class="{ [$style.menuSelected]: selectedProvider === source.source }" :aria-pressed="selectedProvider === source.source" @click="selectProvider(source.source)">{{ source.label }}</button></div>
				<template v-if="activeTranslations.length">
					<div :class="$style.translationTypes" role="group" :aria-label="i18n.ts.zalip.playerVoices">
						<button v-if="voiceTranslations.length" type="button" class="_button" :class="{ [$style.translationTypeSelected]: translationType === 'voice' }" :aria-pressed="translationType === 'voice'" @click="translationType = 'voice'">{{ i18n.ts.zalip.playerVoices }}<small>{{ voiceTranslations.length }}</small></button>
						<button v-if="subtitleTranslations.length" type="button" class="_button" :class="{ [$style.translationTypeSelected]: translationType === 'subtitles' }" :aria-pressed="translationType === 'subtitles'" @click="translationType = 'subtitles'">{{ i18n.ts.zalip.playerSubtitles }}<small>{{ subtitleTranslations.length }}</small></button>
					</div>
					<label :class="$style.menuSearch"><i class="ti ti-search" aria-hidden="true"></i><input v-model="voiceQuery" type="search" :placeholder="i18n.ts.zalip.playerVoiceSearch" :aria-label="i18n.ts.zalip.playerVoiceSearch" @keydown.esc.stop.prevent="voiceModal?.close()"></label>
					<div :class="$style.voiceList">
						<button v-for="translation in filteredTranslations" :key="translation.id" type="button" :title="playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles)" class="_button" :class="{ [$style.menuSelected]: selectedTranslationId === translation.id }" :aria-pressed="selectedTranslationId === translation.id" @click="selectTranslation(translation.id)"><span>{{ translation.name }}</span><small v-if="translation.quality">{{ translation.quality }}</small><i v-if="selectedTranslationId === translation.id" class="ti ti-check" aria-hidden="true"></i></button>
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
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, useTemplateRef, watch } from 'vue';
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
import MkZalipReviewsPanel from '@/components/MkZalipReviewsPanel.vue';
import ZalipRatingDialog from '@/components/ZalipRatingDialog.vue';
import { useZalipHorizontalDrag } from '@/composables/use-zalip-horizontal-drag.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { importerImageUrl } from '@/utility/zalip-importer.js';
import { useZalipImages } from '@/utility/zalip-image.js';
import { zalipAgeRatingLabel, zalipWorkMediaType } from '@/utility/zalip-work-presentation.js';
import { playbackEpisodeAvailable, playbackTranslationLabel, selectablePlaybackTranslations, workPlaybackIframe, workPlaybackSources } from '@/utility/zalip-playback.js';
import { zalipEpisodeQuery, zalipWatchRoute, zalipWorkRoute } from '@/utility/zalip-work-route.js';
import { taxonomyCreditCaption, taxonomyLinkSections, taxonomyProfileLabel, taxonomySectionLabel, taxonomyTypeIcon } from '@/utility/zalip-taxonomy.js';
import { sameWatchTarget, watchTimeLabel } from '@/utility/zalip-watch-progress.js';
import { useZalipWatchProgress } from '@/composables/use-zalip-watch-progress.js';
import { vibixPlayerDocument, vibixPlayerSandbox } from '@/utility/zalip-vibix-player.js';
import { resolveVibixPlaybackEmbed } from '@/utility/zalip-vibix-resolver.js';

type ZalipWork = {
	id: string;
	slug: string;
	mediaType?: 'movie' | 'tv' | null;
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
type PersonalStateContext = { request: number; workId: string | undefined; accountId: string | undefined };

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
	if (!activePage.value) return;
	if (!availablePlaybackSources.value.some(candidate => candidate.source === source)) return;
	watchEditionUnavailable.value = false;
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
}

window.addEventListener('resize', updateViewport, { passive: true });
onBeforeUnmount(() => window.removeEventListener('resize', updateViewport));

const voiceMenuOpen = ref(false);
const episodeMenuOpen = ref(false);
const voiceAnchor = ref<HTMLElement | null>(null);
const episodeAnchor = ref<HTMLElement | null>(null);
const voiceModal = useTemplateRef('voiceModal');
const editionPanel = useTemplateRef<HTMLElement>('editionPanel');
const episodeModal = useTemplateRef('episodeModal');
const workModal = useTemplateRef('workModal');
const moreTrigger = useTemplateRef('moreTrigger');
const workMenuOpen = ref(false);
const workMenuLists = ref(false);
const libraryStatuses = ['planned', 'watching', 'on_hold', 'completed', 'dropped'] as const;
const playbackIframe = useTemplateRef('playbackIframe');
const savedWatchProgress = ref<WatchProgress | null>(null);
const resumeSelection = ref<WatchProgress | null>(null);
const resumingWatch = ref(false);
const watchActionError = ref<string | null>(null);
let watchHistoryGeneration = 0;
const episodeQuery = ref('');
const props = withDefaults(defineProps<{ slug: string; initialSeason?: string; initialEpisode?: string; initialProvider?: string; initialTranslation?: string; watchPage?: boolean }>(), { watchPage: false });
const emit = defineEmits<{
	watchSelection: [selection: { seasonNumber: number | null; episodeNumber: number | null; provider: PlaybackProvider | null; translationId: string | null }];
}>();
const activePage = ref(true);
let playbackActionGeneration = 0;
const watchCoordinateUnavailable = ref(false);
const watchEditionUnavailable = ref(false);
const watchLinkUnavailable = computed(() => watchCoordinateUnavailable.value || watchEditionUnavailable.value);
const work = ref<ZalipWork | null>(null);
const watchRating = computed(() => work.value?.communityRating ?? work.value?.externalRatings?.[0]?.value ?? null);
const images = useZalipImages();
const mobileArtworkSource = computed(() => images.source(work.value?.backdropPath, 'w1280') ?? images.source(work.value?.posterPath));
const workSubtitle = computed(() => [work.value?.originalTitle, work.value?.releaseYear].filter(Boolean).join(', '));
const pending = ref(true);
const saving = ref(false);
const libraryReady = ref(!$i);
const libraryPending = ref(false);
const libraryLoadFailed = ref(false);
const personalActionsDisabled = computed(() => saving.value || (!!$i && !libraryReady.value));
let workRequest = 0;
let discussionRequest = 0;
let reviewRatingRequest = 0;
let personalRatingRevision = 0;
let pendingQuickRating: PersonalStateContext | null = null;
let pendingReviewRating: PersonalStateContext | null = null;
let reviewRatingRefreshNeeded: PersonalStateContext | null = null;
let libraryWriteRequest = 0;
const libraryStatus = ref<LibraryStatus | null>(null);
const saved = computed(() => libraryStatus.value != null);
const episodesWatched = ref(0);
const personalRating = ref<number | null>(null);
const isFavorite = ref(false);
const releaseSubscribed = ref(false);
// Menu switches must remain clickable when selected. `active` menu buttons intentionally do not.
const favoriteSwitch = computed({ get: () => isFavorite.value, set: () => { void toggleFavorite(); } });
const mediaType = computed(() => zalipWorkMediaType(work.value));
const episodic = computed(() => mediaType.value === 'tv');
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
const translationType = ref<'voice' | 'subtitles'>('voice');
const voiceTranslations = computed(() => activeTranslations.value.filter(translation => translation.type !== 'subtitles'));
const subtitleTranslations = computed(() => activeTranslations.value.filter(translation => translation.type === 'subtitles'));
const filteredTranslations = computed(() => (translationType.value === 'subtitles' ? subtitleTranslations.value : voiceTranslations.value).filter(translation => translation.name.toLocaleLowerCase('ru').includes(voiceQuery.value.trim().toLocaleLowerCase('ru'))));
watch([selectedTranslationId, activeTranslations], () => {
	const selected = activeTranslations.value.find(translation => translation.id === selectedTranslationId.value);
	translationType.value = selected?.type === 'subtitles' || !voiceTranslations.value.length ? 'subtitles' : 'voice';
});
const selectedVoiceLabel = computed(() => {
	const translation = activeTranslations.value.find(item => item.id === selectedTranslationId.value);
	return translation ? playbackTranslationLabel(translation, i18n.ts.zalip.playerSubtitles) : selectedProviderLabel.value;
});
const discussionNoteId = ref<string | null>(null);
const discussionError = ref<string | null>(null);
const discussionScope = ref<'work' | 'episode'>('work');
const discussionTab = ref<'comments' | 'reviews'>('comments');
const openingDiscussionScope = ref<'work' | 'episode' | null>(null);
const discussionSection = ref<HTMLElement | null>(null);
const playerSection = ref<HTMLElement | null>(null);
const selectedSeasonNumber = ref<number | null>(null);
const episodes = ref<ZalipEpisode[]>([]);
const episodesPending = ref(false);
const episodesLoadFailed = ref(false);
const episodeRequestId = ref(0);
const selectedEpisodeId = ref<string | null>(null);
const ratingDialogOpen = ref(false);
const ratingLibrary = ref<RatedLibraryEntry[]>([]);
const ratingLibraryPending = ref(false);
const ratingLibraryError = ref(false);
let ratingLibraryRequest = 0;
const ratingError = ref<string | null>(null);
onActivated(() => { activePage.value = true; });
onDeactivated(() => {
	// Cached pages remain mounted; their body teleports must not trap the next page.
	workMenuOpen.value = false;
	ratingDialogOpen.value = false;
	episodeMenuOpen.value = false;
	voiceMenuOpen.value = false;
	activePage.value = false;
	playbackActionGeneration++;
	resumingWatch.value = false;
	playerOpen.value = false;
	playerView.value = 'player';
});
const episodeRail = useTemplateRef('episodeRail');
let episodeSwipeStart: { x: number; y: number } | null = null;
const selectedEpisode = computed(() => episodes.value.find(episode => episode.id === selectedEpisodeId.value) ?? null);

const filteredEpisodes = computed(() => episodes.value.filter(episode => `${episode.episodeNumber} ${episode.title}`.toLocaleLowerCase('ru').includes(episodeQuery.value.trim().toLocaleLowerCase('ru'))));
const selectedEpisodeProgress = computed(() => getEpisodeProgress(work.value?.seasons ?? [], selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
const episodeWatched = computed(() => selectedEpisodeProgress.value != null && episodesWatched.value >= selectedEpisodeProgress.value);

const playerEpisodeContextBlocked = computed(() => ((props.watchPage && !!work.value?.seasons.length) || activePlayback.value?.source === 'kodik' || activePlayback.value?.source === 'vibix') && (selectedSeasonNumber.value != null || !!work.value?.seasons.length) && (episodesPending.value || selectedEpisode.value == null));
const selectedEpisodeAvailable = computed(() => !watchLinkUnavailable.value && !playerEpisodeContextBlocked.value && playbackEpisodeAvailable(activePlayback.value, selectedTranslationId.value, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
const savedWatchRoute = computed(() => zalipWatchRoute(props.slug, savedWatchProgress.value?.seasonNumber, savedWatchProgress.value?.episodeNumber, savedWatchProgress.value?.provider, savedWatchProgress.value?.translationId));
const watchEntryRoute = computed(() => savedWatchProgress.value && !savedWatchProgress.value.completed && props.initialSeason == null && props.initialEpisode == null
	? savedWatchRoute.value
	: zalipWatchRoute(props.slug, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber, activePlayback.value?.source, selectedTranslationId.value));
// Unknown anime/animation serials may have no cached coverage yet; retain their native selectors.
const fixedPlayerClip = computed(() => selectedEpisode.value != null || mediaType.value === 'movie');
const activeVibixEmbed = computed(() => resolveVibixPlaybackEmbed(activePlayback.value, selectedTranslationId.value, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null));
const activeVibixDocument = computed(() => activePage.value && $i && playerOpen.value && playerView.value === 'player' && selectedEpisodeAvailable.value && activePlayback.value?.source === 'vibix'
	? vibixPlayerDocument(activeVibixEmbed.value, { seasonNumber: activeVibixEmbed.value?.type === 'series' ? selectedSeasonNumber.value : null, episodeNumber: activeVibixEmbed.value?.type === 'series' ? selectedEpisode.value?.episodeNumber ?? null : null, translationId: selectedTranslationId.value }) : null);
const activePlayerIframe = computed(() => selectedEpisodeAvailable.value ? selectedProvider.value === 'vibix' ? activeVibixDocument.value ? 'about:srcdoc' : null : workPlaybackIframe(activePlayback.value, selectedTranslationId.value, selectedSeasonNumber.value, selectedEpisode.value?.episodeNumber ?? null, fixedPlayerClip.value) : null);
const resumeIframeUrl = ref<string | null>(null);
const resumeFrameRevision = ref(0);

const activePlayerIframeKey = computed(() => [
	selectedSeasonNumber.value ?? 'movie',
	selectedEpisode.value?.id ?? 'title',
	selectedTranslationId.value ?? 'default',
	selectedProvider.value,
	...(selectedProvider.value === 'vibix' ? [activeVibixEmbed.value?.publisherId, activeVibixEmbed.value?.type, activeVibixEmbed.value?.id] : []),
].join(':'));
watch(activePlayerIframeKey, () => { resumeSelection.value = null; resumeIframeUrl.value = null; resumeFrameRevision.value = 0; }, { flush: 'sync' });
watch(playerOpen, () => { resumeIframeUrl.value = null; resumeFrameRevision.value = 0; }, { flush: 'sync' });
const watchPlayerContext = computed(() => {
	if (!activePage.value || !playerOpen.value || playerView.value !== 'player' || !activePlayerIframe.value || !work.value) return null;
	// Native-selector serials without canonical episode IDs remain playable, but cannot invent a progress target.
	if (!selectedEpisode.value && (mediaType.value !== 'movie' || activePlayback.value?.episodes.length || (selectedProvider.value === 'vibix' && activePlayback.value?.vibixEmbed?.type === 'series') || (selectedProvider.value === 'kodik' && new URL(activePlayerIframe.value).pathname.startsWith('/serial/')))) return null;
	const target = { workId: work.value.id, episodeId: selectedEpisode.value?.id ?? null, provider: selectedProvider.value, translationId: selectedTranslationId.value };
	const resume = resumeSelection.value && sameWatchTarget(resumeSelection.value, target) ? resumeSelection.value : null;
	return { ...target, iframeUrl: activePlayerIframe.value, ...(activeVibixDocument.value ? { iframeDocument: activeVibixDocument.value } : {}), seasonNumber: selectedSeasonNumber.value, episodeNumber: selectedEpisode.value?.episodeNumber ?? null,
										providerTranslationId: activeTranslations.value.find(translation => translation.id === selectedTranslationId.value)?.providerTranslationId ?? null,
										resumeSeconds: resume?.mode === 'time' ? resume.positionSeconds : null };
});
const watchTracker = useZalipWatchProgress(watchPlayerContext, playbackIframe, progress => { if (work.value?.id === progress.workId) { watchHistoryGeneration++; savedWatchProgress.value = progress; } }, async url => { resumeIframeUrl.value = url; resumeFrameRevision.value++; await nextTick(); });
const watchProgressError = computed(() => watchActionError.value ?? ({ failed: i18n.ts.zalip._progress.saveFailed, conflict: i18n.ts.zalip._progress.sessionConflict, unmapped: i18n.ts.zalip._progress.contextUnmapped } as Partial<Record<string, string>>)[watchTracker.state.value] ?? null);
const episodeOnlyProgressHint = computed(() => fixedPlayerClip.value && selectedEpisode.value == null
	? selectedProvider.value === 'alloha' ? i18n.ts.zalip._progress.allohaMovieHint : i18n.ts.zalip._progress.movieHint
	: i18n.ts.zalip._progress.episodeHint);
const selectedEpisodeIndex = computed(() => selectedEpisode.value == null ? -1 : episodes.value.findIndex(episode => episode.id === selectedEpisode.value?.id));
const previousEpisode = computed(() => selectedEpisodeIndex.value > 0 ? episodes.value[selectedEpisodeIndex.value - 1] ?? null : null);
const nextEpisode = computed(() => selectedEpisodeIndex.value >= 0 ? episodes.value[selectedEpisodeIndex.value + 1] ?? null : null);
// A dedicated episode watch never falls back to title comments while metadata
// is pending, fails, or is retried. An episode ID must exist before posting.
const activeDiscussionScope = computed(() => props.watchPage && work.value?.seasons.length ? 'episode' : discussionScope.value);
const episodeDiscussionUnavailable = computed(() => activeDiscussionScope.value === 'episode' && selectedEpisode.value == null);
const activeDiscussionNoteId = computed(() => activeDiscussionScope.value === 'episode' ? selectedEpisode.value?.discussionNoteId ?? null : discussionNoteId.value);
const ratingLabel = computed(() => personalRating.value == null ? i18n.ts.zalip.ratingUnset : i18n.tsx.zalip.ratingValue({ rating: personalRating.value.toString() }));
const activeDiscussionHeading = computed(() => {
	if (activeDiscussionScope.value === 'episode' && selectedEpisode.value != null && work.value != null) return i18n.tsx.zalip.episodeDiscussionHeading({ title: work.value.title, episode: episodeLabel(selectedEpisode.value) });
	return work.value == null ? i18n.ts.zalip.comments : i18n.tsx.zalip.workDiscussionHeading({ title: work.value.title });
});
const activeDiscussionEmptyText = computed(() => activeDiscussionScope.value === 'episode' && selectedEpisode.value != null
	? i18n.tsx.zalip.emptyEpisodeDiscussion({ episode: episodeLabel(selectedEpisode.value) })
	: i18n.ts.zalip.emptyWorkDiscussion);

function tmdbImage(path: string): string {
	return importerImageUrl(path, 'w500') ?? '';
}

function tmdbGalleryImage(path: string): string {
	return importerImageUrl(path, 'w780') ?? '';
}

function episodeArtwork(episode: ZalipEpisode | null, size = 'w780'): string | null {
	return images.source(episode?.stillPath, size)
		?? images.source(work.value?.backdropPath, size)
		?? images.source(work.value?.posterPath, 'w500');
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

async function load(selection?: { initialSeason?: string; initialEpisode?: string; initialProvider?: string; initialTranslation?: string }): Promise<void> {
	const target = { ...props, ...selection };
	const request = ++workRequest;
	discussionRequest++;
	libraryWriteRequest++;
	reviewRatingRequest++;
	pendingQuickRating = null;
	pendingReviewRating = null;
	reviewRatingRefreshNeeded = null;
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
	watchCoordinateUnavailable.value = false;
	watchEditionUnavailable.value = false;
	savedWatchProgress.value = null;
	resumeSelection.value = null;
	resumingWatch.value = false;
	watchActionError.value = null;
	selectedTranslationId.value = null;
	discussionError.value = null;
	discussionScope.value = 'work';
	discussionTab.value = 'comments';
	openingDiscussionScope.value = null;
	selectedSeasonNumber.value = null;
	episodes.value = [];
	episodesPending.value = false;
	episodesLoadFailed.value = false;
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
		const requestedProvider = availablePlaybackSources.value.find(source => source.source === target.initialProvider);
		selectedProvider.value = requestedProvider?.source ?? availablePlaybackSources.value[0]?.source ?? 'alloha';
		catalogueLinks.value = links.entries;
		const requestedTranslation = activeTranslations.value.find(translation => translation.id === target.initialTranslation);
		selectedTranslationId.value = requestedTranslation?.id ?? activeTranslations.value[0]?.id ?? null;
		const requestedSeason = zalipEpisodeQuery(target.initialSeason, 0);
		const requestedEpisode = zalipEpisodeQuery(target.initialEpisode, 0);
		const initialSeason = loadedWork.seasons.find(season => season.seasonNumber === requestedSeason)
			?? loadedWork.seasons.find(season => season.seasonNumber > 0) ?? loadedWork.seasons[0];
		const invalidCoordinates = props.watchPage && ((target.initialSeason != null && (requestedSeason == null || initialSeason?.seasonNumber !== requestedSeason))
			|| (target.initialEpisode != null && (requestedEpisode == null || requestedSeason == null)));
		if (initialSeason != null && !invalidCoordinates) await loadSeason(initialSeason, initialSeason.seasonNumber === requestedSeason ? requestedEpisode : null);
		if (request !== workRequest) return;
		if (props.watchPage) {
			watchCoordinateUnavailable.value = watchCoordinateUnavailable.value || invalidCoordinates || (target.initialEpisode != null && !loadedWork.seasons.length);
			watchEditionUnavailable.value = (!!$i && !!target.initialProvider && !requestedProvider)
				|| (!!$i && !!target.initialTranslation && !requestedTranslation);
			if (selectedEpisode.value) discussionScope.value = 'episode';
		}
		if (!props.watchPage && request === workRequest && window.location.hash.startsWith('#review')) {
			discussionTab.value = 'reviews';
			await nextTick();
			focusDiscussion();
		} else if (request === workRequest && window.location.hash === '#discussion') {
			if (requestedSeason != null && selectedEpisode.value) discussionScope.value = 'episode';
			await nextTick();
			focusDiscussion();
		}
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
	if (!activePage.value || !$i || !work.value || !progress || resumingWatch.value) return;
	const request = workRequest;
	const action = ++playbackActionGeneration;
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
			if (!activePage.value || action !== playbackActionGeneration || request !== workRequest || work.value?.id !== workId || $i?.id !== accountId) return;
			if (selectedEpisodeId.value !== progress.episodeId) throw new Error('Unavailable episode');
		} else if (episodic.value) throw new Error('Unknown canonical episode');
		if (!playbackEpisodeAvailable(provider, progress.translationId, progress.seasonNumber, progress.episodeNumber)) throw new Error('Unavailable edition episode');
		selectedProvider.value = progress.provider;
		selectedTranslationId.value = progress.translationId;
		watchCoordinateUnavailable.value = false;
		watchEditionUnavailable.value = false;
		resumeSelection.value = { ...progress };
		playerView.value = 'player';
		playerOpen.value = true;
		focusPlayer();
	} catch { if (activePage.value && action === playbackActionGeneration && request === workRequest) watchActionError.value = i18n.ts.zalip._progress.resumeUnavailable; } finally { if (action === playbackActionGeneration && request === workRequest) resumingWatch.value = false; }
}

async function restartWatch(): Promise<void> {
	if (!activePage.value || !$i || !work.value || resumingWatch.value) return;
	const request = workRequest;
	const action = ++playbackActionGeneration;
	const workId = work.value.id;
	const accountId = $i.id;
	resumingWatch.value = true;
	watchActionError.value = null;
	playerOpen.value = false;
	try {
		await misskeyApiZalip('zalip/progress/reset', { workId });
		if (!activePage.value || action !== playbackActionGeneration || request !== workRequest || work.value?.id !== workId || $i?.id !== accountId) return;
		watchHistoryGeneration++;
		savedWatchProgress.value = null;
		resumeSelection.value = null;
		openPlayer();
	} catch { if (activePage.value && action === playbackActionGeneration && request === workRequest) watchActionError.value = i18n.ts.zalip._progress.resetFailed; } finally { if (action === playbackActionGeneration && request === workRequest) resumingWatch.value = false; }
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
	const selection = props.watchPage && !watchLinkUnavailable.value ? {
		initialSeason: selectedSeasonNumber.value?.toString(), initialEpisode: selectedEpisode.value?.episodeNumber.toString(),
		initialProvider: activePlayback.value?.source ?? props.initialProvider, initialTranslation: selectedTranslationId.value ?? props.initialTranslation,
	} : undefined;
	await load(selection);
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
	// Scroll only the horizontal episode strip, without moving the page or focus.
	if (tile.left >= rect.left && tile.right <= rect.right) return;
	const left = rail.scrollLeft + tile.left - rect.left - (rect.width - tile.width) / 2;
	rail.scrollTo({ left: Math.max(0, left), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
}, { flush: 'post' });

async function loadSeason(season: ZalipSeason, initialEpisodeNumber: number | null = null): Promise<void> {
	if (work.value == null) return;
	const workId = work.value.id;
	const slug = work.value.slug;
	const generation = workRequest;
	const requestId = ++episodeRequestId.value;
	const current = () => generation === workRequest && work.value?.id === workId && selectedSeasonNumber.value === season.seasonNumber && episodeRequestId.value === requestId;
	selectedSeasonNumber.value = season.seasonNumber;
	episodes.value = [];
	selectedEpisodeId.value = null;
	if (discussionScope.value === 'episode') discussionScope.value = 'work';
	episodesPending.value = true;
	episodesLoadFailed.value = false;
	try {
		const loadedEpisodes = await misskeyApiZalip<ZalipEpisode[]>('zalip/seasons/episodes', {
			slug,
			seasonNumber: season.seasonNumber,
		});
		if (current()) {
			episodes.value = loadedEpisodes;
			const exact = loadedEpisodes.find(episode => episode.episodeNumber === initialEpisodeNumber);
			watchCoordinateUnavailable.value = props.watchPage && initialEpisodeNumber != null && exact == null;
			selectedEpisodeId.value = watchCoordinateUnavailable.value ? null : exact?.id
				?? loadedEpisodes.find(episode => (getEpisodeProgress(work.value?.seasons ?? [], season.seasonNumber, episode.episodeNumber) ?? 0) > episodesWatched.value)?.id
				?? loadedEpisodes[0]?.id ?? null;
		}
	} catch {
		if (current()) {
			episodes.value = [];
			episodesLoadFailed.value = true;
		}
	} finally {
		if (current()) episodesPending.value = false;
	}
}

async function retryEpisodes(): Promise<void> {
	if (episodesPending.value || !episodesLoadFailed.value) return;
	const season = work.value?.seasons.find(candidate => candidate.seasonNumber === selectedSeasonNumber.value);
	if (season) await loadSeason(season, zalipEpisodeQuery(props.initialSeason, 0) === season.seasonNumber ? zalipEpisodeQuery(props.initialEpisode, 0) : null);
}

function selectWatchSeason(event: Event): void {
	const value = Number((event.target as HTMLSelectElement).value);
	const season = work.value?.seasons.find(item => item.seasonNumber === value);
	if (season) void selectSeason(season);
}

async function selectSeason(season: ZalipSeason): Promise<void> {
	if (selectedSeasonNumber.value === season.seasonNumber && (episodes.value.length > 0 || episodesPending.value)) return;
	await loadSeason(season);
	if (props.watchPage && selectedEpisode.value) discussionScope.value = 'episode';
}

function selectEpisode(episode: ZalipEpisode): void {
	episodeModal.value?.close();
	watchCoordinateUnavailable.value = false;
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
	voiceMenuOpen.value = true;
}

async function closeVoiceMenu(): Promise<void> {
	voiceMenuOpen.value = false;
	await nextTick();
	// The mobile trigger can disappear while the panel is open after a resize.
	if (!voiceAnchor.value?.getClientRects().length) {
		editionPanel.value?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
	}
}

function selectTranslation(id: string): void {
	if (!activeTranslations.value.some(translation => translation.id === id)) return;
	watchEditionUnavailable.value = false;
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
	if (!activePage.value) return;
	resumeSelection.value = null;
	if (activePlayback.value && selectedEpisodeAvailable.value) playerOpen.value = true;
}

async function selectDiscussionScope(scope: 'work' | 'episode'): Promise<void> {
	if (scope === 'episode' && selectedEpisode.value == null) return;
	discussionTab.value = 'comments';
	discussionScope.value = scope;
	await nextTick();
	focusDiscussion();
}

function focusDiscussion(): void {
	// Keep this tab selection in callers: opening reviews must not remount the player.
	discussionSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reviewRatingChanged(): Promise<void> {
	if (!work.value || !$i) return;
	const context = personalStateContext();
	const ratingRequest = ++reviewRatingRequest;
	const ratingRevision = ++personalRatingRevision;
	pendingReviewRating = context;
	if (samePersonalState(pendingQuickRating, context)) reviewRatingRefreshNeeded = context;
	try {
		const [current, entries] = await Promise.all([
			misskeyApiZalip<ZalipWork>('zalip/works/show', { slug: work.value.slug }),
			misskeyApiZalip<LibraryEntry[]>('zalip/library/list'),
		]);
		if (!isCurrentPersonalState(context) || ratingRequest !== reviewRatingRequest) return;
		work.value.communityRating = current.communityRating;
		work.value.ratingCount = current.ratingCount;
		if (samePersonalState(pendingQuickRating, context)) reviewRatingRefreshNeeded = context;
		else if (ratingRevision === personalRatingRevision) personalRating.value = entries.find(entry => entry.work.id === context.workId)?.personalRating ?? null;
	} catch { /* The saved personal rating remains valid if the public summary is unavailable. */ } finally {
		if (pendingReviewRating === context) pendingReviewRating = null;
	}
}

function focusPlayer(): void {
	playerSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openPlayer(): void {
	resumeSelection.value = null;
	playerView.value = 'player';
	focusPlayer();
	if (activePage.value && props.watchPage && $i && activePlayback.value && selectedEpisodeAvailable.value) playerOpen.value = true;
}

function openTrailer(): void {
	if (!activePage.value) return;
	playerView.value = 'trailer';
	focusPlayer();
}

async function signInForDiscussion(): Promise<void> {
	await pleaseLogin({ path: window.location.pathname + window.location.search });
}

async function openActiveDiscussion(): Promise<void> {
	if (!$i || work.value == null || openingDiscussionScope.value != null || episodeDiscussionUnavailable.value) return;
	const scope = activeDiscussionScope.value;
	const episode = selectedEpisode.value;
	const workId = work.value.id;
	const workEpoch = workRequest;
	const request = ++discussionRequest;
	const account = $i.id;
	const current = () => request === discussionRequest && workEpoch === workRequest && $i?.id === account && work.value?.id === workId && activeDiscussionScope.value === scope && (scope !== 'episode' || selectedEpisode.value?.id === episode?.id);
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

function applyLibraryEntry(entry: LibraryEntry): void {
	libraryStatus.value = entry.status;
	episodesWatched.value = entry.episodesWatched;
	personalRating.value = entry.personalRating;
	isFavorite.value = entry.isFavorite;
	releaseSubscribed.value = entry.isReleaseSubscribed;
}

function personalStateContext(): PersonalStateContext {
	return { request: workRequest, workId: work.value?.id, accountId: $i?.id };
}

function samePersonalState(first: PersonalStateContext | null, second: PersonalStateContext): boolean {
	return first != null && first.request === second.request && first.workId === second.workId && first.accountId === second.accountId;
}

function isCurrentPersonalState(context: PersonalStateContext): boolean {
	return context.workId != null && samePersonalState(context, personalStateContext());
}

async function updateLibrary(patch: Partial<LibraryUpdate> = {}): Promise<void> {
	if (work.value == null || !$i) return;
	if (!libraryReady.value) throw new Error('Personal library has not been loaded');
	const context = personalStateContext();
	const request = ++libraryWriteRequest;
	const ratingRevision = personalRatingRevision;
	saving.value = true;
	try {
		const entry = await misskeyApiZalip<LibraryEntry>('zalip/library/update', {
			workId: context.workId,
			status: libraryStatus.value,
			...patch,
		});
		if (isCurrentPersonalState(context) && request === libraryWriteRequest) applyLibraryEntry(patch.personalRating !== undefined || ratingRevision === personalRatingRevision ? entry : { ...entry, personalRating: personalRating.value });
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
	personalRatingRevision++;
	const context = personalStateContext();
	pendingQuickRating = context;
	if (samePersonalState(pendingReviewRating, context)) reviewRatingRefreshNeeded = context;
	ratingError.value = null;
	try {
		await updateLibrary({ personalRating: rating });
		if (isCurrentPersonalState(context)) closeRatingDialog();
	} catch {
		if (isCurrentPersonalState(context)) ratingError.value = i18n.ts.zalip.libraryUpdateFailed;
	} finally {
		if (pendingQuickRating === context) {
			pendingQuickRating = null;
			if (samePersonalState(reviewRatingRefreshNeeded, context)) {
				reviewRatingRefreshNeeded = null;
				// Both writers have settled: read their actual commit order, not their response order.
				if (isCurrentPersonalState(context)) void reviewRatingChanged();
			}
		}
	}
}

function shareWork(): void {
	if (work.value == null) return;
	const { id, slug, kind, title, description, releaseYear, genres, posterPath } = work.value;
	void os.post({
		zalipWork: { id, slug, kind, title, description, releaseYear, genres, posterPath },
	});
}

watch([selectedSeasonNumber, selectedEpisodeId, selectedProvider, selectedTranslationId, pending, episodesPending], () => {
	if (!activePage.value || !props.watchPage || pending.value || episodesPending.value || watchLinkUnavailable.value || !work.value || (work.value.seasons.length && !selectedEpisode.value)) return;
	emit('watchSelection', { seasonNumber: selectedSeasonNumber.value, episodeNumber: selectedEpisode.value?.episodeNumber ?? null, provider: activePlayback.value?.source ?? null, translationId: selectedTranslationId.value });
}, { flush: 'post' });

watch(() => [props.slug, props.initialSeason, props.initialEpisode, props.initialProvider, props.initialTranslation], () => void load(), { immediate: true });

definePage(() => ({
	title: work.value?.title ?? 'Zalip',
	icon: 'ti ti-movie',
}));
</script>

<style lang="scss" module>
.resumeBar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 16px; margin-bottom: 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-panelHighlight); > div { display: flex; flex: 1 1 180px; flex-direction: column; gap: 4px; span { font-size: .82em; opacity: .7; } } > button { padding: 10px 14px; border-radius: 999px; background: var(--MI_THEME-buttonBg); &:first-of-type { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); } &:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; } } }
.viewport { container-type: inline-size; }
.page { max-width: 1180px; margin: 0 auto; padding-bottom: 48px; min-width: 0; color: var(--zalip-social-fg); background: var(--zalip-social-panel); }
.work, .content { min-width: 0; }
.watchHeader { display: flex; align-items: center; gap: 12px; padding: 20px 24px; }
.watchBack { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 50%; color: var(--zalip-social-fg); }
.watchBack:hover, .watchLibrary:hover { background: var(--zalip-social-hover); text-decoration: none; }
.watchHeading { flex: 1; min-width: 0; }
.watchHeading h1 { margin: 0; font-size: 18px; line-height: 1.4; overflow-wrap: anywhere; }
.watchHeading h1 a { color: inherit; }
.watchHeading p { margin: 4px 0 0; font-size: 12px; color: var(--zalip-social-muted); }
.watchLibrary { display: flex; align-items: center; gap: 7px; min-height: 40px; padding: 8px 12px; flex-shrink: 0; border: 1px solid var(--zalip-social-border); border-radius: 99px; font-size: 12px; }
.watchLibrary i { font-size: 18px; }
.watchBack:focus-visible, .watchLibrary:focus-visible, .watchButton:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
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
.mobilePrimaryActions { display: none; }
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
.player { scroll-margin-top: 20px; container-type: inline-size; }
.playerTabs { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin-bottom: 18px; padding: 2px; }
.playerTab { flex: 0 0 auto; display: flex; align-items: center; gap: 7px; padding: 10px 12px; border: 1px solid transparent; border-radius: 14px; color: var(--zalip-social-muted); font-weight: 600; font-size: 13px; }
.playerTabActive { color: var(--zalip-social-fg); background: var(--zalip-accent-wash); border-color: var(--zalip-accent-border); }
.subscriptionBar { display: flex; align-items: center; gap: 10px 14px; flex-wrap: wrap; margin: 12px 0 16px; }
.subscriptionBar small { flex: 1 1 180px; color: var(--zalip-social-muted); font-size: 11px; line-height: 1.5; }
.availableNotice { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; font-size: 12px; color: var(--zalip-social-muted); }
.availableNotice i { color: var(--MI_THEME-accent); }
.subscribeButton { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 40px; padding: 10px 14px; border: 1px solid var(--zalip-social-border); border-radius: 99px; color: var(--zalip-social-fg); font-size: 12px; }
.subscribeButton i { flex-shrink: 0; }
.subscribeButton.subscribed { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); border-color: var(--zalip-accent-border); }
.subscribeButton:disabled { opacity: .6; }
.watchLayout { position: relative; min-width: 0; }
.watchFrame { min-width: 0; overflow: hidden; border-radius: var(--MI-radius); background: var(--zalip-social-raised); }
.editionPanel { display: none; }
.editionTrigger { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 52px; box-sizing: border-box; padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--zalip-social-border); }
.editionTrigger > span { display: flex; align-items: baseline; gap: 8px; flex: 1; min-width: 0; }
.editionTrigger strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.editionTrigger small { flex-shrink: 0; color: var(--zalip-social-muted); font-size: 11px; }
.editionTrigger > i { color: var(--zalip-social-muted); font-size: 18px; }
.editionTrigger:focus-visible, .playerToolbar button:focus-visible, .providerChoices button:focus-visible, .translationTypes button:focus-visible, .voiceList button:focus-visible, .episodeTile:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
.playerFrame, .playerPreview { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; background: var(--zalip-social-bg); }
.playerFrame iframe { display: block; width: 100%; height: 100%; border: 0; }
.playerPreview { display: grid; place-items: center; }
.playerPreview > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.playOverlay { position: relative; display: grid; place-items: center; width: 64px; height: 64px; border: 1px solid var(--MI_THEME-fgOnAccent); border-radius: 50%; color: var(--MI_THEME-fgOnAccent); background: color-mix(in srgb, var(--zalip-social-bg) 40%, transparent); }
.playOverlay i { font-size: 38px; }
.playerState { position: relative; display: flex; align-items: center; gap: 9px; max-width: 80%; box-sizing: border-box; margin: 0; padding: 16px; border-radius: 16px; background: color-mix(in srgb, var(--zalip-social-panel) 90%, transparent); color: var(--zalip-social-fg); line-height: 1.5; font-size: 13px; }
.playerToolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; flex-wrap: wrap; }
.episodeControls { display: flex; align-items: center; gap: 5px; }
.episodeControls button { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 9px 11px; border-radius: var(--zalip-radius-small); font-size: 12px; font-weight: 600; }
.episodeControls button:first-child, .episodeControls button:last-child { min-width: 44px; }
.episodeControls button:hover:not(:disabled), .watched:hover:not(:disabled) { background: var(--zalip-social-hover); }
.episodeControls button:disabled { opacity: .35; }
.watched { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 44px; padding: 8px; font-size: 11px; }
.watched i { font-size: 18px; }
.playerEpisodes { margin-top: 12px; }
.seasonPicker { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 12px; color: var(--zalip-social-muted); }
.seasonPicker > div { display: flex; gap: 6px; overflow-x: auto; }
.seasonPicker button { min-width: 34px; padding: 8px 10px; border-radius: 10px; background: var(--zalip-social-raised); }
.seasonPicker .selectedSeasonPill { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
.episodeRail { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 5px; max-height: 230px; overflow-y: auto; scrollbar-width: thin; padding: 2px; }
.episodeTile { min-width: 0; min-height: 44px; padding: 8px 4px; border-radius: var(--zalip-radius-small); text-align: center; color: var(--zalip-social-muted); font-size: 12px; }
.episodeTile:hover { background: var(--zalip-social-hover); color: var(--zalip-social-fg); }
.episodeTile.selectedEpisodeTile { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); font-weight: 600; }
.episodeRailState { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; color: var(--zalip-social-muted); font-size: 13px; }
.episodeRetry { min-height: 44px; padding: 8px 14px; border-radius: var(--MI-radius); background: var(--zalip-social-raised); color: var(--zalip-social-fg); &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } }
.episodeGuide { display: flex; align-items: start; gap: 18px; margin: 28px 0; touch-action: pan-y; }
.episodeGuideStill { width: 32%; max-width: 240px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 12px; }
.episodeGuideContent { min-width: 0; flex: 1; }
.guideNavigation { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.guideNavigation span { color: var(--zalip-social-muted); font-size: 11px; }
.guideNavigation button { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 99px; background: var(--zalip-social-raised); }
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
.voiceDrawer { display: flex; flex-direction: column; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); margin: auto; padding: 16px; border-radius: var(--MI-radius); }
.voiceDrawer header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.voiceDrawer h2 { margin: 0; font-size: 18px; }
.voiceDrawer header button { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; border-radius: 12px; background: var(--zalip-social-hover); }
.providerChoices { display: flex; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
.providerChoices button { min-height: 40px; padding: 8px 10px; border-radius: var(--zalip-radius-small); background: var(--zalip-social-hover); color: var(--zalip-social-muted); font-size: 12px; }
.providerChoices .menuSelected { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); }
.translationTypes { display: flex; gap: 14px; border-bottom: 1px solid var(--zalip-social-border); margin-bottom: 10px; }
.translationTypes button { display: inline-flex; align-items: center; gap: 5px; min-height: 44px; padding: 8px 0; border-bottom: 2px solid transparent; font-size: 12px; color: var(--zalip-social-muted); }
.translationTypes small { font-size: 10px; }
.translationTypes .translationTypeSelected { border-bottom-color: var(--MI_THEME-accent); color: var(--zalip-social-fg); }
.voiceList { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; overflow-y: auto; min-height: 0; scrollbar-width: thin; }
.voiceList button { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; width: 100%; min-height: 44px; padding: 8px 10px; box-sizing: border-box; border-radius: var(--zalip-radius-small); text-align: left; }
.voiceList button:hover { background: var(--zalip-social-hover); }
.voiceList button span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.voiceList small { color: var(--zalip-social-muted); font-size: 11px; }
.voiceList .menuSelected, .episodeChoices .menuSelected { background: var(--zalip-accent-soft); color: var(--MI_THEME-accent); }
@container (min-width: 800px) {
	.watchLayoutWithEditions { padding-right: 236px; }
	.watchLayoutWithEditions .editionTrigger { display: none; }
	.editionPanel { position: absolute; inset: 0 0 0 auto; display: flex; flex-direction: column; box-sizing: border-box; width: 224px; padding: 12px; border-radius: var(--MI-radius); background: var(--zalip-social-raised); }
	.editionPanel h3 { margin: 0; font-size: 13px; font-weight: 600; }
	.editionPanel .voiceList { flex: 1; }
	.editionPanel .availableNotice { margin: 4px 0; overflow-y: auto; }
}
.workSheet { position: relative; box-sizing: border-box; width: min(520px, 100%); max-height: calc(100dvh - 24px); margin: auto; padding: 24px; overflow-y: auto; overscroll-behavior: contain; border-radius: 24px; background: var(--zalip-social-panel); color: var(--zalip-social-fg); box-shadow: 0 12px 50px var(--MI_THEME-shadow); }
.sheetHandle { width: 36px; height: 4px; margin: -12px auto 22px; border-radius: 99px; background: var(--zalip-social-subtle); }
.sheetClose { position: absolute; top: 12px; right: 12px; display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: var(--zalip-social-raised); color: var(--zalip-social-muted); }
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
	.mobilePrimaryActions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin-top: 20px; }
	.mobilePrimaryActions button { min-height: 44px; min-width: 0; }
	.mobilePrimaryActions a { min-height: 44px; min-width: 0; box-sizing: border-box; }
	.watchHeader { gap: 8px; padding: 16px 12px; }
	.watchHeading h1 { font-size: 16px; }
	.watchLibrary { padding: 8px 10px; }
	.watchLibrary span { display: none; }
	.watchPage .content { padding: 0 12px; }
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
	.watched { margin-left: auto; max-width: 40%; font-size: 10px; }
	.episodeControls { gap: 4px; }
	.episodeControls button { padding: 8px 9px; font-size: 11px; }
	.playOverlay { width: 58px; height: 58px; }
	.playerState { padding: 12px; font-size: 12px; }
}
@media (max-width: 600px) {
	.workSheet { width: 100%; max-height: calc(100dvh - 24px); padding: 24px 20px max(20px, env(safe-area-inset-bottom)); border-radius: 24px 24px 0 0; }
	.voiceDrawer { position: fixed; inset: auto 8px 8px; width: auto; height: min(72dvh, 640px); max-height: calc(100dvh - 72px); margin: 0; padding: 12px 12px max(16px, env(safe-area-inset-bottom)); border-radius: 16px; overscroll-behavior: contain; }
}
// The dedicated watch canvas follows AnimeLIB's media/sidebar/episode-strip flow.
.watchCanvas { width: 100%; max-width: none; padding-bottom: 0; background: var(--zalip-social-bg); }
.watchCanvas .watchHeader { display: grid; grid-template-columns: 36px 48px minmax(0, 1fr) auto; align-items: center; gap: 14px; min-height: 96px; box-sizing: border-box; padding: 12px 20px; background: var(--zalip-social-panel); border-bottom: 1px solid var(--zalip-social-border); }
.watchPoster { grid-column: 2; display: grid; place-items: center; width: 48px; height: 68px; border-radius: 4px; object-fit: cover; background: var(--zalip-social-raised); color: var(--zalip-social-muted); }
.watchCanvas .watchHeading { grid-column: 3; }
.watchCanvas .watchHeading h1 { font-size: 20px; line-height: 1.4; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.watchCanvas .watchHeading p { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 5px; font-size: 13px; }
.watchRating { display: inline-flex; align-items: center; gap: 5px; color: var(--zalip-social-fg); }
.watchRating i { color: var(--MI_THEME-warn); }
.watchActions { grid-column: 4; display: flex; align-items: center; gap: 8px; min-width: 0; }
.watchActions button { display: inline-flex; justify-content: center; align-items: center; gap: 7px; min-height: 36px; box-sizing: border-box; padding: 7px 12px; border-radius: 6px; font-size: 13px; white-space: nowrap; }
.watchActions button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.watchNotify { color: var(--MI_THEME-accent); background: var(--zalip-accent-soft); }
.watchNotify.subscribed { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.watchActions .watchLibrary { border: 0; background: var(--zalip-social-raised); }
.watchTrailer { color: var(--zalip-social-muted); }
.watchTrailer[aria-pressed=true] { color: var(--MI_THEME-accent); }
.watchPage .content { padding: 0; }
.watchPage .player { scroll-margin-top: 0; }
.watchPage .watchLayout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 0; padding-right: 0; }
.watchPage .watchFrame { border-radius: 0; background: var(--zalip-social-panel); }
// Playback is a black video viewport in both themes, like the providers' own controls.
.watchPage .playerFrame, .watchPage .playerPreview { height: clamp(360px, 76dvh, 760px); aspect-ratio: auto; background: black; color: white; }
.watchPage .playOverlay { width: 76px; height: 76px; border: 0; border-radius: 0; background: transparent; color: white; }
.watchPage .playOverlay i { font-size: 58px; }
.watchResume { position: absolute; inset: auto 16px 18px; display: flex; align-items: center; justify-content: center; gap: 8px 12px; flex-wrap: wrap; color: white; font-size: 12px; }
.watchResume > span { opacity: .7; }
.watchResume button { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 36px; padding: 8px 12px; border-radius: 6px; background: color-mix(in srgb, white 14%, black); color: white; font-weight: 600; }
.watchResume button:first-of-type { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.watchResume button:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.watchPage .playerToolbar { min-height: 48px; padding: 4px 12px; flex-wrap: nowrap; border-bottom: 1px solid var(--zalip-social-border); }
.watchPage .editionTrigger { min-height: 44px; padding: 8px 16px; }
.watchPage .editionTrigger strong { font-size: 14px; }
.watchPage .editionTrigger small { font-size: 12px; }
.watchPage .playerEpisodes { display: flex; align-items: center; gap: 12px; margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--zalip-social-border); }
.playerNavigation { display: flex; align-items: center; min-width: 0; min-height: 56px; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--zalip-social-border); }
.watchPage .playerNavigation .playerToolbar { display: contents; }
.playerNavigation .episodeControls { order: 0; }
.watchPage .playerNavigation .playerEpisodes { flex: 1; min-width: 0; order: 1; padding: 6px 0; border: 0; }
.playerNavigation .watched { order: 2; flex: 0 0 auto; margin-left: auto; }
.watchSeason { flex: 0 0 auto; display: block; }
.watchSeason select { width: 100%; min-height: 36px; box-sizing: border-box; padding: 6px 12px; border: 1px solid var(--zalip-social-border); border-radius: 6px; font: inherit; font-size: 13px; color: var(--zalip-social-fg); background: var(--zalip-social-panel); }
.watchPage .episodeRail { display: flex; flex: 1; min-width: 0; gap: 4px; max-height: none; overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; padding: 0 0 3px; }
.watchPage .episodeTile { flex: 0 0 auto; min-width: 86px; min-height: 38px; padding: 8px 12px; border-radius: 6px; }
.watchPage .episodeGuide { display: block; max-width: 880px; box-sizing: border-box; margin: 0 auto; padding: 0 24px; border-bottom: 1px solid var(--zalip-social-border); }
.episodeGuideToggle { display: flex; align-items: center; gap: 12px; min-height: 52px; list-style: none; cursor: pointer; font-size: 13px; color: var(--zalip-social-muted); }
.episodeGuideToggle::-webkit-details-marker { display: none; }
.episodeGuideToggle > span { flex: 1; min-width: 0; }
.episodeGuideToggle > small { font-size: 11px; }
.episodeGuideToggle > i { font-size: 16px; transition: transform .15s; }
.episodeGuide[open] > .episodeGuideToggle > i { transform: rotate(180deg); }
.episodeGuideToggle:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; }
.watchPage .episodeGuideContent { display: flex; align-items: start; gap: 18px; padding: 0 0 20px; }
.watchPage .episodeGuideStill { width: 180px; max-width: 35%; flex: 0 0 auto; border-radius: 6px; }
.watchPage .episodeGuideContent p { margin: 0; font-size: 13px; font-weight: 400; color: var(--zalip-social-muted); }
.watchPage .discussionArea { max-width: 880px; box-sizing: border-box; margin: 0 auto; padding: 24px; }
.watchPage .discussionPending { margin: 0; padding: 0; border: 0; background: transparent; }
.watchPage .discussionPending h2 { margin: 0 0 20px; font-size: 20px; }
.watchPage .availableNotice { margin: 0; padding: 10px 20px; }
.watchProgressHelp { margin: 0; padding: 6px 16px; color: var(--zalip-social-muted); font-size: 12px; }
.watchProgressHelp > summary { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; cursor: pointer; }
.watchProgressHelp p { margin: 6px 0; line-height: 1.5; }
.episodeMenu .watchSeason { margin-bottom: 10px; }
@container (min-width: 1000px) {
	.playerNavigation .episodeControls button:nth-child(2) { display: none; }
	.watchPage .watchLayoutWithEditions { grid-template-columns: minmax(0, 1fr) 300px; }
	.watchPage .watchLayoutWithEditions .editionTrigger { display: none; }
	.watchPage .editionPanel { position: static; inset: auto; display: flex; flex-direction: column; min-height: 0; width: auto; padding: 16px; border-left: 1px solid var(--zalip-social-border); border-radius: 0; background: var(--zalip-social-panel); }
	.watchPage .editionPanel h3 { font-size: 14px; font-weight: 500; }
	.watchPage .providerChoices button { min-height: 30px; padding: 5px 10px; font-size: 13px; border-radius: 5px; }
	.watchPage .translationTypes { gap: 16px; margin-bottom: 8px; }
	.watchPage .translationTypes button { min-height: 38px; font-size: 14px; }
	.watchPage .voiceList { flex: 1; }
	.watchPage .voiceList button { min-height: 34px; padding: 6px 10px; border-radius: 5px; }
}
@container (max-width: 999px) {
	.watchPage .editionPanel { display: none; }
	.watchPage .editionTrigger { display: flex; }
	.watchPage .playerFrame, .watchPage .playerPreview { min-height: 240px; height: min(56dvh, 440px); }
	.watchPage .playerNavigation { display: block; min-height: 48px; padding: 0; }
	.watchPage .playerNavigation .playerToolbar { display: flex; border: 0; }
	.watchPage .playerNavigation .playerEpisodes { display: none; }
	.watchPage .playerNavigation .episodeRailFeedback { display: block; padding: 8px 16px; }
}
@container (max-width: 600px) {
	.watchCanvas .watchHeader { grid-template-columns: 40px minmax(0, 1fr) auto; grid-template-areas: 'back actions actions' 'poster heading heading'; gap: 8px 10px; padding: 8px 12px 12px; }
	.watchCanvas .watchBack { grid-area: back; width: 36px; height: 36px; }
	.watchCanvas .watchPoster { grid-area: poster; width: 40px; height: 58px; }
	.watchCanvas .watchHeading { grid-area: heading; }
	.watchCanvas .watchHeading h1 { font-size: 18px; }
	.watchCanvas .watchHeading p { font-size: 12px; }
	.watchActions { grid-area: actions; justify-content: flex-end; gap: 6px; }
	.watchActions button { min-height: 36px; padding: 6px 10px; font-size: 12px; }
	.watchActions .watchLibrary span { display: inline; max-width: 112px; overflow: hidden; text-overflow: ellipsis; }
	.watchTrailer span { display: none; }
	.watchPage .playerToolbar { padding: 4px 10px; }
	.watchPage .watched { max-width: none; margin-left: auto; padding: 6px 10px; }
	.watchPage .watched span { display: none; }
	.watchPage .playerEpisodes { padding: 6px 12px; gap: 8px; }
	.watchPage .watchSeason select { padding: 6px; font-size: 12px; }
	.watchPage .episodeTile { min-width: 70px; min-height: 36px; font-size: 12px; }
	.watchPage .episodeGuide { padding: 0 16px; }
	.episodeGuideToggle { flex-wrap: wrap; column-gap: 8px; padding: 8px 0; }
	.episodeGuideToggle > small { display: none; }
	.watchPage .episodeGuideContent { flex-direction: column; gap: 12px; }
	.watchPage .episodeGuideStill { width: 100%; max-width: none; }
	.watchPage .discussionArea { padding: 20px 16px; }
}
@media (prefers-reduced-motion: reduce) { .episodeGuideToggle > i { transition: none; } }
</style>
