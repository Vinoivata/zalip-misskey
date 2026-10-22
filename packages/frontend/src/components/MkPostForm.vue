<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	:class="[$style.root, { [$style.draghover]: draghover }]"
	@dragover.stop="onDragover"
	@dragenter="onDragenter"
	@dragleave="onDragleave"
	@drop.stop="onDrop"
>
	<header :class="$style.header">
		<div :class="$style.headerLeft">
			<button v-if="!fixed" type="button" :class="$style.cancel" class="_button" :aria-label="i18n.ts.cancel" @click="cancel">{{ i18n.ts.cancel }}</button>
		</div>
		<h2 :class="$style.heading">{{ replyTargetNote ? i18n.ts.reply : renoteTargetNote ? i18n.ts.quote : i18n.ts.zalip._postForm.newPost }}</h2>
		<div :class="$style.headerRight">
			<button ref="otherSettingsButton" v-tooltip="i18n.ts.other" type="button" class="_button" :class="$style.headerRightItem" :aria-label="i18n.ts.other" @click="showOtherSettings"><i class="ti ti-dots" aria-hidden="true"></i></button>
		</div>
	</header>
	<div :class="$style.authorRow">
		<button ref="accountMenuEl" v-tooltip="i18n.ts.account" type="button" class="_button" :class="$style.account" :aria-label="i18n.ts.account" @click="openAccountMenu">
			<img :class="$style.avatar" :src="(postAccount ?? $i).avatarUrl ?? undefined" alt="" decoding="async" width="40" height="40"/>
			<span :class="$style.accountName"><MkUserName :user="postAccount ?? $i"/></span>
			<i class="ti ti-chevron-down" aria-hidden="true"></i>
		</button>
		<div :class="$style.audience">
			<template v-if="!(targetChannel != null && fixed)">
				<button v-if="targetChannel == null" ref="visibilityButton" v-tooltip="i18n.ts.visibility" type="button" :class="['_button', $style.headerRightItem, $style.visibility]" :aria-label="`${i18n.ts.visibility}: ${i18n.ts._visibility[visibility]}`" @click="setVisibility">
					<span v-if="visibility === 'public'"><i class="ti ti-world"></i></span>
					<span v-if="visibility === 'home'"><i class="ti ti-home"></i></span>
					<span v-if="visibility === 'followers'"><i class="ti ti-lock"></i></span>
					<span v-if="visibility === 'specified'"><i class="ti ti-mail"></i></span>
					<span :class="$style.headerRightButtonText">{{ i18n.ts._visibility[visibility] }}</span>
				</button>
				<button v-else type="button" class="_button" :class="[$style.headerRightItem, $style.visibility]" :aria-label="targetChannel.name" disabled>
					<span><i class="ti ti-device-tv"></i></span>
					<span :class="$style.headerRightButtonText">{{ targetChannel.name }}</span>
				</button>
			</template>
		</div>
	</div>
	<div v-if="!communityLocked" :class="$style.communityRow">
		<button type="button" class="_button" :class="$style.communityButton" :disabled="posting || posted || props.mock" :aria-label="i18n.ts.zalip._communities.pick" :aria-haspopup="'dialog'" @click="chooseCommunity"><i class="ti ti-users" aria-hidden="true"></i><span>{{ targetChannel?.name ?? i18n.ts.zalip._communities.optional }}</span><i class="ti ti-chevron-down" aria-hidden="true"></i></button>
		<span v-if="targetChannel" :class="$style.communityNotice">{{ i18n.ts.zalip._communities.publicNotice }}</span>
	</div>
	<MkNoteSimple v-if="replyTargetNote" :class="$style.targetNote" :note="replyTargetNote"/>
	<MkNoteSimple v-if="renoteTargetNote" :class="$style.targetNote" :note="renoteTargetNote"/>
	<div v-if="quoteId" :class="$style.withQuote"><i class="ti ti-quote" aria-hidden="true"></i> {{ i18n.ts.quoteAttached }}<button type="button" class="_button" :aria-label="i18n.ts.remove" @click="quoteId = null; renoteTargetNote = null;"><i class="ti ti-x" aria-hidden="true"></i></button></div>
	<div v-if="visibility === 'specified'" :class="$style.toSpecified">
		<span style="margin-right: 8px;">{{ i18n.ts.recipient }}</span>
		<div :class="$style.visibleUsers">
			<span v-for="u in visibleUsers" :key="u.id" :class="$style.visibleUser">
				<MkAcct :user="u"/>
				<button type="button" class="_button" style="padding: 4px 8px;" :aria-label="`${i18n.ts.remove} @${u.username}`" @click="removeVisibleUser(u.id)"><i class="ti ti-x" aria-hidden="true"></i></button>
			</span>
			<button type="button" class="_buttonPrimary" style="padding: 4px; border-radius: 8px;" :aria-label="i18n.ts.add" @click="addVisibleUser"><i class="ti ti-plus ti-fw" aria-hidden="true"></i></button>
		</div>
	</div>
	<MkInfo v-if="!store.r.tips.value.postForm" :class="$style.showHowToUse" closable @close="closeTip('postForm')">
		<button type="button" class="_textButton" @click="showTour">{{ i18n.ts.help }}</button>
	</MkInfo>
	<MkInfo v-if="scheduledAt != null" :class="$style.scheduledAt">
		<I18n :src="i18n.ts.scheduleToPostOnX" tag="span">
			<template #x>
				<MkTime :time="scheduledAt" :mode="'detail'" style="font-weight: bold;"/>
			</template>
		</I18n> - <button class="_textButton" @click="cancelSchedule()">{{ i18n.ts.cancel }}</button>
	</MkInfo>
	<MkInfo v-if="hasNotSpecifiedMentions" warn :class="$style.hasNotSpecifiedMentions">{{ i18n.ts.notSpecifiedMentionWarning }} - <button class="_textButton" @click="addMissingMention()">{{ i18n.ts.add }}</button></MkInfo>
	<div v-show="useCw" :class="$style.cwOuter">
		<input ref="cwInputEl" v-model="cw" :class="$style.cw" :placeholder="i18n.ts.annotation" :aria-label="i18n.ts.annotation" @keydown="onKeydown" @keyup="onKeyup" @compositionend="onCompositionEnd">
		<div v-if="maxCwTextLength - cwTextLength < 20" :class="['_acrylic', $style.cwTextCount, { [$style.cwTextOver]: cwTextLength > maxCwTextLength }]">{{ maxCwTextLength - cwTextLength }}</div>
	</div>
	<div :class="[$style.textOuter, { [$style.withCw]: useCw }]">
		<div v-if="targetChannel" :class="$style.colorBar" :style="{ background: targetChannel.color }"></div>
		<textarea ref="textareaEl" v-model="text" :class="[$style.text]" :disabled="posting || posted" :readonly="textAreaReadOnly" :placeholder="placeholder" :aria-label="i18n.ts.note" data-testid="post-form-text" @keydown="onKeydown" @keyup="onKeyup" @paste="onPaste" @compositionupdate="onCompositionUpdate" @compositionend="onCompositionEnd"></textarea>
		<div v-if="maxTextLength - textLength < 100" :class="['_acrylic', $style.textCount, { [$style.textOver]: textLength > maxTextLength }]">{{ maxTextLength - textLength }}</div>
	</div>
	<input v-show="withHashtags" ref="hashtagsInputEl" v-model="hashtags" :class="$style.hashtags" :placeholder="i18n.ts.hashtags" :aria-label="i18n.ts.hashtags" list="hashtags">
	<div v-if="selectedZalipWork" :class="$style.zalipShare">
		<ZalipShareCard :share="selectedZalipWork" :preview="true"/>
		<button v-tooltip="i18n.ts.zalip._postForm.removeTitle" type="button" class="_button" :class="$style.removeZalipShare" :aria-label="i18n.ts.zalip._postForm.removeTitle" @click="removeZalipWork"><i class="ti ti-x" aria-hidden="true"></i></button>
	</div>
	<XPostFormAttaches v-if="!selectedZalipWork" v-model="files" @detach="detachFile" @changeSensitive="updateFileSensitive" @changeName="updateFileName"/>
	<div v-if="!selectedZalipWork && uploader.items.value.length > 0" style="padding: 12px;">
		<MkTip k="postFormUploader">
			{{ i18n.ts._postForm.uploaderTip }}
		</MkTip>
		<MkUploaderItems :items="uploader.items.value" @showMenu="(item, ev) => showPerUploadItemMenu(item, ev)" @showMenuViaContextmenu="(item, ev) => showPerUploadItemMenuViaContextmenu(item, ev)"/>
	</div>
	<MkPollEditor v-if="!selectedZalipWork && poll" v-model="poll" @destroyed="poll = null"/>
	<MkNotePreview v-if="showPreview" :class="$style.preview" :text="text" :files="files" :poll="poll ?? undefined" :useCw="useCw" :cw="cw" :user="postAccount ?? $i"/>
	<div v-if="showingOptions" style="padding: 8px 16px;">
	</div>
	<footer ref="footerEl" :class="$style.footer">
		<div :class="$style.footerLeft">
			<button v-tooltip="selectedZalipWork ? i18n.ts.zalip._postForm.replaceTitle : i18n.ts.zalip._postForm.attachTitle" type="button" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: selectedZalipWork }]" :aria-label="selectedZalipWork ? i18n.ts.zalip._postForm.replaceTitle : i18n.ts.zalip._postForm.attachTitle" :aria-pressed="selectedZalipWork != null" @click="chooseZalipWork"><i class="ti ti-movie" aria-hidden="true"></i></button>
			<template v-if="!selectedZalipWork">
				<button v-tooltip="i18n.ts.attachFile + ' (' + i18n.ts.upload + ')'" type="button" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.attachFile + ' (' + i18n.ts.upload + ')'" @click="chooseFileFromPc"><i class="ti ti-photo-plus" aria-hidden="true"></i></button>
				<button v-tooltip="i18n.ts.attachFile + ' (' + i18n.ts.fromDrive + ')'" type="button" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.attachFile + ' (' + i18n.ts.fromDrive + ')'" @click="chooseFileFromDrive"><i class="ti ti-cloud-download" aria-hidden="true"></i></button>
				<button v-tooltip="i18n.ts.poll" type="button" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: poll }]" :aria-label="i18n.ts.poll" :aria-pressed="poll != null" @click="togglePoll"><i class="ti ti-chart-arrows" aria-hidden="true"></i></button>
			</template>
			<button v-tooltip="i18n.ts.useCw" type="button" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: useCw }]" :aria-label="i18n.ts.useCw" :aria-pressed="useCw" @click="useCw = !useCw"><i class="ti ti-eye-off" aria-hidden="true"></i></button>
			<button v-tooltip="i18n.ts.hashtags" type="button" class="_button" :class="[$style.footerButton, { [$style.footerButtonActive]: withHashtags }]" :aria-label="i18n.ts.hashtags" :aria-pressed="withHashtags" @click="withHashtags = !withHashtags"><i class="ti ti-hash" aria-hidden="true"></i></button>
			<button v-tooltip="i18n.ts.mention" type="button" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.mention" @click="insertMention"><i class="ti ti-at" aria-hidden="true"></i></button>
			<button v-if="showAddMfmFunction" v-tooltip="i18n.ts.addMfmFunction" type="button" :class="['_button', $style.footerButton]" :aria-label="i18n.ts.addMfmFunction" @click="insertMfmFunction"><i class="ti ti-palette" aria-hidden="true"></i></button>
			<button v-if="postFormActions.length > 0" v-tooltip="i18n.ts.plugins" type="button" class="_button" :class="$style.footerButton" :aria-label="i18n.ts.plugins" @click="showActions"><i class="ti ti-plug" aria-hidden="true"></i></button>
			<button v-tooltip="i18n.ts.emoji" type="button" :class="['_button', $style.footerButton]" :aria-label="i18n.ts.emoji" @click="insertEmoji"><i class="ti ti-mood-happy" aria-hidden="true"></i></button>
		</div>
		<div :class="$style.footerRight">
			<button ref="submitButtonEl" type="button" class="_button" :class="$style.submit" :disabled="!canPost" :aria-busy="posting" data-testid="post-form-submit" @click="post">
				<div :class="$style.submitInner"><template v-if="posted"></template><template v-else-if="posting"><MkEllipsis/></template><template v-else>{{ submitText }}</template><i :class="submitIcon" aria-hidden="true"></i></div>
			</button>
		</div>
	</footer>
	<datalist id="hashtags">
		<option v-for="hashtag in recentHashtags" :key="hashtag" :value="hashtag"></option>
	</datalist>
