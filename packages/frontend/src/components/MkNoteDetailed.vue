<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	v-if="!muted && !hideByPlugin && !isDeleted"
	ref="rootEl"
	v-hotkey="keymap"
	:class="$style.root"
	tabindex="0"
>
	<div v-if="appearNote.reply && appearNote.reply.replyId">
		<div v-if="!conversationLoaded" style="padding: 16px">
			<MkButton style="margin: 0 auto;" primary rounded @click="loadConversation">{{ i18n.ts.loadConversation }}</MkButton>
		</div>
		<MkNoteSub v-for="note in conversation" :key="note.id" :class="$style.replyToMore" :note="note" thread/>
	</div>
	<MkNoteSub v-if="appearNote.replyId" :note="appearNote?.reply ?? null" :class="$style.replyTo" thread/>
	<div v-if="isRenote" :class="$style.renote">
		<MkAvatar :class="$style.renoteAvatar" :user="note.user" link preview/>
		<i class="ti ti-repeat" style="margin-right: 4px;"></i>
		<span :class="$style.renoteText">
			<I18n :src="i18n.ts.renotedBy" tag="span">
				<template #user>
					<MkA v-user-preview="note.userId" :class="$style.renoteName" :to="userPage(note.user)">
						<MkUserName :user="note.user"/>
					</MkA>
				</template>
			</I18n>
		</span>
		<div :class="$style.renoteInfo">
			<button ref="renoteTime" class="_button" :class="$style.renoteTime" @mousedown.prevent="showRenoteMenu()">
				<i v-if="isMyRenote" class="ti ti-dots" style="margin-right: 4px;"></i>
				<MkTime :time="note.createdAt"/>
			</button>
			<span v-if="note.visibility !== 'public'" style="margin-left: 0.5em;" :title="i18n.ts._visibility[note.visibility]">
				<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
				<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
				<i v-else-if="note.visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
			</span>
			<span v-if="note.localOnly" style="margin-left: 0.5em;" :title="i18n.ts._visibility['disableFederation']"><i class="ti ti-rocket-off"></i></span>
		</div>
	</div>
	<div v-if="isRenote && note.renote == null" :class="$style.deleted">
		{{ i18n.ts.deletedNote }}
	</div>
	<template v-else>
		<article :class="$style.note" @contextmenu.stop="onContextmenu">
			<header :class="$style.noteHeader">
				<MkAvatar :class="$style.noteHeaderAvatar" :user="appearNote.user" link preview/>
				<div :class="$style.noteHeaderBody">
					<MkNoteHeader :note="appearNote" stacked/>
					<MkInstanceTicker v-if="showTicker" :host="appearNote.user.host" :instance="appearNote.user.instance"/>
				</div>
				<button ref="menuButton" type="button" class="_button" :class="$style.menuButton" :aria-label="i18n.ts.more" @click="showMenu()"><i class="ti ti-dots" aria-hidden="true"></i></button>
			</header>
			<div :class="$style.noteContent">
				<p v-if="appearNote.cw != null" :class="$style.cw">
					<Mfm
						v-if="appearNote.cw != ''"
						:text="appearNote.cw"
						:author="appearNote.user"
						:nyaize="'respect'"
						:enableEmojiMenu="true"
						:enableEmojiMenuReaction="true"
					/>
					<MkCwButton v-model="showContent" :text="appearNote.text" :renote="appearNote.renote" :files="appearNote.files" :poll="appearNote.poll"/>
				</p>
				<div v-show="appearNote.cw == null || showContent">
					<span v-if="appearNote.isHidden" style="opacity: 0.5">({{ i18n.ts.private }})</span>
					<MkA v-if="appearNote.replyId" :class="$style.noteReplyTarget" :to="`/notes/${appearNote.replyId}`"><i class="ti ti-arrow-back-up"></i></MkA>
					<Mfm
						v-if="appearNote.text"
						:parsedNodes="parsed"
						:text="appearNote.text"
						:author="appearNote.user"
						:nyaize="'respect'"
						:emojiUrls="appearNote.emojis"
						:enableEmojiMenu="true"
						:enableEmojiMenuReaction="true"
						class="_selectable"
					/>
					<a v-if="appearNote.renote != null" :class="$style.rn">RN:</a>
					<div v-if="translating || translation" :class="$style.translation">
						<MkLoading v-if="translating" mini/>
						<div v-else-if="translation">
							<b>{{ i18n.tsx.translatedFrom({ x: translation.sourceLang }) }}: </b>
							<Mfm :text="translation.text" :author="appearNote.user" :nyaize="'respect'" :emojiUrls="appearNote.emojis" class="_selectable"/>
						</div>
					</div>
					<ZalipShareCard v-if="appearNote.zalipShare" :share="appearNote.zalipShare"/>
					<div v-if="appearNote.files && appearNote.files.length > 0">
						<MkMediaList ref="galleryEl" :mediaList="appearNote.files"/>
					</div>
					<MkPoll
						v-if="appearNote.poll"
						:noteId="appearNote.id"
						:multiple="appearNote.poll.multiple"
						:expiresAt="appearNote.poll.expiresAt"
						:choices="$appearNote.pollChoices"
						:author="appearNote.user"
						:emojiUrls="appearNote.emojis"
						:class="$style.poll"
					/>
					<div v-if="isEnabledUrlPreview">
						<MkUrlPreview v-for="url in urls" :key="url" :url="url" :compact="true" :detail="true" style="margin-top: 6px;"/>
					</div>
					<div v-if="appearNote.renoteId" :class="$style.quote"><MkNoteSimple :note="appearNote?.renote ?? null" :class="$style.quoteNote"/></div>
				</div>
				<MkA v-if="appearNote.channel && !inChannel" :class="$style.channel" :to="`/channels/${appearNote.channel.id}`"><i class="ti ti-device-tv"></i> {{ appearNote.channel.name }}</MkA>
			</div>
			<footer>
				<div :class="$style.noteFooterInfo">
					<MkA :to="notePage(appearNote)">
						<time :datetime="appearNote.createdAt">{{ formattedDate }}</time>
					</MkA>
					<span v-if="appearNote.visibility !== 'public'" style="margin-left: 0.5em;">
						<span style="border: 1px solid var(--MI_THEME-divider); margin-right: 0.5em;"></span>
						<i v-if="appearNote.visibility === 'home'" class="ti ti-home"></i>
						<i v-else-if="appearNote.visibility === 'followers'" class="ti ti-lock"></i>
						<i v-else-if="appearNote.visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
						<span style="margin-left: 0.3em;">{{ i18n.ts._visibility[appearNote.visibility] }}</span>
					</span>
				</div>
				<div :class="$style.actionRow">
					<button ref="reactButton" type="button" :class="[$style.noteFooterButton, { [$style.reacted]: $appearNote.myReaction != null }]" class="_button" :aria-label="i18n.ts.reaction" :aria-pressed="$appearNote.myReaction != null" @click="toggleReact()">
						<MkReactionIcon v-if="summaryReaction" :class="$style.summaryReaction" :reaction="summaryReaction" :emojiUrl="$appearNote.reactionEmojis[summaryReaction.substring(1, summaryReaction.length - 1)]"/>
						<MkZalipIcon v-else :name="appearNote.reactionAcceptance === 'likeOnly' ? 'heart' : 'mood'"/>
						<span :class="$style.noteFooterButtonCount">{{ number($appearNote.reactionCount) }}</span>
					</button>
					<button v-tooltip="i18n.ts.zalip.comments" class="_button" :class="$style.noteFooterButton" :aria-label="i18n.ts.zalip.comments" @click="openComments()">
						<MkZalipIcon name="reply"/>
						<span :class="$style.noteFooterButtonCount">{{ number(appearNote.repliesCount) }}</span>
					</button>
					<button
						v-if="canRenote"
						ref="renoteButton"
						class="_button"
						:class="$style.noteFooterButton"
						:aria-label="i18n.ts.renote"
						@click="renote()"
					>
						<MkZalipIcon name="repeat"/>
						<span :class="$style.noteFooterButtonCount">{{ number(appearNote.renoteCount) }}</span>
					</button>
					<button v-else class="_button" :class="$style.noteFooterButton" :aria-label="i18n.ts.renote" disabled>
						<i class="ti ti-ban"></i>
					</button>

					<MkZalipBookmark :class="$style.bookmark" :noteId="appearNote.id"/>
					<button v-if="prefer.s.showClipButtonInNoteFooter" ref="clipButton" class="_button" :class="$style.noteFooterButton" :aria-label="i18n.ts.clip" @click="clip()">
						<i class="ti ti-paperclip"></i>
					</button>
				</div>
			</footer>
		</article>
		<div :class="$style.commentsHeader">
			<h2>{{ tab === 'reactions' ? i18n.ts.reactions : tab === 'renotes' ? i18n.ts.renotes : i18n.ts.zalip.comments }}</h2>
			<select v-model="discussionView" :class="$style.discussionSelect" :aria-label="i18n.ts.zalip.discussion">
				<option value="newest">{{ i18n.ts.zalip.commentsNewest }}</option>
				<option value="oldest">{{ i18n.ts.zalip.commentsOldest }}</option>
				<option value="renotes">{{ i18n.ts.renotes }}</option>
				<option value="reactions">{{ i18n.ts.reactions }}</option>
			</select>
		</div>
		<div>
			<div v-if="tab === 'replies'" :class="$style.comments">
				<MkLoading v-if="repliesPending"/>
				<div v-else-if="repliesError" :class="$style.commentsState"><p>{{ i18n.ts.zalip.commentsError }}</p><button class="_textButton" type="button" @click="loadReplies()">{{ i18n.ts.retry }}</button></div>
				<p v-else-if="repliesLoaded && replies.length === 0" :class="$style.commentsState">{{ i18n.ts.zalip.commentsEmpty }}</p>
				<MkNoteSub v-for="note in replies" :key="note.id" :note="note" :class="$style.reply" :detail="true" @reply="replyToComment"/>
				<button v-if="repliesHasMore && !repliesPending" type="button" class="_textButton" :class="$style.commentsState" @click="loadReplies(true)">{{ i18n.ts.loadMore }}</button>
				<ZalipCommentForm :rootNote="appearNote" :replyTo="commentTarget" floating @posted="commentPosted" @cancelReply="commentTarget = appearNote"/>
			</div>
			<div v-else-if="tab === 'renotes'" :class="$style.tab_renotes">
				<MkPagination :paginator="renotesPaginator" :forceDisableInfiniteScroll="true">
					<template #default="{ items }">
						<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); grid-gap: 12px;">
							<MkA v-for="item in items" :key="item.id" :to="userPage(item.user)">
								<MkUserCardMini :user="item.user" :withChart="false"/>
							</MkA>
						</div>
					</template>
				</MkPagination>
			</div>
			<div v-else-if="tab === 'reactions'" :class="$style.tab_reactions">
				<div :class="$style.reactionTabs">
					<button v-for="reaction in Object.keys($appearNote.reactions)" :key="reaction" :class="[$style.reactionTab, { [$style.reactionTabActive]: reactionTabType === reaction }]" class="_button" @click="reactionTabType = reaction">
						<MkReactionIcon :reaction="reaction"/>
						<span style="margin-left: 4px;">{{ $appearNote.reactions[reaction] }}</span>
					</button>
				</div>
				<MkPagination v-if="reactionTabType" :key="reactionTabType" :paginator="reactionsPaginator" :forceDisableInfiniteScroll="true">
					<template #default="{ items }">
						<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); grid-gap: 12px;">
							<MkA v-for="item in items" :key="item.id" :to="userPage(item.user)">
								<MkUserCardMini :user="item.user" :withChart="false"/>
							</MkA>
						</div>
					</template>
				</MkPagination>
			</div>
		</div>
	</template>
