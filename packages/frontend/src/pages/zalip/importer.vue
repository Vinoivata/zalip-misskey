<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<PageWithHeader>
	<div class="_spacer" style="--MI_SPACER-w: 1100px;">
		<main :class="$style.page">
			<div v-if="!iAmAdmin" :class="$style.empty"><i class="ti ti-lock" aria-hidden="true"></i><h1>{{ i18n.ts.zalip._importer.adminOnly }}</h1><p>{{ i18n.ts.zalip._importer.permissionsHint }}</p></div>
			<template v-else>
				<header :class="$style.heading">
					<div><p :class="$style.eyebrow"><i class="ti ti-database-import" aria-hidden="true"></i> ZALIP</p><h1>{{ i18n.ts.zalip._importer.title }}</h1><p>{{ i18n.ts.zalip._importer.draftsHint }}</p></div>
					<MkA to="/zalip/editor" :class="$style.button"><i class="ti ti-pencil" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.editor }}</MkA>
				</header>

				<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._importer.sections">
					<button v-for="item in tabs" :key="item.id" type="button" class="_button" :class="{ [$style.active]: tab === item.id }" :aria-pressed="tab === item.id" @click="tab = item.id"><i :class="item.icon" aria-hidden="true"></i>{{ item.title }}</button>
				</nav>
				<p v-if="message" :class="$style.message" role="status">{{ message }}</p>
				<p v-if="actionError" :class="$style.error" role="alert">{{ actionError }}</p>
				<p v-if="sourcesError" :class="$style.error" role="alert">{{ sourcesError }} <button type="button" class="_textButton" @click="loadSources">{{ i18n.ts.zalip._importer.retry }}</button></p>

				<template v-if="tab === 'import'">
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><p :class="$style.eyebrow">{{ i18n.ts.zalip._importer.findContent }}</p><h2>{{ i18n.ts.zalip._importer.searchHeading }}</h2><p>{{ i18n.ts.zalip._importer.searchHint }}</p></div></div>
						<form :class="$style.searchForm" @submit.prevent="search(1)">
							<label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="searchForm.source" :disabled="busy" @change="clearSearch"><option v-for="source in searchableSources" :key="source.source" :value="source.source">{{ importerSourceLabel(source.source) }}</option></select></label>
							<label><span>{{ i18n.ts.zalip._importer.type }}</span><select v-model="searchForm.mediaType" :disabled="busy" @change="clearSearch"><option value="movie">{{ i18n.ts.zalip._importer.movie }}</option><option value="tv">{{ i18n.ts.zalip._importer.series }}</option></select></label>
							<label :class="$style.grow"><span>{{ i18n.ts.zalip._importer.query }}</span><input v-model.trim="searchForm.query" type="search" required minlength="2" maxlength="200" :placeholder="i18n.ts.zalip._importer.queryPlaceholder" :disabled="busy"></label>
							<button type="submit" class="_button" :class="$style.primary" :disabled="searching || !canSearch"><i :class="searching ? 'ti ti-loader-2 ti-spin' : 'ti ti-search'" aria-hidden="true"></i>{{ searching ? i18n.ts.zalip._importer.searching : i18n.ts.zalip._importer.find }}</button>
						</form>
						<p v-if="!sourcesLoading && !searchableSources.length" :class="$style.hint">{{ i18n.ts.zalip._importer.noSearchSource }}</p>
						<p v-if="searchError" :class="$style.error" role="alert">{{ searchError }}</p>
						<div v-if="searchItems.length" :class="$style.searchResults">
							<article v-for="item in searchItems" :key="importerReferenceKey(item.ref)" :class="$style.result">
								<label :class="$style.selection"><input type="checkbox" :checked="isSelected(item.ref)" :disabled="!isSelected(item.ref) && selectedRefs.length >= 100" :aria-label="i18n.tsx.zalip._importer.selectWork({ name: item.title })" @change="toggleSelection(item.ref)"></label>
								<div :class="$style.poster"><img v-if="importerImageUrl(item.posterUrl)" :src="importerImageUrl(item.posterUrl)!" alt="" loading="lazy"><i v-else class="ti ti-movie" aria-hidden="true"></i></div>
								<div :class="$style.grow"><h3>{{ item.title }}</h3><p>{{ item.releaseYear ?? i18n.ts.zalip._importer.unknownYear }}<span v-if="item.originalTitle"> · {{ item.originalTitle }}</span></p><small>{{ importerSourceLabel(item.ref.source) }} · {{ item.ref.mediaType }} · {{ item.ref.externalId }}</small></div>
								<button type="button" class="_button" :class="$style.button" :disabled="previewLoading" @click="showPreview(item.ref)"><i class="ti ti-eye" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.preview }}</button>
							</article>
						</div>
						<p v-else-if="searched && !searching && !searchError" :class="$style.hint">{{ i18n.ts.zalip._importer.searchEmpty }}</p>
						<div v-if="searched" :class="$style.toolbar">
							<div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="searching || searchPage <= 1" @click="search(searchPage - 1)"><i class="ti ti-chevron-left" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.previous }}</button><span>{{ i18n.tsx.zalip._importer.searchPage({ page: String(searchPage) }) }}</span><button type="button" class="_button" :class="$style.button" :disabled="searching || !searchHasMore" @click="search(searchPage + 1)">{{ i18n.ts.zalip._importer.next }}<i class="ti ti-chevron-right" aria-hidden="true"></i></button></div>
							<details :class="$style.bulkSelection"><summary>{{ i18n.tsx.zalip._importer.selectedCount({ count: String(selectedRefs.length) }) }} · {{ i18n.ts.zalip._importer.bulkImport }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.bulkArtworkHint }}</p><p v-if="preview || previewLoading" :class="$style.hint">{{ i18n.ts.zalip._importer.previewSubmitHint }}</p><div :class="$style.actions"><button v-if="!preview && !previewLoading" type="button" class="_button" :class="$style.button" :disabled="busy || selectedRefs.length === 0" @click="queueReferences(selectedRefs)">{{ i18n.ts.zalip._importer.importSelected }}</button><button type="button" class="_textButton" :disabled="selectedRefs.length === 0" @click="selectedRefs = []">{{ i18n.ts.zalip._importer.clearSelection }}</button></div></details>
						</div>
					</section>

					<section :class="$style.panel">
						<h2>{{ i18n.ts.zalip._importer.byId }}</h2><p :class="$style.hint">{{ i18n.ts.zalip._importer.singleReferenceHint }}</p>
						<p :class="$style.hint">{{ batch.source === 'kodik' ? i18n.ts.zalip._importer.kodikReferencesHint : i18n.ts.zalip._importer.imdbHint }}</p>
						<form :class="$style.form" @submit.prevent="previewBatch">
							<label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="batch.source" :disabled="busy"><option v-for="source in importerSources" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label>
							<label><span>{{ i18n.ts.zalip._importer.idMediaType }}</span><select v-model="batch.mediaType" :disabled="busy"><option value="movie">{{ i18n.ts.zalip._importer.movie }}</option><option value="tv">{{ i18n.ts.zalip._importer.series }}</option></select></label>
							<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.references }}</span><textarea v-model="batch.references" rows="2" maxlength="20000" :placeholder="batch.source === 'kodik' ? 'serial-123\nmovie-456' : '11\nhttps://www.themoviedb.org/movie/157336'" :disabled="busy"></textarea></label>
							<div :class="[$style.actions, $style.wide]"><button type="submit" class="_button" :class="$style.button" :disabled="busy || previewLoading || !batch.references.trim()"><i class="ti ti-eye" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.previewFirst }}</button><span :class="$style.hint">{{ i18n.ts.zalip._importer.noPublishing }}</span></div>
						</form>
					</section>
				</template>

				<details v-if="tab === 'import' || tab === 'schedules'" ref="importOptionsPanel" :open="props.imagesOnly === '1' && tab === 'import'" :class="[$style.panel, $style.details]">
					<summary>{{ i18n.ts.zalip._importer.importOptions }}</summary>
					<p :class="$style.hint">{{ i18n.ts.zalip._importer.optionsHint }}</p>
					<ImporterArtworkSettings v-model:mode="currentSelection.artwork" v-model:settings="currentSelection.artworkSettings" :disabled="busy || profileOptionsLocked"/>
					<label :class="$style.check"><input v-model="currentSelection.filters.requirePlayer" type="checkbox" :disabled="busy || profileOptionsLocked">{{ i18n.ts.zalip._importer.requirePlayer }}</label><p :class="$style.hint">{{ i18n.ts.zalip._importer.requirePlayerHint }}</p>
					<fieldset :class="$style.locks"><legend>{{ i18n.ts.zalip._importer.enrichmentSources }}</legend><label v-for="source in importerSources" :key="source"><input v-model="currentSelection.sources" type="checkbox" :value="source" :disabled="busy || profileOptionsLocked || !sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</label></fieldset>
					<div v-if="tab === 'import'" :class="$style.form">
						<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.importCategories }}</span><select v-model="categoryIds" multiple size="3" :disabled="busy"><option v-for="entry in categories" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></label>
					</div>
					<h3 :class="$style.optionsHeading">{{ i18n.ts.zalip._importer.selectedFields }}</h3>
					<details v-for="group in importerFieldGroups" :key="group.id" :class="$style.fieldGroup">
						<summary>{{ importerGroupLabel(group.id) }} <small>{{ group.fields.filter(field => currentSelection.fields.includes(field)).length }} / {{ group.fields.length }}</small></summary>
						<label :class="$style.check"><input type="checkbox" :checked="group.fields.every(field => currentSelection.fields.includes(field))" :disabled="busy || profileOptionsLocked" @change="toggleFieldGroup(group.fields)">{{ i18n.ts.zalip._importer.selectGroup }}</label>
						<div v-for="field in group.fields" :key="field" :class="$style.fieldRow"><label :class="$style.check"><input v-model="currentSelection.fields" type="checkbox" :value="field" :disabled="busy || profileOptionsLocked">{{ importerFieldLabel(field) }}</label><select v-model="currentSelection.fieldSources[field]" :aria-label="i18n.tsx.zalip._importer.fieldPreference({ field: importerFieldLabel(field) })" :disabled="busy || profileOptionsLocked || !currentSelection.fields.includes(field)"><option value="">{{ i18n.ts.zalip._importer.defaultSource }}</option><option v-for="source in importerSources" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured || (!currentSelection.sources.includes(source) && !currentPrimarySources.includes(source))">{{ importerSourceLabel(source) }}</option></select></div>
					</details>
					<details :class="$style.fieldGroup"><summary>{{ i18n.ts.zalip._importer.importFilters }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.importFiltersHint }}</p><div :class="$style.form"><fieldset :class="[$style.locks, $style.wide]"><legend>{{ i18n.ts.zalip._importer.workType }}</legend><label v-for="kind in workKinds" :key="kind.value"><input v-model="currentSelection.filters.kinds" type="checkbox" :value="kind.value" :disabled="busy || profileOptionsLocked">{{ kind.title }}</label></fieldset><label><span>{{ i18n.ts.zalip._importer.yearFrom }}</span><input v-model="currentSelection.filters.yearFrom" type="number" min="1888" max="3000" :disabled="busy || profileOptionsLocked"></label><label><span>{{ i18n.ts.zalip._importer.yearTo }}</span><input v-model="currentSelection.filters.yearTo" type="number" min="1888" max="3000" :disabled="busy || profileOptionsLocked"></label><label><span>{{ i18n.ts.zalip._importer.ruleGenres }}</span><input v-model="currentSelection.filters.genres" maxlength="5050" :disabled="busy || profileOptionsLocked"></label><label><span>{{ i18n.ts.zalip._importer.ruleCountries }}</span><input v-model="currentSelection.filters.countries" maxlength="5050" :disabled="busy || profileOptionsLocked"></label><label><span>{{ i18n.ts.zalip._importer.ratingMin }}</span><input v-model="currentSelection.filters.ratingMin" type="number" min="0" max="10" step="0.1" :disabled="busy || profileOptionsLocked"></label></div></details>
				</details>

				<template v-if="tab === 'import'">
					<section v-if="previewLoading || preview || previewError" ref="previewPanel" :class="[$style.panel, $style.previewPanel]" aria-live="polite">
						<div :class="$style.sectionHeading"><h2>{{ i18n.ts.zalip._importer.previewHeading }}</h2><button type="button" class="_button" :class="$style.button" :disabled="previewLoading" :aria-label="i18n.ts.zalip._importer.closePreview" @click="previewBase = null; artworkChoices = {}; previewError = ''"><i class="ti ti-x" aria-hidden="true"></i></button></div>
						<p v-if="previewLoading"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.previewLoading }}</p>
						<p v-if="previewError" :class="$style.error" role="alert">{{ previewError }}</p>
						<template v-if="preview && !previewLoading">
							<p v-if="previewStale" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.optionsChangedPreview }} <button type="button" class="_textButton" :disabled="busy" @click="showPreview(preview.record.ref)">{{ i18n.ts.zalip._importer.refreshPreview }}</button></p>
							<p v-if="preview.matchesFilters === false" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.previewFiltered }}</p>
							<div :class="$style.previewHero"><div :class="$style.previewPoster"><img v-if="importerImageUrl(preview.record.posterUrl)" :src="importerImageUrl(preview.record.posterUrl)!" alt=""><i v-else class="ti ti-movie" aria-hidden="true"></i></div><div><span :class="$style.badge">{{ preview.workId ? i18n.ts.zalip._importer.existingWork : i18n.ts.zalip._importer.newDraft }}</span><h3>{{ preview.record.title }}</h3><p>{{ [preview.record.releaseYear, preview.record.originalTitle].filter(Boolean).join(' · ') }}</p><p>{{ preview.record.genres.join(' · ') }}</p><p>{{ preview.record.description }}</p><div :class="$style.chips"><span v-for="identity in preview.record.identities" :key="`${identity.provider}:${identity.entityType}:${identity.externalId}`">{{ identity.provider }} · {{ identity.entityType }} · {{ identity.externalId }}</span></div></div></div>
							<div :class="$style.selectionSummary"><span><i class="ti ti-checklist" aria-hidden="true"></i>{{ i18n.tsx.zalip._importer.selectedFieldsSummary({ selected: String(importSelection.fields.length), total: String(importerFields.length) }) }}</span><button type="button" class="_textButton" @click="showImportOptions">{{ i18n.ts.zalip._importer.importOptions }}</button></div>
							<ImporterArtworkPicker v-if="previewBase" :key="importerReferenceKey(previewBase.record.ref)" v-model="artworkChoices" :preview="previewBase" :lockedFields="lockedFields" :disabled="busy || previewStale" :galleryLimit="artworkGalleryLimit"/>
							<ul v-if="previewWarnings.length" :class="$style.warnings" :aria-label="i18n.ts.zalip._importer.warningsTitle"><li v-for="warning in previewWarnings" :key="warning">{{ warning }}</li></ul>
							<div :class="$style.chips"><span>{{ i18n.tsx.zalip._importer.peopleCount({ count: String(preview.record.credits.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.studiosCount({ count: String(preview.record.companies.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.collectionsCount({ count: String(preview.record.collections.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.seasonsCount({ count: String(preview.record.seasons.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.playersCount({ count: String(preview.record.players.length) }) }}</span></div>
							<details :class="$style.details"><summary>{{ i18n.ts.zalip._importer.peopleAndCollections }}</summary><p v-if="preview.record.credits.length">{{ preview.record.credits.map(credit => `${credit.name} (${credit.role})`).join(' · ') }}</p><p v-if="preview.record.companies.length">{{ preview.record.companies.map(company => company.name).join(' · ') }}</p><p v-if="preview.record.collections.length">{{ preview.record.collections.map(collection => collection.name).join(' · ') }}</p></details>
							<details :class="[$style.details, $style.diffDetails]">
								<summary>{{ i18n.ts.zalip._importer.reviewChanges }} <span :class="$style.count">{{ preview.changes.length }}</span></summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.fieldSelectionHint }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.locksHint }}</p>
								<div :class="$style.diffList"><article v-for="change in preview.changes" :key="change.field" :class="$style.diff"><label><input type="checkbox" :checked="previewLockChecked(change.field)" :disabled="previewLockDisabled(change.field)" :aria-label="i18n.tsx.zalip._importer.protectField({ field: importerFieldLabel(change.field) })" @change="toggleLock(change.field)"><span :class="$style.lockLabel"><i class="ti ti-lock" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.protect }}</span><strong>{{ importerFieldLabel(change.field) }}</strong><span v-if="change.protected || lockedFields.includes(change.field)" :class="$style.badge"><i class="ti ti-lock" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.protected }}</span><small v-if="change.selected === false">{{ i18n.ts.zalip._importer.skippedField }}</small></label><div :class="$style.diffValues"><div><small>{{ i18n.ts.zalip._importer.before }}</small><p>{{ formatImporterValue(change.before) }}</p></div><div><small>{{ i18n.ts.zalip._importer.after }}</small><p>{{ formatImporterValue(change.after) }}</p></div></div></article></div>
								<p v-if="preview.changes.length === 0" :class="$style.hint">{{ i18n.ts.zalip._importer.noChanges }}</p>
							</details>
							<div :class="[$style.actions, $style.previewActions]"><button type="button" class="_button" :class="$style.primary" :disabled="busy || previewStale" @click="queueReferences([preview.record.ref], true)"><i class="ti ti-download" aria-hidden="true"></i>{{ preview.workId ? i18n.ts.zalip._importer.enqueueUpdate : i18n.ts.zalip._importer.enqueueDraft }}</button><span :class="$style.hint">{{ i18n.ts.zalip._importer.noPublishing }}</span></div>
						</template>
					</section>

					<details :class="[$style.panel, $style.details, $style.bulkPanel]">
						<summary><i class="ti ti-stack-2" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.bulkImport }} <span :class="$style.count">{{ batchReferenceCount }}</span></summary>
						<p :class="$style.hint">{{ i18n.ts.zalip._importer.byIdHint }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.bulkArtworkHint }}</p>
						<p v-if="lockedFields.length" :class="$style.hint">{{ i18n.ts.zalip._importer.protectionScope }}</p>
						<p v-if="preview || previewLoading" :class="$style.hint">{{ i18n.ts.zalip._importer.previewSubmitHint }}</p>
						<div v-else :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy || !batch.references.trim() || !sourceStatus(batch.source)?.configured" @click="queueBatch"><i class="ti ti-download" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.enqueue }}</button></div>
					</details>
					<details ref="workProtectionPanel" :class="[$style.panel, $style.details]">
						<summary>{{ i18n.ts.zalip._importer.persistedProtection }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.persistedProtectionHint }}</p>
						<form :class="$style.searchForm" @submit.prevent="loadWorkState"><label :class="$style.grow"><span>{{ i18n.ts.zalip._importer.workId }}</span><input v-model.trim="workStateId" required maxlength="32" pattern="[A-Za-z0-9]+" :disabled="busy || workStateLoading"></label><button type="submit" class="_button" :class="$style.button" :disabled="busy || workStateLoading || !workStateId">{{ i18n.ts.zalip._importer.loadWorkState }}</button></form>
						<p v-if="workStateLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><p v-if="workStateError" :class="$style.error" role="alert">{{ workStateError }}</p>
						<template v-if="workState">
							<h3 :class="$style.optionsHeading">{{ workState.title }}</h3><fieldset v-for="group in importerFieldGroups" :key="group.id" :class="[$style.locks, $style.lockGroup]"><legend>{{ importerGroupLabel(group.id) }}</legend><label v-for="field in group.fields" :key="field"><input v-model="persistedLocks" type="checkbox" :value="field" :disabled="busy || workStateLoading">{{ importerFieldLabel(field) }}<small v-if="workOrigin(field)"> · {{ workOrigin(field) }}</small><small v-if="workState.fields.find(item => item.field === field)?.editorial"> · {{ i18n.ts.zalip._importer.editorialProtection }}</small></label></fieldset><button type="button" class="_button" :class="$style.primary" :disabled="busy || workStateLoading || workState.workId !== workStateId" @click="saveWorkLocks">{{ i18n.ts.zalip._importer.saveLocks }}</button>
							<p :class="$style.hint">{{ i18n.ts.zalip._importer.repairCollapsVoicesHint }}</p>
							<p v-if="workState.locks.includes('players')" :class="$style.hint">{{ i18n.ts.zalip._importer.repairVoicesLocked }}</p>
							<p v-else-if="workLocksChanged" :class="$style.hint">{{ i18n.ts.zalip._importer.repairVoicesUnsavedLocks }}</p>
							<button type="button" class="_button" :class="$style.button" :disabled="busy || workStateLoading || !importerVoiceRepairReady(workState, workStateId, persistedLocks)" @click="repairCollapsVoices"><i class="ti ti-volume" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.repairCollapsVoices }}</button>
						</template>
					</details>
				</template>

				<template v-else-if="tab === 'runs'">
					<details :class="[$style.panel, $style.details]"><summary>{{ i18n.ts.zalip._importer.deliveryDiagnostics }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.deliveryDiagnosticsHint }}</p><button type="button" class="_button" :class="$style.button" :disabled="diagnosticsLoading" @click="loadDiagnostics">{{ i18n.ts.zalip._importer.refresh }}</button><p v-if="diagnosticsLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><p v-if="diagnosticsError" :class="$style.error" role="alert">{{ diagnosticsError }}</p><template v-if="diagnostics"><p>{{ i18n.tsx.zalip._importer.subscriptionsSummary({ total: String(diagnostics.subscriptions.total), works: String(diagnostics.subscriptions.works) }) }}</p><p>{{ i18n.tsx.zalip._importer.availabilitySummary({ total: String(diagnostics.availability.total), pending: String(diagnostics.availability.pendingPublished) }) }}<small v-if="diagnostics.availability.oldestPendingAt" :class="$style.hint"> · {{ i18n.tsx.zalip._importer.oldestPending({ date: dateLabel(diagnostics.availability.oldestPendingAt) }) }}</small></p><p>{{ i18n.tsx.zalip._importer.releasesSummary({ total: String(diagnostics.releases.total), pending: String(diagnostics.releases.pendingPublished) }) }}<small v-if="diagnostics.releases.oldestPendingAt" :class="$style.hint"> · {{ i18n.tsx.zalip._importer.oldestPending({ date: dateLabel(diagnostics.releases.oldestPendingAt) }) }}</small></p></template></details>
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.runsHeading }}</h2><p>{{ i18n.ts.zalip._importer.runsHint }}</p></div><button type="button" class="_button" :class="$style.button" :disabled="runsLoading" @click="loadRuns"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.refresh }}</button></div>
						<p v-if="runsError" :class="$style.error" role="alert">{{ runsError }}</p>
						<p v-if="runsLoading && !runs.length" :class="$style.hint">{{ i18n.ts.zalip._importer.runsLoading }}</p><p v-else-if="!runs.length && !runsError" :class="$style.hint">{{ i18n.ts.zalip._importer.noRuns }}</p>
						<div :class="$style.rows"><button v-for="run in runs" :key="run.id" type="button" class="_button" :class="[$style.runRow, { [$style.selectedRow]: selectedRun?.id === run.id }]" :disabled="busy" @click="loadRun(run.id)"><div><strong>{{ runModeLabel(run.mode) }} · {{ importerStateLabel(run.state) }}</strong><small>{{ dateLabel(run.createdAt) }} · {{ run.id }}</small></div><div><span>{{ run.completed }} / {{ run.total }}</span><small v-if="run.failed">{{ i18n.tsx.zalip._importer.failedCount({ count: String(run.failed) }) }}</small></div><progress :value="importerProgress(run.completed, run.total)" max="100" :aria-label="i18n.tsx.zalip._importer.runProgress({ id: run.id })"></progress></button></div>
					</section>
					<section v-if="selectedRun" :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ importerStateLabel(selectedRun.state) }}</h2><p>{{ selectedRun.id }}</p></div><div :class="$style.actions"><button v-if="['queued', 'running'].includes(selectedRun.state)" type="button" class="_button" :class="$style.button" :disabled="busy" @click="runAction('pause')"><i class="ti ti-player-pause" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.pause }}</button><button v-if="selectedRun.state === 'paused'" type="button" class="_button" :class="$style.button" :disabled="busy" @click="runAction('resume')"><i class="ti ti-player-play" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.resume }}</button><button v-if="selectedRun.failed > 0 || selectedRun.state === 'failed'" type="button" class="_button" :class="$style.button" :disabled="busy || selectedRun.state === 'running'" @click="runAction('retry')"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.retryFailed }}</button><button v-if="['queued', 'running', 'paused'].includes(selectedRun.state)" type="button" class="_button" :class="$style.danger" :disabled="busy" @click="runAction('cancel')">{{ i18n.ts.zalip._importer.cancel }}</button></div></div>
						<p v-if="selectedRun.error" :class="$style.error" role="alert">{{ selectedRun.error }}</p>
						<div :class="$style.rows"><article v-for="item in runItems" :key="item.id" :class="$style.itemRow"><div :class="$style.grow"><strong>{{ item.position + 1 }}. {{ importerSourceLabel(item.ref.source) }} · {{ item.ref.externalId }}</strong><small>{{ item.ref.mediaType }} · {{ importerStateLabel(item.state) }}</small><p v-if="item.error" :class="$style.error">{{ importerArtworkSelectionStale(item.error) ? i18n.ts.zalip._importer.artworkSelectionStale : item.error }}</p><button v-if="importerArtworkSelectionStale(item.error)" type="button" class="_textButton" :disabled="busy || previewLoading" @click="previewRunArtwork(item)">{{ i18n.ts.zalip._importer.refreshPreview }}</button><div v-if="runWarnings.get(item.id)?.length" :class="$style.itemWarnings"><p><i class="ti ti-alert-triangle" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.warningsTitle }}</p><ul :class="$style.warnings" :aria-label="i18n.ts.zalip._importer.warningsTitle"><li v-for="warning in runWarnings.get(item.id)" :key="warning">{{ warning }}</li></ul></div></div><div v-if="item.workId" :class="$style.itemActions"><button type="button" class="_textButton" :disabled="busy || workStateLoading" @click="showImportedWork(item.workId)">{{ i18n.tsx.zalip._importer.itemWorkId({ id: item.workId }) }}<i class="ti ti-arrow-up-right" aria-hidden="true"></i></button><MkA to="/zalip/editor" :class="$style.button">{{ i18n.ts.zalip._importer.editor }}</MkA></div></article></div>
					</section>
				</template>

				<template v-else-if="tab === 'taxonomy'">
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.taxonomyHeading }}</h2><p>{{ i18n.ts.zalip._importer.taxonomyHint }}</p></div><MkA to="/zalip/taxonomy" :class="$style.button"><i class="ti ti-external-link" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.publicPages }}</MkA></div>
						<form :class="$style.searchForm" @submit.prevent="loadTaxonomy"><label><span>{{ i18n.ts.zalip._importer.directory }}</span><select v-model="taxonomyType" :disabled="busy" @change="loadTaxonomy"><option v-for="type in taxonomyTypes" :key="type" :value="type">{{ taxonomyTypeLabel(type) }}</option></select></label><label :class="$style.grow"><span>{{ i18n.ts.zalip._importer.name }}</span><input v-model.trim="taxonomyQuery" type="search" maxlength="200" :placeholder="i18n.ts.zalip._importer.directorySearch" :disabled="busy"></label><button type="submit" class="_button" :class="$style.button" :disabled="taxonomyLoading">{{ i18n.ts.zalip._importer.find }}</button><button type="button" class="_button" :class="$style.primary" :disabled="busy" @click="resetTaxonomyForm"><i class="ti ti-plus" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.create }}</button></form>
						<p v-if="taxonomyError" :class="$style.error" role="alert">{{ taxonomyError }}</p><p v-if="taxonomyLoading" :class="$style.hint">{{ i18n.ts.zalip._importer.taxonomyLoading }}</p>
						<div v-else :class="$style.rows"><button v-for="entry in taxonomyEntries" :key="entry.id" type="button" class="_button" :class="$style.entityRow" :disabled="busy" @click="editTaxonomy(entry)"><div :class="$style.entityImage"><img v-if="importerImageUrl(entry.imageUrl)" :src="importerImageUrl(entry.imageUrl)!" alt="" loading="lazy"><i v-else :class="taxonomyIcon(entry.type)" aria-hidden="true"></i></div><div :class="$style.grow"><strong>{{ entry.name }}</strong><small>{{ entry.slug }} · {{ entry.id }}</small></div><i class="ti ti-pencil" aria-hidden="true"></i></button></div><p v-if="!taxonomyLoading && !taxonomyEntries.length && !taxonomyError" :class="$style.hint">{{ i18n.ts.zalip._importer.taxonomyEmpty }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.taxonomyLimit }}</p>
					</section>
					<section :class="$style.panel">
						<h2>{{ taxonomyForm.id ? i18n.ts.zalip._importer.editEntry : i18n.ts.zalip._importer.newEntry }}</h2>
						<form :class="$style.form" @submit.prevent="saveTaxonomy"><label><span>{{ i18n.ts.zalip._importer.type }}</span><select v-model="taxonomyForm.type" :disabled="busy || (!!taxonomyForm.id)"><option v-for="type in taxonomyTypes" :key="type" :value="type">{{ taxonomyTypeLabel(type) }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.name }}</span><input v-model.trim="taxonomyForm.name" required maxlength="256" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.slug }}</span><input v-model.trim="taxonomyForm.slug" maxlength="160" :placeholder="i18n.ts.zalip._importer.slugPlaceholder" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.imageUrl }}</span><input v-model.trim="taxonomyForm.imageUrl" type="url" maxlength="1024" :disabled="busy"></label><label v-if="taxonomyForm.type === 'category'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.parentCategory }}</span><select v-model="taxonomyForm.parentId" :disabled="busy"><option value="">{{ i18n.ts.zalip._importer.noParent }}</option><option v-for="entry in categories.filter(category => category.id !== taxonomyForm.id)" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></label><label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.description }}</span><textarea v-model="taxonomyForm.description" rows="4" maxlength="8192" :disabled="busy"></textarea></label><div :class="[$style.actions, $style.wide]"><button type="submit" class="_button" :class="$style.primary" :disabled="busy || !taxonomyForm.name"><i class="ti ti-device-floppy" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.save }}</button><MkA v-if="taxonomyForm.id && taxonomyForm.slug" :to="`/zalip/taxonomy/${taxonomyForm.type}/${taxonomyForm.slug}`" :class="$style.button">{{ i18n.ts.zalip._importer.publicPage }}</MkA></div></form>
						<details v-if="taxonomyForm.type === 'person'" :class="$style.fieldGroup" open><summary>{{ i18n.ts.zalip._importer.personFacts }}</summary><div :class="$style.form"><label v-for="key in personFactKeys" :key="key"><span>{{ taxonomyFactLabel(key) }}</span><input v-model.trim="personFacts[key]" :type="key === 'homepage' ? 'url' : 'text'" :maxlength="key === 'birthday' || key === 'deathday' ? 32 : key === 'homepage' ? 1024 : 256" :disabled="busy"></label><label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.aliases }}</span><textarea v-model="personFacts.aliases" rows="3" maxlength="7710" :placeholder="i18n.ts.zalip._importer.aliasesHint" :disabled="busy"></textarea></label><label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.biography }}</span><textarea v-model="personFacts.biography" rows="6" maxlength="16384" :disabled="busy"></textarea></label></div><div :class="$style.actions"><button type="button" class="_button" :class="$style.primary" :disabled="busy || !taxonomyForm.name" @click="saveTaxonomy">{{ i18n.ts.zalip._importer.save }}</button></div><template v-if="taxonomyForm.id"><p :class="$style.hint">{{ i18n.ts.zalip._importer.personEnrichmentHint }}</p><div :class="$style.actions"><button v-for="source in personSources" :key="source" type="button" class="_button" :class="$style.button" :disabled="busy || taxonomyDirty" @click="enrichPerson(source)"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.personEnrichment }} · {{ importerSourceLabel(source) }}</button></div></template></details>
						<details v-if="taxonomyForm.type === 'collection'" :class="$style.fieldGroup" open><summary>{{ i18n.ts.zalip._importer.collectionPresentation }}</summary><div :class="$style.form"><label><span>{{ i18n.ts.zalip._importer.collectionSemanticKind }}</span><select v-model="collectionForm.semanticKind" :disabled="busy"><option value="theme">{{ i18n.ts.zalip._importer.collectionTheme }}</option><option value="platform">{{ i18n.ts.zalip._importer.collectionPlatform }}</option><option value="franchise">{{ i18n.ts.zalip._importer.collectionFranchise }}</option></select></label><label :class="$style.check"><input v-model="collectionForm.isEnabled" type="checkbox" :disabled="busy">{{ i18n.ts.zalip._importer.collectionPublicEnabled }}</label></div><p :class="$style.hint">{{ i18n.ts.zalip._importer.collectionPresentationHint }}</p><button type="button" class="_button" :class="$style.primary" :disabled="busy || !taxonomyForm.name" @click="saveTaxonomy">{{ i18n.ts.zalip._importer.save }}</button></details>
						<div v-if="taxonomyForm.type === 'collection' && collectionCollapsId" :class="$style.actions"><span :class="$style.hint">{{ i18n.tsx.zalip._importer.collectionSourceId({ id: collectionCollapsId }) }}</span><button type="button" class="_button" :class="$style.button" :disabled="busy || taxonomyDirty || !collectionForm.isEnabled || !sourceStatus('collaps')?.configured" @click="prepareCollectionBackfill"><i class="ti ti-link" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.prepareCollectionBackfill }}</button></div>
						<fieldset v-if="taxonomyForm.type === 'category'" :class="$style.categoryRules">
							<legend>{{ i18n.ts.zalip._importer.categoryRules }}</legend>
							<label :class="$style.check"><input v-model="categoryRules.enabled" type="checkbox" :disabled="busy">{{ i18n.ts.zalip._importer.enableCategoryRules }}</label>
							<div v-if="categoryRules.enabled" :class="$style.form">
								<fieldset :class="[$style.locks, $style.wide]"><legend>{{ i18n.ts.zalip._importer.workType }}</legend><label v-for="kind in workKinds" :key="kind.value"><input v-model="categoryRules.kinds" type="checkbox" :value="kind.value" :disabled="busy">{{ kind.title }}</label></fieldset>
								<label><span>{{ i18n.ts.zalip._importer.ruleGenres }}</span><input v-model.trim="categoryRules.genres" maxlength="1024" :placeholder="i18n.ts.zalip._importer.ruleGenresPlaceholder" :disabled="busy"></label>
								<label><span>{{ i18n.ts.zalip._importer.ruleCountries }}</span><input v-model.trim="categoryRules.countries" maxlength="1024" :placeholder="i18n.ts.zalip._importer.ruleCountriesPlaceholder" :disabled="busy"></label>
								<label><span>{{ i18n.ts.zalip._importer.yearFrom }}</span><input v-model="categoryRules.yearFrom" type="number" min="1888" max="3000" :disabled="busy"></label>
								<label><span>{{ i18n.ts.zalip._importer.yearTo }}</span><input v-model="categoryRules.yearTo" type="number" min="1888" max="3000" :disabled="busy"></label>
								<label :class="[$style.check, $style.wide]"><input v-model="categoryRules.all" type="checkbox" :disabled="busy">{{ i18n.ts.zalip._importer.ruleAll }}</label>
								<p :class="[$style.hint, $style.wide]">{{ i18n.ts.zalip._importer.rulesHint }}</p>
							</div>
							<button type="button" class="_button" :class="$style.button" :disabled="busy || !taxonomyForm.name" @click="saveTaxonomy">{{ i18n.ts.zalip._importer.saveRules }}</button>
						</fieldset>
						<details v-if="taxonomyForm.id && taxonomyForm.type === 'category'" :class="$style.fieldGroup"><summary>{{ i18n.ts.zalip._importer.recalculate }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.recalculateHint }}</p><div :class="$style.form"><label><span>{{ i18n.ts.zalip._importer.task }}</span><select v-model="recalculateForm.mode" :disabled="busy" @change="resetRecalculate"><option value="selected">{{ i18n.ts.zalip._importer.recalculateSelected }}</option><option value="catalogue">{{ i18n.ts.zalip._importer.recalculateCatalogue }}</option></select></label><label v-if="recalculateForm.mode === 'selected'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.recalculateWorkIds }}</span><textarea v-model="recalculateForm.workIds" rows="3" maxlength="3300" :disabled="busy"></textarea></label></div><div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy || taxonomyDirty" @click="recalculateCategory(false)">{{ i18n.ts.zalip._importer.recalculate }}</button><button v-if="recalculateForm.mode === 'catalogue' && recalculateCursor" type="button" class="_button" :class="$style.button" :disabled="busy || taxonomyDirty" @click="recalculateCategory(true)">{{ i18n.ts.zalip._importer.recalculateContinue }}</button></div><p v-if="recalculateResult" :class="$style.hint" role="status">{{ i18n.tsx.zalip._importer.recalculateResult({ processed: String(recalculateResult.processed), matched: String(recalculateResult.matched), skipped: String(recalculateResult.skipped) }) }}<span v-if="recalculateForm.mode === 'catalogue' && !recalculateCursor"> · {{ i18n.ts.zalip._importer.recalculateDone }}</span></p></details>
						<template v-if="taxonomyForm.id"><h3>{{ i18n.ts.zalip._importer.linkedWorks }}</h3><form :class="$style.form" @submit.prevent="linkTaxonomy"><label><span>{{ i18n.ts.zalip._importer.workId }}</span><input v-model.trim="membership.workId" required maxlength="32" :placeholder="i18n.ts.zalip._importer.workIdPlaceholder" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.role }}</span><input v-model.trim="membership.role" maxlength="64" :placeholder="i18n.ts.zalip._importer.rolePlaceholder" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.character }}</span><input v-model.trim="membership.character" maxlength="256" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.position }}</span><input v-model.number="membership.position" type="number" min="0" max="100000" :disabled="busy"></label><button type="submit" class="_button" :class="$style.button" :disabled="busy || taxonomyWorksLoading"><i class="ti ti-link" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.linkWork }}</button></form><p v-if="taxonomyWorksLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><div :class="$style.rows"><article v-for="work in taxonomyWorks" :key="`${work.id}:${work.role ?? ''}`" :class="$style.itemRow"><div><strong>{{ work.title }}</strong><small>{{ [work.releaseYear, work.role, work.character].filter(Boolean).join(' · ') }}</small></div><button type="button" class="_button" :class="$style.danger" :disabled="busy || taxonomyWorksLoading" :aria-label="i18n.tsx.zalip._importer.unlinkWork({ name: work.title })" @click="unlinkTaxonomy(work)"><i class="ti ti-unlink" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.unlink }}</button></article></div></template>
						<p v-if="taxonomyForm.id && taxonomyWorksError" :class="$style.error" role="alert">{{ taxonomyWorksError }} <button type="button" class="_textButton" :disabled="busy || taxonomyWorksLoading" @click="loadTaxonomyWorks(taxonomyForm.id, taxonomyWorksRetryAppend)">{{ i18n.ts.zalip._importer.retry }}</button></p><button v-if="taxonomyForm.id && taxonomyWorksCursor" type="button" class="_button" :class="$style.button" :disabled="busy || taxonomyWorksLoading" @click="loadTaxonomyWorks(taxonomyForm.id, true)">{{ i18n.ts.zalip._importer.showMore }}</button>
					</section>
				</template>

				<template v-else-if="tab === 'schedules'">
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.schedulesHeading }}</h2><p>{{ i18n.ts.zalip._importer.schedulesHint }}</p></div><button type="button" class="_button" :class="$style.primary" :disabled="busy" @click="resetProfile()"><i class="ti ti-plus" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.newSchedule }}</button></div>
						<p v-if="profilesError" :class="$style.error" role="alert">{{ profilesError }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.activeProfileHint }}</p>
						<div :class="$style.rows"><article v-for="profile in profiles" :key="profile.id" :class="$style.itemRow"><div :class="$style.grow"><strong>{{ profile.name }}</strong><small>{{ importerSourceLabel(profile.source) }} · {{ profileModeLabel(profile.mode) }} · {{ profile.enabled ? i18n.ts.zalip._importer.enabled : i18n.ts.zalip._importer.disabled }} · {{ i18n.tsx.zalip._importer.intervalSummary({ count: String(profile.intervalMinutes) }) }}</small><small>{{ i18n.tsx.zalip._importer.scheduleDates({ last: dateLabel(profile.lastRunAt), next: dateLabel(profile.nextRunAt) }) }}</small><p v-if="profile.lastError" :class="$style.error">{{ profile.lastError }}</p></div><div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy" @click="editProfile(profile)">{{ i18n.ts.zalip._importer.edit }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy || profileActive(profile.id)" @click="runProfile(profile)"><i class="ti ti-player-play" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.run }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy" @click="profileAction(profile, profile.enabled ? 'disable' : 'enable')">{{ profile.enabled ? i18n.ts.zalip._importer.disableProfile : i18n.ts.zalip._importer.enableProfile }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy || profileActive(profile.id)" @click="profileAction(profile, 'reset-cursor')">{{ i18n.ts.zalip._importer.resetCursor }}</button><button type="button" class="_button" :class="$style.danger" :disabled="busy || profileActive(profile.id)" @click="profileAction(profile, 'delete')"><i class="ti ti-trash" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.deleteSchedule }}</button></div></article></div><p v-if="!profiles.length && !profilesError" :class="$style.hint">{{ i18n.ts.zalip._importer.noSchedules }}</p>
					</section>
					<section :class="$style.panel">
						<h2>{{ profileForm.id ? i18n.ts.zalip._importer.editSchedule : i18n.ts.zalip._importer.newSchedule }}</h2>
						<form :class="$style.form" @submit.prevent="saveProfile"><label><span>{{ i18n.ts.zalip._importer.name }}</span><input v-model.trim="profileForm.name" required maxlength="120" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="profileForm.source" :disabled="busy || profileOptionsLocked"><option v-for="source in importerSources" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.task }}</span><select v-model="profileForm.mode" :disabled="busy || profileOptionsLocked"><option value="metadata">{{ i18n.ts.zalip._importer.metadataMode }}</option><option value="availability">{{ i18n.ts.zalip._importer.availabilityMode }}</option><option value="collection">{{ i18n.ts.zalip._importer.collectionMode }}</option><option value="discovery" :disabled="profileForm.source !== 'collaps' || !sourceStatus('collaps')?.capabilities.updates">{{ i18n.ts.zalip._importer.discoveryMode }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.interval }}</span><input v-model.number="profileForm.intervalMinutes" type="number" required min="15" max="43200" :disabled="busy"></label><label v-if="profileForm.mode === 'collection'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.collectionId }}</span><input v-model.trim="profileForm.collectionId" required maxlength="100" pattern="[A-Za-z0-9_-]+" :disabled="busy || profileOptionsLocked"></label><label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.categories }}</span><select v-model="profileForm.categoryIds" multiple size="3" :disabled="busy"><option v-for="entry in categories" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></label><details :class="[$style.fieldGroup, $style.wide]"><summary>{{ i18n.ts.zalip._importer.lockedFields }}</summary><fieldset v-for="group in importerFieldGroups" :key="group.id" :class="[$style.locks, $style.lockGroup]"><legend>{{ importerGroupLabel(group.id) }}</legend><label v-for="field in group.fields" :key="field"><input v-model="profileForm.lockedFields" type="checkbox" :value="field" :disabled="busy">{{ importerFieldLabel(field) }}</label></fieldset></details><label :class="[$style.check, $style.wide]"><input v-model="profileForm.enabled" type="checkbox" :disabled="busy">{{ i18n.ts.zalip._importer.enableSchedule }}</label><p v-if="profileCapabilityWarning" :class="[$style.hint, $style.wide]">{{ profileCapabilityWarning }}</p><button type="submit" class="_button" :class="$style.primary" :disabled="busy || !profileForm.name || !!profileCapabilityWarning"><i class="ti ti-device-floppy" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.saveSchedule }}</button></form>
					</section>
				</template>

				<template v-else-if="tab === 'maintenance'">
					<details :class="[$style.panel, $style.details]" open>
						<summary>{{ i18n.ts.zalip._importer.playbackSettings }}</summary>
						<p :class="$style.hint">{{ i18n.ts.zalip._importer.playbackSettingsHint }}</p>
						<p v-if="playbackSettingsLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p>
						<p v-if="playbackSettingsError" :class="$style.error" role="alert">{{ playbackSettingsError }} <button type="button" class="_textButton" :disabled="playbackSettingsLoading || busy" @click="loadPlaybackSettings">{{ i18n.ts.zalip._importer.retry }}</button></p>
						<form v-if="playbackProviders.length" @submit.prevent="savePlaybackSettings">
							<div v-for="(provider, index) in playbackProviders" :key="provider.source" :class="$style.playerSettingsRow">
								<label :class="$style.grow"><span>{{ importerSourceLabel(provider.source) }} · {{ i18n.ts.zalip._importer.playerLabel }}</span><input v-model="provider.label" required maxlength="40" :disabled="busy || playbackSettingsLoading"></label>
								<label :class="$style.check"><input v-model="provider.enabled" type="checkbox" :disabled="busy || playbackSettingsLoading">{{ i18n.ts.zalip._importer.enabled }}</label>
								<div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy || playbackSettingsLoading || index === 0" :aria-label="i18n.tsx.zalip._importer.movePlayerUp({ name: provider.label })" @click="movePlayer(index, -1)"><i class="ti ti-arrow-up" aria-hidden="true"></i></button><button type="button" class="_button" :class="$style.button" :disabled="busy || playbackSettingsLoading || index === playbackProviders.length - 1" :aria-label="i18n.tsx.zalip._importer.movePlayerDown({ name: provider.label })" @click="movePlayer(index, 1)"><i class="ti ti-arrow-down" aria-hidden="true"></i></button></div>
							</div>
							<button type="submit" class="_button" :class="$style.primary" :disabled="busy || playbackSettingsLoading || !importerPlaybackSettings(playbackProviders)">{{ i18n.ts.zalip._importer.save }}</button>
						</form>
					</details>
					<section :class="$style.panel">
						<h2>{{ i18n.ts.zalip._importer.maintenanceHeading }}</h2><p :class="$style.hint">{{ i18n.ts.zalip._importer.maintenanceHint }}</p>
						<form :class="$style.form" @submit.prevent="createMaintenance">
							<label><span>{{ i18n.ts.zalip._importer.task }}</span><select v-model="maintenanceForm.kind" :disabled="busy"><option v-for="kind in maintenanceKinds" :key="kind" :value="kind">{{ importerMaintenanceLabel(kind) }}</option></select></label>
							<label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="maintenanceForm.source" :disabled="busy"><option v-for="source in maintenanceSources(maintenanceForm.kind)" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label>
							<label v-if="maintenanceForm.kind === 'collection-backfill'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.maintenanceCollectionIds }}</span><textarea v-model="maintenanceForm.collectionIds" rows="3" maxlength="1700" :disabled="busy"></textarea></label>
							<p :class="[$style.hint, $style.wide]">{{ maintenanceHint(maintenanceForm.kind) }}</p>
							<label><span>{{ i18n.ts.zalip._importer.maintenanceBatch }}</span><input v-model.number="maintenanceForm.batchLimit" type="number" required min="20" max="50" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.maintenanceBudget }}</span><input v-model.number="maintenanceForm.timeBudgetSeconds" type="number" required min="10" max="120" :disabled="busy"></label>
							<p v-if="!sourceStatus(maintenanceForm.source)?.configured" :class="[$style.hint, $style.wide]">{{ i18n.ts.zalip._importer.sourceNotConfigured }}</p>
							<button type="submit" class="_button" :class="$style.primary" :disabled="busy || !sourceStatus(maintenanceForm.source)?.configured || !importerMaintenanceRequest(maintenanceForm)"><i class="ti ti-player-play" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.maintenanceStart }}</button>
						</form>
					</section>
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><h2>{{ i18n.ts.zalip._importer.maintenanceRuns }}</h2><button type="button" class="_button" :class="$style.button" :disabled="maintenanceLoading" @click="refreshMaintenance">{{ i18n.ts.zalip._importer.refresh }}</button></div>
						<p v-if="maintenanceError" :class="$style.error" role="alert">{{ maintenanceError }}</p><p v-if="maintenanceLoading && !maintenanceRuns.length" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><p v-if="!maintenanceLoading && !maintenanceRuns.length && !maintenanceError" :class="$style.hint">{{ i18n.ts.zalip._importer.noRuns }}</p>
						<div :class="$style.rows"><button v-for="run in maintenanceRuns" :key="run.id" type="button" class="_button" :class="[$style.runRow, { [$style.selectedRow]: selectedMaintenance?.id === run.id }]" :disabled="busy" @click="loadMaintenanceRun(run.id)"><div><strong>{{ importerMaintenanceLabel(run.kind) }} · {{ importerStateLabel(run.state) }}</strong><small>{{ importerSourceLabel(run.source) }} · {{ dateLabel(run.createdAt) }}</small></div><span>{{ i18n.tsx.zalip._importer.maintenanceProcessed({ count: String(run.stats.processed) }) }}</span></button></div>
						<p v-if="maintenanceRunLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><p v-if="maintenanceRunError" :class="$style.error" role="alert">{{ maintenanceRunError }} <button type="button" class="_textButton" :disabled="maintenanceRunLoading" @click="retryMaintenanceRun">{{ i18n.ts.zalip._importer.retry }}</button></p>
						<article v-if="selectedMaintenance" :class="$style.fieldGroup">
							<div :class="$style.sectionHeading"><div><h3>{{ importerMaintenanceLabel(selectedMaintenance.kind) }} · {{ importerStateLabel(selectedMaintenance.state) }}</h3><small>{{ selectedMaintenance.id }}</small></div><div :class="$style.actions"><button v-if="['paused', 'failed'].includes(selectedMaintenance.state)" type="button" class="_button" :class="$style.button" :disabled="busy || maintenanceRunLoading" @click="maintenanceAction('resume')">{{ i18n.ts.zalip._importer.resume }}</button><button v-if="['queued', 'running', 'paused'].includes(selectedMaintenance.state)" type="button" class="_button" :class="$style.danger" :disabled="busy || maintenanceRunLoading" @click="maintenanceAction('cancel')">{{ i18n.ts.zalip._importer.cancel }}</button></div></div>
							<p :class="$style.hint" role="status">{{ i18n.tsx.zalip._importer.maintenanceStats({ processed: String(selectedMaintenance.stats.processed), created: String(selectedMaintenance.stats.created), updated: String(selectedMaintenance.stats.updated), linked: String(selectedMaintenance.stats.linked), skipped: String(selectedMaintenance.stats.skipped), failed: String(selectedMaintenance.stats.failed) }) }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.maintenanceProgressHint }}</p>
							<p v-if="selectedMaintenance.retryAfter" :class="$style.hint">{{ i18n.tsx.zalip._importer.maintenanceRetryAfter({ date: dateLabel(selectedMaintenance.retryAfter) }) }}</p><p v-if="selectedMaintenance.error" :class="$style.error">{{ safeMaintenanceError(selectedMaintenance.error) }}</p>
							<ul v-if="maintenanceWarnings.length" :class="$style.warnings" :aria-label="i18n.ts.zalip._importer.warningsTitle"><li v-for="warning in maintenanceWarnings" :key="warning">{{ warning }}</li></ul>
						</article>
					</section>
					<details :class="[$style.panel, $style.details]">
						<summary>{{ i18n.ts.zalip._importer.maintenanceSchedules }}</summary><p :class="$style.hint">{{ i18n.ts.zalip._importer.maintenanceSchedulesHint }}</p>
						<div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy || maintenanceProfilesLoading" @click="loadMaintenanceProfiles">{{ i18n.ts.zalip._importer.refresh }}</button><button type="button" class="_button" :class="$style.primary" :disabled="busy" @click="resetMaintenanceProfile">{{ i18n.ts.zalip._importer.newSchedule }}</button></div>
						<p v-if="maintenanceProfilesError" :class="$style.error" role="alert">{{ maintenanceProfilesError }}</p><p v-if="maintenanceProfilesLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p>
						<div :class="$style.rows"><article v-for="profile in maintenanceProfiles" :key="profile.id" :class="$style.itemRow"><div :class="$style.grow"><strong>{{ profile.name }}</strong><small>{{ importerMaintenanceLabel(profile.kind) }} · {{ importerSourceLabel(profile.source) }} · {{ profile.enabled ? i18n.ts.zalip._importer.enabled : i18n.ts.zalip._importer.disabled }}</small><small>{{ i18n.tsx.zalip._importer.scheduleDates({ last: dateLabel(profile.lastRunAt), next: dateLabel(profile.nextRunAt) }) }}</small><p v-if="profile.lastError" :class="$style.error">{{ safeMaintenanceError(profile.lastError) }}</p></div><div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy" @click="editMaintenanceProfile(profile)">{{ i18n.ts.zalip._importer.edit }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy || (!profile.enabled && !sourceStatus(profile.source)?.configured)" @click="maintenanceProfileAction(profile, profile.enabled ? 'disable' : 'enable')">{{ profile.enabled ? i18n.ts.zalip._importer.disableProfile : i18n.ts.zalip._importer.enableProfile }}</button></div></article></div>
						<form :class="$style.form" @submit.prevent="saveMaintenanceProfile">
							<label><span>{{ i18n.ts.zalip._importer.name }}</span><input v-model.trim="maintenanceProfileForm.name" required maxlength="120" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.task }}</span><select v-model="maintenanceProfileForm.kind" :disabled="busy || maintenanceProfileLocked"><option v-for="kind in maintenanceKinds" :key="kind" :value="kind">{{ importerMaintenanceLabel(kind) }}</option></select></label>
							<label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="maintenanceProfileForm.source" :disabled="busy || maintenanceProfileLocked"><option v-for="source in maintenanceSources(maintenanceProfileForm.kind)" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.interval }}</span><input v-model.number="maintenanceProfileForm.intervalMinutes" type="number" required min="60" max="10080" :disabled="busy"></label>
							<label v-if="maintenanceProfileForm.kind === 'collection-backfill'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.maintenanceCollectionIds }}</span><textarea v-model="maintenanceProfileForm.collectionIds" rows="3" maxlength="1700" :disabled="busy || maintenanceProfileLocked"></textarea></label>
							<label><span>{{ i18n.ts.zalip._importer.maintenanceBatch }}</span><input v-model.number="maintenanceProfileForm.batchLimit" type="number" required min="20" max="50" :disabled="busy || maintenanceProfileLocked"></label><label><span>{{ i18n.ts.zalip._importer.maintenanceBudget }}</span><input v-model.number="maintenanceProfileForm.timeBudgetSeconds" type="number" required min="10" max="120" :disabled="busy || maintenanceProfileLocked"></label>
							<p :class="[$style.hint, $style.wide]">{{ maintenanceHint(maintenanceProfileForm.kind) }}</p><p v-if="maintenanceProfileLocked" :class="[$style.hint, $style.wide]">{{ i18n.ts.zalip._importer.activeProfileHint }}</p>
							<button type="submit" class="_button" :class="$style.primary" :disabled="busy || !maintenanceProfileForm.name || !sourceStatus(maintenanceProfileForm.source)?.configured || !importerMaintenanceRequest(maintenanceProfileForm)">{{ i18n.ts.zalip._importer.saveSchedule }}</button>
						</form>
					</details>
				</template>
				<template v-else-if="tab === 'sources'">
					<section :class="$style.panel">
						<h2>{{ i18n.ts.zalip._importer.serviceSettings }}</h2><p :class="$style.hint">{{ i18n.ts.zalip._importer.serviceSettingsHint }}</p><p :class="$style.hint">{{ i18n.ts.zalip._importer.sourceOriginHint }}</p>
						<p v-if="serviceSettingsLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><p v-if="serviceSettingsError" :class="$style.error" role="alert">{{ serviceSettingsError }} <button type="button" class="_textButton" :disabled="serviceSettingsLoading" @click="loadServiceSettings">{{ i18n.ts.zalip._importer.retry }}</button></p>
						<template v-if="serviceSettings">
							<p v-if="!serviceSettings.encryptionReady" :class="$style.error" role="alert">{{ i18n.ts.zalip._importer.sourceSettingsEncryptionUnavailable }}</p>
							<details v-for="entry in serviceSettings.sources" :key="entry.source" :class="$style.fieldGroup">
								<summary>{{ importerSourceLabel(entry.source) }} · {{ entry.apiTokenSet ? i18n.ts.zalip._importer.configured : i18n.ts.zalip._importer.notConfigured }}</summary>
								<form :class="$style.form" autocomplete="off" @submit.prevent="saveServiceSettings(entry.source)">
									<label><span>{{ i18n.ts.zalip._importer.sourceApiOrigin }}</span><input v-model="serviceForms[entry.source].apiOrigin" type="url" required maxlength="1024" :disabled="busy || serviceSettingsLoading" :readonly="!serviceSettings.encryptionReady"></label>
									<label v-if="entry.source === 'alloha' || entry.source === 'collaps' || entry.source === 'kodik'"><span>{{ i18n.ts.zalip._importer.sourcePlayerOrigin }}</span><input v-model="serviceForms[entry.source].playerOrigin" type="url" :required="entry.source !== 'kodik'" maxlength="1024" :disabled="busy || serviceSettingsLoading" :readonly="!serviceSettings.encryptionReady"><small v-if="entry.source === 'kodik'">{{ i18n.ts.zalip._importer.kodikPlayerOriginHint }}</small></label>
									<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.sourceApiToken }}</span><input v-model="serviceForms[entry.source].apiToken" type="text" maxlength="4096" autocomplete="off" autocapitalize="off" :spellcheck="false" :disabled="busy || serviceSettingsLoading || serviceForms[entry.source].clearApiToken" :readonly="!serviceSettings.encryptionReady"><small>{{ i18n.tsx.zalip._importer.credentialOrigin({ origin: importerCredentialOriginLabel(entry.apiTokenOrigin) }) }}</small></label>
									<label :class="[$style.check, $style.wide]"><input v-model="serviceForms[entry.source].clearApiToken" type="checkbox" :disabled="busy || serviceSettingsLoading || !serviceSettings.encryptionReady" @change="clearServiceToken(entry.source, 'api')">{{ i18n.ts.zalip._importer.clearSourceApiToken }}</label>
									<template v-if="entry.source === 'alloha'">
										<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.sourcePlayerToken }}</span><input v-model="serviceForms[entry.source].playerToken" type="text" maxlength="512" autocomplete="off" autocapitalize="off" :spellcheck="false" :disabled="busy || serviceSettingsLoading || serviceForms[entry.source].clearPlayerToken" :readonly="!serviceSettings.encryptionReady"><small>{{ i18n.tsx.zalip._importer.credentialOrigin({ origin: importerCredentialOriginLabel(entry.playerTokenOrigin) }) }}</small></label>
										<label :class="[$style.check, $style.wide]"><input v-model="serviceForms[entry.source].clearPlayerToken" type="checkbox" :disabled="busy || serviceSettingsLoading || !serviceSettings.encryptionReady" @change="clearServiceToken(entry.source, 'player')">{{ i18n.ts.zalip._importer.clearSourcePlayerToken }}</label><p :class="[$style.hint, $style.wide]">{{ i18n.ts.zalip._importer.sourcePlayerTokenHint }}</p>
									</template>
									<p v-if="serviceSaveErrors[entry.source]" :class="[$style.error, $style.wide]" role="alert">{{ serviceSaveErrors[entry.source] }}</p>
									<div :class="[$style.actions, $style.wide]"><button type="submit" class="_button" :class="$style.primary" :disabled="busy || serviceSettingsLoading || !serviceSettings.encryptionReady"><i class="ti ti-device-floppy" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.save }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy || serviceSettingsLoading" @click="resetServiceForm(entry.source)">{{ i18n.ts.zalip._importer.resetSourceChanges }}</button></div>
								</form>
							</details>
						</template>
					</section>
				</template>
				<details :class="[$style.panel, $style.details, $style.sourceDetails]">
					<summary><i class="ti ti-plug-connected" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.sources }}</summary>
					<section :class="$style.sources" :aria-label="i18n.ts.zalip._importer.sources">
						<article v-for="source in importerSources" :key="source" :class="$style.source">
							<strong>{{ importerSourceLabel(source) }}</strong><span :class="{ [$style.connected]: sourceStatus(source)?.configured }">{{ sourcesLoading ? i18n.ts.zalip._importer.checkingSettings : sourcesError ? i18n.ts.zalip._importer.configurationUnknown : sourceStatus(source)?.configured ? i18n.ts.zalip._importer.configured : i18n.ts.zalip._importer.notConfigured }}</span>
							<small v-if="sourceStatus(source)?.dailyLimit">{{ i18n.tsx.zalip._importer.dailyLimit({ count: String(sourceStatus(source)?.dailyLimit) }) }}</small>
							<button type="button" class="_button" :class="$style.button" :disabled="busy || sourceChecking[source] || !sourceStatus(source)?.configured" @click="checkSource(source)"><i :class="sourceChecking[source] ? 'ti ti-loader-2 ti-spin' : 'ti ti-plug-connected'" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.checkSource }}</button>
							<template v-if="sourceChecks[source]"><small :class="{ [$style.error]: !sourceChecks[source]!.ok }" role="status">{{ sourceChecks[source]!.ok ? i18n.ts.zalip._importer.sourceHealthy : i18n.ts.zalip._importer.sourceCheckFailed }}</small><small>{{ i18n.tsx.zalip._importer.sourceChecked({ date: dateLabel(sourceChecks[source]!.checkedAt), latency: String(sourceChecks[source]!.latencyMs) }) }}<span v-if="sourceChecks[source]!.cached"> · {{ i18n.ts.zalip._importer.cachedCheck }}</span></small></template>
							<small v-if="sourceCheckErrors[source]" :class="$style.error" role="alert">{{ sourceCheckErrors[source] }}</small>
						</article>
					</section>
					<p :class="$style.hint">{{ i18n.ts.zalip._importer.configurationHint }}</p>
				</details>
			</template>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import type { ImportArtworkChoices, ImportField, ImportMaintenanceKind, ImportMaintenanceProfile, ImportMaintenanceRun, ImportMaintenanceSource, ImportMediaType, ImportPlaybackProvider, ImportPreview, ImportProfile, ImportRef, ImportRun, ImportRunItem, ImportSearchItem, ImportServiceForm, ImportServiceSave, ImportServiceSettingsResponse, ImportSource, ImportSourceCheck, ImportSourceStatus, ImportVoiceRepair, ImportWorkState, TaxonomyEntry, TaxonomyType, TaxonomyWork } from '@/utility/zalip-importer.js';