</div>
</template>

<script lang="ts" setup>
import { watch, nextTick, onMounted, defineAsyncComponent, provide, shallowRef, ref, computed, useTemplateRef, onUnmounted, onBeforeUnmount } from 'vue';
import * as mfm from 'mfm-js';
import * as Misskey from 'misskey-js';
import insertTextAtCursor from 'insert-text-at-cursor';
import { toASCII } from 'punycode.js';
import { host, url } from '@@/js/config.js';
import MkUploaderItems from './MkUploaderItems.vue';
import type { ShallowRef } from 'vue';
import type { PostFormProps, ZalipWorkShare } from '@/types/post-form.js';
import type { MenuItem } from '@/types/menu.js';
import type { PollEditorModelValue } from '@/components/MkPollEditor.vue';
import type { UploaderItem } from '@/composables/use-uploader.js';
import MkNotePreview from '@/components/MkNotePreview.vue';
import ZalipShareCard from '@/components/ZalipShareCard.vue';
import XPostFormAttaches from '@/components/MkPostFormAttaches.vue';
import MkPollEditor from '@/components/MkPollEditor.vue';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import { erase, unique } from '@/utility/array.js';
import { extractMentions } from '@/utility/extract-mentions.js';
import { formatTimeString } from '@/utility/format-time-string.js';
import { Autocomplete } from '@/utility/autocomplete.js';
import * as os from '@/os.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { chooseDriveFile } from '@/utility/drive.js';
import { store } from '@/store.js';
import MkInfo from '@/components/MkInfo.vue';
import { i18n } from '@/i18n.js';
import { zalipDiscussionContext } from '@/utility/zalip-discussion-context.js';
import { instance } from '@/instance.js';
import { ensureSignin, notesCount, incNotesCount } from '@/i.js';
import { getAccounts, getAccountMenu } from '@/accounts.js';
import { deepClone } from '@/utility/clone.js';
import MkRippleEffect from '@/components/MkRippleEffect.vue';
import { miLocalStorage } from '@/local-storage.js';
import { claimAchievement } from '@/utility/achievements.js';
import { emojiPicker } from '@/utility/emoji-picker.js';
import { mfmFunctionPicker } from '@/utility/mfm-function-picker.js';
import { prefer } from '@/preferences.js';
import { getPluginHandlers } from '@/plugin.js';
import { DI } from '@/di.js';
import { globalEvents } from '@/events.js';
import { checkDragDataType, getDragData } from '@/drag-and-drop.js';
import { useUploader } from '@/composables/use-uploader.js';
import { startTour } from '@/utility/tour.js';
import { closeTip } from '@/tips.js';

const $i = ensureSignin();

const props = withDefaults(defineProps<PostFormProps & {
	fixed?: boolean;
	autofocus?: boolean;
	freezeAfterPosted?: boolean;
	mock?: boolean;
}>(), {
	initialVisibleUsers: () => [],
	autofocus: true,
	mock: false,
	initialLocalOnly: undefined,
});

provide(DI.mock, props.mock);

const emit = defineEmits<{
	(ev: 'posted'): void;
	(ev: 'cancel'): void;
	(ev: 'esc'): void;

	// Mock用
	(ev: 'fileChangeSensitive', fileId: string, to: boolean): void;
}>();

const textareaEl = useTemplateRef('textareaEl');
const cwInputEl = useTemplateRef('cwInputEl');
const hashtagsInputEl = useTemplateRef('hashtagsInputEl');
const visibilityButton = useTemplateRef('visibilityButton');
const otherSettingsButton = useTemplateRef('otherSettingsButton');
const accountMenuEl = useTemplateRef('accountMenuEl');
const footerEl = useTemplateRef('footerEl');
const submitButtonEl = useTemplateRef('submitButtonEl');

