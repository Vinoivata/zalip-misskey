<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
	<PageWithHeader>
		<div class="_spacer" style="--MI_SPACER-w: 1000px;">
			<div :class="$style.page">
				<div v-if="!iAmAdmin" :class="$style.denied">
					<i class="ti ti-lock"></i>
					<strong>Редактор доступен только администраторам Misskey</strong>
					<span>Проверка прав выполняется ещё раз на сервере для каждого действия.</span>
				</div>

				<template v-else>
					<header :class="$style.header">
						<div><p :class="$style.eyebrow"><i class="ti ti-pencil"></i> {{ i18n.ts.controlPanel }}</p><h1>{{ i18n.ts.zalip.editorTitle }}</h1><p>{{ i18n.ts.zalip.editorHint }}</p></div>
						<MkA to="/" :class="$style.back"><i class="ti ti-arrow-left"></i> К кино</MkA>
					</header>

					<section :class="$style.create">
						<div><h2>Импорт из TMDB</h2><p>Сервер сам получает метаданные по ID. Ключ TMDB остаётся только в конфигурации сервера и никогда не попадает в браузер.</p></div>
						<form :class="$style.importForm" @submit.prevent="importTmdb">
							<select v-model="tmdb.mediaType" class="_input" aria-label="Тип в TMDB"><option value="movie">Фильм</option><option value="tv">Сериал</option></select>
							<input v-model.trim="tmdb.id" class="_input" inputmode="numeric" required placeholder="TMDB ID, например 11">
							<button class="_button" :class="$style.createButton" :disabled="tmdbSubmitting"><i class="ti ti-download"></i> {{ tmdbSubmitting ? 'Импортируем…' : 'Импортировать черновик' }}</button>
							<span v-if="tmdbMessage" :class="$style.importMessage">{{ tmdbMessage }}</span>
						</form>
					</section>

					<section :class="$style.create">
						<div><h2>Новый черновик</h2><p>Черновик не видят пользователи. Сначала проверьте данные, затем публикуйте его отдельно.</p></div>
						<form :class="$style.form" @submit.prevent="createDraft">
							<label><span>Название</span><input v-model.trim="form.title" class="_input" required maxlength="256" placeholder="Например, Путешествие к центру Земли"></label>
							<label><span>URL-идентификатор</span><input v-model.trim="form.slug" class="_input" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="160" placeholder="journey-to-the-center-of-the-earth"></label>
							<label><span>Тип</span><select v-model="form.kind" class="_input"><option value="movie">Фильм</option><option value="series">Сериал</option><option value="anime">Аниме</option><option value="animation">Анимация</option></select></label>
							<label><span>Год</span><input v-model.trim="form.releaseYear" class="_input" inputmode="numeric" maxlength="4" placeholder="2026"></label>
							<label :class="$style.wide"><span>Оригинальное название</span><input v-model.trim="form.originalTitle" class="_input" maxlength="256" placeholder="Необязательно"></label>
							<label :class="$style.wide"><span>Описание</span><textarea v-model.trim="form.description" class="_input" rows="4" maxlength="8192" placeholder="Необязательно; позже это заполнит импорт TMDB или редактор."></textarea></label>
							<div :class="$style.formFooter"><span v-if="message">{{ message }}</span><button class="_button" :class="$style.createButton" :disabled="submitting"><i class="ti ti-plus"></i> {{ submitting ? 'Создаём…' : 'Создать черновик' }}</button></div>
						</form>
					</section>

					<section :class="$style.works">
						<div :class="$style.sectionHeader"><div><p :class="$style.eyebrow">ПОСЛЕДНИЕ</p><h2>Тайтлы</h2></div><div :class="$style.sectionActions"><button class="_button" :class="$style.reload" :disabled="loading || bulkSyncing || allohaSyncing" @click="load"><i class="ti ti-refresh"></i></button><button class="_button" :class="$style.reload" :disabled="loading || bulkSyncing || allohaSyncing" @click="syncAllTmdbMedia"><i class="ti ti-database-import"></i> {{ bulkSyncing ? 'Обновляем TMDB…' : 'Обновить все TMDB' }}</button><button class="_button" :class="$style.reload" :disabled="loading || bulkSyncing || allohaSyncing" @click="syncAlloha"><i class="ti ti-device-tv"></i> {{ allohaSyncing ? 'Проверяем Alloha…' : 'Проверить Alloha' }}</button></div></div>
						<p v-if="bulkMessage" :class="$style.bulkMessage">{{ bulkMessage }}</p>
						<div v-if="loading" :class="$style.empty"><i class="ti ti-loader-2 ti-spin"></i> Загружаем…</div>
						<div v-else-if="works.length === 0" :class="$style.empty"><i class="ti ti-movie-off"></i> Черновиков пока нет.</div>
						<div v-else :class="$style.workList">
							<article v-for="work in works" :key="work.id" :class="$style.work">
								<div><p :class="$style.state" :data-state="work.publicationState">{{ stateLabel(work.publicationState) }}</p><h3>{{ work.title }}</h3><p :class="$style.meta">{{ kindLabel(work.kind) }}<span v-if="work.releaseYear"> · {{ work.releaseYear }}</span><span> · /zalip/{{ work.slug }}</span></p><p v-if="work.tmdbMediaType === 'tv' && work.seasons.length" :class="$style.syncHint">Сезоны из TMDB: перед публикацией загрузите метаданные серий.</p><details :class="$style.edit"><summary><i class="ti ti-pencil"></i> Править метаданные</summary><form @submit.prevent="updateWork(work)"><label><span>Название</span><input v-model.trim="editFor(work).title" class="_input" required maxlength="256"></label><label><span>Оригинальное название</span><input v-model.trim="editFor(work).originalTitle" class="_input" maxlength="256"></label><label><span>Год</span><input v-model.trim="editFor(work).releaseYear" class="_input" inputmode="numeric" maxlength="4"></label><label :class="$style.editWide"><span>Описание</span><textarea v-model.trim="editFor(work).description" class="_input" rows="3" maxlength="8192"></textarea></label><button class="_button" :class="$style.smallButton" :disabled="savingId === work.id"><i class="ti ti-device-floppy"></i> {{ savingId === work.id ? 'Сохраняем…' : 'Сохранить' }}</button></form></details><details v-if="work.kind !== 'movie'" :class="$style.edit"><summary><i class="ti ti-stack-2"></i> Добавить сезон вручную</summary><form @submit.prevent="createManualSeason(work)"><label><span>Номер сезона</span><input v-model.trim="manualSeasonFor(work).seasonNumber" class="_input" required inputmode="numeric" maxlength="5" placeholder="1"></label><label><span>Название сезона</span><input v-model.trim="manualSeasonFor(work).title" class="_input" required maxlength="256" placeholder="Сезон 1"></label><label><span>Дата выхода</span><input v-model="manualSeasonFor(work).airDate" class="_input" type="date"></label><label :class="$style.editWide"><span>Описание</span><textarea v-model.trim="manualSeasonFor(work).description" class="_input" rows="2" maxlength="8192"></textarea></label><button class="_button" :class="$style.smallButton" :disabled="savingId === work.id"><i class="ti ti-plus"></i> Добавить сезон</button></form></details><details v-for="season in work.seasons" :key="season.id" :class="$style.edit"><summary><i class="ti ti-list-details"></i> Добавить серию: {{ seasonLabel(season) }}</summary><form @submit.prevent="createManualEpisode(work, season)"><label><span>Номер серии</span><input v-model.trim="manualEpisodeFor(work, season).episodeNumber" class="_input" required inputmode="numeric" maxlength="6" placeholder="1"></label><label><span>Название серии</span><input v-model.trim="manualEpisodeFor(work, season).title" class="_input" required maxlength="256" placeholder="Серия 1"></label><label><span>Дата выхода</span><input v-model="manualEpisodeFor(work, season).airDate" class="_input" type="date"></label><label><span>Длительность, мин.</span><input v-model.trim="manualEpisodeFor(work, season).runtimeMinutes" class="_input" inputmode="numeric" maxlength="5" placeholder="Необязательно"></label><label :class="$style.editWide"><span>Описание</span><textarea v-model.trim="manualEpisodeFor(work, season).description" class="_input" rows="2" maxlength="8192"></textarea></label><button class="_button" :class="$style.smallButton" :disabled="savingId === work.id"><i class="ti ti-plus"></i> Добавить серию</button></form></details></div>
								<div :class="$style.workActions">
									<MkA v-if="work.publicationState === 'published'" :to="`/zalip/${work.slug}`" :class="$style.smallButton"><i class="ti ti-external-link"></i> Открыть</MkA>
									<button v-if="work.publicationState !== 'published'" class="_button" :class="$style.smallButton" :disabled="savingId === work.id" @click="setState(work, 'published')"><i class="ti ti-world"></i> Опубликовать</button>
									<button v-else class="_button" :class="$style.smallButton" :disabled="savingId === work.id" @click="setState(work, 'archived')"><i class="ti ti-eye-off"></i> Снять</button>
									<button v-if="work.publicationState === 'published'" class="_button" :class="$style.smallButton" :disabled="savingId === work.id" @click="openDiscussion(work)"><i class="ti ti-messages"></i> Обсуждение</button>
									<button v-if="work.tmdbMediaType" class="_button" :class="$style.smallButton" :disabled="mediaSyncingId === work.id" @click="syncTmdbMedia(work)"><i class="ti ti-refresh"></i> {{ mediaSyncingId === work.id ? 'Обновляем данные…' : 'Данные из TMDB' }}</button>
									<button v-for="season in work.tmdbMediaType === 'tv' ? work.seasons : []" :key="season.id" class="_button" :class="$style.smallButton" :disabled="syncingSeasonKey === seasonKey(work, season.seasonNumber)" @click="syncSeason(work, season.seasonNumber)"><i class="ti ti-list-details"></i> {{ syncingSeasonKey === seasonKey(work, season.seasonNumber) ? 'Загружаем…' : `Серии: ${season.seasonNumber === 0 ? 'спец.' : season.seasonNumber}` }}</button>
								</div>
								<p v-if="seasonMessage.workId === work.id" :class="$style.syncMessage">{{ seasonMessage.text }}</p>
								<p v-if="mediaMessage.workId === work.id" :class="$style.syncMessage">{{ mediaMessage.text }}</p>
							</article>
						</div>
					</section>
				</template>
			</div>
		</div>
	</PageWithHeader>