import ImporterArtworkSettings from '@/pages/zalip/importer-artwork-settings.vue';
import ImporterArtworkPicker from '@/pages/zalip/importer-artwork-picker.vue';
import { importerArtworkCurrentChoices, importerArtworkFieldLocked, importerArtworkFields, importerArtworkLimitChoices, importerArtworkOptions, importerArtworkPreview, importerArtworkSameRef, importerArtworkSelectionStale } from '@/utility/zalip-importer-artwork.js';
import { i18n } from '@/i18n.js';
import { formatImporterValue, importerCredentialOriginLabel, importerFieldGroups, importerFieldLabel, importerFields, importerFiltersValid, importerGroupLabel, importerImageUrl, importerImdbId, importerMaintenanceLabel, importerMaintenanceRequest, importerOptions, importerPlaybackSettings, importerProgress, importerReference, importerReferenceKey, importerRefreshSequence, importerRequestCurrent, importerRequestFinish, importerRequestInvalidate, importerRequestStart, importerRequestState, importerSelection, importerServiceForm, importerServiceRequest, importerServiceSettingsUpdate, importerSourceLabel, importerSources, importerStateLabel, importerWarningLabels, importerWorkIds, splitImporterReferenceLines, taxonomyAppendWorks, taxonomyBaseChanges, taxonomyCollectionChanges, taxonomyFactLabel, taxonomyPersonChanges, taxonomyTypeLabel, taxonomyTypes } from '@/utility/zalip-importer.js';
import { iAmAdmin } from '@/i.js';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import * as os from '@/os.js';
import { importerVoiceRepairReady } from '@/utility/zalip-importer.js';