const posting = ref(false);
const posted = ref(false);
const text = ref(props.initialText ?? '');
const files = ref(props.initialFiles ?? []);
const poll = ref<PollEditorModelValue | null>(null);
const useCw = ref<boolean>(!!props.initialCw);
const showPreview = ref(store.s.showPreview);
watch(showPreview, () => store.set('showPreview', showPreview.value));
const showAddMfmFunction = ref(prefer.s.enableQuickAddMfmFunction);
watch(showAddMfmFunction, () => prefer.commit('enableQuickAddMfmFunction', showAddMfmFunction.value));
const cw = ref<string | null>(props.initialCw ?? null);
const localOnly = ref(props.initialLocalOnly ?? (prefer.s.rememberNoteVisibility ? store.s.localOnly : prefer.s.defaultNoteLocalOnly));
const visibility = ref(props.initialVisibility ?? (prefer.s.rememberNoteVisibility ? store.s.visibility : prefer.s.defaultNoteVisibility));
const visibleUsers = ref<Misskey.entities.UserDetailed[]>([]);
if (props.initialVisibleUsers) {
	props.initialVisibleUsers.forEach(u => pushVisibleUser(u));
}
const reactionAcceptance = ref(store.s.reactionAcceptance);
const scheduledAt = ref<number | null>(null);
const draghover = ref(false);
const quoteId = ref<string | null>(null);
const hasNotSpecifiedMentions = ref(false);
const recentHashtags = ref(JSON.parse(miLocalStorage.getItem('hashtags') ?? '[]'));
const imeText = ref('');
const showingOptions = ref(false);
const textAreaReadOnly = ref(false);
const justEndedComposition = ref(false);
const renoteTargetNote: ShallowRef<PostFormProps['renote'] | null> = shallowRef(props.renote);
const replyTargetNote: ShallowRef<PostFormProps['reply'] | null> = shallowRef(props.reply);
const targetChannel = shallowRef(props.channel);
const communityLocked = computed(() => props.channel != null || replyTargetNote.value != null || renoteTargetNote.value != null || props.initialNote != null);
const personalCommunityAudience = ref({ visibility: visibility.value, localOnly: localOnly.value });
let communityRequest = 0;
let communityPickerOpen = false;
let communityAlive = true;
const selectedZalipWork = ref<ZalipWorkShare | null>(props.zalipWork ?? null);

const serverDraftId = ref<string | null>(null);
const postFormActions = getPluginHandlers('post_form_action');

let textAutocomplete: Autocomplete | null = null;
let cwAutocomplete: Autocomplete | null = null;
let hashtagAutocomplete: Autocomplete | null = null;

const uploader = useUploader({
	multiple: true,
});

onUnmounted(() => {
	uploader.dispose();
});

uploader.events.on('itemUploaded', ctx => {
	files.value.push(ctx.item.uploaded!);
	uploader.removeItem(ctx.item);
});

const draftKey = computed((): string => {
	// Keep the originating draft slot stable when adding/removing an optional group.
	let key = props.channel ? `channel:${props.channel.id}` : '';

	if (props.zalipWork) {
		key += `zalip:${props.zalipWork.id}`;
	} else if (renoteTargetNote.value) {
		key += `renote:${renoteTargetNote.value.id}`;
	} else if (replyTargetNote.value) {
		key += `reply:${replyTargetNote.value.id}`;
	} else {
		key += `note:${$i.id}`;
	}

	return key;
});

const placeholder = computed((): string => {
	if (renoteTargetNote.value) {
		return i18n.ts._postForm.quotePlaceholder;
	} else if (replyTargetNote.value) {
		const context = zalipDiscussionContext(replyTargetNote.value);
		return context?.isRoot ? i18n.tsx.zalip.contentCommentPlaceholder({ title: context.title }) : i18n.ts._postForm.replyPlaceholder;
	} else if (targetChannel.value) {
		return i18n.ts._postForm.channelPlaceholder;
	} else {
		const xs = [
			i18n.ts._postForm._placeholders.a,
			i18n.ts._postForm._placeholders.b,
			i18n.ts._postForm._placeholders.c,
			i18n.ts._postForm._placeholders.d,
			i18n.ts._postForm._placeholders.e,
			i18n.ts._postForm._placeholders.f,
		];
		return xs[Math.floor(Math.random() * xs.length)];
	}
});

const submitText = computed((): string => {
	return scheduledAt.value != null
		? i18n.ts.schedule
		: selectedZalipWork.value
			? i18n.ts.zalip.shareTitle
			: renoteTargetNote.value
				? i18n.ts.quote
				: replyTargetNote.value
					? i18n.ts.reply
					: i18n.ts.note;
});

const submitIcon = computed((): string => {
	return posted.value ? 'ti ti-check' : scheduledAt.value != null ? 'ti ti-calendar-time' : replyTargetNote.value ? 'ti ti-arrow-back-up' : renoteTargetNote.value ? 'ti ti-quote' : 'ti ti-send';
});

const textLength = computed((): number => {
	return (text.value + imeText.value).length;
});

const maxTextLength = computed((): number => {
	return instance ? instance.maxNoteTextLength : 1000;
});

const cwTextLength = computed((): number => {
	return cw.value?.length ?? 0;
});

const maxCwTextLength = 100;

const canPost = computed((): boolean => {
	return !props.mock && !posting.value && !posted.value && !uploader.uploading.value && (uploader.items.value.length === 0 || uploader.readyForUpload.value) &&
		(
			selectedZalipWork.value != null ||
			1 <= textLength.value ||
			1 <= files.value.length ||
			1 <= uploader.items.value.length ||
			poll.value != null ||
			renoteTargetNote.value != null ||
			quoteId.value != null
		) &&
		(textLength.value <= maxTextLength.value) &&
		(
			useCw.value ?
				(
					cw.value != null && cw.value.trim() !== '' &&
					cwTextLength.value <= maxCwTextLength
				) : true
		) &&
		(files.value.length <= 16) &&
		(!poll.value || poll.value.choices.length >= 2);
});

// cannot save pure renote as draft
const canSaveAsServerDraft = computed((): boolean => {
	return selectedZalipWork.value == null && canPost.value && (textLength.value > 0 || files.value.length > 0 || poll.value != null);
});

const withHashtags = store.model('postFormWithHashtags');
const hashtags = store.model('postFormHashtags');

watch(text, () => {
	checkMissingMention();
}, { immediate: true });

watch(visibility, () => {
	checkMissingMention();
}, { immediate: true });

watch(visibleUsers, () => {
	checkMissingMention();
}, {
	deep: true,
});

if (props.mention) {
	text.value = props.mention.host ? `@${props.mention.username}@${toASCII(props.mention.host)}` : `@${props.mention.username}`;
	text.value += ' ';
}

if (replyTargetNote.value && !zalipDiscussionContext(replyTargetNote.value)?.isRoot && (replyTargetNote.value.user.username !== $i.username || (replyTargetNote.value.user.host != null && replyTargetNote.value.user.host !== host))) {
	text.value = `@${replyTargetNote.value.user.username}${replyTargetNote.value.user.host != null ? '@' + toASCII(replyTargetNote.value.user.host) : ''} `;
}

if (replyTargetNote.value && !zalipDiscussionContext(replyTargetNote.value)?.isRoot && replyTargetNote.value.text != null) {
	const ast = mfm.parse(replyTargetNote.value.text);
	const otherHost = replyTargetNote.value.user.host;

	for (const x of extractMentions(ast)) {
		const mention = x.host ?
			`@${x.username}@${toASCII(x.host)}` :
			(otherHost == null || otherHost === host) ?
				`@${x.username}` :
				`@${x.username}@${toASCII(otherHost)}`;

		// 自分は除外
		if ($i.username === x.username && (x.host == null || x.host === host)) continue;

		// 重複は除外
		if (text.value.includes(`${mention} `)) continue;

		text.value += `${mention} `;
	}
}

if ($i.isSilenced && visibility.value === 'public') {
	visibility.value = 'home';
}

if (targetChannel.value) {
	visibility.value = 'public';
	localOnly.value = true; // TODO: チャンネルが連合するようになった折には消す
}

// 公開以外へのリプライ時は元の公開範囲を引き継ぐ
if (replyTargetNote.value && ['home', 'followers', 'specified'].includes(replyTargetNote.value.visibility)) {
	if (replyTargetNote.value.visibility === 'home' && visibility.value === 'followers') {
		visibility.value = 'followers';
	} else if (['home', 'followers'].includes(replyTargetNote.value.visibility) && visibility.value === 'specified') {
		visibility.value = 'specified';
	} else {
		visibility.value = replyTargetNote.value.visibility;
	}

	if (visibility.value === 'specified') {
		if (replyTargetNote.value.visibleUserIds) {
			misskeyApi('users/show', {
				userIds: replyTargetNote.value.visibleUserIds.filter(uid => uid !== $i.id && uid !== replyTargetNote.value?.userId),
			}).then(users => {
				users.forEach(u => pushVisibleUser(u));
			});
		}

		if (replyTargetNote.value.userId !== $i.id) {
			misskeyApi('users/show', { userId: replyTargetNote.value.userId }).then(user => {
				pushVisibleUser(user);
			});
		}
	}
}

if (props.specified) {
	visibility.value = 'specified';
	pushVisibleUser(props.specified);
}

// keep cw when reply
if (prefer.s.keepCw && replyTargetNote.value && replyTargetNote.value.cw) {
	useCw.value = true;
	cw.value = replyTargetNote.value.cw;
}