</div>
<div v-else-if="muted" class="_panel" :class="$style.muted" @click="muted = false">
	<I18n :src="i18n.ts.userSaysSomething" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
</div>
</template>

<script lang="ts" setup>
import { inject, provide, ref, useTemplateRef, markRaw, computed, onMounted } from 'vue';
import * as Misskey from 'misskey-js';
import type { Keymap } from '@/utility/hotkey.js';
import { useNote } from '@/composables/use-note.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { notePage } from '@/filters/note.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { Paginator } from '@/utility/paginator.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import number from '@/filters/number.js';
import { DI } from '@/di.js';

// コンポーネント外部の依存関係
import MkNoteSub from '@/components/MkNoteSub.vue';
import MkNoteHeader from '@/components/MkNoteHeader.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import MkZalipBookmark from '@/components/MkZalipBookmark.vue';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkCwButton from '@/components/MkCwButton.vue';
import MkPoll from '@/components/MkPoll.vue';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import MkInstanceTicker from '@/components/MkInstanceTicker.vue';
import MkUserCardMini from '@/components/MkUserCardMini.vue';
import MkPagination from '@/components/MkPagination.vue';
import MkButton from '@/components/MkButton.vue';
import ZalipShareCard from '@/components/ZalipShareCard.vue';
import ZalipCommentForm from '@/components/ZalipCommentForm.vue';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	initialTab?: 'replies' | 'renotes' | 'reactions';
}>(), {
	initialTab: 'replies',
});