type Tab = 'import' | 'runs' | 'taxonomy' | 'schedules' | 'maintenance' | 'sources';
const props = withDefaults(defineProps<{ source?: string; mediaType?: string; externalId?: string; imagesOnly?: string; workId?: string }>(), { source: '', mediaType: '', externalId: '', imagesOnly: '', workId: '' });
const tabs: { id: Tab; title: string; icon: string }[] = [{ id: 'import', title: i18n.ts.zalip._importer.import, icon: 'ti ti-download' }, { id: 'runs', title: i18n.ts.zalip._importer.runs, icon: 'ti ti-list-check' }, { id: 'taxonomy', title: i18n.ts.zalip._importer.directories, icon: 'ti ti-tags' }, { id: 'schedules', title: i18n.ts.zalip._importer.schedules, icon: 'ti ti-clock' }, { id: 'maintenance', title: i18n.ts.zalip._importer.maintenance, icon: 'ti ti-tool' }, { id: 'sources', title: i18n.ts.zalip._importer.serviceSettings, icon: 'ti ti-key' }];
const tab = ref<Tab>('import');
const sources = ref<ImportSourceStatus[]>([]);
const sourcesLoading = ref(true);
const sourcesError = ref('');
const sourceChecks = reactive<Partial<Record<ImportSource, ImportSourceCheck>>>({});
const sourceChecking = reactive<Partial<Record<ImportSource, boolean>>>({});
const sourceCheckErrors = reactive<Partial<Record<ImportSource, string>>>({});
const sourceCheckRevision = reactive<Partial<Record<ImportSource, number>>>({});
const serviceSettings = ref<ImportServiceSettingsResponse | null>(null);
const serviceSettingsLoading = ref(false);
const serviceSettingsError = ref('');
const serviceSaveErrors = reactive<Partial<Record<ImportSource, string>>>({});
const serviceForms = reactive(Object.fromEntries(importerSources.map(source => [source, { apiOrigin: '', playerOrigin: '', apiToken: '', playerToken: '', clearApiToken: false, clearPlayerToken: false }])) as Record<ImportSource, ImportServiceForm>);
const busy = ref(false);
const message = ref('');
const actionError = ref('');
const searchForm = reactive({ source: 'tmdb' as ImportSource, mediaType: 'movie' as ImportMediaType, query: '' });
const searchItems = ref<ImportSearchItem[]>([]);
const searchPage = ref(1);
const searchHasMore = ref(false);
const searching = ref(false);
const searched = ref(false);
const searchError = ref('');
const selectedRefs = ref<ImportRef[]>([]);
const batch = reactive({ source: 'tmdb' as ImportSource, mediaType: 'movie' as ImportMediaType, references: '' });
const categoryIds = ref<string[]>([]);
const batchReferenceCount = computed(() => splitImporterReferenceLines(batch.references).length);
const lockedFields = ref<string[]>([]);
const importSelection = reactive(importerSelection({ artwork: 'local' }));
const artworkGalleryLimit = computed(() => importSelection.artwork === 'local' ? importSelection.artworkSettings.galleryLimit : 18);
const profileSelection = reactive(importerSelection());
const workStateId = ref('');
const workState = ref<ImportWorkState | null>(null);
const persistedLocks = ref<string[]>([]);
const workStateLoading = ref(false);
const workStateError = ref('');
const workLocksChanged = computed(() => !!workState.value && (new Set(persistedLocks.value).size !== workState.value.locks.length || workState.value.locks.some(field => !persistedLocks.value.includes(field))));
const previewBase = ref<ImportPreview | null>(null);
const artworkChoices = ref<ImportArtworkChoices>({});
const preview = computed(() => previewBase.value ? importerArtworkPreview(previewBase.value, artworkChoices.value, lockedFields.value, artworkGalleryLimit.value) : null);
const previewLoading = ref(false);
const previewError = ref('');
const previewOptionsKey = ref('');
const previewPanel = useTemplateRef('previewPanel');
const importOptionsPanel = useTemplateRef('importOptionsPanel');
const workProtectionPanel = useTemplateRef('workProtectionPanel');
const runs = ref<ImportRun[]>([]);
const runsLoading = ref(false);
const runsError = ref('');
const selectedRun = ref<ImportRun | null>(null);
const requestedRunId = ref<string | null>(null);
const runLoading = ref(false);
const runItems = ref<ImportRunItem[]>([]);
type DeliveryDiagnostics = { subscriptions: { total: number; works: number }; availability: { total: number; pendingPublished: number; oldestPendingAt: string | null }; releases: { total: number; pendingPublished: number; oldestPendingAt: string | null } };
const diagnostics = ref<DeliveryDiagnostics | null>(null);
const diagnosticsLoading = ref(false);
const diagnosticsError = ref('');
const taxonomyType = ref<TaxonomyType>('person');
const taxonomyQuery = ref('');
const taxonomyEntries = ref<TaxonomyEntry[]>([]);
const taxonomyWorks = ref<TaxonomyWork[]>([]);
const taxonomyWorksLoading = ref(false);
const taxonomyWorksCursor = ref<string | null>(null);
const taxonomyWorksError = ref('');
const taxonomyWorksRetryAppend = ref(false);
const categories = ref<TaxonomyEntry[]>([]);
const taxonomyLoading = ref(false);
const taxonomyError = ref('');
const taxonomyForm = reactive({ id: '', type: 'person' as TaxonomyType, name: '', slug: '', description: '', imageUrl: '', parentId: '' });
const taxonomyData = ref<Record<string, unknown>>({});
const taxonomyBaseEntry = ref<TaxonomyEntry | null>(null);
const taxonomyExternalIds = ref<Record<string, unknown>>({});
const personFactKeys = ['originalName', 'birthday', 'deathday', 'placeOfBirth', 'homepage'] as const;
const personFacts = reactive({ originalName: '', birthday: '', deathday: '', placeOfBirth: '', homepage: '', biography: '', aliases: '' });
const collectionForm = reactive({ semanticKind: 'theme' as 'theme' | 'platform' | 'franchise', isEnabled: true });
const recalculateForm = reactive({ mode: 'selected', workIds: '' });
const recalculateCursor = ref<string | null>(null);
const recalculateResult = ref<{ processed: number; matched: number; skipped: number; nextCursor: string | null } | null>(null);
const taxonomySavedSnapshot = ref('');
const categoryRules = reactive({ enabled: false, all: false, kinds: [] as string[], genres: '', countries: '', yearFrom: '', yearTo: '' });
const workKinds = [{ value: 'movie', title: i18n.ts.zalip._importer.movie }, { value: 'series', title: i18n.ts.zalip._importer.series }, { value: 'anime', title: i18n.ts.zalip._importer.anime }, { value: 'animation', title: i18n.ts.zalip._importer.animation }];
const membership = reactive({ workId: '', role: '', character: '', position: 0 });
const profiles = ref<ImportProfile[]>([]);
const profilesError = ref('');
const profileForm = reactive({ id: '', name: '', source: 'tmdb' as ImportSource, mode: 'metadata' as ImportProfile['mode'], intervalMinutes: 1440, enabled: false, collectionId: '', lockedFields: [] as string[], categoryIds: [] as string[] });
const playbackProviders = ref<ImportPlaybackProvider[]>([]);
const playbackSettingsLoading = ref(false);
const playbackSettingsError = ref('');
const maintenanceKinds: ImportMaintenanceKind[] = ['collections-dictionary', 'collection-backfill', 'person-enrichment'];
const maintenanceForm = reactive({ kind: 'collections-dictionary' as ImportMaintenanceKind, source: 'collaps' as ImportMaintenanceSource, collectionIds: '', batchLimit: 20, timeBudgetSeconds: 60 });
const maintenanceRuns = ref<ImportMaintenanceRun[]>([]);
const maintenanceLoading = ref(false);
const maintenanceError = ref('');
const selectedMaintenance = ref<ImportMaintenanceRun | null>(null);
const requestedMaintenanceId = ref<string | null>(null);
const maintenanceRunRequest = reactive(importerRequestState());
const maintenanceRunLoading = computed(() => maintenanceRunRequest.loading);
const maintenanceRunError = computed(() => maintenanceRunRequest.error);
const maintenanceProfiles = ref<ImportMaintenanceProfile[]>([]);
const maintenanceProfilesLoading = ref(false);
const maintenanceProfilesError = ref('');
const maintenanceProfileForm = reactive({ id: '', name: '', kind: 'collections-dictionary' as ImportMaintenanceKind, source: 'collaps' as ImportMaintenanceSource, collectionIds: '', intervalMinutes: 1440, batchLimit: 20, timeBudgetSeconds: 60 });
let pollTimer: number | null = null;
let pollBusy = false;
let searchRevision = 0;
let taxonomyRevision = 0;
let taxonomyWorksRevision = 0;
let previewRevision = 0;
let runRevision = 0;
let workStateRevision = 0;