function watchForDraft() {
	watch(text, () => saveDraft());
	watch(useCw, () => saveDraft());
	watch(cw, () => saveDraft());
	watch(poll, () => saveDraft());
	watch(files, () => saveDraft(), { deep: true });
	watch(visibility, () => saveDraft());
	watch(localOnly, () => saveDraft());
	watch(quoteId, () => saveDraft());
	watch(reactionAcceptance, () => saveDraft());
	watch(scheduledAt, () => saveDraft());
	watch(targetChannel, () => saveDraft());
}

function chooseCommunity(): void {
	if (communityLocked.value || communityPickerOpen || posting.value || posted.value || props.mock) return;
	const request = ++communityRequest;
	const account = postAccount.value?.id ?? $i.id;
	const current = () => communityAlive && request === communityRequest && account === (postAccount.value?.id ?? $i.id) && !posting.value && !posted.value;
	communityPickerOpen = true;
	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkZalipCommunityPicker.vue')), { currentChannelId: targetChannel.value?.id ?? null }, {
		selected: async channel => {
			if (!current() || channel?.isArchived) return;
			if (channel && visibility.value !== 'public') {
				const { canceled } = await os.confirm({ type: 'warning', text: i18n.ts.zalip._communities.publicNotice });
				if (canceled || !current()) return;
			}
			if (channel) {
				if (!targetChannel.value) personalCommunityAudience.value = { visibility: visibility.value, localOnly: localOnly.value };
				targetChannel.value = channel;
				visibility.value = 'public';
				localOnly.value = true;
			} else if (targetChannel.value) {
				targetChannel.value = null;
				visibility.value = personalCommunityAudience.value.visibility;
				localOnly.value = personalCommunityAudience.value.localOnly;
			}
		},
		closed: () => { communityPickerOpen = false; dispose(); },
	});
}

function checkMissingMention() {
	if (visibility.value === 'specified') {
		const ast = mfm.parse(text.value);

		for (const x of extractMentions(ast)) {
			if (!visibleUsers.value.some(u => (u.username === x.username) && ((u.host === x.host) || (x.host === host && u.host == null)))) {
				hasNotSpecifiedMentions.value = true;
				return;
			}
		}
	}
	hasNotSpecifiedMentions.value = false;
}

function addMissingMention() {
	const ast = mfm.parse(text.value);

	for (const x of extractMentions(ast)) {
		if (!visibleUsers.value.some(u => (u.username === x.username) && (u.host === x.host))) {
			misskeyApi('users/show', { username: x.username, host: x.host }).then(user => {
				pushVisibleUser(user);
			});
		}
	}
}

function togglePoll() {
	if (poll.value) {
		poll.value = null;
	} else {
		poll.value = {
			choices: ['', ''],
			multiple: false,
			expiresAt: null,
			expiredAfter: null,
		};
	}
}

async function chooseZalipWork(): Promise<void> {
	if (props.mock) return;

	const replacesAttachments = selectedZalipWork.value == null && (files.value.length > 0 || uploader.items.value.length > 0 || poll.value != null);
	if (replacesAttachments) {
		const { canceled } = await os.confirm({
			type: 'question',
			text: 'Карточка тайтла — отдельный формат записи. Прикреплённые файлы и опрос будут убраны.',
		});
		if (canceled) return;
	}

	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/ZalipWorkPickerDialog.vue')), {
		initialQuery: selectedZalipWork.value?.title ?? '',
	}, {
		selected: work => {
			if (replacesAttachments) {
				files.value = [];
				poll.value = null;
				uploader.reset();
			}
			selectedZalipWork.value = work;
			scheduledAt.value = null;
		},
		closed: () => dispose(),
	});
}

function removeZalipWork(): void {
	selectedZalipWork.value = null;
}

function addTag(tag: string) {
	if (textareaEl.value == null) return;
	insertTextAtCursor(textareaEl.value, ` #${tag} `);
}

function focus() {
	if (textareaEl.value) {
		textareaEl.value.focus();
		textareaEl.value.setSelectionRange(textareaEl.value.value.length, textareaEl.value.value.length);
	}
}

function chooseFileFromPc(ev: PointerEvent) {
	if (props.mock) return;

	os.chooseFileFromPc({ multiple: true }).then(files => {
		if (files.length === 0) return;
		uploader.addFiles(files);
	});
}

function chooseFileFromDrive(ev: PointerEvent) {
	if (props.mock) return;

	chooseDriveFile({ multiple: true }).then(driveFiles => {
		files.value.push(...driveFiles);
	});
}

function detachFile(id: Misskey.entities.DriveFile['id']) {
	files.value = files.value.filter(x => x.id !== id);
}

function updateFileSensitive(file: Misskey.entities.DriveFile, isSensitive: boolean) {
	if (props.mock) {
		emit('fileChangeSensitive', file.id, isSensitive);
	}
	files.value[files.value.findIndex(x => x.id === file.id)].isSensitive = isSensitive;
}

function updateFileName(file: Misskey.entities.DriveFile, name: Misskey.entities.DriveFile['name']) {
	files.value[files.value.findIndex(x => x.id === file.id)].name = name;
}

function setVisibility() {
	if (targetChannel.value) {
		visibility.value = 'public';
		localOnly.value = true; // TODO: チャンネルが連合するようになった折には消す
		return;
	}

	const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkVisibilityPicker.vue')), {
		currentVisibility: visibility.value,
		isSilenced: $i.isSilenced,
		anchorElement: visibilityButton.value,
		...(replyTargetNote.value ? { isReplyVisibilitySpecified: replyTargetNote.value.visibility === 'specified' } : {}),
	}, {
		changeVisibility: v => {
			visibility.value = v;
			if (prefer.s.rememberNoteVisibility) {
				store.set('visibility', visibility.value);
			}
		},
		closed: () => dispose(),
	});
}

//#region その他の設定メニューpopup
function showOtherSettings() {
	const menuItems = [{
		type: 'button',
		text: i18n.ts._drafts.saveToDraft,
		icon: 'ti ti-cloud-upload',
		action: async () => {
			if (!canSaveAsServerDraft.value) {
				return os.alert({
					type: 'error',
					text: i18n.ts._drafts.cannotCreateDraft,
				});
			}
			saveServerDraft();
		},
	}, ...($i.policies.scheduledNoteLimit > 0 ? [{
		icon: 'ti ti-calendar-time',
		text: i18n.ts.schedulePost + '...',
		action: () => {
			schedule();
		},
	}] : []), { type: 'divider' }, {
		type: 'switch',
		icon: 'ti ti-eye',
		text: i18n.ts.preview,
		ref: showPreview,
	}, {
		icon: 'ti ti-trash',
		text: i18n.ts.reset,
		danger: true,
		action: async () => {
			if (props.mock) return;
			const { canceled } = await os.confirm({
				type: 'question',
				text: i18n.ts.resetAreYouSure,
			});
			if (canceled) return;
			clear();
		},
	}] satisfies MenuItem[];

	os.popupMenu(menuItems, otherSettingsButton.value, { appearance: 'zalip-note', width: 300 });
}
//#endregion

function pushVisibleUser(user: Misskey.entities.UserDetailed) {
	if (!visibleUsers.value.some(u => u.username === user.username && u.host === user.host)) {
		visibleUsers.value.push(user);
	}
}

function addVisibleUser() {
	os.selectUser().then(user => {
		pushVisibleUser(user);

		if (!text.value.toLowerCase().includes(`@${user.username.toLowerCase()}`)) {
			text.value = `@${Misskey.acct.toString(user)} ${text.value}`;
		}
	});
}

function removeVisibleUser(id: string) {
	visibleUsers.value = visibleUsers.value.filter(u => u.id !== id);
}

function clear() {
	text.value = '';
	cw.value = null;
	files.value = [];
	poll.value = null;
	quoteId.value = null;
	scheduledAt.value = null;
	selectedZalipWork.value = props.zalipWork ?? null;
	uploader.reset();
}

function onKeydown(ev: KeyboardEvent) {
	if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey) && canPost.value) post();

	// justEndedComposition.value is for Safari, which keyDown occurs after compositionend.
	// ev.isComposing is for another browsers.
	if (ev.key === 'Escape' && !justEndedComposition.value && !ev.isComposing) emit('esc');
}

function onKeyup(ev: KeyboardEvent) {
	justEndedComposition.value = false;
}

function onCompositionUpdate(ev: CompositionEvent) {
	imeText.value = ev.data;
}

function onCompositionEnd(ev: CompositionEvent) {
	imeText.value = '';
	justEndedComposition.value = true;
}

const pastedFileName = 'yyyy-MM-dd HH-mm-ss [{{number}}]';