</template>

<script lang="ts" setup>
import { onMounted, reactive, ref } from 'vue';
import { i18n } from '@/i18n.js';
import { definePage } from '@/page.js';
import { iAmAdmin } from '@/i.js';
import { useRouter } from '@/router.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type WorkKind = 'movie' | 'series' | 'anime' | 'animation';
type PublicationState = 'draft' | 'published' | 'archived';
type AdminWork = {
	id: string;
	slug: string;
	kind: WorkKind;
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	publicationState: PublicationState;
	publishedAt: string | null;
	tmdbMediaType: 'movie' | 'tv' | null;
	tmdbId: number | null;
	seasons: Array<{ id: string; seasonNumber: number; title: string }>;
};

const router = useRouter();
const works = ref<AdminWork[]>([]);
const loading = ref(false);
const submitting = ref(false);
const savingId = ref<string | null>(null);
const message = ref('');
const form = reactive({ title: '', slug: '', kind: 'movie' as WorkKind, releaseYear: '', originalTitle: '', description: '' });
const tmdb = reactive({ mediaType: 'movie' as 'movie' | 'tv', id: '' });
const tmdbSubmitting = ref(false);
const tmdbMessage = ref('');
const syncingSeasonKey = ref<string | null>(null);
const seasonMessage = reactive({ workId: '', text: '' });
const mediaSyncingId = ref<string | null>(null);
const mediaMessage = reactive({ workId: '', text: '' });
const bulkSyncing = ref(false);
const bulkMessage = ref('');
const allohaSyncing = ref(false);
const edits = reactive<Record<string, { title: string; originalTitle: string; description: string; releaseYear: string; }>>({});
const manualSeasons = reactive<Record<string, { seasonNumber: string; title: string; description: string; airDate: string; }>>({});
const manualEpisodes = reactive<Record<string, { episodeNumber: string; title: string; description: string; airDate: string; runtimeMinutes: string; }>>({});