function sourceStatus(source: ImportSource): ImportSourceStatus | undefined { return sources.value.find(item => item.source === source); }

const searchableSources = computed(() => sources.value.filter(source => source.configured && source.capabilities.search));
const canSearch = computed(() => sourceStatus(searchForm.source)?.configured && sourceStatus(searchForm.source)?.capabilities.search);
const currentSelection = computed(() => tab.value === 'schedules' ? profileSelection : importSelection);
const currentPrimarySources = computed(() => tab.value === 'schedules' ? [profileForm.source] : [...new Set([batch.source, searchForm.source, ...selectedRefs.value.map(item => item.source), ...(preview.value ? [preview.value.record.ref.source] : [])])]);
const previewStale = computed(() => !!preview.value && previewOptionsKey.value !== JSON.stringify(importerOptions(importSelection)));
const previewWarnings = computed(() => importerWarningLabels(preview.value?.warnings));
const runWarnings = computed(() => new Map(runItems.value.map(item => [item.id, importerWarningLabels(item.warnings)])));
const maintenanceWarnings = computed(() => importerWarningLabels(selectedMaintenance.value?.warnings));
const maintenanceProfileLocked = computed(() => !!maintenanceProfileForm.id && maintenanceRuns.value.some(run => run.profileId === maintenanceProfileForm.id && ['queued', 'running', 'paused'].includes(run.state)));
const profileOptionsLocked = computed(() => tab.value === 'schedules' && profileActive(profileForm.id));
const personSources = computed(() => importerSources.filter((source): source is 'tmdb' | 'kinopoisk' => (source === 'tmdb' || source === 'kinopoisk') && sourceStatus(source)?.configured === true && /^[1-9]\d*$/u.test(String(taxonomyExternalIds.value[source] ?? ''))));
const taxonomyDirty = computed(() => taxonomySavedSnapshot.value !== taxonomySnapshot());
const collectionCollapsId = computed(() => { const id = taxonomyExternalIds.value.collaps; return typeof id === 'string' && /^[1-9][0-9]{0,15}$/u.test(id) ? id : null; });
const profileCapabilityWarning = computed(() => {
	const source = sourceStatus(profileForm.source);
	if (!source?.configured) return i18n.ts.zalip._importer.sourceNotConfigured;
	if (profileForm.mode === 'collection' && !source.capabilities.collections) return i18n.ts.zalip._importer.collectionsUnsupported;
	if (profileForm.mode === 'availability' && !['alloha', 'collaps', 'kodik'].includes(profileForm.source)) return i18n.ts.zalip._importer.availabilityUnsupported;
	if (profileForm.mode === 'discovery' && (profileForm.source !== 'collaps' || !source.capabilities.updates)) return i18n.ts.zalip._importer.discoveryUnsupported;
	return '';
});