async function onPaste(ev: ClipboardEvent) {
	if (props.mock) return;
	if (ev.clipboardData == null) return;
	if (textareaEl.value == null) return;

	let pastedFiles: File[] = [];
	for (const { item, i } of Array.from(ev.clipboardData.items, (data, x) => ({ item: data, i: x }))) {
		if (item.kind === 'file') {
			const file = item.getAsFile();
			if (!file) continue;
			const lio = file.name.lastIndexOf('.');
			const ext = lio >= 0 ? file.name.slice(lio) : '';
			const formattedName = `${formatTimeString(new Date(file.lastModified), pastedFileName).replace(/{{number}}/g, `${i + 1}`)}${ext}`;
			const renamedFile = new File([file], formattedName, { type: file.type });
			pastedFiles.push(renamedFile);
		}
	}
	if (pastedFiles.length > 0) {
		ev.preventDefault();
		uploader.addFiles(pastedFiles);
		return;
	}

	const paste = ev.clipboardData.getData('text');

	if (!renoteTargetNote.value && !quoteId.value && paste.startsWith(url + '/notes/')) {
		ev.preventDefault();

		const { canceled } = await os.confirm({
			type: 'info',
			text: i18n.ts.quoteQuestion,
		});

		if (canceled) {
			insertTextAtCursor(textareaEl.value, paste);
			return;
		}

		quoteId.value = paste.substring(url.length).match(/^\/notes\/(.+?)\/?$/)?.[1] ?? null;
	}

	if (paste.length > 1000) {
		ev.preventDefault();

		const { canceled } = await os.confirm({
			type: 'info',
			text: i18n.ts.attachAsFileQuestion,
		});

		if (canceled) {
			insertTextAtCursor(textareaEl.value, paste);
			return;
		}

		const fileName = formatTimeString(new Date(), pastedFileName).replace(/{{number}}/g, '0');
		const file = new File([paste], `${fileName}.txt`, { type: 'text/plain' });
		uploader.addFiles([file]);
	}
}

function onDragover(ev: DragEvent) {
	if (ev.dataTransfer == null) return;
	if (ev.dataTransfer.items[0] == null) return;

	const isFile = ev.dataTransfer.items[0].kind === 'file';
	if (isFile || checkDragDataType(ev, ['driveFiles'])) {
		ev.preventDefault();
		draghover.value = true;
		switch (ev.dataTransfer.effectAllowed) {
			case 'all':
			case 'uninitialized':
			case 'copy':
			case 'copyLink':
			case 'copyMove':
				ev.dataTransfer.dropEffect = 'copy';
				break;
			case 'linkMove':
			case 'move':
				ev.dataTransfer.dropEffect = 'move';
				break;
			default:
				ev.dataTransfer.dropEffect = 'none';
				break;
		}
	}
}

function onDragenter() {
	draghover.value = true;
}

function onDragleave() {
	draghover.value = false;
}

function onDrop(ev: DragEvent): void {
	draghover.value = false;

	// ファイルだったら
	if (ev.dataTransfer && ev.dataTransfer.files.length > 0) {
		ev.preventDefault();
		uploader.addFiles(Array.from(ev.dataTransfer.files));
		return;
	}

	//#region ドライブのファイル
	{
		const droppedData = getDragData(ev, 'driveFiles');
		if (droppedData != null) {
			files.value.push(...droppedData);
			ev.preventDefault();
		}
	}
	//#endregion
}

type StoredDrafts = {
	[key: string]: {
		updatedAt: string;
		data: {
			text: string;
			useCw: boolean;
			cw: string | null;
			visibility: 'public' | 'home' | 'followers' | 'specified';
			localOnly: boolean;
			files: Misskey.entities.DriveFile[];
			poll: PollEditorModelValue | null;
			visibleUserIds?: string[];
			quoteId: string | null;
			reactionAcceptance: 'likeOnly' | 'likeOnlyForRemote' | 'nonSensitiveOnly' | 'nonSensitiveOnlyForLocalLikeOnlyForRemote' | null;
			scheduledAt: number | null;
			channel?: PostFormProps['channel'];
			communityAudience?: { visibility: 'public' | 'home' | 'followers' | 'specified'; localOnly: boolean };
		};
	};
};

function saveDraft() {
	if (props.instant || props.mock) return;

	const draftsData = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}') as StoredDrafts;

	draftsData[draftKey.value] = {
		updatedAt: new Date().toISOString(),
		data: {
			text: text.value,
			useCw: useCw.value,
			cw: cw.value,
			visibility: visibility.value,
			localOnly: localOnly.value,
			files: files.value,
			poll: poll.value,
			...( visibleUsers.value.length > 0 ? { visibleUserIds: visibleUsers.value.map(x => x.id) } : {}),
			quoteId: quoteId.value,
			reactionAcceptance: reactionAcceptance.value,
			scheduledAt: scheduledAt.value,
			channel: targetChannel.value ?? null,
			communityAudience: personalCommunityAudience.value,
		},
	};

	miLocalStorage.setItem('drafts', JSON.stringify(draftsData));
}

function deleteDraft() {
	const draftsData = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}') as StoredDrafts;

	delete draftsData[draftKey.value];

	miLocalStorage.setItem('drafts', JSON.stringify(draftsData));
}

async function saveServerDraft(options: {
	isActuallyScheduled?: boolean;
} = {}) {
	return await os.apiWithDialog(serverDraftId.value == null ? 'notes/drafts/create' : 'notes/drafts/update', {
		...(serverDraftId.value == null ? {} : { draftId: serverDraftId.value }),
		text: text.value,
		cw: useCw.value ? cw.value || null : null,
		visibility: visibility.value,
		localOnly: localOnly.value,
		hashtag: hashtags.value,
		fileIds: files.value.map(f => f.id),
		poll: poll.value,
		visibleUserIds: visibleUsers.value.map(x => x.id),
		renoteId: renoteTargetNote.value ? renoteTargetNote.value.id : quoteId.value ? quoteId.value : null,
		replyId: replyTargetNote.value ? replyTargetNote.value.id : null,
		channelId: targetChannel.value ? targetChannel.value.id : null,
		reactionAcceptance: reactionAcceptance.value,
		scheduledAt: scheduledAt.value,
		isActuallyScheduled: options.isActuallyScheduled ?? false,
	});
}

function isAnnoying(text: string): boolean {
	return text.includes('$[x2') ||
		text.includes('$[x3') ||
		text.includes('$[x4') ||
		text.includes('$[scale') ||
		text.includes('$[position');
}

async function uploadFiles() {
	await uploader.upload();

	for (const uploadedItem of uploader.items.value.filter(x => x.uploaded != null)) {
		files.value.push(uploadedItem.uploaded!);
		uploader.removeItem(uploadedItem);
	}
}