function kindLabel(kind: WorkKind): string {
	return ({ movie: 'Фильм', series: 'Сериал', anime: 'Аниме', animation: 'Анимация' })[kind];
}

function stateLabel(state: PublicationState): string {
	return ({ draft: 'Черновик', published: 'Опубликован', archived: 'Снят с публикации' })[state];
}

function tmdbImportErrorMessage(error: unknown): string {
	const code = typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string'
		? error.code
		: null;

	switch (code) {
		case 'ZALIP_TMDB_NOT_CONFIGURED': return 'TMDB не настроен на сервере.';
		case 'ZALIP_TMDB_NOT_FOUND': return 'TMDB не нашёл тайтл с этим ID и выбранным типом.';
		case 'ZALIP_TMDB_DUPLICATE': return 'Этот тайтл уже есть в каталоге.';
		case 'ZALIP_TMDB_UNAVAILABLE': return 'TMDB временно недоступен с сервера. Повторите попытку позже.';
		default: return 'Импорт не выполнен. Проверьте ID, выбранный тип и права администратора.';
	}
}

async function load(): Promise<void> {
	if (!iAmAdmin) return;
	loading.value = true;
	try {
		works.value = await misskeyApiZalip<AdminWork[]>('zalip/admin/works/list', { limit: 50 });
		for (const work of works.value) {
			edits[work.id] = { title: work.title, originalTitle: work.originalTitle ?? '', description: work.description ?? '', releaseYear: work.releaseYear?.toString() ?? '' };
		}
	} finally {
		loading.value = false;
	}
}

