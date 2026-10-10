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

				<section :class="$style.sources" :aria-label="i18n.ts.zalip._importer.sources">
					<article v-for="source in importerSources" :key="source" :class="$style.source">
						<strong>{{ importerSourceLabel(source) }}</strong><span :class="{ [$style.connected]: sourceStatus(source)?.configured }">{{ sourcesLoading ? i18n.ts.zalip._importer.checkingSettings : sourcesError ? i18n.ts.zalip._importer.configurationUnknown : sourceStatus(source)?.configured ? i18n.ts.zalip._importer.configured : i18n.ts.zalip._importer.notConfigured }}</span>
						<small v-if="sourceStatus(source)?.dailyLimit">{{ i18n.tsx.zalip._importer.dailyLimit({ count: String(sourceStatus(source)?.dailyLimit) }) }}</small>
					</article>
				</section>
				<p v-if="sourcesError" :class="$style.error" role="alert">{{ sourcesError }} <button type="button" class="_textButton" @click="loadSources">{{ i18n.ts.zalip._importer.retry }}</button></p>
				<p :class="$style.hint">{{ i18n.ts.zalip._importer.configurationHint }}</p>

				<nav :class="$style.tabs" :aria-label="i18n.ts.zalip._importer.sections">
					<button v-for="item in tabs" :key="item.id" type="button" class="_button" :class="{ [$style.active]: tab === item.id }" :aria-pressed="tab === item.id" @click="tab = item.id"><i :class="item.icon" aria-hidden="true"></i>{{ item.title }}</button>
				</nav>
				<p v-if="message" :class="$style.message" role="status">{{ message }}</p>
				<p v-if="actionError" :class="$style.error" role="alert">{{ actionError }}</p>

				<template v-if="tab === 'import'">
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.searchHeading }}</h2><p>{{ i18n.ts.zalip._importer.searchHint }}</p></div></div>
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
							<div :class="$style.actions"><span>{{ i18n.tsx.zalip._importer.selectedCount({ count: String(selectedRefs.length) }) }}</span><button type="button" class="_button" :class="$style.primary" :disabled="busy || selectedRefs.length === 0" @click="queueReferences(selectedRefs)">{{ i18n.ts.zalip._importer.importSelected }}</button><button type="button" class="_textButton" :disabled="selectedRefs.length === 0" @click="selectedRefs = []">{{ i18n.ts.zalip._importer.clearSelection }}</button></div>
						</div>
					</section>

					<section :class="$style.panel">
						<h2>{{ i18n.ts.zalip._importer.byId }}</h2><p :class="$style.hint">{{ i18n.ts.zalip._importer.byIdHint }}</p>
						<p v-if="lockedFields.length" :class="$style.hint">{{ i18n.ts.zalip._importer.protectionScope }}</p>
						<form :class="$style.form" @submit.prevent="queueBatch">
							<label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="batch.source" :disabled="busy"><option v-for="source in importerSources" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label>
							<label><span>{{ i18n.ts.zalip._importer.idMediaType }}</span><select v-model="batch.mediaType" :disabled="busy"><option value="movie">{{ i18n.ts.zalip._importer.movie }}</option><option value="tv">{{ i18n.ts.zalip._importer.series }}</option></select></label>
							<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.references }}</span><textarea v-model="batch.references" rows="4" maxlength="20000" placeholder="11&#10;https://www.themoviedb.org/movie/157336" :disabled="busy"></textarea></label>
							<label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.importCategories }}</span><select v-model="categoryIds" multiple size="3" :disabled="busy"><option v-for="entry in categories" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></label>
							<div :class="[$style.actions, $style.wide]"><button type="button" class="_button" :class="$style.button" :disabled="previewLoading || !batch.references.trim()" @click="previewBatch"><i class="ti ti-eye" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.previewFirst }}</button><button type="submit" class="_button" :class="$style.primary" :disabled="busy || !batch.references.trim() || !sourceStatus(batch.source)?.configured"><i class="ti ti-download" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.enqueue }}</button></div>
						</form>
					</section>

					<section v-if="previewLoading || preview || previewError" ref="previewPanel" :class="$style.panel" aria-live="polite">
						<div :class="$style.sectionHeading"><h2>{{ i18n.ts.zalip._importer.previewHeading }}</h2><button type="button" class="_button" :class="$style.button" :disabled="previewLoading" :aria-label="i18n.ts.zalip._importer.closePreview" @click="preview = null; previewError = ''"><i class="ti ti-x" aria-hidden="true"></i></button></div>
						<p v-if="previewLoading"><i class="ti ti-loader-2 ti-spin" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.previewLoading }}</p>
						<p v-if="previewError" :class="$style.error" role="alert">{{ previewError }}</p>
						<template v-if="preview && !previewLoading">
							<div :class="$style.previewHero"><div :class="$style.previewPoster"><img v-if="importerImageUrl(preview.record.posterUrl)" :src="importerImageUrl(preview.record.posterUrl)!" alt=""><i v-else class="ti ti-movie" aria-hidden="true"></i></div><div><span :class="$style.badge">{{ preview.workId ? i18n.ts.zalip._importer.existingWork : i18n.ts.zalip._importer.newDraft }}</span><h3>{{ preview.record.title }}</h3><p>{{ [preview.record.releaseYear, preview.record.originalTitle].filter(Boolean).join(' · ') }}</p><p>{{ preview.record.genres.join(' · ') }}</p><p>{{ preview.record.description }}</p><div :class="$style.chips"><span v-for="identity in preview.record.identities" :key="`${identity.provider}:${identity.entityType}:${identity.externalId}`">{{ identity.provider }} · {{ identity.entityType }} · {{ identity.externalId }}</span></div></div></div>
							<ul v-if="preview.warnings.length" :class="$style.warnings"><li v-for="warning in preview.warnings" :key="warning">{{ warning }}</li></ul>
							<div :class="$style.chips"><span>{{ i18n.tsx.zalip._importer.peopleCount({ count: String(preview.record.credits.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.studiosCount({ count: String(preview.record.companies.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.collectionsCount({ count: String(preview.record.collections.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.seasonsCount({ count: String(preview.record.seasons.length) }) }}</span><span>{{ i18n.tsx.zalip._importer.playersCount({ count: String(preview.record.players.length) }) }}</span></div>
							<details :class="$style.details"><summary>{{ i18n.ts.zalip._importer.peopleAndCollections }}</summary><p v-if="preview.record.credits.length">{{ preview.record.credits.map(credit => `${credit.name} (${credit.role})`).join(' · ') }}</p><p v-if="preview.record.companies.length">{{ preview.record.companies.map(company => company.name).join(' · ') }}</p><p v-if="preview.record.collections.length">{{ preview.record.collections.map(collection => collection.name).join(' · ') }}</p></details>
							<h3>{{ i18n.ts.zalip._importer.changes }}</h3><p :class="$style.hint">{{ i18n.ts.zalip._importer.locksHint }}</p>
							<div :class="$style.diffList"><article v-for="change in preview.changes" :key="change.field" :class="$style.diff"><label><input type="checkbox" :checked="change.protected || lockedFields.includes(change.field)" :disabled="busy || (change.protected)" @change="toggleLock(change.field)"><strong>{{ importerFieldLabel(change.field) }}</strong><span v-if="change.protected" :class="$style.badge"><i class="ti ti-lock" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.protected }}</span></label><div :class="$style.diffValues"><div><small>{{ i18n.ts.zalip._importer.before }}</small><p>{{ formatImporterValue(change.before) }}</p></div><div><small>{{ i18n.ts.zalip._importer.after }}</small><p>{{ formatImporterValue(change.after) }}</p></div></div></article></div>
							<p v-if="preview.changes.length === 0" :class="$style.hint">{{ i18n.ts.zalip._importer.noChanges }}</p>
							<div :class="$style.actions"><button type="button" class="_button" :class="$style.primary" :disabled="busy" @click="queueReferences([preview.record.ref])"><i class="ti ti-download" aria-hidden="true"></i>{{ preview.workId ? i18n.ts.zalip._importer.enqueueUpdate : i18n.ts.zalip._importer.enqueueDraft }}</button><span :class="$style.hint">{{ i18n.ts.zalip._importer.noPublishing }}</span></div>
						</template>
					</section>
				</template>

				<template v-else-if="tab === 'runs'">
					<section :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.runsHeading }}</h2><p>{{ i18n.ts.zalip._importer.runsHint }}</p></div><button type="button" class="_button" :class="$style.button" :disabled="runsLoading" @click="loadRuns"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.refresh }}</button></div>
						<p v-if="runsError" :class="$style.error" role="alert">{{ runsError }}</p>
						<p v-if="runsLoading && !runs.length" :class="$style.hint">{{ i18n.ts.zalip._importer.runsLoading }}</p><p v-else-if="!runs.length && !runsError" :class="$style.hint">{{ i18n.ts.zalip._importer.noRuns }}</p>
						<div :class="$style.rows"><button v-for="run in runs" :key="run.id" type="button" class="_button" :class="[$style.runRow, { [$style.selectedRow]: selectedRun?.id === run.id }]" :disabled="busy" @click="loadRun(run.id)"><div><strong>{{ runModeLabel(run.mode) }} · {{ importerStateLabel(run.state) }}</strong><small>{{ dateLabel(run.createdAt) }} · {{ run.id }}</small></div><div><span>{{ run.completed }} / {{ run.total }}</span><small v-if="run.failed">{{ i18n.tsx.zalip._importer.failedCount({ count: String(run.failed) }) }}</small></div><progress :value="importerProgress(run.completed, run.total)" max="100" :aria-label="i18n.tsx.zalip._importer.runProgress({ id: run.id })"></progress></button></div>
					</section>
					<section v-if="selectedRun" :class="$style.panel">
						<div :class="$style.sectionHeading"><div><h2>{{ importerStateLabel(selectedRun.state) }}</h2><p>{{ selectedRun.id }}</p></div><div :class="$style.actions"><button v-if="['queued', 'running'].includes(selectedRun.state)" type="button" class="_button" :class="$style.button" :disabled="busy" @click="runAction('pause')"><i class="ti ti-player-pause" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.pause }}</button><button v-if="selectedRun.state === 'paused'" type="button" class="_button" :class="$style.button" :disabled="busy" @click="runAction('resume')"><i class="ti ti-player-play" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.resume }}</button><button v-if="selectedRun.failed > 0 || selectedRun.state === 'failed'" type="button" class="_button" :class="$style.button" :disabled="busy || selectedRun.state === 'running'" @click="runAction('retry')"><i class="ti ti-refresh" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.retryFailed }}</button><button v-if="['queued', 'running', 'paused'].includes(selectedRun.state)" type="button" class="_button" :class="$style.danger" :disabled="busy" @click="runAction('cancel')">{{ i18n.ts.zalip._importer.cancel }}</button></div></div>
						<p v-if="selectedRun.error" :class="$style.error" role="alert">{{ selectedRun.error }}</p>
						<div :class="$style.rows"><article v-for="item in runItems" :key="item.id" :class="$style.itemRow"><div><strong>{{ item.position + 1 }}. {{ importerSourceLabel(item.ref.source) }} · {{ item.ref.externalId }}</strong><small>{{ item.ref.mediaType }} · {{ importerStateLabel(item.state) }}</small><p v-if="item.error" :class="$style.error">{{ item.error }}</p></div><span v-if="item.workId" :class="$style.hint">{{ i18n.tsx.zalip._importer.itemWorkId({ id: item.workId }) }}</span></article></div>
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
						<template v-if="taxonomyForm.id"><h3>{{ i18n.ts.zalip._importer.linkedWorks }}</h3><form :class="$style.form" @submit.prevent="linkTaxonomy"><label><span>{{ i18n.ts.zalip._importer.workId }}</span><input v-model.trim="membership.workId" required maxlength="32" :placeholder="i18n.ts.zalip._importer.workIdPlaceholder" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.role }}</span><input v-model.trim="membership.role" maxlength="64" :placeholder="i18n.ts.zalip._importer.rolePlaceholder" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.character }}</span><input v-model.trim="membership.character" maxlength="256" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.position }}</span><input v-model.number="membership.position" type="number" min="0" max="100000" :disabled="busy"></label><button type="submit" class="_button" :class="$style.button" :disabled="busy || taxonomyWorksLoading"><i class="ti ti-link" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.linkWork }}</button></form><p v-if="taxonomyWorksLoading" :class="$style.hint" role="status">{{ i18n.ts.zalip._importer.loading }}</p><div :class="$style.rows"><article v-for="work in taxonomyWorks" :key="`${work.id}:${work.role ?? ''}`" :class="$style.itemRow"><div><strong>{{ work.title }}</strong><small>{{ [work.releaseYear, work.role, work.character].filter(Boolean).join(' · ') }}</small></div><button type="button" class="_button" :class="$style.danger" :disabled="busy || taxonomyWorksLoading" :aria-label="i18n.tsx.zalip._importer.unlinkWork({ name: work.title })" @click="unlinkTaxonomy(work)"><i class="ti ti-unlink" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.unlink }}</button></article></div></template>
					</section>
				</template>

				<template v-else>
					<section :class="$style.panel"><div :class="$style.sectionHeading"><div><h2>{{ i18n.ts.zalip._importer.schedulesHeading }}</h2><p>{{ i18n.ts.zalip._importer.schedulesHint }}</p></div><button type="button" class="_button" :class="$style.primary" :disabled="busy" @click="resetProfile"><i class="ti ti-plus" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.newSchedule }}</button></div><p v-if="profilesError" :class="$style.error" role="alert">{{ profilesError }}</p><div :class="$style.rows"><article v-for="profile in profiles" :key="profile.id" :class="$style.itemRow"><div :class="$style.grow"><strong>{{ profile.name }}</strong><small>{{ importerSourceLabel(profile.source) }} · {{ profileModeLabel(profile.mode) }} · {{ profile.enabled ? i18n.ts.zalip._importer.enabled : i18n.ts.zalip._importer.disabled }} · {{ i18n.tsx.zalip._importer.intervalSummary({ count: String(profile.intervalMinutes) }) }}</small><small>{{ i18n.tsx.zalip._importer.scheduleDates({ last: dateLabel(profile.lastRunAt), next: dateLabel(profile.nextRunAt) }) }}</small><p v-if="profile.lastError" :class="$style.error">{{ profile.lastError }}</p></div><div :class="$style.actions"><button type="button" class="_button" :class="$style.button" :disabled="busy" @click="editProfile(profile)">{{ i18n.ts.zalip._importer.edit }}</button><button type="button" class="_button" :class="$style.button" :disabled="busy" @click="runProfile(profile)"><i class="ti ti-player-play" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.run }}</button></div></article></div><p v-if="!profiles.length && !profilesError" :class="$style.hint">{{ i18n.ts.zalip._importer.noSchedules }}</p></section>
					<section :class="$style.panel"><h2>{{ profileForm.id ? i18n.ts.zalip._importer.editSchedule : i18n.ts.zalip._importer.newSchedule }}</h2><form :class="$style.form" @submit.prevent="saveProfile"><label><span>{{ i18n.ts.zalip._importer.name }}</span><input v-model.trim="profileForm.name" required maxlength="160" :disabled="busy"></label><label><span>{{ i18n.ts.zalip._importer.source }}</span><select v-model="profileForm.source" :disabled="busy"><option v-for="source in importerSources" :key="source" :value="source" :disabled="!sourceStatus(source)?.configured">{{ importerSourceLabel(source) }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.task }}</span><select v-model="profileForm.mode" :disabled="busy"><option value="metadata">{{ i18n.ts.zalip._importer.metadataMode }}</option><option value="availability">{{ i18n.ts.zalip._importer.availabilityMode }}</option><option value="collection">{{ i18n.ts.zalip._importer.collectionMode }}</option></select></label><label><span>{{ i18n.ts.zalip._importer.interval }}</span><input v-model.number="profileForm.intervalMinutes" type="number" required min="15" max="43200" :disabled="busy"></label><label v-if="profileForm.mode === 'collection'" :class="$style.wide"><span>{{ i18n.ts.zalip._importer.collectionId }}</span><input v-model.trim="profileForm.collectionId" required maxlength="128" pattern="[A-Za-z0-9_-]+" :disabled="busy"></label><label :class="$style.wide"><span>{{ i18n.ts.zalip._importer.categories }}</span><select v-model="profileForm.categoryIds" multiple size="3" :disabled="busy"><option v-for="entry in categories" :key="entry.id" :value="entry.id">{{ entry.name }}</option></select></label><fieldset :class="[$style.locks, $style.wide]"><legend>{{ i18n.ts.zalip._importer.lockedFields }}</legend><label v-for="field in importerFields" :key="field"><input v-model="profileForm.lockedFields" type="checkbox" :value="field" :disabled="busy">{{ importerFieldLabel(field) }}</label></fieldset><label :class="[$style.check, $style.wide]"><input v-model="profileForm.enabled" type="checkbox" :disabled="busy">{{ i18n.ts.zalip._importer.enableSchedule }}</label><p v-if="profileCapabilityWarning" :class="[$style.hint, $style.wide]">{{ profileCapabilityWarning }}</p><button type="submit" class="_button" :class="$style.primary" :disabled="busy || !profileForm.name || !!profileCapabilityWarning"><i class="ti ti-device-floppy" aria-hidden="true"></i>{{ i18n.ts.zalip._importer.saveSchedule }}</button></form></section>
				</template>
			</template>
		</main>
	</div>