// 周辺コンテキストのインジェクト
const inChannel = inject(DI.inChannel, null);

// Template Refsの定義
const rootEl = useTemplateRef('rootEl');
const menuButton = useTemplateRef('menuButton');
const renoteButton = useTemplateRef('renoteButton');
const renoteTime = useTemplateRef('renoteTime');
const reactButton = useTemplateRef('reactButton');
const clipButton = useTemplateRef('clipButton');
const galleryEl = useTemplateRef('galleryEl');

// コンポーサブルの呼び出し
const {
	note,
	appearNote,
	$appearNote,
	hideByPlugin,
	isRenote,
	showContent,
	isDeleted,
	translating,
	translation,
	muted,
	canRenote,
	isMyRenote,
	parsed,
	urls,
	showTicker,

	// 関数群
	renote,
	reply,
	react,
	reactViaMfmEmoji,
	toggleReact,
	onContextmenu,
	showMenu,
	clip,
	showRenoteMenu,
	blur,
} = useNote(props, {
	rootEl,
	menuButton,
	renoteButton,
	renoteTime,
	reactButton,
	clipButton,
}, {
	inChannel,
});

// provide
provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);
const summaryReaction = computed(() => $appearNote.myReaction ?? Object.entries($appearNote.reactions).sort((a, b) => b[1] - a[1])[0]?.[0]);
const formattedDate = computed(() => new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(appearNote.createdAt)) + ' · ' + new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(appearNote.createdAt)));