function editFor(work: AdminWork) {
	return edits[work.id] ?? (edits[work.id] = { title: work.title, originalTitle: work.originalTitle ?? '', description: work.description ?? '', releaseYear: work.releaseYear?.toString() ?? '' });
}

function manualSeasonFor(work: AdminWork) {
	return manualSeasons[work.id] ?? (manualSeasons[work.id] = { seasonNumber: '', title: '', description: '', airDate: '' });
}

function manualEpisodeFor(work: AdminWork, season: AdminWork['seasons'][number]) {
	const key = seasonKey(work, season.seasonNumber);
	return manualEpisodes[key] ?? (manualEpisodes[key] = { episodeNumber: '', title: '', description: '', airDate: '', runtimeMinutes: '' });
}

function seasonLabel(season: AdminWork['seasons'][number]): string {
	return season.seasonNumber === 0 ? 'Спецэпизоды' : `Сезон ${season.seasonNumber}`;
}

async function updateWork(work: AdminWork): Promise<void> {
	const edit = editFor(work);
	const releaseYear = edit.releaseYear === '' ? null : Number(edit.releaseYear);
	if (releaseYear !== null && (!Number.isSafeInteger(releaseYear) || releaseYear < 1888 || releaseYear > 3000)) {
		message.value = 'Год должен быть целым числом от 1888 до 3000.';
		return;
	}

	savingId.value = work.id;
	message.value = '';
	try {
		await misskeyApiZalip('zalip/admin/works/update', { workId: work.id, title: edit.title, originalTitle: edit.originalTitle || null, description: edit.description || null, releaseYear });
		message.value = `Метаданные «${edit.title}» сохранены.`;
		await load();
	} catch {
		message.value = 'Не удалось сохранить метаданные. Проверьте поля и права.';
	} finally {
		savingId.value = null;
	}
}