</PageWithHeader>
</template>

<script lang="ts" setup>
import { i18n } from '@/i18n.js';
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, useTemplateRef, watch } from 'vue';
import type { ImportMediaType, ImportPreview, ImportProfile, ImportRef, ImportRun, ImportRunItem, ImportSearchItem, ImportSource, ImportSourceStatus, TaxonomyEntry, TaxonomyType, TaxonomyWork } from '@/utility/zalip-importer.js';
import { formatImporterValue, importerFieldLabel, importerFields, importerImageUrl, importerProgress, importerReference, importerReferenceKey, importerSourceLabel, importerSources, importerStateLabel, splitImporterReferenceLines, taxonomyTypeLabel, taxonomyTypes } from '@/utility/zalip-importer.js';
import { iAmAdmin } from '@/i.js';
import { definePage } from '@/page.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';
import * as os from '@/os.js';

type Tab = 'import' | 'runs' | 'taxonomy' | 'schedules';
const tabs: { id: Tab; title: string; icon: string }[] = [{ id: 'import', title: i18n.ts.zalip._importer.import, icon: 'ti ti-download' }, { id: 'runs', title: i18n.ts.zalip._importer.runs, icon: 'ti ti-list-check' }, { id: 'taxonomy', title: i18n.ts.zalip._importer.directories, icon: 'ti ti-tags' }, { id: 'schedules', title: i18n.ts.zalip._importer.schedules, icon: 'ti ti-clock' }];
const tab = ref<Tab>('import');
const sources = ref<ImportSourceStatus[]>([]);
const sourcesLoading = ref(true);
const sourcesError = ref('');
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
const lockedFields = ref<string[]>([]);
const preview = ref<ImportPreview | null>(null);
const previewLoading = ref(false);
const previewError = ref('');
const previewPanel = useTemplateRef('previewPanel');
const runs = ref<ImportRun[]>([]);
const runsLoading = ref(false);
const runsError = ref('');
const selectedRun = ref<ImportRun | null>(null);
const requestedRunId = ref<string | null>(null);
const runLoading = ref(false);
const runItems = ref<ImportRunItem[]>([]);
const taxonomyType = ref<TaxonomyType>('person');
const taxonomyQuery = ref('');
const taxonomyEntries = ref<TaxonomyEntry[]>([]);
const taxonomyWorks = ref<TaxonomyWork[]>([]);
const taxonomyWorksLoading = ref(false);
const categories = ref<TaxonomyEntry[]>([]);
const taxonomyLoading = ref(false);
const taxonomyError = ref('');
const taxonomyForm = reactive({ id: '', type: 'person' as TaxonomyType, name: '', slug: '', description: '', imageUrl: '', parentId: '' });
const taxonomyData = ref<Record<string, unknown>>({});
const categoryRules = reactive({ enabled: false, all: false, kinds: [] as string[], genres: '', countries: '', yearFrom: '', yearTo: '' });
const workKinds = [{ value: 'movie', title: i18n.ts.zalip._importer.movie }, { value: 'series', title: i18n.ts.zalip._importer.series }, { value: 'anime', title: i18n.ts.zalip._importer.anime }, { value: 'animation', title: i18n.ts.zalip._importer.animation }];
const membership = reactive({ workId: '', role: '', character: '', position: 0 });
const profiles = ref<ImportProfile[]>([]);
const profilesError = ref('');
const profileForm = reactive({ id: '', name: '', source: 'tmdb' as ImportSource, mode: 'metadata' as ImportProfile['mode'], intervalMinutes: 1440, enabled: false, collectionId: '', lockedFields: [] as string[], categoryIds: [] as string[] });
let pollTimer: number | null = null;
let pollBusy = false;
let searchRevision = 0;
let taxonomyRevision = 0;
let taxonomyWorksRevision = 0;
let previewRevision = 0;
let runRevision = 0;