async function post(ev?: PointerEvent) {
	if (ev != null) {
		const el = (ev.currentTarget ?? ev.target) as HTMLElement | null;

		if (el && prefer.s.animation && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
			const rect = el.getBoundingClientRect();
			const x = rect.left + (el.offsetWidth / 2);
			const y = rect.top + (el.offsetHeight / 2);
			const { dispose } = os.popup(MkRippleEffect, { x, y }, {
				end: () => dispose(),
			});
		}
	}

	if (scheduledAt.value != null) {
		if (uploader.items.value.some(x => x.uploaded == null)) {
			await uploadFiles();

			// アップロード失敗したものがあったら中止
			if (uploader.items.value.some(x => x.uploaded == null)) {
				return;
			}
		}

		await postAsScheduled();
		clear();
		return;
	}

	if (props.mock) return;

	if (visibility.value === 'public' && (
		(useCw.value && cw.value != null && cw.value.trim() !== '' && isAnnoying(cw.value)) || // CWが迷惑になる場合
		((!useCw.value || cw.value == null || cw.value.trim() === '') && text.value != null && text.value.trim() !== '' && isAnnoying(text.value)) // CWが無い かつ 本文が迷惑になる場合
	)) {
		const { canceled, result } = await os.actions({
			type: 'warning',
			text: i18n.ts.thisPostMayBeAnnoying,
			actions: [{
				value: 'home',
				text: i18n.ts.thisPostMayBeAnnoyingHome,
				primary: true,
			}, {
				value: 'cancel',
				text: i18n.ts.thisPostMayBeAnnoyingCancel,
			}, {
				value: 'ignore',
				text: i18n.ts.thisPostMayBeAnnoyingIgnore,
			}],
		});

		if (canceled) return;
		if (result === 'cancel') return;
		if (result === 'home') {
			visibility.value = 'home';
		}
	}

	if (uploader.items.value.some(x => x.uploaded == null)) {
		await uploadFiles();

		// アップロード失敗したものがあったら中止
		if (uploader.items.value.some(x => x.uploaded == null)) {
			return;
		}
	}

	let postData = {
		text: text.value === '' ? null : text.value,
		fileIds: files.value.length > 0 ? files.value.map(f => f.id) : undefined,
		replyId: replyTargetNote.value ? replyTargetNote.value.id : undefined,
		renoteId: renoteTargetNote.value ? renoteTargetNote.value.id : quoteId.value ? quoteId.value : undefined,
		channelId: targetChannel.value ? targetChannel.value.id : undefined,
		poll: poll.value,
		cw: useCw.value ? cw.value ?? '' : null,
		localOnly: visibility.value === 'specified' ? false : localOnly.value,
		visibility: visibility.value,
		visibleUserIds: visibility.value === 'specified' ? visibleUsers.value.map(u => u.id) : undefined,
		reactionAcceptance: reactionAcceptance.value,
	};

	if (withHashtags.value && hashtags.value && hashtags.value.trim() !== '') {
		const hashtags_ = hashtags.value.trim().split(' ').map(x => x.startsWith('#') ? x : '#' + x).join(' ');
		if (!postData.text) {
			postData.text = hashtags_;
		} else {
			const postTextLines = postData.text.split('\n');
			if (postTextLines[postTextLines.length - 1].trim() === '') {
				postTextLines[postTextLines.length - 1] += hashtags_;
			} else {
				postTextLines[postTextLines.length - 1] += ' ' + hashtags_;
			}
			postData.text = postTextLines.join('\n');
		}
	}

	// plugin
	const notePostInterruptors = getPluginHandlers('note_post_interruptor');
	if (notePostInterruptors.length > 0) {
		for (const interruptor of notePostInterruptors) {
			try {
				postData = await interruptor.handler(deepClone(postData)) as typeof postData;
			} catch (err) {
				console.error(err);
			}
		}
	}

	let token: string | undefined = undefined;

	if (postAccount.value) {
		const storedAccounts = await getAccounts();
		const storedAccount = storedAccounts.find(x => x.id === postAccount.value?.id);
		if (storedAccount && storedAccount.token != null) {
			token = storedAccount.token;
		} else {
			await os.alert({
				type: 'error',
				text: 'cannot find the token of the selected account.',
			});
			return;
		}
	}

	posting.value = true;
	const postRequest = selectedZalipWork.value
		? misskeyApi<{ createdNote: Misskey.entities.Note }>('zalip/shares/create' as never, {
			workId: selectedZalipWork.value.id,
			text: postData.text,
			cw: postData.cw,
			visibility: postData.visibility,
			visibleUserIds: postData.visibleUserIds,
			localOnly: postData.localOnly,
			replyId: postData.replyId,
			renoteId: postData.renoteId,
			channelId: postData.channelId,
			reactionAcceptance: postData.reactionAcceptance,
		} as never, token)
		: misskeyApi('notes/create', postData, token);

	postRequest.then((res) => {
		if (props.freezeAfterPosted) {
			posted.value = true;
		} else {
			clear();
		}

		globalEvents.emit('notePosted', res.createdNote);

		nextTick(() => {
			deleteDraft();
			emit('posted');
			if (postData.text && postData.text !== '') {
				const hashtags_ = mfm.parse(postData.text).map(x => x.type === 'hashtag' && x.props.hashtag).filter(x => x) as string[];
				const history = JSON.parse(miLocalStorage.getItem('hashtags') ?? '[]') as string[];
				miLocalStorage.setItem('hashtags', JSON.stringify(unique(hashtags_.concat(history))));
			}
			posting.value = false;
			postAccount.value = null;

			incNotesCount();
			if (notesCount === 1) {
				claimAchievement('notes1');
			}

			const text = postData.text ?? '';
			const lowerCase = text.toLowerCase();
			if ((lowerCase.includes('love') || lowerCase.includes('❤')) && lowerCase.includes('misskey')) {
				claimAchievement('iLoveMisskey');
			}
			if ([
				'https://youtu.be/Efrlqw8ytg4',
				'https://www.youtube.com/watch?v=Efrlqw8ytg4',
				'https://m.youtube.com/watch?v=Efrlqw8ytg4',

				'https://youtu.be/XVCwzwxdHuA',
				'https://www.youtube.com/watch?v=XVCwzwxdHuA',
				'https://m.youtube.com/watch?v=XVCwzwxdHuA',

				'https://open.spotify.com/track/3Cuj0mZrlLoXx9nydNi7RB',
				'https://open.spotify.com/track/7anfcaNPQWlWCwyCHmZqNy',
				'https://open.spotify.com/track/5Odr16TvEN4my22K9nbH7l',
				'https://open.spotify.com/album/5bOlxyl4igOrp2DwVQxBco',
			].some(url => text.includes(url))) {
				claimAchievement('brainDiver');
			}

			if (renoteTargetNote.value && (renoteTargetNote.value.userId === $i.id) && text.length > 0) {
				claimAchievement('selfQuote');
			}

			const date = new Date();
			const h = date.getHours();
			const m = date.getMinutes();
			const s = date.getSeconds();
			if (h >= 0 && h <= 3) {
				claimAchievement('postedAtLateNight');
			}
			if (m === 0 && s === 0) {
				claimAchievement('postedAt0min0sec');
			}

			if (serverDraftId.value != null) {
				misskeyApi('notes/drafts/delete', { draftId: serverDraftId.value });
			}
		});
	}).catch(err => {
		posting.value = false;
		os.alert({
			type: 'error',
			text: err.message + '\n' + (err as any).id,
		});
	});
}

async function postAsScheduled() {
	if (props.mock) return;

	await saveServerDraft({
		isActuallyScheduled: true,
	});
}

function cancel() {
	emit('cancel');
}

function insertMention() {
	os.selectUser({ localOnly: localOnly.value, includeSelf: true }).then(user => {
		if (textareaEl.value == null) return;
		insertTextAtCursor(textareaEl.value, '@' + Misskey.acct.toString(user) + ' ');
	});
}

async function insertEmoji(ev: PointerEvent) {
	textAreaReadOnly.value = true;
	const target = ev.currentTarget ?? ev.target;
	if (target == null) return;

	// emojiPickerはダイアログが閉じずにtextareaとやりとりするので、
	// focustrapをかけているとinsertTextAtCursorが効かない
	// そのため、投稿フォームのテキストに直接注入する
	// See: https://github.com/misskey-dev/misskey/pull/14282
	//      https://github.com/misskey-dev/misskey/issues/14274

	let pos = textareaEl.value?.selectionStart ?? 0;
	let posEnd = textareaEl.value?.selectionEnd ?? text.value.length;
	emojiPicker.show(
		target as HTMLElement,
		emoji => {
			const textBefore = text.value.substring(0, pos);
			const textAfter = text.value.substring(posEnd);
			text.value = textBefore + emoji + textAfter;
			pos += emoji.length;
			posEnd += emoji.length;
		},
		() => {
			textAreaReadOnly.value = false;
			nextTick(() => {
				if (textareaEl.value) {
					textareaEl.value.focus();
					textareaEl.value.setSelectionRange(pos, posEnd);
				}
			});
		},
	);
}

async function insertMfmFunction(ev: PointerEvent) {
	if (textareaEl.value == null) return;
	let pos = textareaEl.value.selectionStart ?? 0;
	let posEnd = textareaEl.value.selectionEnd ?? text.value.length;
	mfmFunctionPicker(
		ev.currentTarget ?? ev.target,
		(tag) => {
			if (pos === posEnd) {
				text.value = `${text.value.substring(0, pos)}$[${tag} ]${text.value.substring(pos)}`;
				pos += tag.length + 3;
				posEnd = pos;
			} else {
				text.value = `${text.value.substring(0, pos)}$[${tag} ${text.value.substring(pos, posEnd)}]${text.value.substring(posEnd)}`;
				pos += tag.length + 3;
				posEnd = pos;
			}
		},
		() => {
			nextTick(() => {
				if (textareaEl.value) {
					textareaEl.value.focus();
					textareaEl.value.setSelectionRange(pos, posEnd);
				}
			});
		},
	);
}

function showActions(ev: PointerEvent) {
	os.popupMenu(postFormActions.map(action => ({
		text: action.title,
		action: () => {
			action.handler({
				text: text.value,
				cw: cw.value,
			}, (key, value) => {
				if (typeof key !== 'string' || typeof value !== 'string') return;
				if (key === 'text') { text.value = value; }
				if (key === 'cw') { useCw.value = value !== null; cw.value = value; }
			});
		},
	})), ev.currentTarget ?? ev.target);
}

const postAccount = ref<Misskey.entities.UserDetailed | null>(null);