async function createManualSeason(work: AdminWork): Promise<void> {
	const form = manualSeasonFor(work);
	const seasonNumber = Number(form.seasonNumber);
	if (!Number.isSafeInteger(seasonNumber) || seasonNumber < 0 || seasonNumber > 10000) {
		seasonMessage.workId = work.id;
		seasonMessage.text = 'Номер сезона должен быть целым числом от 0 до 10 000.';
		return;
	}

	savingId.value = work.id;
	seasonMessage.workId = '';
	try {
		await misskeyApiZalip('zalip/admin/seasons/create', { workId: work.id, seasonNumber, title: form.title, originalTitle: null, description: form.description || null, airDate: form.airDate || null });
		manualSeasons[work.id] = { seasonNumber: '', title: '', description: '', airDate: '' };
		seasonMessage.workId = work.id;
		seasonMessage.text = `Сезон ${seasonNumber === 0 ? 'со спецэпизодами' : seasonNumber} добавлен.`;
		await load();
	} catch {
		seasonMessage.workId = work.id;
		seasonMessage.text = 'Не удалось добавить сезон. Проверьте номер, поля и отсутствие дубликата.';
	} finally {
		savingId.value = null;
	}
}

async function createManualEpisode(work: AdminWork, season: AdminWork['seasons'][number]): Promise<void> {
	const form = manualEpisodeFor(work, season);
	const episodeNumber = Number(form.episodeNumber);
	const runtimeMinutes = form.runtimeMinutes === '' ? null : Number(form.runtimeMinutes);
	if (!Number.isSafeInteger(episodeNumber) || episodeNumber < 0 || episodeNumber > 100000 || (runtimeMinutes != null && (!Number.isSafeInteger(runtimeMinutes) || runtimeMinutes < 0 || runtimeMinutes > 10000))) {
		seasonMessage.workId = work.id;
		seasonMessage.text = 'Проверьте номер серии и длительность: нужны неотрицательные целые числа.';
		return;
	}

	savingId.value = work.id;
	seasonMessage.workId = '';
	try {
		await misskeyApiZalip('zalip/admin/episodes/create', { workId: work.id, seasonNumber: season.seasonNumber, episodeNumber, title: form.title, originalTitle: null, description: form.description || null, airDate: form.airDate || null, runtimeMinutes });
		manualEpisodes[seasonKey(work, season.seasonNumber)] = { episodeNumber: '', title: '', description: '', airDate: '', runtimeMinutes: '' };
		seasonMessage.workId = work.id;
		seasonMessage.text = `Серия ${episodeNumber} добавлена в ${seasonLabel(season).toLowerCase()}.`;
		await load();
	} catch {
		seasonMessage.workId = work.id;
		seasonMessage.text = 'Не удалось добавить серию. Проверьте номер, поля и отсутствие дубликата.';
	} finally {
		savingId.value = null;
	}
}

async function createDraft(): Promise<void> {
	const year = form.releaseYear === '' ? null : Number(form.releaseYear);
	if (!Number.isSafeInteger(year ?? 0) && year !== null) {
		message.value = 'Год должен быть целым числом.';
		return;
	}

	submitting.value = true;
	message.value = '';
	try {
		await misskeyApiZalip('zalip/admin/works/create', {
			slug: form.slug,
			kind: form.kind,
			title: form.title,
			originalTitle: form.originalTitle || null,
			description: form.description || null,
			releaseYear: year,
		});
		Object.assign(form, { title: '', slug: '', kind: 'movie', releaseYear: '', originalTitle: '', description: '' });
		message.value = 'Черновик создан.';
		await load();
	} catch {
		message.value = 'Не удалось создать черновик. Проверьте URL-идентификатор и права.';
	} finally {
		submitting.value = false;
	}
}

async function importTmdb(): Promise<void> {
	const tmdbId = Number(tmdb.id);
	if (!Number.isSafeInteger(tmdbId) || tmdbId < 1) {
		tmdbMessage.value = 'Укажите корректный числовой TMDB ID.';
		return;
	}

	tmdbSubmitting.value = true;
	tmdbMessage.value = '';
	try {
		const work = await misskeyApiZalip<{ title: string }>('zalip/admin/works/import-tmdb', { tmdbMediaType: tmdb.mediaType, tmdbId });
		tmdb.id = '';
		tmdbMessage.value = `Создан черновик: ${work.title}.`;
		await load();
	} catch (error) {
		tmdbMessage.value = tmdbImportErrorMessage(error);
	} finally {
		tmdbSubmitting.value = false;
	}
}