function errorMessage(error: unknown): string {
	if (importerArtworkSelectionStale(error)) return i18n.ts.zalip._importer.artworkSelectionStale;
	const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
	if (code.includes('NOT_CONFIGURED')) return i18n.ts.zalip._importer.errorConfiguration;
	if (code.includes('NOT_FOUND')) return i18n.ts.zalip._importer.errorNotFound;
	if (code.includes('CONFLICT') || code.includes('DUPLICATE')) return i18n.ts.zalip._importer.errorConflict;
	if (code.includes('RATE') || code.includes('QUOTA')) return i18n.ts.zalip._importer.errorQuota;
	if (code.includes('PERMISSION') || code.includes('ADMIN')) return i18n.ts.zalip._importer.errorPermissions;
	return i18n.ts.zalip._importer.errorGeneric;
}

function dateLabel(value: string | null): string {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru');
}

function taxonomyIcon(type: TaxonomyType): string { return ({ person: 'ti ti-user', studio: 'ti ti-building', genre: 'ti ti-tag', category: 'ti ti-folders', collection: 'ti ti-stack-2' })[type]; }

function profileModeLabel(mode: ImportProfile['mode']): string { return ({ metadata: i18n.ts.zalip._importer.metadata, availability: i18n.ts.zalip._importer.availabilityMode, collection: i18n.ts.zalip._importer.collectionMode, discovery: i18n.ts.zalip._importer.discoveryMode })[mode]; }

function profileActive(id: string): boolean { return !!id && runs.value.some(run => run.profileId === id && ['queued', 'running', 'paused'].includes(run.state)); }

// Vue refs can change while a confirmation is open; re-read them outside TS's pre-await narrowing.
function actionBusy(): boolean { return busy.value; }

function currentRunId(): string | undefined { return selectedRun.value?.id; }

function taxonomyContextReady(entryId: string): boolean { return !busy.value && !taxonomyDirty.value && taxonomyForm.id === entryId; }

function taxonomyLinkReady(entryId: string): boolean { return !busy.value && !taxonomyWorksLoading.value && taxonomyForm.id === entryId; }

function workOrigin(field: ImportField): string {
	const source = workState.value?.fields.find(item => item.field === field)?.source;
	return source && importerSources.includes(source as ImportSource) ? importerSourceLabel(source as ImportSource) : source ?? '';
}

function toggleFieldGroup(fields: ImportField[]): void {
	if (busy.value || profileOptionsLocked.value) return;
	const selection = currentSelection.value;
	selection.fields = fields.every(field => selection.fields.includes(field)) ? selection.fields.filter(field => !fields.includes(field)) : [...new Set([...selection.fields, ...fields])];
}

function showImportOptions(): void {
	if (!importOptionsPanel.value) return;
	importOptionsPanel.value.setAttribute('open', '');
	importOptionsPanel.value.querySelector('summary')?.focus({ preventScroll: true });
	importOptionsPanel.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showImportedWork(workId: string): Promise<void> {
	if (busy.value || workStateLoading.value) return;
	tab.value = 'import';
	workStateId.value = workId;
	await nextTick();
	if (workProtectionPanel.value) {
		workProtectionPanel.value.setAttribute('open', '');
		workProtectionPanel.value.querySelector('summary')?.focus({ preventScroll: true });
		workProtectionPanel.value.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}
	await loadWorkState();
}

async function checkSource(source: ImportSource): Promise<void> {
	if (busy.value || sourceChecking[source] || !sourceStatus(source)?.configured) return;
	const revision = (sourceCheckRevision[source] ?? 0) + 1;
	sourceCheckRevision[source] = revision;
	sourceChecking[source] = true;
	sourceCheckErrors[source] = '';
	try { const result = await misskeyApiZalip<ImportSourceCheck>('zalip/admin/importer/sources/check', { source }); if (sourceCheckRevision[source] === revision) sourceChecks[source] = result; } catch (error) { if (sourceCheckRevision[source] === revision) sourceCheckErrors[source] = errorMessage(error); } finally { if (sourceCheckRevision[source] === revision) sourceChecking[source] = false; }
}

function applyServiceSettings(result: ImportServiceSettingsResponse, savedSource?: ImportSource): void {
	if (result.sources.length !== importerSources.length || new Set(result.sources.map(entry => entry.source)).size !== importerSources.length || result.sources.some(entry => !importerSources.includes(entry.source))) throw new Error('invalid-settings');
	serviceSettings.value = importerServiceSettingsUpdate(serviceSettings.value, result, savedSource);
	for (const entry of result.sources) if (!savedSource || entry.source === savedSource) Object.assign(serviceForms[entry.source], importerServiceForm(entry));
}

async function loadServiceSettings(): Promise<void> {
	if (serviceSettingsLoading.value) return;
	serviceSettingsLoading.value = true;
	serviceSettingsError.value = '';
	try { applyServiceSettings(await misskeyApiZalip<ImportServiceSettingsResponse>('zalip/admin/importer/sources/settings/show')); } catch (error) { serviceSettingsError.value = errorMessage(error); } finally { serviceSettingsLoading.value = false; }
}

function resetServiceForm(source: ImportSource): void {
	if (busy.value || serviceSettingsLoading.value) return;
	const entry = serviceSettings.value?.sources.find(item => item.source === source);
	if (entry) Object.assign(serviceForms[source], importerServiceForm(entry));
	serviceSaveErrors[source] = '';
}

function clearServiceToken(source: ImportSource, type: 'api' | 'player'): void {
	const form = serviceForms[source];
	if (type === 'api' && form.clearApiToken) form.apiToken = '';
	if (type === 'player' && form.clearPlayerToken) form.playerToken = '';
}

function serviceSettingsActionReady(source: ImportSource, request: ImportServiceSave): boolean {
	const entry = serviceSettings.value?.sources.find(item => item.source === source);
	return !actionBusy() && !serviceSettingsLoading.value && serviceSettings.value?.encryptionReady === true && !!entry && JSON.stringify(request) === JSON.stringify(importerServiceRequest(entry, serviceForms[source]));
}

async function saveServiceSettings(source: ImportSource): Promise<void> {
	if (busy.value || serviceSettingsLoading.value || !serviceSettings.value?.encryptionReady) return;
	const entry = serviceSettings.value.sources.find(item => item.source === source);
	if (!entry) return;
	const params = importerServiceRequest(entry, serviceForms[source]);
	if (!params) { serviceSaveErrors[source] = i18n.ts.zalip._importer.invalidSourceSettings; return; }
	if (params.clearApiToken || params.clearPlayerToken) {
		const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.clearSourceTokenTitle, text: i18n.ts.zalip._importer.clearSourceTokenText });
		if (confirmation.canceled || !serviceSettingsActionReady(source, params)) return;
	}
	busy.value = true;
	serviceSaveErrors[source] = '';
	try {
		applyServiceSettings(await misskeyApiZalip<ImportServiceSettingsResponse>('zalip/admin/importer/sources/settings/save', params), source);
		sourceCheckRevision[source] = (sourceCheckRevision[source] ?? 0) + 1;
		delete sourceChecks[source]; sourceChecking[source] = false; sourceCheckErrors[source] = '';
		await loadSources();
		message.value = i18n.ts.zalip._importer.sourceSettingsSaved;
	} catch (error) { serviceSaveErrors[source] = errorMessage(error); } finally { busy.value = false; }
}