async function openAccountMenu(ev: PointerEvent) {
	if (props.mock) return;

	function showDraftsDialog(scheduled: boolean) {
		const { dispose } = os.popup(defineAsyncComponent(() => import('@/components/MkNoteDraftsDialog.vue')), {
			scheduled,
		}, {
			restore: async (draft: Misskey.entities.NoteDraft) => {
				text.value = draft.text ?? '';
				useCw.value = draft.cw != null;
				cw.value = draft.cw ?? null;
				visibility.value = draft.visibility;
				localOnly.value = draft.localOnly ?? false;
				files.value = draft.files ?? [];
				hashtags.value = draft.hashtag ?? '';
				if (draft.hashtag) withHashtags.value = true;
				if (draft.poll) {
					// 投票を一時的に空にしないと反映されないため
					poll.value = null;
					nextTick(() => {
						poll.value = {
							choices: draft.poll!.choices,
							multiple: draft.poll!.multiple,
							expiresAt: draft.poll!.expiresAt ? (new Date(draft.poll!.expiresAt)).getTime() : null,
							expiredAfter: null,
						};
					});
				}
				if (draft.visibleUserIds) {
					misskeyApi('users/show', { userIds: draft.visibleUserIds }).then(users => {
						users.forEach(u => pushVisibleUser(u));
					});
				}
				quoteId.value = draft.renoteId ?? null;
				renoteTargetNote.value = draft.renote;
				replyTargetNote.value = draft.reply;
				reactionAcceptance.value = draft.reactionAcceptance;
				scheduledAt.value = draft.scheduledAt ?? null;
				if (draft.channel) targetChannel.value = draft.channel as unknown as Misskey.entities.Channel;
				else if (!props.channel) targetChannel.value = null;

				visibleUsers.value = [];
				draft.visibleUserIds?.forEach(uid => {
					if (!visibleUsers.value.some(u => u.id === uid)) {
						misskeyApi('users/show', { userId: uid }).then(user => {
							pushVisibleUser(user);
						});
					}
				});

				serverDraftId.value = draft.id;
			},
			cancel: () => {

			},
			closed: () => {
				dispose();
			},
		});
	}

	const items = await getAccountMenu({
		withExtraOperation: false,
		includeCurrentAccount: true,
		active: postAccount.value != null ? postAccount.value.id : $i.id,
		onChoose: (account) => {
			if (account.id === $i.id) {
				postAccount.value = null;
			} else {
				postAccount.value = account;
			}
		},
	});

	os.popupMenu([{
		type: 'button',
		text: i18n.ts._drafts.listDrafts,
		icon: 'ti ti-cloud-download',
		action: () => {
			showDraftsDialog(false);
		},
	}, {
		type: 'button',
		text: i18n.ts._drafts.listScheduledNotes,
		icon: 'ti ti-clock-down',
		action: () => {
			showDraftsDialog(true);
		},
	}, { type: 'divider' }, ...items], (ev.currentTarget ?? ev.target ?? undefined) as HTMLElement | undefined);
}

function showPerUploadItemMenu(item: UploaderItem, ev: PointerEvent) {
	const menu = uploader.getMenu(item);
	os.popupMenu(menu, ev.currentTarget ?? ev.target);
}

function showPerUploadItemMenuViaContextmenu(item: UploaderItem, ev: PointerEvent) {
	const menu = uploader.getMenu(item);
	os.contextMenu(menu, ev);
}

async function schedule() {
	const { canceled, result } = await os.inputDatetime({
		title: i18n.ts.schedulePost,
	});
	if (canceled) return;
	if (result.getTime() <= Date.now()) return;

	scheduledAt.value = result.getTime();
}

function cancelSchedule() {
	scheduledAt.value = null;
}

function showTour() {
	if (textareaEl.value == null ||
		footerEl.value == null ||
		accountMenuEl.value == null ||
		visibilityButton.value == null ||
		otherSettingsButton.value == null ||
		submitButtonEl.value == null) {
		return;
	}

	startTour([{
		element: textareaEl.value,
		title: i18n.ts._postForm._howToUse.content_title,
		description: i18n.ts._postForm._howToUse.content_description,
	}, {
		element: footerEl.value,
		title: i18n.ts._postForm._howToUse.toolbar_title,
		description: i18n.ts._postForm._howToUse.toolbar_description,
	}, {
		element: accountMenuEl.value,
		title: i18n.ts._postForm._howToUse.account_title,
		description: i18n.ts._postForm._howToUse.account_description,
	}, {
		element: visibilityButton.value,
		title: i18n.ts._postForm._howToUse.visibility_title,
		description: i18n.ts._postForm._howToUse.visibility_description,
	}, {
		element: otherSettingsButton.value,
		title: i18n.ts._postForm._howToUse.menu_title,
		description: i18n.ts._postForm._howToUse.menu_description,
	}, {
		element: submitButtonEl.value,
		title: i18n.ts._postForm._howToUse.submit_title,
		description: i18n.ts._postForm._howToUse.submit_description,
	}]).then(() => {
		closeTip('postForm');
	});
}

onMounted(() => {
	if (props.autofocus) {
		focus();

		nextTick(() => {
			focus();
		});
	}

	if (textareaEl.value) textAutocomplete = new Autocomplete(textareaEl.value, text);
	if (cwInputEl.value) cwAutocomplete = new Autocomplete(cwInputEl.value, cw);
	if (hashtagsInputEl.value) hashtagAutocomplete = new Autocomplete(hashtagsInputEl.value, hashtags);

	nextTick(() => {
		// 書きかけの投稿を復元
		if (!props.instant && !props.mention && !props.specified && !props.mock) {
			const draft = JSON.parse(miLocalStorage.getItem('drafts') ?? '{}')[draftKey.value] as StoredDrafts[string] | undefined;
			if (draft != null) {
				text.value = draft.data.text;
				useCw.value = draft.data.useCw;
				cw.value = draft.data.cw;
				visibility.value = draft.data.visibility;
				localOnly.value = draft.data.localOnly;
				files.value = (draft.data.files || []).filter(draftFile => draftFile);
				if (draft.data.poll) {
					poll.value = draft.data.poll;
				}
				if (draft.data.visibleUserIds) {
					misskeyApi('users/show', { userIds: draft.data.visibleUserIds }).then(users => {
						users.forEach(u => pushVisibleUser(u));
					});
				}
				quoteId.value = draft.data.quoteId;
				reactionAcceptance.value = draft.data.reactionAcceptance;
				scheduledAt.value = draft.data.scheduledAt ?? null;
				if (!communityLocked.value && draft.data.channel) {
					targetChannel.value = draft.data.channel;
					personalCommunityAudience.value = draft.data.communityAudience ?? personalCommunityAudience.value;
					visibility.value = 'public'; localOnly.value = true;
				}
			}
		}

		// 削除して編集
		if (props.initialNote) {
			const init = props.initialNote;
			// Editing an existing private/personal note must never inherit a group
			// from an unrelated new-post draft (a group forces public visibility).
			targetChannel.value = init.channelId == null ? null : init.channel ?? (props.channel?.id === init.channelId ? props.channel : null);
			text.value = init.text ? init.text : '';
			useCw.value = init.cw != null;
			cw.value = init.cw ?? null;
			visibility.value = init.visibility;
			localOnly.value = init.localOnly ?? false;
			files.value = init.files ?? [];
			if (init.poll) {
				poll.value = {
					choices: init.poll.choices.map(x => x.text),
					multiple: init.poll.multiple,
					expiresAt: init.poll.expiresAt ? (new Date(init.poll.expiresAt)).getTime() : null,
					expiredAfter: null,
				};
			}
			if (init.visibleUserIds) {
				misskeyApi('users/show', { userIds: init.visibleUserIds }).then(users => {
					users.forEach(u => pushVisibleUser(u));
				});
			}
			quoteId.value = renoteTargetNote.value ? renoteTargetNote.value.id : null;
			reactionAcceptance.value = init.reactionAcceptance;
		}

		nextTick(() => watchForDraft());
	});
});

onBeforeUnmount(() => {
	communityAlive = false;
	communityRequest++;
	uploader.abortAll();
	if (textAutocomplete) {
		textAutocomplete.detach();
	}
	if (cwAutocomplete) {
		cwAutocomplete.detach();
	}
	if (hashtagAutocomplete) {
		hashtagAutocomplete.detach();
	}
});

async function canClose() {
	if (!uploader.allItemsUploaded.value) {
		const { canceled } = await os.confirm({
			type: 'question',
			text: i18n.ts._postForm.quitInspiteOfThereAreUnuploadedFilesConfirm,
			okText: i18n.ts.yes,
			cancelText: i18n.ts.no,
		});
		if (canceled) return false;
	}

	return true;
}

defineExpose({
	clear,
	abortUploader: () => uploader.abortAll(),
	canClose,
});
</script>