function sourceStatus(source: ImportSource): ImportSourceStatus | undefined { return sources.value.find(item => item.source === source); }

const searchableSources = computed(() => sources.value.filter(source => source.configured && source.capabilities.search));
const canSearch = computed(() => sourceStatus(searchForm.source)?.configured && sourceStatus(searchForm.source)?.capabilities.search);
const profileCapabilityWarning = computed(() => {
	const source = sourceStatus(profileForm.source);
	if (!source?.configured) return i18n.ts.zalip._importer.sourceNotConfigured;
	if (profileForm.mode === 'collection' && !source.capabilities.collections) return i18n.ts.zalip._importer.collectionsUnsupported;
	if (profileForm.mode === 'availability' && !['alloha', 'collaps'].includes(profileForm.source)) return i18n.ts.zalip._importer.availabilityUnsupported;
	return '';
});

function errorMessage(error: unknown): string {
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

function profileModeLabel(mode: ImportProfile['mode']): string { return ({ metadata: i18n.ts.zalip._importer.metadata, availability: i18n.ts.zalip._importer.availabilityMode, collection: i18n.ts.zalip._importer.collectionMode })[mode]; }

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

function batchReferences(): ImportRef[] | null {
	const lines = splitImporterReferenceLines(batch.references);
	if (lines.length === 0 || lines.length > 100) { actionError.value = i18n.ts.zalip._importer.errorBatchSize; return null; }
	const refs = lines.map(value => importerReference(batch.source, batch.mediaType, value));
	if (refs.some(value => value === null)) { actionError.value = i18n.ts.zalip._importer.errorReferences; return null; }
	return refs as ImportRef[];
}

async function previewBatch(): Promise<void> { const refs = batchReferences(); if (refs) await showPreview(refs[0]); }

async function queueBatch(): Promise<void> { const refs = batchReferences(); if (refs) await queueReferences(refs); }

async function showPreview(value: ImportRef): Promise<void> {
	const revision = ++previewRevision;
	previewLoading.value = true;
	previewError.value = '';
	preview.value = null;
	lockedFields.value = [];
	await nextTick();
	previewPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	try {
		const result = await misskeyApiZalip<ImportPreview>('zalip/admin/importer/preview', { ref: value });
		if (revision === previewRevision) preview.value = result;
	} catch (error) { if (revision === previewRevision) previewError.value = errorMessage(error); } finally { if (revision === previewRevision) previewLoading.value = false; }
}

async function queueReferences(refs: ImportRef[]): Promise<void> {
	if (busy.value || refs.length === 0 || refs.length > 100) return;
	busy.value = true;
	actionError.value = '';
	try {
		const result = await misskeyApiZalip<{ id: string; state: string }>('zalip/admin/importer/runs/create', { refs, mode: 'import', lockedFields: lockedFields.value, categoryIds: categoryIds.value });
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
	if (action === 'cancel') { const result = await os.confirm({ type: 'warning', title: i18n.ts.zalip._importer.cancelRunTitle, text: i18n.ts.zalip._importer.cancelRunText }); if (result.canceled) return; }
	const runId = selectedRun.value.id;
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

function resetTaxonomyForm(): void { if (busy.value) return; taxonomyWorksRevision++; taxonomyWorksLoading.value = false; Object.assign(taxonomyForm, { id: '', type: taxonomyType.value, name: '', slug: '', description: '', imageUrl: '', parentId: '' }); taxonomyWorks.value = []; taxonomyData.value = {}; Object.assign(categoryRules, { enabled: false, all: false, kinds: [], genres: '', countries: '', yearFrom: '', yearTo: '' }); }

async function editTaxonomy(entry: TaxonomyEntry, fromSave = false): Promise<void> {
	if (busy.value && !fromSave) return;
	taxonomyWorks.value = [];
	Object.assign(taxonomyForm, { id: entry.id, type: entry.type, name: entry.name, slug: entry.slug, description: entry.description ?? '', imageUrl: entry.imageUrl ?? '', parentId: entry.parentId ?? '' });
	taxonomyData.value = { ...entry.data };
	const rules = typeof entry.data?.rules === 'object' && entry.data.rules !== null ? entry.data.rules as Record<string, unknown> : null;
	const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	Object.assign(categoryRules, { enabled: !!rules && Object.keys(rules).length > 0, all: rules?.all === true, kinds: strings(rules?.kinds), genres: strings(rules?.genres).join(', '), countries: strings(rules?.countries).join(', '), yearFrom: typeof rules?.yearFrom === 'number' ? String(rules.yearFrom) : '', yearTo: typeof rules?.yearTo === 'number' ? String(rules.yearTo) : '' });
	Object.assign(membership, { workId: '', role: '', character: '', position: 0 });
	await loadTaxonomyWorks(entry.id);
}

async function loadTaxonomyWorks(entryId: string): Promise<void> {
	const revision = ++taxonomyWorksRevision;
	taxonomyWorksLoading.value = true;
	try { const result = await misskeyApiZalip<{ entry: TaxonomyEntry; works: TaxonomyWork[] }>('zalip/admin/importer/taxonomy/show', { entryId }); if (revision === taxonomyWorksRevision && entryId === taxonomyForm.id) taxonomyWorks.value = result.works; } catch (error) { if (revision === taxonomyWorksRevision && entryId === taxonomyForm.id) actionError.value = errorMessage(error); } finally { if (revision === taxonomyWorksRevision) taxonomyWorksLoading.value = false; }
}

async function saveTaxonomy(): Promise<void> {
	if (busy.value) return;
	const yearFrom = categoryRules.yearFrom === '' ? undefined : Number(categoryRules.yearFrom);
	const yearTo = categoryRules.yearTo === '' ? undefined : Number(categoryRules.yearTo);
	if (taxonomyForm.type === 'category' && categoryRules.enabled && ([yearFrom, yearTo].some(year => year !== undefined && (!Number.isInteger(year) || year < 1888 || year > 3000)) || (yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo))) { actionError.value = i18n.ts.zalip._importer.invalidYears; return; }
	busy.value = true;
	actionError.value = '';
	try {
		const list = (value: string) => Array.from(new Set(value.split(',').map(item => item.trim()).filter(Boolean)));
		const entry = await misskeyApiZalip<TaxonomyEntry>('zalip/admin/importer/taxonomy/save', { entryId: taxonomyForm.id || undefined, type: taxonomyForm.type, name: taxonomyForm.name, slug: taxonomyForm.slug || undefined, description: taxonomyForm.description || null, imageUrl: taxonomyForm.imageUrl || null, parentId: taxonomyForm.parentId || null, ...(taxonomyForm.type === 'category' ? { data: { ...taxonomyData.value, rules: categoryRules.enabled ? { all: categoryRules.all, kinds: categoryRules.kinds, genres: list(categoryRules.genres), countries: list(categoryRules.countries), yearFrom, yearTo } : {} } } : {}) });
		await editTaxonomy(entry, true);
		await Promise.all([loadTaxonomy(), loadCategories()]);
		message.value = i18n.ts.zalip._importer.entrySaved;
	} catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
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
	if (result.canceled || busy.value || taxonomyWorksLoading.value || entryId !== taxonomyForm.id) return;
	busy.value = true;
	try { await misskeyApiZalip('zalip/admin/importer/taxonomy/link', { entryId, workId: work.id, role: work.role || undefined, remove: true }); if (taxonomyForm.id === entryId) await loadTaxonomyWorks(entryId); } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function loadProfiles(): Promise<void> {
	profilesError.value = '';
	try { profiles.value = (await misskeyApiZalip<{ profiles: ImportProfile[] }>('zalip/admin/importer/schedules/list')).profiles; } catch (error) { profilesError.value = errorMessage(error); }
}

function resetProfile(): void { if (busy.value) return; Object.assign(profileForm, { id: '', name: '', source: 'tmdb', mode: 'metadata', intervalMinutes: 1440, enabled: false, collectionId: '', lockedFields: [], categoryIds: [] }); }

function editProfile(profile: ImportProfile, fromSave = false): void { if (busy.value && !fromSave) return; Object.assign(profileForm, { id: profile.id, name: profile.name, source: profile.source, mode: profile.mode, intervalMinutes: profile.intervalMinutes, enabled: profile.enabled, collectionId: profile.collectionId ?? '', lockedFields: [...profile.lockedFields], categoryIds: [...profile.categoryIds] }); }

async function saveProfile(): Promise<void> {
	if (busy.value || profileCapabilityWarning.value) return;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<ImportProfile>('zalip/admin/importer/schedules/save', { ...profileForm, id: profileForm.id || undefined, collectionId: profileForm.mode === 'collection' ? profileForm.collectionId : null }); editProfile(result, true); await loadProfiles(); message.value = i18n.ts.zalip._importer.scheduleSaved; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function runProfile(profile: ImportProfile): Promise<void> {
	if (busy.value) return;
	busy.value = true;
	actionError.value = '';
	try { const result = await misskeyApiZalip<{ id: string; state: string }>('zalip/admin/importer/schedules/run', { profileId: profile.id }); tab.value = 'runs'; await Promise.all([loadRuns(), loadRun(result.id)]); message.value = i18n.ts.zalip._importer.scheduleEnqueued; } catch (error) { actionError.value = errorMessage(error); } finally { busy.value = false; }
}

async function pollRuns(): Promise<void> {
	if (!iAmAdmin || tab.value !== 'runs' || window.document.hidden || pollBusy) return;
	pollBusy = true;
	try { await loadRuns(); if (selectedRun.value && ['queued', 'running'].includes(selectedRun.value.state)) await loadRun(selectedRun.value.id, true); } finally { pollBusy = false; }
}

function startPolling(): void { if (iAmAdmin && pollTimer === null) pollTimer = window.setInterval(() => void pollRuns(), 5000); }

function stopPolling(): void { if (pollTimer !== null) window.clearInterval(pollTimer); pollTimer = null; }

watch(tab, value => { actionError.value = ''; if (value === 'runs') void loadRuns(); if (value === 'taxonomy') void loadTaxonomy(); if (value === 'schedules') void loadProfiles(); });
onMounted(() => { if (iAmAdmin) { void Promise.all([loadSources(), loadCategories(), loadRuns(), loadProfiles()]); startPolling(); } });
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
.sources { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
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
.page button:focus-visible, .page a:focus-visible, .page input:focus-visible, .page select:focus-visible, .page textarea:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 3px; }
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
.previewHero { display: flex; align-items: start; gap: 18px; margin: 18px 0; }
.previewHero h3 { margin-top: 12px; font-size: 1.35rem; }
.previewHero p { line-height: 1.6; font-size: .9rem; }
.previewPoster { display: grid; place-items: center; width: 130px; height: 195px; flex-shrink: 0; background: var(--MI_THEME-bg); border-radius: var(--MI-radius); overflow: clip; }
.previewPoster i { font-size: 3rem; color: var(--MI_THEME-fgTransparentWeak); }
.badge, .chips span { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px; border-radius: 999px; background: var(--MI_THEME-accentedBg); color: var(--MI_THEME-accent); font-size: .72rem; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 12px 0; }
.chips span { background: var(--MI_THEME-bg); color: var(--MI_THEME-fgTransparentWeak); overflow-wrap: anywhere; }
.warnings { padding: 14px 14px 14px 32px; border-radius: var(--MI-radius); background: var(--MI_THEME-infoWarnBg); color: var(--MI_THEME-infoWarnFg); font-size: .85rem; line-height: 1.6; }
.details { margin: 16px 0; font-size: .85rem; line-height: 1.6; }
.details summary { cursor: pointer; color: var(--MI_THEME-accent); }
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
.locks label, .page .check { flex-direction: row; align-items: center; }
.empty { padding: 50px 20px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
.empty i { font-size: 2rem; color: var(--MI_THEME-accent); }
@media (max-width: 650px) { .page { padding-top: 12px; } .sources { grid-template-columns: repeat(2, minmax(0, 1fr)); } .source { padding: 12px; } .heading { align-items: start; } .heading h1 { font-size: 1.5rem; } .panel { padding: 16px; } .tabs button { padding: 11px 14px; } .tabs button i { display: none; } .searchForm { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } .searchForm label { min-width: 0; } .searchForm .grow { grid-column: 1 / -1; } .searchForm > button { width: fit-content; } .form, .diffValues { grid-template-columns: 1fr; } .wide { grid-column: auto; } .result { flex-wrap: wrap; gap: 10px; } .result .button { margin-left: auto; } .previewHero { gap: 12px; } .previewPoster { width: 90px; height: 135px; } .previewHero h3 { font-size: 1.1rem; } }
</style>