async function loadWorkState(): Promise<void> {
	if (busy.value || workStateLoading.value || !workStateId.value) return;
	const workId = workStateId.value;
	const revision = ++workStateRevision;
	workStateLoading.value = true;
	workStateError.value = '';
	workState.value = null;
	try { const result = await misskeyApiZalip<ImportWorkState>('zalip/admin/importer/work-state/show', { workId }); if (revision === workStateRevision && workId === workStateId.value) { workState.value = result; persistedLocks.value = [...result.locks]; } } catch (error) { if (revision === workStateRevision) workStateError.value = errorMessage(error); } finally { if (revision === workStateRevision) workStateLoading.value = false; }
}

async function saveWorkLocks(): Promise<void> {
	if (busy.value || workStateLoading.value || !workState.value || workState.value.workId !== workStateId.value) return;
	const workId = workState.value.workId;
	const locks = [...persistedLocks.value];
	busy.value = true;
	workStateError.value = '';
	try { const result = await misskeyApiZalip<ImportWorkState>('zalip/admin/importer/work-state/save', { workId, lockedFields: locks }); if (workId === workStateId.value) { workState.value = result; persistedLocks.value = [...result.locks]; } if (preview.value?.workId === workId) { previewOptionsKey.value = ''; } message.value = i18n.ts.zalip._importer.locksSaved; } catch (error) { workStateError.value = errorMessage(error); } finally { busy.value = false; }
}

async function repairCollapsVoices(): Promise<void> {
	if (busy.value || workStateLoading.value || !importerVoiceRepairReady(workState.value, workStateId.value, persistedLocks.value)) return;
	const state = workState.value!;
	const workId = state.workId;
	const revision = workStateRevision;
	busy.value = true;
	workStateError.value = '';
	message.value = '';
	try {
		const result = await misskeyApiZalip<ImportVoiceRepair>('zalip/admin/importer/work-state/refresh-voices', { workId, expected: state.playbackRevision });
		if (revision !== workStateRevision || workId !== workStateId.value || result.workId !== workId) return;
		if (result.status === 'stale') {
			workState.value = null;
			persistedLocks.value = [];
			workStateError.value = i18n.ts.zalip._importer.repairVoicesStale;
			return;
		}
		workState.value = { ...state, playbackRevision: result.playbackRevision };
		if (result.status === 'updated') {
			if (preview.value?.workId === workId) previewOptionsKey.value = '';
			message.value = i18n.tsx.zalip._importer.repairVoicesUpdated({ count: result.translations });
		} else {
			message.value = ({
				'already-current': i18n.ts.zalip._importer.repairVoicesAlready,
				locked: i18n.ts.zalip._importer.repairVoicesLocked,
				unsupported: i18n.ts.zalip._importer.repairVoicesUnsupported,
				empty: i18n.ts.zalip._importer.repairVoicesEmpty,
				unavailable: i18n.ts.zalip._importer.repairVoicesUnavailable,
			})[result.status] ?? i18n.ts.zalip._importer.errorGeneric;
		}
	} catch (error) {
		if (revision === workStateRevision && workId === workStateId.value) workStateError.value = errorMessage(error);
	} finally { busy.value = false; }
}

function runModeLabel(mode: ImportRun['mode']): string { return ({ import: i18n.ts.zalip._importer.import, sync: i18n.ts.zalip._importer.update, availability: i18n.ts.zalip._importer.availabilityMode })[mode]; }

async function loadSources(): Promise<void> {
	sourcesLoading.value = true;
	sourcesError.value = '';
	try {
		sources.value = (await misskeyApiZalip<{ sources: ImportSourceStatus[] }>('zalip/admin/importer/sources')).sources;
		if (!canSearch.value && searchableSources.value[0]) searchForm.source = searchableSources.value[0].source;
	} catch (error) { sourcesError.value = errorMessage(error); } finally { sourcesLoading.value = false; }
}

function clearSearch(): void { searchRevision++; searchItems.value = []; searched.value = false; searchError.value = ''; }

async function search(page: number): Promise<void> {
	if (searching.value || !canSearch.value || searchForm.query.length < 2) return;
	const revision = ++searchRevision;
	searching.value = true;
	searchError.value = '';
	try {
		const result = await misskeyApiZalip<{ items: ImportSearchItem[]; page: number; hasMore: boolean }>('zalip/admin/importer/search', { ...searchForm, page });
		if (revision !== searchRevision) return;
		searchItems.value = result.items;
		searchPage.value = result.page;
		searchHasMore.value = result.hasMore;
		searched.value = true;
	} catch (error) { if (revision === searchRevision) searchError.value = errorMessage(error); } finally { searching.value = false; }
}

function isSelected(value: ImportRef): boolean { return selectedRefs.value.some(item => importerReferenceKey(item) === importerReferenceKey(value)); }

function toggleSelection(value: ImportRef): void {
	if (isSelected(value)) selectedRefs.value = selectedRefs.value.filter(item => importerReferenceKey(item) !== importerReferenceKey(value));
	else if (selectedRefs.value.length < 100) selectedRefs.value = [...selectedRefs.value, value];
}

function toggleLock(field: string): void { lockedFields.value = lockedFields.value.includes(field) ? lockedFields.value.filter(item => item !== field) : [...lockedFields.value, field]; }

function previewLockChecked(field: string): boolean {
	const imageField = importerArtworkFields.find(item => item === field);
	return lockedFields.value.includes(field) || (imageField && previewBase.value ? importerArtworkFieldLocked(previewBase.value, imageField) : preview.value?.changes.find(change => change.field === field)?.protected === true);
}

function previewLockDisabled(field: string): boolean {
	if (busy.value || previewStale.value || !previewBase.value) return true;
	const imageField = importerArtworkFields.find(item => item === field);
	if (imageField) return importerArtworkFieldLocked(previewBase.value, imageField);
	const change = previewBase.value.changes.find(item => item.field === field);
	return change?.protected === true || change?.selected === false;
}

function batchReferences(): ImportRef[] | null {
	const lines = splitImporterReferenceLines(batch.references);
	if (lines.length === 0 || lines.length > 100) { actionError.value = i18n.ts.zalip._importer.errorBatchSize; return null; }
	if (batch.source === 'alloha' && lines.some(value => importerImdbId(value) || value.startsWith('imdb:'))) { actionError.value = i18n.ts.zalip._importer.imdbAllohaUnsupported; return null; }
	const refs = lines.map(value => importerReference(batch.source, batch.mediaType, value));
	if (refs.some(value => value === null)) { actionError.value = i18n.ts.zalip._importer.errorReferences; return null; }
	return refs as ImportRef[];
}

async function previewBatch(): Promise<void> { const refs = batchReferences(); if (refs) await showPreview(refs[0]); }

async function queueBatch(): Promise<void> { const refs = batchReferences(); if (refs) await queueReferences(refs); }

async function previewRunArtwork(item: ImportRunItem): Promise<void> {
	if (busy.value || previewLoading.value) return;
	Object.assign(importSelection, importerSelection(selectedRun.value?.options ?? { artwork: 'local' }));
	Object.assign(batch, { source: item.ref.source, mediaType: item.ref.mediaType, references: item.ref.externalId });
	Object.assign(searchForm, { source: item.ref.source, mediaType: item.ref.mediaType });
	artworkChoices.value = {};
	message.value = i18n.ts.zalip._importer.artworkSelectionStale;
	tab.value = 'import';
	await showPreview({ ...item.ref });
}

async function showPreview(value: ImportRef): Promise<void> {
	if (busy.value || !importerFiltersValid(importSelection)) { if (!busy.value) actionError.value = i18n.ts.zalip._importer.invalidFilters; return; }
	const options = importerOptions(importSelection);
	const revision = ++previewRevision;
	previewLoading.value = true;
	previewError.value = '';
	if (!previewBase.value || !importerArtworkSameRef(previewBase.value.record.ref, value)) artworkChoices.value = {};
	previewBase.value = null;
	lockedFields.value = [];
	await nextTick();
	previewPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	try {
		const initialRef = initialArtworkReference();
		const workId = initialRef && importerArtworkSameRef(initialRef, value) && /^[a-zA-Z0-9]{1,32}$/u.test(props.workId) ? props.workId : undefined;
		const result = await misskeyApiZalip<ImportPreview>('zalip/admin/importer/preview', { ref: { ...value }, options, ...(workId ? { workId } : {}) });
		if (revision === previewRevision) { artworkChoices.value = importerArtworkLimitChoices(importerArtworkCurrentChoices(result, artworkChoices.value), artworkGalleryLimit.value); previewBase.value = result; previewOptionsKey.value = JSON.stringify(options); if (result.workId) workStateId.value = result.workId; }
	} catch (error) { if (revision === previewRevision) previewError.value = errorMessage(error); } finally { if (revision === previewRevision) previewLoading.value = false; }
}

async function queueReferences(refs: ImportRef[], fromPreview = false): Promise<void> {
	if (busy.value || refs.length === 0 || refs.length > 100) return;
	if (fromPreview && (previewStale.value || !preview.value || refs.length !== 1 || !importerArtworkSameRef(refs[0], preview.value.record.ref))) return;
	if (!importerFiltersValid(importSelection)) { actionError.value = i18n.ts.zalip._importer.invalidFilters; return; }
	const options = importerOptions(importSelection);
	const params = { refs: refs.map(value => ({ ...value })), mode: 'import', lockedFields: [...lockedFields.value], categoryIds: [...categoryIds.value], options: fromPreview ? importerArtworkOptions(options, refs[0], importerArtworkLimitChoices(artworkChoices.value, artworkGalleryLimit.value)) : options };
	busy.value = true;
	actionError.value = '';
	try {
		const result = await misskeyApiZalip<{ id: string; state: string }>('zalip/admin/importer/runs/create', params);
		message.value = i18n.ts.zalip._importer.runCreated;
		selectedRefs.value = [];
		tab.value = 'runs';
		await Promise.all([loadRuns(), loadRun(result.id)]);
	} catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadRuns(): Promise<void> {
	if (runsLoading.value) return;
	runsLoading.value = true;
	runsError.value = '';
	try { runs.value = (await misskeyApiZalip<{ runs: ImportRun[] }>('zalip/admin/importer/runs/list')).runs; } catch (error) { runsError.value = errorMessage(error); } finally { runsLoading.value = false; }
}

async function loadDiagnostics(): Promise<void> {
	if (diagnosticsLoading.value) return;
	diagnosticsLoading.value = true;
	diagnosticsError.value = '';
	try { diagnostics.value = await misskeyApiZalip<DeliveryDiagnostics>('zalip/admin/importer/diagnostics'); } catch (error) { diagnosticsError.value = errorMessage(error); } finally { diagnosticsLoading.value = false; }
}

async function loadRun(runId: string, polling = false): Promise<void> {
	if (polling && (runLoading.value || requestedRunId.value !== runId)) return;
	if (!polling && requestedRunId.value !== runId) {
		requestedRunId.value = runId;
		selectedRun.value = null;
		runItems.value = [];
	}
	const revision = ++runRevision;
	runLoading.value = true;
	try {
		const result = await misskeyApiZalip<{ run: ImportRun; items: ImportRunItem[] }>('zalip/admin/importer/runs/show', { runId });
		if (revision !== runRevision) return;
		selectedRun.value = result.run;
		runItems.value = result.items;
	} catch (error) { if (revision === runRevision) actionError.value = errorMessage(error); } finally { if (revision === runRevision) runLoading.value = false; }
}

async function runAction(action: 'pause' | 'resume' | 'retry' | 'cancel'): Promise<void> {
	if (!selectedRun.value || busy.value) return;
	const runId = selectedRun.value.id;
	if (action === 'cancel') { const result = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.cancelRunTitle, text: i18n.ts.zalip._importer.cancelRunText }); if (result.canceled) return; }
	if (actionBusy() || currentRunId() !== runId) return;
	busy.value = true;
	actionError.value = '';
	try { await misskeyApiZalip('zalip/admin/importer/runs/action', { runId, action }); await Promise.all([loadRuns(), loadRun(runId)]); } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadCategories(): Promise<void> {
	try { categories.value = (await misskeyApiZalip<{ entries: TaxonomyEntry[] }>('zalip/admin/importer/taxonomy/list', { type: 'category', limit: 100 })).entries; } catch (error) { actionError.value = errorMessage(error); }
}

async function loadTaxonomy(): Promise<void> {
	const revision = ++taxonomyRevision;
	taxonomyLoading.value = true;
	taxonomyError.value = '';
	try { const result = await misskeyApiZalip<{ entries: TaxonomyEntry[] }>('zalip/admin/importer/taxonomy/list', { type: taxonomyType.value, query: taxonomyQuery.value, limit: 100 }); if (revision === taxonomyRevision) taxonomyEntries.value = result.entries; } catch (error) { if (revision === taxonomyRevision) taxonomyError.value = errorMessage(error); } finally { if (revision === taxonomyRevision) taxonomyLoading.value = false; }
}

function resetRecalculate(): void { recalculateCursor.value = null; recalculateResult.value = null; }

function taxonomySnapshot(): string { return JSON.stringify({ form: taxonomyForm, facts: personFacts, rules: categoryRules, collection: collectionForm }); }

function resetTaxonomyForm(): void {
	if (busy.value) return;
	taxonomyWorksRevision++;
	taxonomyWorksLoading.value = false;
	Object.assign(taxonomyForm, { id: '', type: taxonomyType.value, name: '', slug: '', description: '', imageUrl: '', parentId: '' });
	taxonomyWorks.value = [];
	taxonomyWorksCursor.value = null;
	taxonomyWorksError.value = '';
	taxonomyData.value = {};
	taxonomyBaseEntry.value = null;
	taxonomyExternalIds.value = {};
	for (const key of Object.keys(personFacts) as (keyof typeof personFacts)[]) personFacts[key] = '';
	Object.assign(collectionForm, { semanticKind: 'theme', isEnabled: true });
	Object.assign(categoryRules, { enabled: false, all: false, kinds: [], genres: '', countries: '', yearFrom: '', yearTo: '' });
	resetRecalculate();
	taxonomySavedSnapshot.value = taxonomySnapshot();
}

async function editTaxonomy(entry: TaxonomyEntry, fromSave = false): Promise<void> {
	if (busy.value && !fromSave) return;
	taxonomyWorks.value = [];
	taxonomyWorksCursor.value = null;
	taxonomyWorksError.value = '';
	Object.assign(taxonomyForm, { id: entry.id, type: entry.type, name: entry.name, slug: entry.slug, description: entry.description ?? '', imageUrl: entry.imageUrl ?? '', parentId: entry.parentId ?? '' });
	taxonomyData.value = { ...entry.data };
	taxonomyBaseEntry.value = { ...entry };
	taxonomyExternalIds.value = { ...entry.externalIds };
	const rules = typeof entry.data?.rules === 'object' && entry.data.rules !== null ? entry.data.rules as Record<string, unknown> : null;
	const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	Object.assign(categoryRules, { enabled: !!rules && Object.keys(rules).length > 0, all: rules?.all === true, kinds: strings(rules?.kinds), genres: strings(rules?.genres).join(', '), countries: strings(rules?.countries).join(', '), yearFrom: typeof rules?.yearFrom === 'number' ? String(rules.yearFrom) : '', yearTo: typeof rules?.yearTo === 'number' ? String(rules.yearTo) : '' });
	for (const key of [...personFactKeys, 'biography'] as const) personFacts[key] = typeof entry.data?.[key] === 'string' ? entry.data[key] as string : '';
	personFacts.aliases = strings(entry.data?.aliases).join('\n');
	Object.assign(collectionForm, { semanticKind: ['theme', 'platform', 'franchise'].includes(String(entry.data?.semanticKind)) ? entry.data?.semanticKind : 'theme', isEnabled: entry.data?.isEnabled !== false });
	resetRecalculate();
	taxonomySavedSnapshot.value = taxonomySnapshot();
	Object.assign(membership, { workId: '', role: '', character: '', position: 0 });
	await loadTaxonomyWorks(entry.id);
}