<style lang="scss" module>
.communityRow { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 0 24px 12px; }
.communityButton { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; min-width: 0; max-width: 100%; padding: 0 12px; border-radius: 999px; background: var(--MI_THEME-buttonBg); color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; } &:disabled { opacity: .5; cursor: not-allowed; } }
.communityNotice { color: var(--MI_THEME-fgTransparentWeak); font-size: 11px; }
.root {
	position: relative;
	container-type: inline-size;
	font-family: var(--zalip-font-family);
	color: var(--MI_THEME-fg);
	background: var(--MI_THEME-panel);
}
.root.draghover { outline: 2px solid var(--MI_THEME-accent); outline-offset: -2px; }

//#region header
.header {
	position: sticky;
	top: 0;
	z-index: 2;
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
	align-items: center;
	min-height: 56px;
	padding: 0 16px;
	background: var(--MI_THEME-panel);
	border-bottom: 1px solid var(--MI_THEME-divider);
}
.heading { margin: 0; font-size: 16px; font-weight: 700; line-height: 24px; }

.headerLeft {
	display: flex;
	align-items: center;
	min-width: 0;
}

.cancel {
	min-height: 40px;
	font-size: 14px;
	text-align: start;
	color: var(--MI_THEME-fgTransparentWeak);
}
.authorRow { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 16px 10px; }
.account { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; border-radius: 8px; > i { flex: 0 0 auto; font-size: 12px; color: var(--MI_THEME-fgTransparentWeak); } }
.accountName { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 14px; font-weight: 700; }
.audience { display: flex; align-items: center; flex: 0 0 auto; gap: 2px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }

.avatar {
	display: block;
	flex: 0 0 40px;
	width: 40px;
	height: 40px;
	border-radius: 50%;
	object-fit: cover;
}

.headerRight {
	display: flex;
	align-items: center;
	justify-content: flex-end;
}

.submit {
	margin: 0;
	border-radius: 999px;

	&:focus-visible {
		outline: none;

		> .submitInner {
			outline: 2px solid var(--MI_THEME-fgOnAccent);
			outline-offset: -4px;
		}
	}

	&:disabled {
		opacity: 0.45;
	}

	&.posting {
		cursor: wait;
	}

	&:not(:disabled):hover {
		> .submitInner {
			filter: brightness(1.08);
		}
	}

	&:not(:disabled):active {
		> .submitInner {
			filter: brightness(.95);
		}
	}
}

.colorBar {
	position: absolute;
	top: 0px;
	left: 12px;
	width: 5px;
	height: 100% ;
	border-radius: 999px;
	pointer-events: none;
}

.submitInner {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 0 16px;
	min-height: 40px;
	font-size: 14px;
	font-weight: 700;
	border-radius: inherit;
	min-width: 96px;
	box-sizing: border-box;
	color: var(--MI_THEME-fgOnAccent);
	background: var(--MI_THEME-accent);
	transition: filter .15s;
	> i { font-size: 18px; }
}

.headerRightItem {
	margin: 0;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-height: 36px;
	min-width: 36px;
	padding: 0 6px;
	border-radius: 8px;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&:disabled {
		background: none;
	}

	&.danger {
		color: var(--MI_THEME-warn);
	}
}

.headerRightButtonText {
	padding-left: 5px;
}

.visibility {
	overflow: clip;
	text-overflow: ellipsis;
	white-space: nowrap;
	max-width: 180px;

	&:enabled {
		> .headerRightButtonText {
			opacity: 0.8;
		}
	}
}
//#endregion

.preview {
	padding: 12px 16px;
	min-height: 75px;
	max-height: 150px;
	overflow: auto;
	border-top: 1px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-bg);
}

.zalipShare {
	position: relative;
	padding-top: 1px;
}

.removeZalipShare {
	position: absolute;
	top: 20px;
	right: 24px;
	display: grid;
	width: 28px;
	height: 28px;
	place-items: center;
	border: 1px solid var(--MI_THEME-divider);
	border-radius: 999px;
	background: color-mix(in srgb, var(--MI_THEME-panel) 86%, transparent);
	color: var(--MI_THEME-fgTransparent);

	&:hover {
		color: var(--MI_THEME-fg);
		background: var(--MI_THEME-panel);
	}
}

.targetNote {
	padding: 0 16px 16px;
}

.withQuote {
	margin: 0 0 8px 0;
	color: var(--MI_THEME-accent);
}

.toSpecified {
	padding: 6px 16px;
	margin-bottom: 8px;
	overflow: auto;
	white-space: nowrap;
}

.visibleUsers {
	display: inline;
	top: -1px;
	font-size: 14px;
}

.visibleUser {
	margin-right: 14px;
	padding: 8px 0 8px 8px;
	border-radius: 8px;
	background: var(--MI_THEME-buttonBg);
}

.hasNotSpecifiedMentions {
	margin: 0 16px 16px;
}

.scheduledAt {
	margin: 0 16px 16px;
}

.showHowToUse {
	margin: 0 16px 16px;
}

.cw,
.hashtags,
.text {
	display: block;
	box-sizing: border-box;
	padding: 0 16px;
	margin: 0;
	width: 100%;
	font-size: 16px;
	line-height: 24px;
	border: none;
	border-radius: 0;
	background: transparent;
	color: var(--MI_THEME-fg);
	font-family: inherit;

	&:focus-visible { outline: none; box-shadow: inset 0 -2px 0 var(--MI_THEME-focus); }

	&:disabled {
		opacity: 0.5;
	}
}

.cwOuter {
	width: 100%;
	position: relative;
}

.cw {
	z-index: 1;
	padding-bottom: 8px;
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.cwTextCount {
	position: absolute;
	top: 0;
	right: 2px;
	padding: 2px 6px;
	font-size: .9em;
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	max-width: 100%;
	min-width: 1.6em;
	text-align: center;

	&.cwTextOver {
		color: var(--MI_THEME-error);
	}
}

.hashtags {
	z-index: 1;
	padding-top: 8px;
	padding-bottom: 8px;
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.textOuter {
	width: 100%;
	position: relative;

	&.withCw {
		padding-top: 8px;
	}
}

.text {
	max-width: 100%;
	min-width: 100%;
	width: 100%;
	min-height: 132px;
	max-height: 500px;
	field-sizing: content;
}

.textCount {
	position: absolute;
	top: 0;
	right: 2px;
	padding: 4px 6px;
	font-size: .9em;
	color: var(--MI_THEME-warn);
	border-radius: 6px;
	min-width: 1.6em;
	text-align: center;

	&.textOver {
		color: var(--MI_THEME-error);
	}
}

.footer {
	position: sticky;
	bottom: 0;
	z-index: 2;
	display: flex;
	align-items: flex-end;
	gap: 8px;
	padding: 10px 16px max(10px, env(safe-area-inset-bottom));
	border-top: 1px solid var(--MI_THEME-divider);
	background: var(--MI_THEME-panel);
}

.footerLeft {
	flex: 1;
	min-width: 0;
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
}

.footerRight {
	flex: 0 0 auto;
	margin-left: auto;
	display: flex;
	align-items: center;
}

.footerButton {
	display: inline-grid;
	place-items: center;
	padding: 0;
	margin: 0;
	font-size: 20px;
	width: 36px;
	height: 40px;
	border-radius: 50%;
	color: var(--MI_THEME-fgTransparentWeak);
	transition: background .15s, color .15s;

	&:hover {
		background: var(--MI_THEME-buttonHoverBg);
	}

	&.footerButtonActive {
		color: var(--MI_THEME-accent);
	}
}

.previewButtonActive {
	color: var(--MI_THEME-accent);
}
.cancel:focus-visible, .account:focus-visible, .headerRightItem:focus-visible, .footerButton:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 1px; }
@media (hover: none), (pointer: coarse) { .footerButton, .headerRightItem, .cancel { min-width: 44px; min-height: 44px; } .submitInner { min-height: 44px; } }
@media (prefers-reduced-motion: reduce) { .root *, .submitInner { transition: none !important; animation: none !important; } }
@media (max-width: 600px) { .text { resize: none; } }

@container (max-width: 500px) {
	.header { min-height: 52px; }
	.authorRow { padding: 12px 16px 10px; }
	.visibility { max-width: 132px; }

	.toSpecified {
		padding: 6px 16px;
	}

	.preview {
		padding: 16px 14px 0 14px;
	}
	.cw,
	.hashtags,
	.text {
		padding: 0 16px;
	}

	.text {
		min-height: 150px;
	}

	.footer {
		padding: 8px 10px max(8px, env(safe-area-inset-bottom));
	}
}

@container (max-width: 350px) {
	.authorRow { gap: 4px; }
	.visibility { max-width: 108px; }
	.submitInner { min-width: 84px; padding: 0 10px; }

}
</style>