// MkNoteDetailed固有
const tab = ref(props.initialTab ?? 'replies');
const oldestFirst = ref(false);
const discussionView = computed({
	get: () => tab.value === 'replies' ? (oldestFirst.value ? 'oldest' : 'newest') : tab.value,
	set: (value: string) => {
		if (value === 'oldest' || value === 'newest') {
			oldestFirst.value = value === 'oldest';
			openComments();
		} else if (value === 'renotes' || value === 'reactions') tab.value = value;
	},
});
const reactionTabType = ref<string | null>(null);

const renotesPaginator = markRaw(new Paginator('notes/renotes', {
	limit: 10,
	params: {
		noteId: appearNote.id,
	},
}));

const reactionsPaginator = markRaw(new Paginator('notes/reactions', {
	limit: 10,
	computedParams: computed(() => ({
		noteId: appearNote.id,
		type: reactionTabType.value,
	})),
}));

const replies = ref<Misskey.entities.Note[]>([]);
const repliesLoaded = ref(false);
const repliesPending = ref(false);
const repliesError = ref(false);
const repliesHasMore = ref(false);
let repliesRequest = 0;
const commentTarget = ref<Misskey.entities.Note>(appearNote);

async function loadReplies(append = false): Promise<void> {
	if (append && repliesPending.value) return;
	const request = ++repliesRequest;
	const ascending = oldestFirst.value;
	const cursor = append ? replies.value.at(-1)?.id : undefined;
	if (!append) replies.value = [];
	repliesLoaded.value = true;
	repliesPending.value = true;
	repliesError.value = false;
	try {
		const res = await misskeyApi('notes/children', {
			noteId: appearNote.id,
			limit: 30,
			...(ascending ? { sinceId: cursor ?? appearNote.id } : cursor ? { untilId: cursor } : {}),
		});
		if (request !== repliesRequest) return;
		repliesHasMore.value = res.length === 30;
		replies.value = append ? [...replies.value, ...res.filter(note => !replies.value.some(current => current.id === note.id))] : res;
	} catch {
		if (request === repliesRequest) repliesError.value = true;
	} finally {
		if (request === repliesRequest) repliesPending.value = false;
	}
}

function openComments(): void {
	tab.value = 'replies';
	void loadReplies();
}

function replyToComment(target: Misskey.entities.Note): void {
	commentTarget.value = target;
}

function commentPosted(): void {
	commentTarget.value = appearNote;
	void loadReplies();
}

onMounted(() => {
	if (tab.value === 'replies') void loadReplies();
});

const conversation = ref<Misskey.entities.Note[]>([]);
const conversationLoaded = ref(false);