async function setState(work: AdminWork, publicationState: PublicationState): Promise<void> {
	savingId.value = work.id;
	try {
		await misskeyApiZalip('zalip/admin/works/update-state', { workId: work.id, publicationState });
		await load();
	} finally {
		savingId.value = null;
	}
}

async function openDiscussion(work: AdminWork): Promise<void> {
	savingId.value = work.id;
	try {
		const discussion = await misskeyApiZalip<{ noteId: string }>('zalip/admin/discussions/create', { workId: work.id });
		router.push('/notes/:noteId/:initialTab?', { params: { noteId: discussion.noteId, initialTab: 'replies' } });
	} finally {
		savingId.value = null;
	}
}

function seasonKey(work: AdminWork, seasonNumber: number): string {
	return `${work.id}:${seasonNumber}`;
}

async function syncSeason(work: AdminWork, seasonNumber: number): Promise<void> {
	const key = seasonKey(work, seasonNumber);
	syncingSeasonKey.value = key;
	seasonMessage.workId = '';
	seasonMessage.text = '';
	try {
		const result = await misskeyApiZalip<{ added: number; updated: number; total: number }>('zalip/admin/seasons/import-tmdb', { workId: work.id, seasonNumber });
		seasonMessage.workId = work.id;
		seasonMessage.text = `Сезон ${seasonNumber === 0 ? 'со спецэпизодами' : seasonNumber}: сохранено ${result.total}, добавлено ${result.added}, обновлено ${result.updated}.`;
	} catch {
		seasonMessage.workId = work.id;
		seasonMessage.text = 'Серии не загрузились: проверьте настройки TMDB и данные тайтла.';
	} finally {
		syncingSeasonKey.value = null;
	}
}

async function syncTmdbMedia(work: AdminWork): Promise<void> {
	mediaSyncingId.value = work.id;
	mediaMessage.workId = '';
	mediaMessage.text = '';
	try {
		await misskeyApiZalip('zalip/admin/works/sync-tmdb-media', { workId: work.id });
		mediaMessage.workId = work.id;
		mediaMessage.text = `Жанры, длительность, кадры и трейлер для «${work.title}» обновлены из TMDB.`;
		await load();
	} catch (error) {
		mediaMessage.workId = work.id;
		mediaMessage.text = tmdbImportErrorMessage(error);
	} finally {
		mediaSyncingId.value = null;
	}
}

async function syncAllTmdbMedia(): Promise<void> {
	bulkSyncing.value = true;
	bulkMessage.value = '';
	try {
		const result = await misskeyApiZalip<{ total: number; updated: number; failed: number }>('zalip/admin/works/sync-all-tmdb-media', {});
		bulkMessage.value = result.failed === 0
			? `TMDB обновлён: ${result.updated} из ${result.total} тайтлов.`
			: `TMDB обновлён: ${result.updated} из ${result.total}; не удалось обновить: ${result.failed}.`;
		await load();
	} catch (error) {
		bulkMessage.value = tmdbImportErrorMessage(error);
	} finally {
		bulkSyncing.value = false;
	}
}

async function syncAlloha(): Promise<void> {
	allohaSyncing.value = true;
	bulkMessage.value = '';
	try {
		const result = await misskeyApiZalip<{ checked: number; available: number; events: number }>('zalip/admin/alloha/sync', {});
		bulkMessage.value = `Alloha проверена: ${result.available} из ${result.checked} тайтлов доступны; новых событий: ${result.events}.`;
	} catch (error) {
		const code = typeof error === 'object' && error != null && 'code' in error && typeof error.code === 'string' ? error.code : null;
		bulkMessage.value = code === 'ZALIP_ALLOHA_NOT_CONFIGURED'
			? 'Alloha не настроена на сервере.'
			: 'Alloha временно недоступна. Повторите проверку позже.';
	} finally {
		allohaSyncing.value = false;
	}
}

onMounted(() => void load());

definePage(() => ({ title: 'Редактор Zalip', icon: 'ti ti-pencil' }));
</script>