async function loadTaxonomyWorks(entryId: string, append = false): Promise<void> {
	if (append && (taxonomyWorksLoading.value || !taxonomyWorksCursor.value)) return;
	const cursor = append ? taxonomyWorksCursor.value : null;
	const revision = ++taxonomyWorksRevision;
	taxonomyWorksLoading.value = true;
	taxonomyWorksError.value = '';
	taxonomyWorksRetryAppend.value = append;
	try { const result = await misskeyApiZalip<{ entry: TaxonomyEntry; works: TaxonomyWork[]; nextCursor: string | null }>('zalip/admin/importer/taxonomy/show', { entryId, limit: 50, ...(cursor ? { cursor } : {}) }); if (revision === taxonomyWorksRevision && entryId === taxonomyForm.id) { taxonomyWorks.value = append ? taxonomyAppendWorks(taxonomyWorks.value, result.works) : result.works; taxonomyWorksCursor.value = result.nextCursor ?? null; } } catch (error) { if (revision === taxonomyWorksRevision && entryId === taxonomyForm.id) taxonomyWorksError.value = errorMessage(error); } finally { if (revision === taxonomyWorksRevision) taxonomyWorksLoading.value = false; }
}

async function saveTaxonomy(): Promise<void> {
	if (busy.value) return;
	const aliases = [...new Set(personFacts.aliases.split(/\r?\n/u).map(value => value.trim()).filter(Boolean))];
	if (taxonomyForm.type === 'person' && (aliases.length > 30 || aliases.some(value => value.length > 256))) { actionError.value = i18n.ts.zalip._importer.invalidAliases; return; }
	const yearFrom = categoryRules.yearFrom === '' ? undefined : Number(categoryRules.yearFrom);
	const yearTo = categoryRules.yearTo === '' ? undefined : Number(categoryRules.yearTo);
	if (taxonomyForm.type === 'category' && categoryRules.enabled && ([yearFrom, yearTo].some(year => year !== undefined && (!Number.isInteger(year) || year < 1888 || year > 3000)) || (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo))) { actionError.value = i18n.ts.zalip._importer.invalidYears; return; }
	busy.value = true;
	actionError.value = '';
	try {
		const list = (value: string) => Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)));
		const data = taxonomyForm.type === 'category' ? { rules: categoryRules.enabled ? { all: categoryRules.all, kinds: [...categoryRules.kinds], genres: list(categoryRules.genres), countries: list(categoryRules.countries), yearFrom, yearTo } : {} } : taxonomyForm.type === 'person' ? taxonomyPersonChanges(personFacts, taxonomyData.value) : taxonomyForm.type === 'collection' ? taxonomyCollectionChanges(collectionForm, taxonomyData.value) : undefined;
		const entry = await misskeyApiZalip<TaxonomyEntry>('zalip/admin/importer/taxonomy/save', { entryId: taxonomyForm.id || undefined, type: taxonomyForm.type, name: taxonomyForm.name, ...taxonomyBaseChanges(taxonomyForm, taxonomyBaseEntry.value), ...(data ? { data } : {}) });
		await editTaxonomy(entry, true);
		await Promise.all([loadTaxonomy(), loadCategories()]);
		message.value = i18n.ts.zalip._importer.entrySaved;
	} catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function enrichPerson(source: 'tmdb' | 'kinopoisk'): Promise<void> {
	if (busy.value || taxonomyDirty.value || !taxonomyForm.id || taxonomyForm.type !== 'person' || !personSources.value.includes(source)) return;
	const entryId = taxonomyForm.id;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ entry: TaxonomyEntry; changedFields: string[] }>('zalip/admin/importer/taxonomy/enrich-person', { entryId, source }); if (taxonomyForm.id === entryId) await editTaxonomy(result.entry, true); await loadTaxonomy(); message.value = i18n.tsx.zalip._importer.personEnriched({ count: String(result.changedFields.length) }); } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function recalculateCategory(continuing: boolean): Promise<void> {
	if (busy.value || taxonomyDirty.value || !taxonomyForm.id || taxonomyForm.type !== 'category') return;
	const entryId = taxonomyForm.id;
	const mode = recalculateForm.mode;
	const workIds = mode === 'selected' ? importerWorkIds(recalculateForm.workIds) : undefined;
	if (workIds === null) { actionError.value = i18n.ts.zalip._importer.errorWorkIds; return; }
	const cursor = continuing ? recalculateCursor.value : null;
	if (continuing && !cursor) return;
	const selectedIdsText = recalculateForm.workIds;
	const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.recalculateTitle, text: i18n.ts.zalip._importer.recalculateText });
	if (confirmation.canceled || !taxonomyContextReady(entryId) || mode !== recalculateForm.mode || selectedIdsText !== recalculateForm.workIds || (continuing && cursor !== recalculateCursor.value)) return;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ processed: number; matched: number; skipped: number; nextCursor: string | null }>('zalip/admin/importer/taxonomy/recalculate', { entryId, ...(workIds ? { workIds } : { limit: 100, ...(cursor ? { afterId: cursor } : {}) }) }); if (taxonomyForm.id === entryId) { recalculateResult.value = result; recalculateCursor.value = result.nextCursor; await loadTaxonomyWorks(entryId); } } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function linkTaxonomy(): Promise<void> {
	if (!taxonomyForm.id || busy.value || taxonomyWorksLoading.value) return;
	const entryId = taxonomyForm.id;
	busy.value = true;
	actionError.value = '';
	try { await misskeyApiZalip('zalip/admin/importer/taxonomy/link', { entryId, workId: membership.workId, role: membership.role || undefined, character: membership.character || undefined, position: membership.position }); if (taxonomyForm.id === entryId) await loadTaxonomyWorks(entryId); message.value = i18n.ts.zalip._importer.linkSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function unlinkTaxonomy(work: TaxonomyWork): Promise<void> {
	if (busy.value || taxonomyWorksLoading.value) return;
	const entryId = taxonomyForm.id;
	const result = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.unlinkTitle, text: i18n.tsx.zalip._importer.unlinkText({ name: work.title }) });
	if (result.canceled || !taxonomyLinkReady(entryId)) return;
	busy.value = true;
	try { await misskeyApiZalip('zalip/admin/importer/taxonomy/link', { entryId, workId: work.id, role: work.role || undefined, remove: true }); if (taxonomyForm.id === entryId) await loadTaxonomyWorks(entryId); } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadProfiles(): Promise<void> {
	profilesError.value = '';
	try { profiles.value = (await misskeyApiZalip<{ profiles: ImportProfile[] }>('zalip/admin/importer/schedules/list')).profiles; } catch (error) { profilesError.value = errorMessage(error); }
}

function resetProfile(fromSave = false): void { if (busy.value && !fromSave) return; Object.assign(profileForm, { id: '', name: '', source: 'tmdb', mode: 'metadata', intervalMinutes: 1440, enabled: false, collectionId: '', lockedFields: [], categoryIds: [] }); Object.assign(profileSelection, importerSelection()); }

function editProfile(profile: ImportProfile, fromSave = false): void { if (busy.value && !fromSave) return; Object.assign(profileForm, { id: profile.id, name: profile.name, source: profile.source, mode: profile.mode, intervalMinutes: profile.intervalMinutes, enabled: profile.enabled, collectionId: profile.collectionId ?? '', lockedFields: [...profile.lockedFields], categoryIds: [...profile.categoryIds] }); Object.assign(profileSelection, importerSelection(profile.options)); }

async function saveProfile(): Promise<void> {
	if (busy.value || profileCapabilityWarning.value) return;
	if (!importerFiltersValid(profileSelection)) { actionError.value = i18n.ts.zalip._importer.invalidFilters; return; }
	if (!profileForm.name || profileForm.name.length > 120 || profileForm.collectionId.length > 100 || !Number.isInteger(profileForm.intervalMinutes) || profileForm.intervalMinutes < 15 || profileForm.intervalMinutes > 43200) { actionError.value = i18n.ts.zalip._importer.errorGeneric; return; }
	const params = { ...profileForm, id: profileForm.id || undefined, collectionId: profileForm.mode === 'collection' ? profileForm.collectionId : null, lockedFields: [...profileForm.lockedFields], categoryIds: [...profileForm.categoryIds], options: importerOptions(profileSelection) };
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<ImportProfile>('zalip/admin/importer/schedules/save', params); editProfile(result, true); await loadProfiles(); message.value = i18n.ts.zalip._importer.scheduleSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function profileAction(profile: ImportProfile, action: 'enable' | 'disable' | 'reset-cursor' | 'delete'): Promise<void> {
	if (busy.value || (['reset-cursor', 'delete'].includes(action) && profileActive(profile.id))) return;
	const profileId = profile.id;
	if (action === 'reset-cursor' || action === 'delete') {
		const result = await os.confirm({ type: 'warning', title: action === 'delete' ? i18n.ts.zalip._importer.deleteScheduleTitle : i18n.ts.zalip._importer.resetCursorTitle, text: action === 'delete' ? i18n.ts.zalip._importer.deleteScheduleText : i18n.ts.zalip._importer.resetCursorText });
		if (result.canceled || actionBusy() || profileActive(profileId) || !profiles.value.some(item => item.id === profileId)) return;
	}
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ id: string; deleted?: boolean; profile?: ImportProfile }>('zalip/admin/importer/schedules/action', { profileId, action }); if (profileForm.id === profileId) { if (result.deleted) resetProfile(true); else if (result.profile) profileForm.enabled = result.profile.enabled; } await loadProfiles(); message.value = i18n.ts.zalip._importer.profileActionSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function runProfile(profile: ImportProfile): Promise<void> {
	if (busy.value || profileActive(profile.id)) return;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ id: string; state: string }>('zalip/admin/importer/schedules/run', { profileId: profile.id }); tab.value = 'runs'; await Promise.all([loadRuns(), loadRun(result.id)]); message.value = i18n.ts.zalip._importer.scheduleEnqueued; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

function maintenanceSources(kind: ImportMaintenanceKind): ImportMaintenanceSource[] { return kind === 'person-enrichment' ? ['tmdb', 'kinopoisk'] : ['collaps']; }

function prepareCollectionBackfill(): void {
	if (busy.value || taxonomyDirty.value || !collectionForm.isEnabled || !collectionCollapsId.value || !sourceStatus('collaps')?.configured) return;
	Object.assign(maintenanceForm, { kind: 'collection-backfill', source: 'collaps', collectionIds: collectionCollapsId.value });
	tab.value = 'maintenance';
}

function maintenanceHint(kind: ImportMaintenanceKind): string { return ({ 'collections-dictionary': i18n.ts.zalip._importer.dictionaryMaintenanceHint, 'collection-backfill': i18n.ts.zalip._importer.collectionBackfillHint, 'person-enrichment': i18n.ts.zalip._importer.personMaintenanceHint })[kind]; }

function safeMaintenanceError(code: string): string { return errorMessage({ code: code.toUpperCase() }); }

async function loadPlaybackSettings(): Promise<void> {
	if (playbackSettingsLoading.value) return;
	playbackSettingsLoading.value = true;
	playbackSettingsError.value = '';
	try {
		const result = await misskeyApiZalip<{ providers: ImportPlaybackProvider[] }>('zalip/admin/importer/playback-settings/show');
		const snapshot = importerPlaybackSettings(result.providers);
		if (!snapshot) throw new Error('invalid-settings');
		playbackProviders.value = snapshot.providers;
	} catch (error) { playbackSettingsError.value = errorMessage(error); } finally { playbackSettingsLoading.value = false; }
}

function movePlayer(index: number, delta: -1 | 1): void {
	if (busy.value || playbackSettingsLoading.value) return;
	const target = index + delta;
	if (index < 0 || index >= playbackProviders.value.length || target < 0 || target >= playbackProviders.value.length) return;
	const providers = [...playbackProviders.value];
	[providers[index], providers[target]] = [providers[target], providers[index]];
	playbackProviders.value = providers.map((provider, position) => ({ ...provider, position: position as 0 | 1 | 2 }));
}

function playbackSettingsActionReady(params: { providers: ImportPlaybackProvider[] }): boolean { return !actionBusy() && !playbackSettingsLoading.value && JSON.stringify(params) === JSON.stringify(importerPlaybackSettings(playbackProviders.value)); }

async function savePlaybackSettings(): Promise<void> {
	if (busy.value || playbackSettingsLoading.value) return;
	const params = importerPlaybackSettings(playbackProviders.value);
	if (!params) { actionError.value = i18n.ts.zalip._importer.invalidPlaybackSettings; return; }
	if (params.providers.every(provider => !provider.enabled)) {
		const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.disableAllPlayersTitle, text: i18n.ts.zalip._importer.disableAllPlayersText });
		if (confirmation.canceled || !playbackSettingsActionReady(params)) return;
	}
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ providers: ImportPlaybackProvider[] }>('zalip/admin/importer/playback-settings/save', params); const snapshot = importerPlaybackSettings(result.providers); if (!snapshot) throw new Error('invalid-settings'); playbackProviders.value = snapshot.providers; message.value = i18n.ts.zalip._importer.playbackSettingsSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadMaintenanceRuns(): Promise<void> {
	if (maintenanceLoading.value) return;
	maintenanceLoading.value = true;
	maintenanceError.value = '';
	try { maintenanceRuns.value = await misskeyApiZalip<ImportMaintenanceRun[]>('zalip/admin/importer/maintenance/list', { limit: 20 }); } catch (error) { maintenanceError.value = errorMessage(error); } finally { maintenanceLoading.value = false; }
}

async function loadMaintenanceRun(runId: string, polling = false, fromAction = false): Promise<void> {
	if (busy.value && !fromAction) return;
	if (polling && (maintenanceRunLoading.value || requestedMaintenanceId.value !== runId)) return;
	if (!polling && requestedMaintenanceId.value !== runId) { requestedMaintenanceId.value = runId; selectedMaintenance.value = null; }
	const revision = importerRequestStart(maintenanceRunRequest);
	try { const result = await misskeyApiZalip<ImportMaintenanceRun>('zalip/admin/importer/maintenance/show', { runId }); if (importerRequestCurrent(maintenanceRunRequest, revision)) selectedMaintenance.value = result; } catch (error) { if (importerRequestCurrent(maintenanceRunRequest, revision)) maintenanceRunRequest.error = errorMessage(error); } finally { importerRequestFinish(maintenanceRunRequest, revision); }
}

async function retryMaintenanceRun(): Promise<void> { if (!busy.value && requestedMaintenanceId.value && !maintenanceRunLoading.value) await loadMaintenanceRun(requestedMaintenanceId.value); }

async function refreshMaintenance(): Promise<void> { await importerRefreshSequence(loadMaintenanceRuns, async () => { if (requestedMaintenanceId.value) await loadMaintenanceRun(requestedMaintenanceId.value, true); }, () => !busy.value && tab.value === 'maintenance' && !window.document.hidden); }

async function createMaintenance(): Promise<void> {
	if (busy.value || !sourceStatus(maintenanceForm.source)?.configured) return;
	const params = importerMaintenanceRequest(maintenanceForm);
	if (!params) { actionError.value = i18n.ts.zalip._importer.invalidMaintenance; return; }
	const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.maintenanceStartTitle, text: maintenanceHint(params.kind) });
	if (confirmation.canceled || actionBusy() || JSON.stringify(params) !== JSON.stringify(importerMaintenanceRequest(maintenanceForm))) return;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ runId: string }>('zalip/admin/importer/maintenance/create', params); await Promise.all([loadMaintenanceRuns(), loadMaintenanceRun(result.runId, false, true)]); message.value = i18n.ts.zalip._importer.maintenanceCreated; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

function maintenanceActionReady(runId: string): boolean { return !actionBusy() && !maintenanceRunLoading.value && selectedMaintenance.value?.id === runId; }

async function maintenanceAction(action: 'cancel' | 'resume'): Promise<void> {
	if (busy.value || maintenanceRunLoading.value || !selectedMaintenance.value) return;
	const runId = selectedMaintenance.value.id;
	if (action === 'cancel') { const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.cancelRunTitle, text: i18n.ts.zalip._importer.maintenanceCancelText }); if (confirmation.canceled || !maintenanceActionReady(runId)) return; }
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<ImportMaintenanceRun>('zalip/admin/importer/maintenance/action', { runId, action }); if (requestedMaintenanceId.value === runId) { importerRequestInvalidate(maintenanceRunRequest); selectedMaintenance.value = result; } await loadMaintenanceRuns(); } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadMaintenanceProfiles(): Promise<void> {
	if (maintenanceProfilesLoading.value) return;
	maintenanceProfilesLoading.value = true;
	maintenanceProfilesError.value = '';
	try { maintenanceProfiles.value = await misskeyApiZalip<ImportMaintenanceProfile[]>('zalip/admin/importer/maintenance/schedules/list'); } catch (error) { maintenanceProfilesError.value = errorMessage(error); } finally { maintenanceProfilesLoading.value = false; }
}