function loadConversation() {
	conversationLoaded.value = true;
	if (appearNote.replyId == null) return;
	misskeyApi('notes/conversation', {
		noteId: appearNote.replyId,
	}).then(res => {
		conversation.value = res.reverse();
	});
}

// キーボードショートカットマップ
const keymap = {
	'r': () => reply(),
	'e|a|plus': () => react(),
	'q': () => renote(),
	'm': () => showMenu(),
	'c': () => {
		if (!prefer.s.showClipButtonInNoteFooter) return;
		clip();
	},
	'o': () => {
		galleryEl.value?.openGallery();
	},
	'v|enter': () => {
		if (appearNote.cw != null) {
			showContent.value = !showContent.value;
		}
	},
	'esc': {
		allowRepeat: true,
		callback: () => blur(),
	},
} as const satisfies Keymap;
</script>

<style lang="scss" module>
.summaryReaction { width: 22px; height: 22px; font-size: 22px; object-fit: contain; }
.root {
	position: relative;
	font-size: 14px;
	transition: box-shadow 0.1s ease;
	overflow: clip;
	contain: content;

	&:focus-visible {
		outline: none;

		&::after {
			content: "";
			pointer-events: none;
			display: block;
			position: absolute;
			z-index: 10;
			top: 0;
			left: 0;
			right: 0;
			bottom: 0;
			margin: auto;
			width: calc(100% - 8px);
			height: calc(100% - 8px);
			border: dashed 2px var(--MI_THEME-focus);
			border-radius: var(--MI-radius);
			box-sizing: border-box;
		}
	}
}

.replyTo {
	opacity: 0.7;
	padding-bottom: 0;
}

.replyToMore {
	opacity: 0.7;
}

.renote {
	display: flex;
	align-items: center;
	padding: 16px 32px 8px 32px;
	line-height: 28px;
	white-space: pre;
	color: var(--MI_THEME-renote);
}

.renoteAvatar {
	flex-shrink: 0;
	display: inline-block;
	width: 28px;
	height: 28px;
	margin: 0 8px 0 0;
	border-radius: 6px;
}

.renoteText {
	overflow: hidden;
	flex-shrink: 1;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.renoteName {
	font-weight: bold;
}

.renoteInfo {
	margin-left: auto;
	font-size: 0.9em;
}

.renoteTime {
	flex-shrink: 0;
	color: inherit;
}

.renote + .note {
	padding-top: 8px;
}

.note {
	padding: 16px 16px 0;
	font-size: 14px;

	&:hover > .main > .footer > .button {
		opacity: 1;
	}
}

.noteHeader {
	display: flex;
	position: relative;
	margin-bottom: 10px;
	align-items: flex-start;
}

.noteHeaderAvatar {
	display: block;
	flex-shrink: 0;
	width: 40px;
	height: 40px;
}

.noteHeaderBody {
	flex: 1;
	min-width: 0;
	padding: 0 8px 0 8px;
	font-size: 14px;
}

.noteContent {
	container-type: inline-size;
	overflow-wrap: break-word;
	line-height: 1.55;
}

.menuButton { display: grid; place-items: center; flex: 0 0 36px; width: 36px; height: 40px; margin-top: -4px; border-radius: 50%; font-size: 20px; color: var(--MI_THEME-fgTransparentWeak); }
.menuButton:hover { background: var(--MI_THEME-panelHighlight); }
.menuButton:focus-visible { outline: 2px solid var(--MI_THEME-focus); }

.cw {
	cursor: default;
	display: block;
	margin: 0;
	padding: 0;
	overflow-wrap: break-word;
}

.noteReplyTarget {
	color: var(--MI_THEME-accent);
	margin-right: 0.5em;
}

.rn {
	margin-left: 4px;
	font-style: oblique;
	color: var(--MI_THEME-renote);
}

.translation {
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	padding: 12px;
	margin-top: 8px;
}

.poll {
	font-size: 80%;
}

.quote {
	padding: 8px 0;
}

.quoteNote {
	padding: 16px;
	border: dashed 1px var(--MI_THEME-renote);
	border-radius: 8px;
	overflow: clip;
}

.channel {
	opacity: 0.7;
	font-size: 80%;
}

.noteFooterInfo {
	margin: 12px 0 4px;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 12px;
}
.actionRow { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; min-height: 40px; }
.noteFooterButton.reacted { color: var(--MI_THEME-accent); }
.actionRow > .bookmark { min-width: 32px; min-height: 32px; > svg { width: 20px; height: 20px; } }
.discussionSelect { max-width: 50%; padding: 5px 8px; border: 1px solid var(--MI_THEME-divider); border-radius: 7px; background: transparent; color: var(--MI_THEME-fgTransparentWeak); font: inherit; font-size: 12px; }

.noteFooterButton {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	min-width: 32px;
	min-height: 32px;
	gap: 5px;
	margin: 0;
	padding: 0;
	color: var(--MI_THEME-fgTransparentWeak);
	border: 0;
	border-radius: 999px;
	font-size: 20px;
	> svg { width: 20px; height: 20px; }

	&:hover {
		color: var(--MI_THEME-fgHighlighted);
		background: var(--MI_THEME-panelHighlight);
	}
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
}

.noteFooterButtonCount {
	display: inline;
	margin: 0;
	font-size: 13px;
	font-variant-numeric: tabular-nums;

	&.reacted {
		color: var(--MI_THEME-accent);
	}
}

@media (hover: none), (pointer: coarse) {
	.noteFooterButton, .actionRow > .bookmark { min-width: 44px; min-height: 44px; }
	.menuButton { min-width: 44px; min-height: 44px; }
}

.reply:not(:first-child) {
	border-top: solid 0.5px var(--MI_THEME-divider);
}

.tabs {
	border-top: solid 0.5px var(--MI_THEME-divider);
	border-bottom: solid 0.5px var(--MI_THEME-divider);
	display: flex;
}

.tab {
	flex: 1;
	padding: 12px 8px;
	border-top: solid 2px transparent;
	border-bottom: solid 2px transparent;
	min-height: 48px;
	font-size: 13px;
}

.tabActive {
	border-bottom: solid 2px var(--MI_THEME-accent);
}

.tabCount {
	margin-left: 4px;
	opacity: 0.7;
}

.comments {
	padding-top: 4px;
}

.commentsHeader {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin: 0;
	padding: 14px 18px;
	border-top: solid 0.5px var(--MI_THEME-divider);
	border-bottom: solid 0.5px var(--MI_THEME-divider);
}

.commentsHeader h2 {
	margin: 0;
	font-size: 1.05em;
}

.commentsHeader h2 span {
	font-weight: normal;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.62);
}