<style lang="scss" module>
.page { padding: 24px var(--MI-margin) 52px; }
.page input, .page select, .page textarea { width: 100%; min-width: 0; min-height: 44px; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--MI_THEME-divider); border-radius: 10px; background: var(--MI_THEME-bg); color: var(--MI_THEME-fg); font: inherit; font-size: 15px; }
.page input:focus, .page select:focus, .page textarea:focus { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
.page input::placeholder, .page textarea::placeholder { color: var(--MI_THEME-fgTransparentWeak); }
.header, .sectionHeader { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.sectionActions { display: flex; align-items: center; flex-wrap: wrap; justify-content: end; gap: 8px; }
.header { margin-bottom: 24px; }
.eyebrow { display: flex; align-items: center; gap: 7px; margin: 0 0 8px; color: var(--MI_THEME-accent); font-size: 0.72rem; font-weight: 700; letter-spacing: 0.1em; }
.header h1, .sectionHeader h2 { margin: 0; }
.back, .smallButton, .reload { display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; border-radius: 999px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fg); font-weight: 700; text-decoration: none; }
.back { flex-shrink: 0; white-space: nowrap; }
.create { padding: 22px; border: 1px solid var(--MI_THEME-divider); border-radius: 20px; background: var(--MI_THEME-panel); }
.create + .create { margin-top: 16px; }
.create h2 { margin: 0; font-size: 1.2rem; }
.create > div > p { margin: 7px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.88rem; }
.importForm { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-top: 18px; }
.importMessage { grid-column: 1 / -1; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.85rem; }
.form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-top: 20px; }
.form label { display: grid; gap: 6px; }
.form label span { font-size: 0.8rem; font-weight: 700; color: var(--MI_THEME-fgTransparentWeak); }
.form textarea { resize: vertical; }
.wide { grid-column: 1 / -1; }
.formFooter { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.85rem; }
.createButton { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 999px; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-weight: 700; }
.works { margin-top: 36px; }
.reload { padding: 9px; }
.empty, .denied { display: grid; justify-items: center; gap: 10px; padding: 48px 20px; border: 1px dashed var(--MI_THEME-divider); border-radius: 20px; color: var(--MI_THEME-fgTransparentWeak); text-align: center; }
.denied i, .empty i { color: var(--MI_THEME-accent); font-size: 2rem; }
.denied strong { color: var(--MI_THEME-fg); }
.workList { display: grid; gap: 10px; margin-top: 16px; }
.work { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px; border-radius: 16px; background: var(--MI_THEME-panel); }
.state { display: inline-flex; margin: 0 0 6px; padding: 3px 7px; border-radius: 999px; background: var(--MI_THEME-panelHighlight); color: var(--MI_THEME-fgTransparentWeak); font-size: 0.72rem; font-weight: 700; }
.state[data-state='published'] { color: var(--MI_THEME-accent); }
.state[data-state='archived'] { opacity: 0.65; }
.work h3 { margin: 0; font-size: 1rem; }
.meta { margin: 5px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.8rem; }
.syncHint, .syncMessage { margin: 8px 0 0; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.78rem; }
.syncMessage { grid-column: 1 / -1; color: var(--MI_THEME-accent); }
.bulkMessage { margin: 0 0 12px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.85rem; }
.edit { margin-top: 12px; color: var(--MI_THEME-fgTransparentWeak); font-size: 0.8rem; }
.edit summary { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--MI_THEME-accent); font-weight: 700; }
.edit form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
.edit label { display: grid; gap: 4px; }
.edit label span { font-size: 0.7rem; font-weight: 700; }
.edit textarea { resize: vertical; }
.editWide { grid-column: 1 / -1; }
.workActions { display: flex; flex-wrap: wrap; justify-content: end; gap: 7px; }
@media (max-width: 600px) { .page { padding-top: 12px; } .form, .importForm, .edit form { grid-template-columns: 1fr; } .wide, .editWide { grid-column: auto; } .work { align-items: start; flex-direction: column; } .workActions, .sectionActions { justify-content: start; } .header { align-items: start; } }
</style>