function resetMaintenanceProfile(): void { if (!busy.value) Object.assign(maintenanceProfileForm, { id: '', name: '', kind: 'collections-dictionary', source: 'collaps', collectionIds: '', intervalMinutes: 1440, batchLimit: 20, timeBudgetSeconds: 60 }); }

function editMaintenanceProfile(profile: ImportMaintenanceProfile): void { if (!busy.value) Object.assign(maintenanceProfileForm, { id: profile.id, name: profile.name, kind: profile.kind, source: profile.source, collectionIds: profile.options?.collectionIds?.join('\n') ?? '', intervalMinutes: profile.intervalMinutes, batchLimit: profile.batchLimit, timeBudgetSeconds: profile.timeBudgetSeconds }); }

async function saveMaintenanceProfile(): Promise<void> {
	if (busy.value || !sourceStatus(maintenanceProfileForm.source)?.configured) return;
	const params = importerMaintenanceRequest(maintenanceProfileForm);
	if (!params || !maintenanceProfileForm.name.trim() || maintenanceProfileForm.name.trim().length > 120 || !Number.isInteger(maintenanceProfileForm.intervalMinutes) || maintenanceProfileForm.intervalMinutes < 60 || maintenanceProfileForm.intervalMinutes > 10080) { actionError.value = i18n.ts.zalip._importer.invalidMaintenance; return; }
	const request = { ...params, profileId: maintenanceProfileForm.id || undefined, name: maintenanceProfileForm.name.trim(), intervalMinutes: maintenanceProfileForm.intervalMinutes };
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<ImportMaintenanceProfile>('zalip/admin/importer/maintenance/schedules/save', request); Object.assign(maintenanceProfileForm, { id: result.id, name: result.name }); await loadMaintenanceProfiles(); message.value = i18n.ts.zalip._importer.scheduleSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function maintenanceProfileAction(profile: ImportMaintenanceProfile, action: 'enable' | 'disable'): Promise<void> {
	if (busy.value) return;
	const profileId = profile.id;
	if (action === 'enable') { const confirmation = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.maintenanceEnableTitle, text: i18n.ts.zalip._importer.maintenanceSchedulesHint }); if (confirmation.canceled || actionBusy() || !maintenanceProfiles.value.some(item => item.id === profileId && !item.enabled)) return; }
	busy.value = true;
	actionError.value = '';
	try { await misskeyApiZalip('zalip/admin/importer/maintenance/schedules/action', { profileId, action }); await loadMaintenanceProfiles(); message.value = i18n.ts.zalip._importer.profileActionSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function pollRuns(): Promise<void> {
	if (!iAmAdmin || !['runs', 'maintenance'].includes(tab.value) || window.document.hidden || pollBusy || busy.value) return;
	pollBusy = true;
	try { if (tab.value === 'maintenance') { await importerRefreshSequence(loadMaintenanceRuns, async () => { if (selectedMaintenance.value && ['queued', 'running'].includes(selectedMaintenance.value.state)) await loadMaintenanceRun(selectedMaintenance.value.id, true); }, () => !busy.value && tab.value === 'maintenance' && !window.document.hidden); } else { await loadRuns(); if (!busy.value && tab.value === 'runs' && selectedRun.value && ['queued', 'running'].includes(selectedRun.value.state)) await loadRun(selectedRun.value.id, true); } } finally { pollBusy = false; }
}

function startPolling(): void { if (iAmAdmin && pollTimer === null) pollTimer = window.setInterval(() => void pollRuns(), 5000); }

function stopPolling(): void { if (pollTimer !== null) window.clearInterval(pollTimer); pollTimer = null; }

function initialArtworkReference(): ImportRef | null {
	if (!importerSources.includes(props.source as ImportSource) || !['movie', 'tv'].includes(props.mediaType)) return null;
	return importerReference(props.source as ImportSource, props.mediaType as ImportMediaType, props.externalId);
}

function loadInitialReference(): void {
	const initialRef = initialArtworkReference();
	if (!initialRef) return;
	Object.assign(batch, { source: initialRef.source, mediaType: initialRef.mediaType, references: initialRef.externalId });
	Object.assign(searchForm, { source: initialRef.source, mediaType: initialRef.mediaType });
	if (props.imagesOnly === '1') { importSelection.fields = [...importerArtworkFields]; message.value = i18n.ts.zalip._importer.artworkOnlyHint; }
	void showPreview(initialRef);
}

watch(tab, value => { actionError.value = ''; if (value === 'runs') void loadRuns(); if (value === 'taxonomy') void loadTaxonomy(); if (value === 'schedules') void loadProfiles(); if (value === 'maintenance') void Promise.all([playbackProviders.value.length ? Promise.resolve() : loadPlaybackSettings(), loadMaintenanceRuns(), loadMaintenanceProfiles()]); if (value === 'sources' && !serviceSettings.value) void loadServiceSettings(); });
watch(() => maintenanceForm.kind, kind => { if (!maintenanceSources(kind).includes(maintenanceForm.source)) maintenanceForm.source = maintenanceSources(kind)[0]; });
watch(() => maintenanceProfileForm.kind, kind => { if (!maintenanceSources(kind).includes(maintenanceProfileForm.source)) maintenanceProfileForm.source = maintenanceSources(kind)[0]; });
onMounted(() => { if (iAmAdmin) { void Promise.all([loadSources(), loadCategories(), loadRuns(), loadProfiles()]).then(loadInitialReference); startPolling(); } });
onActivated(startPolling);
onDeactivated(stopPolling);
onBeforeUnmount(stopPolling);
definePage(() => ({ title: i18n.ts.zalip._importer.pageTitle, icon: 'ti ti-database-import' }));
</script>

<style lang="scss" module>
.page { padding: 24px var(--MI-margin) 64px; }
.page h1, .page h2, .page h3 { margin: 0 0 12px; }
.page h1 { font-size: 1.8rem; }
.page h2 { font-size: 1.2rem; }
.page h3 { font-size: 1rem; }
.heading, .sectionHeading, .toolbar, .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.heading, .sectionHeading, .toolbar { justify-content: space-between; }
.heading { margin-bottom: 24px; }
.heading p, .sectionHeading p { margin: 6px 0; color: var(--MI_THEME-fgTransparentWeak); line-height: 1.5; }
.eyebrow { display: flex; gap: 6px; align-items: center; color: var(--MI_THEME-accent) !important; font-size: .72rem; font-weight: 700; letter-spacing: .1em; }
.sources { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
.source { display: flex; flex-direction: column; gap: 8px; padding: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); }
.source span, .source small { color: var(--MI_THEME-fgTransparentWeak); font-size: .8rem; }
.source .connected { color: var(--MI_THEME-accent); }
.tabs { display: flex; gap: 6px; margin: 24px 0 16px; padding: 5px; border-radius: 999px; background: var(--MI_THEME-panel); overflow-x: auto; }
.tabs button { display: inline-flex; justify-content: center; align-items: center; gap: 8px; flex: 1; padding: 12px 16px; border-radius: 999px; white-space: nowrap; }
.tabs .active { background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-weight: 700; }
.panel { margin-top: 16px; padding: 22px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-panel); scroll-margin-top: 100px; }
.button, .primary, .danger { display: inline-flex; align-items: center; justify-content: center; gap: 7px; min-height: 40px; padding: 9px 14px; border-radius: 999px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fg); font: inherit; font-size: .85rem; font-weight: 700; text-decoration: none; box-sizing: border-box; }
.primary { background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); }
.danger { color: var(--MI_THEME-error); }
.page button:disabled { opacity: .5; }
.page button:focus-visible, .page a:focus-visible, .page input:focus-visible, .page select:focus-visible, .page textarea:focus-visible, .page summary:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
.searchForm { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; margin-top: 18px; }
.searchForm label { min-width: 120px; }
.form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 16px; }
.page label { display: flex; flex-direction: column; gap: 6px; font-size: .85rem; }
.page label > span { color: var(--MI_THEME-fgTransparentWeak); }
.page input:not([type='checkbox']), .page select, .page textarea { width: 100%; min-width: 0; min-height: 42px; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); font: inherit; font-size: 15px; }
.page input[type='checkbox'] { width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--MI_THEME-accent); }
.page textarea { resize: vertical; }
.grow { flex: 1; min-width: 0; }
.wide { grid-column: 1 / -1; }
.hint { color: var(--MI_THEME-fgTransparentWeak); font-size: .82rem; line-height: 1.6; }
.error { color: var(--MI_THEME-error); font-size: .85rem; line-height: 1.6; overflow-wrap: anywhere; }
.message { padding: 12px 16px; border-radius: var(--MI-radius); background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-size: .9rem; }
.searchResults, .rows { display: grid; gap: 8px; margin-top: 18px; }
.result { display: flex; align-items: center; gap: 14px; padding: 12px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.selection { flex-shrink: 0; }
.result h3 { margin: 0; }
.result p { margin: 5px 0; font-size: .85rem; }
.result small, .itemRow small, .runRow small, .entityRow small { display: block; margin-top: 5px; color: var(--MI_THEME-fgTransparentWeak); font-size: .75rem; overflow-wrap: anywhere; }
.poster { display: grid; place-items: center; width: 52px; height: 78px; flex-shrink: 0; background: var(--MI_THEME-bg); border-radius: 6px; overflow: clip; }
.poster img, .previewPoster img { width: 100%; height: 100%; object-fit: cover; }
.poster i { font-size: 1.6rem; color: var(--MI_THEME-fgTransparentWeak); }
.toolbar { margin-top: 18px; font-size: .85rem; }
.bulkSelection { width: 100%; border-top: 1px solid var(--MI_THEME-divider); padding-top: 12px; }
.bulkSelection summary { cursor: pointer; color: var(--MI_THEME-fg); font-weight: 700; }
.selectionSummary { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; margin: 16px 0; padding: 12px 14px; border-radius: var(--MI-radius); background: var(--MI_THEME-bg); font-size: .85rem; }
.selectionSummary > span { display: inline-flex; align-items: center; gap: 8px; }
.selectionSummary i { color: var(--MI_THEME-accent); }
.previewPanel { border-color: color-mix(in srgb, var(--MI_THEME-accent) 45%, var(--MI_THEME-divider)); }
.previewHero > div:last-child { min-width: 0; }
.previewActions { margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--MI_THEME-divider); }
.previewActions > .primary { min-height: 46px; }
.diffDetails { padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.diffDetails > summary { font-weight: 700; }
.count { margin-left: 6px; color: var(--MI_THEME-fgTransparentWeak); font-weight: 400; }
.lockLabel { display: inline-flex; align-items: center; gap: 5px; font-size: .75rem; }
.sourceDetails > summary, .bulkPanel > summary { font-weight: 700; color: var(--MI_THEME-fg); }
.sourceDetails > summary > i, .bulkPanel > summary > i { margin-right: 8px; color: var(--MI_THEME-accent); }
.sourceDetails .sources { margin-top: 16px; }
.bulkPanel .actions { margin-top: 16px; }
.itemActions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.itemActions > button { display: inline-flex; align-items: center; gap: 5px; overflow-wrap: anywhere; }
.previewHero { display: flex; align-items: start; gap: 18px; margin: 18px 0; }
.previewHero h3 { margin-top: 12px; font-size: 1.35rem; }
.previewHero p { line-height: 1.6; font-size: .9rem; }
.previewPoster { display: grid; place-items: center; width: 130px; height: 195px; flex-shrink: 0; background: var(--MI_THEME-bg); border-radius: var(--MI-radius); overflow: clip; }
.previewPoster i { font-size: 3rem; color: var(--MI_THEME-fgTransparentWeak); }
.badge, .chips span { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-size: .72rem; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
.chips span { background: var(--MI_THEME-bg); color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; }
.warnings { padding: 14px 14px 14px 32px; border-radius: var(--MI-radius); background: var(--MI_THEME-infoWarnBg); color: var(--MI_THEME-infoWarnFg); font-size: .85rem; line-height: 1.6; }
.itemWarnings { margin-top: 12px; }
.itemWarnings > p { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--MI_THEME-infoWarnFg); font-size: .82rem; }
.itemWarnings .warnings { margin: 8px 0 0; overflow-wrap: anywhere; }
.details { margin: 16px 0; font-size: .85rem; line-height: 1.6; }
.details summary { cursor: pointer; color: var(--MI_THEME-accent); }
.optionsHeading { margin-top: 20px !important; }
.fieldGroup { margin: 16px 0; padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.fieldGroup summary { cursor: pointer; font-weight: 700; }
.fieldGroup summary small { margin-left: 8px; color: var(--MI_THEME-fgTransparentWeak); font-weight: 400; }
.fieldGroup > .check { margin-top: 14px; }
.fieldGroup > .actions { margin-top: 16px; }
.fieldRow { display: grid; grid-template-columns: minmax(0, 1fr) minmax(160px, 1fr); align-items: center; gap: 12px; margin-top: 10px; }
.fieldRow .check { min-width: 0; }
.lockGroup { margin: 16px 0; }
.diffList { display: grid; gap: 12px; margin: 16px 0; }
.diff { border-bottom: 1px solid var(--MI_THEME-divider); padding-bottom: 12px; }
.diff > label { flex-direction: row; align-items: center; flex-wrap: wrap; }
.diffValues { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.diffValues > div { min-width: 0; padding: 12px; border-radius: var(--MI-radius); background: var(--MI_THEME-bg); }
.diffValues small { color: var(--MI_THEME-fgTransparentWeak); }
.diffValues p { margin: 6px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .8rem; line-height: 1.6; max-height: 220px; overflow-y: auto; user-select: text; }
.runRow { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); text-align: start; }
.runRow.selectedRow { border-color: var(--MI_THEME-accent); }
.runRow progress { grid-column: 1 / -1; width: 100%; height: 6px; accent-color: var(--MI_THEME-accent); }
.itemRow, .entityRow { display: flex; align-items: center; gap: 12px; padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); text-align: start; }
.itemRow { justify-content: space-between; flex-wrap: wrap; }
.entityImage { display: grid; place-items: center; width: 42px; height: 42px; flex-shrink: 0; border-radius: var(--MI-radius); background: var(--MI_THEME-bg); overflow: clip; }
.entityImage img { width: 100%; height: 100%; object-fit: cover; }
.entityImage i { color: var(--MI_THEME-accent); font-size: 1.3rem; }
.locks { display: flex; flex-wrap: wrap; gap: 12px 18px; margin: 0; padding: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.categoryRules { display: grid; gap: 14px; margin: 24px 0; padding: 16px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.playerSettingsRow { display: flex; align-items: end; flex-wrap: wrap; gap: 14px; margin: 16px 0; padding: 14px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.playerSettingsRow .grow { min-width: 160px; }
.locks label, .page .check { flex-direction: row; align-items: center; }
.empty { padding: 50px 20px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.empty i { font-size: 2rem; color: var(--MI_THEME-accent); }
@media (max-width: 650px) { .page { padding-top: 12px; } .sources { grid-template-columns: repeat(2, minmax(0, 1fr)); } .source { padding: 12px; } .heading { align-items: start; } .heading h1 { font-size: 1.5rem; } .panel { padding: 16px; } .tabs button { padding: 11px 14px; } .tabs button i { display: none; } .searchForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .searchForm label { min-width: 0; } .searchForm .grow { grid-column: 1 / -1; } .searchForm > button { width: fit-content; } .form, .diffValues { grid-template-columns: 1fr; } .wide { grid-column: auto; } .result { flex-wrap: wrap; gap: 10px; } .result .button { margin-left: auto; } .previewHero { gap: 12px; } .previewPoster { width: 90px; height: 135px; } .previewHero h3 { font-size: 1.1rem; } }
@media (max-width: 650px) { .fieldRow { grid-template-columns: 1fr; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--MI_THEME-divider); } }
@media (max-width: 650px) { .selectionSummary { align-items: start; flex-direction: column; } .previewActions { align-items: stretch; flex-direction: column; } .previewActions > .primary { width: 100%; } .itemActions { align-items: start; flex-direction: column; } .sourceDetails .sources { grid-template-columns: 1fr; } }
</style>