.refreshComments {
	min-width: 44px;
	min-height: 44px;
	padding: 6px;
	border-radius: 7px;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.7);
}

.commentsState {
	margin: 0;
	padding: 26px 32px;
	text-align: center;
	color: color(from var(--MI_THEME-fg) srgb r g b / 0.65);
}

.tab_renotes {
	padding: 16px;
}

.tab_reactions {
	padding: 16px;
}

.reactionTabs {
	display: flex;
	gap: 8px;
	flex-wrap: wrap;
	margin-bottom: 8px;
}

.reactionTab {
	padding: 4px 6px;
	border: solid 1px var(--MI_THEME-divider);
	border-radius: 6px;
}

.reactionTabActive {
	border-color: var(--MI_THEME-accent);
}

@container (max-width: 500px) {
	.root {
		font-size: 14px;
	}
	.tab {
		padding-inline: 4px;
		font-size: 12px;
		white-space: nowrap;
		> i { display: block; margin: 0 auto 4px; font-size: 18px; }
	}
}

@container (max-width: 450px) {
	.renote {
		padding: 8px 16px 0 16px;
	}

	.note {
		padding: 14px 16px 0;
	}

	.noteHeaderAvatar {
		width: 40px;
		height: 40px;
	}

	.commentsHeader {
		padding: 16px 16px 8px;
	}

	.commentsState {
		padding: 24px 16px;
	}
}

@container (max-width: 350px) {
	.actionRow { gap: 10px; }
}

@container (max-width: 300px) {
	.root {
		font-size: 14px;
	}

	.noteHeaderAvatar {
		width: 40px;
		height: 40px;
	}

	.noteFooterButton {
		&:not(:last-child) {
			margin-right: 4px;
		}
	}
}

.muted {
	padding: 8px;
	text-align: center;
	opacity: 0.7;
}

.deleted {
	text-align: center;
	padding: 32px;
	margin: 6px 32px 32px;
	--color: light-dark(rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.15));
	background-size: auto auto;
	background-image: repeating-linear-gradient(135deg, transparent, transparent 10px, var(--color) 4px, var(--color) 14px);
	border-radius: 8px;
}
</style>
