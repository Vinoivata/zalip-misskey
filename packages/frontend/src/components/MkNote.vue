<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div
	v-if="!hardMuted && !hideByPlugin && muted === false"
	ref="rootEl"
	v-hotkey="keymap"
	:class="[$style.root, { [$style.showActionsOnlyHover]: prefer.s.showNoteActionsOnlyHover, [$style.skipRender]: prefer.s.skipNoteRender }]"
	tabindex="0"
	@keydown.enter.self.prevent="openComments()"
	@keydown.space.self.prevent="openComments()"
>
	<MkNoteSub v-if="appearNote.replyId && !isCommentRepost && !renoteCollapsed" :note="appearNote?.reply ?? null" :class="$style.replyTo" thread/>
	<div v-if="pinned" :class="$style.tip"><i class="ti ti-pin"></i> {{ i18n.ts.pinnedNote }}</div>
	<div v-if="isRenote" :class="$style.renote">
		<div v-if="note.channel" :class="$style.colorBar" :style="{ background: note.channel.color }"></div>
		<MkAvatar :class="$style.renoteAvatar" :user="note.user" link preview/>
		<i class="ti ti-repeat" style="margin-right: 4px;"></i>
		<I18n :src="isCommentRepost ? i18n.ts.zalip.commentRenotedBy : i18n.ts.renotedBy" tag="span" :class="$style.renoteText">
			<template #user>
				<MkA v-user-preview="note.userId" :class="$style.renoteUserName" :to="userPage(note.user)">
					<MkUserName :user="note.user"/>
				</MkA>
			</template>
		</I18n>
		<div :class="$style.renoteInfo">
			<button ref="renoteTime" type="button" :class="$style.renoteTime" class="_button" :aria-label="i18n.ts.renoteDetails" @click="showRenoteMenu()">
				<i class="ti ti-dots" :class="$style.renoteMenu" aria-hidden="true"></i>
				<MkTime :time="note.createdAt"/>
			</button>
			<span v-if="note.visibility !== 'public'" style="margin-left: 0.5em;" :title="i18n.ts._visibility[note.visibility]">
				<i v-if="note.visibility === 'home'" class="ti ti-home"></i>
				<i v-else-if="note.visibility === 'followers'" class="ti ti-lock"></i>
				<i v-else-if="note.visibility === 'specified'" ref="specified" class="ti ti-mail"></i>
			</span>
			<span v-if="note.channel" style="margin-left: 0.5em;" :title="note.channel.name"><i class="ti ti-device-tv"></i></span>
		</div>
	</div>
	<div v-if="isRenote && note.renote == null" :class="$style.deleted">
		{{ i18n.ts.deletedNote }}
	</div>
	<div v-else-if="renoteCollapsed" :class="$style.collapsedRenoteTarget">
		<MkAvatar :class="$style.collapsedRenoteTargetAvatar" :user="appearNote.user" link preview/>
		<Mfm :text="getNoteSummary(appearNote)" :plain="true" :nowrap="true" :author="appearNote.user" :nyaize="'respect'" :class="$style.collapsedRenoteTargetText" @click="renoteCollapsed = false"/>
	</div>
	<article v-else ref="articleEl" :class="$style.article" @pointerdown="startPostPointer" @click="openPost" @dblclick="postNavigation.cancel" @contextmenu.stop="postNavigation.cancel(); onContextmenu($event)">
		<div v-if="appearNote.channel" :class="$style.colorBar" :style="{ background: appearNote.channel.color }"></div>
		<MkAvatar :class="[$style.avatar, prefer.s.useStickyIcons ? $style.useSticky : null]" :user="appearNote.user" :link="!mock" :preview="!mock"/>
		<div :class="$style.main">
			<div :class="[$style.threadContent, { [$style.hasReplyPreview]: hasReplyPreview }]">
				<div :class="$style.headerRow">
					<MkNoteHeader :note="appearNote" stacked :class="$style.noteHeader"/>
					<MkZalipFollowButton v-if="!appearNote.isHidden" :user="appearNote.user" :mock="mock"/>
					<button ref="menuButton" type="button" :class="$style.menuButton" class="_button" :aria-label="i18n.ts.more" @click="showMenu()"><i class="ti ti-dots" aria-hidden="true"></i></button>
				</div>
				<MkA v-if="isCommentRepost" :class="$style.commentContext" :to="`/notes/${appearNote.replyId}`"><MkZalipIcon name="reply"/><span>{{ commentContextTitle }}</span></MkA>
				<div :class="$style.body" style="container-type: inline-size;">
					<p v-if="appearNote.cw != null" :class="$style.cw">
						<Mfm
							v-if="appearNote.cw != ''"
							:text="appearNote.cw"
							:author="appearNote.user"
							:nyaize="'respect'"
							:enableEmojiMenu="true"
							:enableEmojiMenuReaction="true"
						/>
						<MkCwButton v-model="showContent" :text="appearNote.text" :renote="appearNote.renote" :files="appearNote.files" :poll="appearNote.poll" style="margin: 4px 0;"/>
					</p>
					<div v-show="appearNote.cw == null || showContent">
						<div :class="[$style.text, { [$style.contentCollapsed]: hasLongText && collapsed }]">
							<span v-if="appearNote.isHidden" style="opacity: 0.5">({{ i18n.ts.private }})</span>
							<MkA v-if="appearNote.replyId && !isCommentRepost" :class="$style.replyIcon" :to="`/notes/${appearNote.replyId}`"><i class="ti ti-arrow-back-up"></i></MkA>
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
							<div v-if="translating || translation" :class="$style.translation">
								<MkLoading v-if="translating" mini/>
								<div v-else-if="translation">
									<b>{{ i18n.tsx.translatedFrom({ x: translation.sourceLang }) }}: </b>
									<Mfm :text="translation.text" :author="appearNote.user" :nyaize="'respect'" :emojiUrls="appearNote.emojis" class="_selectable"/>
								</div>
							</div>
						</div>
						<button v-if="hasLongText" type="button" class="_button" :class="$style.readMore" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? i18n.ts.showMore : i18n.ts.showLess }}</button>
						<ZalipShareCard v-if="appearNote.zalipShare" :share="appearNote.zalipShare"/>
						<div v-if="appearNote.files && appearNote.files.length > 0" data-zalip-post-interactive style="margin-top: 8px;">
							<MkMediaList ref="galleryEl" :mediaList="appearNote.files" layout="carousel"/>
						</div>
						<MkPoll
							v-if="appearNote.poll"
							data-zalip-post-interactive
							:noteId="appearNote.id"
							:multiple="appearNote.poll.multiple"
							:expiresAt="appearNote.poll.expiresAt"
							:choices="$appearNote.pollChoices"
							:author="appearNote.user"
							:emojiUrls="appearNote.emojis"
							:class="$style.poll"
						/>
						<div v-if="isEnabledUrlPreview" data-zalip-post-interactive>
							<MkUrlPreview v-for="url in urls" :key="url" :url="url" :compact="true" :detail="false" :class="$style.urlPreview"/>
						</div>
						<div v-if="appearNote.renoteId" data-zalip-post-interactive :class="$style.quote"><MkNoteSimple :note="appearNote?.renote ?? null" :class="$style.quoteNote"/></div>
					</div>
					<MkA v-if="appearNote.channel && !inChannel" :class="$style.channel" :to="`/channels/${appearNote.channel.id}`"><i class="ti ti-device-tv"></i> {{ appearNote.channel.name }}</MkA>
				</div>
				<MkZalipReplyPreview v-if="appearNote.repliesCount > 0 && (appearNote.cw == null || showContent)" :noteId="appearNote.id" :replyCount="appearNote.repliesCount" :replyAnchor="commentButton" @visible="hasReplyPreview = $event"/>
			</div>
			<footer :class="$style.footer">
				<div :class="$style.reactionAction">
				<button ref="reactButton" type="button" :class="[$style.footerButton, { [$style.reacted]: $appearNote.myReaction != null }]" class="_button" :aria-label="i18n.ts.reaction" :aria-pressed="$appearNote.myReaction != null" @click="handleToggleReact()">
					<MkReactionIcon v-if="summaryReaction" :class="$style.summaryReaction" :reaction="summaryReaction" :emojiUrl="$appearNote.reactionEmojis[summaryReaction.substring(1, summaryReaction.length - 1)]"/>
					<MkZalipIcon v-else :name="appearNote.reactionAcceptance === 'likeOnly' ? 'heart' : 'mood'"/>
					<span :class="$style.actionLabel">{{ i18n.ts.reaction }}</span>
				</button>
				<MkA :to="`/notes/${appearNote.id}/reactions`" :class="$style.reactionCount" :aria-label="i18n.ts.reactions">{{ number($appearNote.reactionCount) }}</MkA>
				</div>
				<button ref="commentButton" v-tooltip="i18n.ts.zalip.comments" type="button" :class="$style.footerButton" class="_button" :aria-label="i18n.ts.zalip.comments" @click="openComments()">
					<MkZalipIcon name="reply"/>
					<span :class="$style.actionLabel">{{ i18n.ts.zalip.comments }}</span>
					<span :class="$style.footerButtonCount">{{ number(appearNote.repliesCount) }}</span>
				</button>
				<button
					v-if="canRenote"
					ref="renoteButton"
					:class="$style.footerButton"
					class="_button"
					type="button"
					:aria-label="i18n.ts.renote"
					@click="renote()"
				>
					<MkZalipIcon name="repeat"/>
					<span :class="$style.footerButtonCount">{{ number(appearNote.renoteCount) }}</span>
				</button>
				<button v-else :class="$style.footerButton" class="_button" :aria-label="i18n.ts.renote" disabled>
					<i class="ti ti-ban"></i>
				</button>
				<MkZalipBookmark :class="$style.bookmark" :noteId="appearNote.id"/>
				<span v-if="viewCount != null" :class="$style.viewCount" :title="i18n.ts.zalip.postViews" :aria-label="`${i18n.ts.zalip.postViews}: ${number(viewCount)}`"><i class="ti ti-chart-bar" aria-hidden="true"></i><span>{{ number(viewCount) }}</span></span>
				<button v-if="prefer.s.showClipButtonInNoteFooter" ref="clipButton" type="button" :class="$style.footerButton" class="_button" :aria-label="i18n.ts.clip" @click="clip()">
					<i class="ti ti-paperclip"></i>
				</button>
			</footer>
		</div>
	</article>
</div>
<div v-else-if="!hardMuted && !hideByPlugin" :class="$style.muted" @click="muted = false">
	<I18n v-if="muted === 'sensitiveMute'" :src="i18n.ts.userSaysSomethingSensitive" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
	<I18n v-else-if="showSoftWordMutedWord !== true" :src="i18n.ts.userSaysSomething" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
	</I18n>
	<I18n v-else :src="i18n.ts.userSaysSomethingAbout" tag="small">
		<template #name>
			<MkA v-user-preview="appearNote.userId" :to="userPage(appearNote.user)">
				<MkUserName :user="appearNote.user"/>
			</MkA>
		</template>
		<template #word>
			{{ Array.isArray(muted) ? muted.map(words => Array.isArray(words) ? words.join() : words).slice(0, 3).join(' ') : muted }}
		</template>
	</I18n>
</div>
<div v-else>
	<!--
		MkDateSeparatedList uses TransitionGroup which requires single element in the child elements
		so MkNote create empty div instead of no elements
	-->
</div>
</template>

<script lang="ts" setup>
import { inject, ref, useTemplateRef, provide, computed, onBeforeUnmount } from 'vue';
import * as Misskey from 'misskey-js';
import { shouldCollapsed } from '@@/js/collapsed.js';
import type { Ref } from 'vue';
import type { Keymap } from '@/utility/hotkey.js';
import { useNote } from '@/composables/use-note.js';
import { prefer } from '@/preferences.js';
import { i18n } from '@/i18n.js';
import { userPage } from '@/filters/user.js';
import { getNoteSummary } from '@/utility/get-note-summary.js';
import { isEnabledUrlPreview } from '@/utility/url-preview.js';
import { focusPrev, focusNext } from '@/utility/focus.js';
import number from '@/filters/number.js';
import { DI } from '@/di.js';
import { useRouter } from '@/router.js';
import { createZalipPostNavigation } from '@/utility/zalip-post-navigation.js';
import { useZalipNoteViews } from '@/composables/use-zalip-note-views.js';

// コンポーネント外部の依存関係
import MkNoteSub from '@/components/MkNoteSub.vue';
import MkNoteHeader from '@/components/MkNoteHeader.vue';
import MkZalipFollowButton from '@/components/MkZalipFollowButton.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import MkZalipBookmark from '@/components/MkZalipBookmark.vue';
import MkZalipReplyPreview from '@/components/MkZalipReplyPreview.vue';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkCwButton from '@/components/MkCwButton.vue';
import MkPoll from '@/components/MkPoll.vue';
import MkUrlPreview from '@/components/MkUrlPreview.vue';
import ZalipShareCard from '@/components/ZalipShareCard.vue';

const props = withDefaults(defineProps<{
	note: Misskey.entities.Note;
	pinned?: boolean;
	mock?: boolean;
	withHardMute?: boolean;
}>(), {
	mock: false,
});

const emit = defineEmits<{
	(ev: 'reaction', emoji: string): void;
	(ev: 'removeReaction', emoji: string): void;
}>();

const router = useRouter();
const hasReplyPreview = ref(false);

provide(DI.mock, props.mock);

// 周辺コンテキストのインジェクト
const inTimeline = inject<boolean>('inTimeline', false);
const tl_withSensitive = inject<Ref<boolean>>('tl_withSensitive', ref(true));
const inChannel = inject(DI.inChannel, null);
const currentClip = inject<Ref<Misskey.entities.Clip> | null>('currentClip', null);
const currentAntenna = inject<Ref<Misskey.entities.Antenna | null> | null>('currentAntenna', null);

// Template Refsの定義
const rootEl = useTemplateRef('rootEl');
const articleEl = useTemplateRef('articleEl');
const menuButton = useTemplateRef('menuButton');
const renoteButton = useTemplateRef('renoteButton');
const renoteTime = useTemplateRef('renoteTime');
const reactButton = useTemplateRef('reactButton');
const commentButton = useTemplateRef<HTMLElement>('commentButton');
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
	translating,
	translation,
	muted,
	hardMuted,
	collapsed,
	renoteCollapsed,
	parsed,
	urls,
	canRenote,

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
	inTimeline,
	tl_withSensitive,
	inChannel,
	currentClip,
	currentAntenna,
});

// provide
provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);
const summaryReaction = computed(() => $appearNote.myReaction ?? Object.entries($appearNote.reactions).sort((a, b) => b[1] - a[1])[0]?.[0]);
const isCommentRepost = isRenote && appearNote.replyId != null;
const commentContextTitle = computed(() => appearNote.reply?.isZalipDiscussionRoot && !appearNote.reply.isHidden && appearNote.reply.cw == null
	? getNoteSummary(appearNote.reply, { showReply: false, showRenote: false })
	: i18n.ts.zalip.commentContext);
// Only text participates in read-more. Media, polls and linked title cards stay fully reachable.
const hasLongText = computed(() => shouldCollapsed({ ...appearNote, files: [] }, []));
const viewCount = useZalipNoteViews(articleEl, () => appearNote, () => !props.mock && !hardMuted.value && !hideByPlugin.value && muted.value === false && !renoteCollapsed.value && (appearNote.cw == null || showContent.value));

// MkNote固有
const showSoftWordMutedWord = computed(() => prefer.s.showSoftWordMutedWord);

function handleToggleReact() {
	toggleReact((reaction) => {
		if ($appearNote.myReaction === reaction) {
			emit('removeReaction', reaction);
		} else {
			emit('reaction', reaction);
			$appearNote.reactions[reaction] = 1;
			$appearNote.reactionCount++;
			$appearNote.myReaction = reaction;
		}
	});
}

function emitUpdReaction(emoji: string, delta: number) {
	if (delta < 0) {
		emit('removeReaction', emoji);
	} else if (delta > 0) {
		emit('reaction', emoji);
	}
}

let postPointerStart: { x: number; y: number } | undefined;
const postNavigation = createZalipPostNavigation(openComments);
onBeforeUnmount(postNavigation.cancel);

function startPostPointer(event: PointerEvent): void {
	postNavigation.cancel();
	postPointerStart = { x: event.clientX, y: event.clientY };
}

function openPost(event: MouseEvent): void {
	if (event.currentTarget instanceof HTMLElement) postNavigation.click(event, event.currentTarget, postPointerStart);
	postPointerStart = undefined;
}

function openComments(): void {
	postNavigation.cancel();
	if (props.mock) return;
	router.push('/notes/:noteId/:initialTab?', {
		params: { noteId: appearNote.id, initialTab: 'replies' },
	});
}

// キーボードショートカットマップ
const keymap = {
	'r': () => {
		if (renoteCollapsed.value) return;
		reply();
	},
	'e|a|plus': () => {
		if (renoteCollapsed.value) return;
		react();
	},
	'q': () => {
		if (renoteCollapsed.value) return;
		renote();
	},
	'm': () => {
		if (renoteCollapsed.value) return;
		showMenu();
	},
	'c': () => {
		if (renoteCollapsed.value) return;
		if (!prefer.s.showClipButtonInNoteFooter) return;
		clip();
	},
	'o': () => {
		if (renoteCollapsed.value) return;
		galleryEl.value?.openGallery();
	},
	'v': () => {
		if (renoteCollapsed.value) {
			renoteCollapsed.value = false;
		} else if (appearNote.cw != null) {
			showContent.value = !showContent.value;
		} else if (hasLongText.value) {
			collapsed.value = !collapsed.value;
		}
	},
	'esc': {
		allowRepeat: true,
		callback: () => blur(),
	},
	'up|k|shift+tab': {
		allowRepeat: true,
		callback: () => focusPrev(rootEl.value),
	},
	'down|j|tab': {
		allowRepeat: true,
		callback: () => focusNext(rootEl.value),
	},
} as const satisfies Keymap;
</script>

<style lang="scss" module>
.summaryReaction { width: 20px; height: 20px; font-size: 20px; object-fit: contain; }
.instanceTicker { margin-top: 4px; }
.root {
	position: relative;
	min-width: 0;
	font-size: max(1em, 15px);
	border-bottom: 1px solid color-mix(in srgb, var(--MI_THEME-divider) 84%, transparent);
	overflow: clip;
	contain: content;
	transition: background 0.16s ease;

	@media (hover: hover) and (pointer: fine) {
		&:hover > .article {
			background: color-mix(in srgb, var(--MI_THEME-panelHighlight) 36%, transparent);
		}
	}

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

	.footer {
		position: relative;
		z-index: 1;
	}

	&:hover > .article > .main > .footer > .footerButton {
		color: var(--MI_THEME-fg);
	}

	&.showActionsOnlyHover {
		.footer {
			visibility: hidden;
			position: absolute;
			top: 12px;
			right: 12px;
			padding: 0 4px;
			margin-bottom: 0 !important;
			background: var(--MI_THEME-popup);
			border-radius: 8px;
			box-shadow: 0px 4px 32px var(--MI_THEME-shadow);
		}

		.footerButton {
			font-size: 90%;

			&:not(:last-child) {
				margin-right: 0;
			}
		}
	}

	&.showActionsOnlyHover:hover, &.showActionsOnlyHover:focus-within {
		.footer {
			visibility: visible;
		}
	}
}

.skipRender {
	// TODO: これが有効だとTransitionGroupでnoteを追加するときに一瞬がくっとなってしまうのをどうにかしたい
	// Transitionが完了するのを待ってからskipRenderを付与すれば解決しそうだけどパフォーマンス的な影響が不明
	content-visibility: auto;
	contain-intrinsic-size: 0 150px;
}

.tip {
	display: flex;
	align-items: center;
	padding: 14px 26px 6px;
	line-height: 24px;
	font-size: 90%;
	white-space: pre;
	color: #d28a3f;
}

.tip + .article {
	padding-top: 8px;
}

.replyTo {
	opacity: 0.7;
	padding-bottom: 0;
}

.renote {
	position: relative;
	display: flex;
	align-items: center;
	padding: 14px 26px 6px;
	line-height: 28px;
	white-space: pre;
	color: var(--MI_THEME-renote);

	& + .article {
		padding-top: 8px;
	}

	> .colorBar {
		height: calc(100% - 6px);
	}
}

.renoteAvatar {
	flex-shrink: 0;
	display: inline-block;
	width: 28px;
	height: 28px;
	margin: 0 8px 0 0;
}

.renoteText {
	overflow: hidden;
	flex-shrink: 1;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.renoteUserName {
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

.renoteMenu {
	margin-right: 4px;
}

.collapsedRenoteTarget {
	display: flex;
	align-items: center;
	line-height: 28px;
	white-space: pre;
	padding: 0 32px 18px;
}

.collapsedRenoteTargetAvatar {
	flex-shrink: 0;
	display: inline-block;
	width: 28px;
	height: 28px;
	margin: 0 8px 0 0;
}

.collapsedRenoteTargetText {
	overflow: hidden;
	flex-shrink: 1;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-size: 90%;
	opacity: 0.7;
	cursor: pointer;

	&:hover {
		text-decoration: underline;
	}
}

.article {
	position: relative;
	cursor: pointer;
	display: flex;
	padding: 16px 16px 10px;
	border-radius: 0;
	transition: background 0.16s ease;
}

.threadContent { position: relative; }

.threadContent::after {
	content: '';
	position: absolute;
	left: -32px;
	top: 44px;
	bottom: 0;
	width: 1px;
	background: var(--MI_THEME-divider);
	pointer-events: none;
}
.hasReplyPreview::after { bottom: 24px; }
.commentContext { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0 0 8px; color: var(--zalip-social-muted); font-size: 13px; > svg { flex: 0 0 16px; width: 16px; height: 16px; } > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }

.colorBar {
	position: absolute;
	top: 8px;
	left: 8px;
	width: 5px;
	height: calc(100% - 16px);
	border-radius: 999px;
	pointer-events: none;
}

.avatar {
	flex-shrink: 0;
	display: block !important;
	margin: 0 12px 0 0;
	width: 40px;
	height: 40px;
	border-radius: 50%;

	&.useSticky {
		position: sticky !important;
		top: calc(18px + var(--MI-stickyTop, 0px));
		left: 0;
	}
}

.main {
	flex: 1;
	min-width: 0;
}

.headerRow {
	display: flex;
	align-items: flex-start;
	gap: 8px;
	min-width: 0;
	margin-bottom: 6px;
}

.noteHeader { flex: 1; min-width: 0; }
.body { min-width: 0; }
.reactions { margin-top: 8px; }
.menuButton {
	display: grid;
	place-items: center;
	flex: 0 0 44px;
	width: 44px;
	height: 44px;
	margin-top: -4px;
	border-radius: 50%;
	color: var(--MI_THEME-fgTransparentWeak);
	font-size: 18px;
	&:hover { background: var(--MI_THEME-panelHighlight); }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); }
}

.cw {
	cursor: default;
	display: block;
	margin: 0;
	padding: 0;
	overflow-wrap: break-word;
}

.contentCollapsed {
	max-height: 9.3em;
	overflow: clip;
}

.readMore {
	display: inline-flex;
	align-items: center;
	min-height: 36px;
	padding: 0;
	margin: 2px 0 4px;
	font-size: 13px;
	font-weight: 500;
	color: var(--MI_THEME-accent);
	&:hover { text-decoration: underline; }
	&:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: 2px; }
}

.text {
	overflow-wrap: break-word;
	line-height: 1.55;
}

.replyIcon {
	color: var(--MI_THEME-accent);
	margin-right: 0.5em;
}

.translation {
	border: solid 0.5px var(--MI_THEME-divider);
	border-radius: var(--MI-radius);
	padding: 12px;
	margin-top: 8px;
}

.urlPreview {
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

.footer {
	display: flex;
	align-items: center;
	gap: 18px;
	flex-wrap: wrap;
	margin: 10px 0 0;
}

.footerButton {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 5px;
	min-width: 32px;
	min-height: 40px;
	margin: 0;
	padding: 0;
	border: 0;
	border-radius: 10px;
	color: var(--zalip-social-muted);
	transition: color 0.16s ease, background 0.16s ease;
	> i { font-size: 19px; }
	> svg { width: 20px; height: 20px; }

	&:hover {
		background: color-mix(in srgb, var(--MI_THEME-panelHighlight) 80%, transparent);
		color: var(--MI_THEME-accent);
	}

	&:focus-visible {
		outline: 2px solid var(--MI_THEME-focus);
		outline-offset: 2px;
	}
}

.actionLabel { display: none; }
.reactionAction { display: inline-flex; align-items: center; gap: 2px; }
.reactionCount { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; min-height: 40px; color: var(--zalip-social-muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.reactionCount:focus-visible { outline: 2px solid var(--MI_THEME-focus); border-radius: 8px; }
.viewCount { display: inline-flex; align-items: center; gap: 4px; color: var(--zalip-social-muted); min-height: 40px; font-size: 12px; font-variant-numeric: tabular-nums; > i { font-size: 18px; } }
.reacted { color: var(--MI_THEME-accent); }
.footer > .bookmark { min-width: 32px; min-height: 40px; > svg { width: 20px; height: 20px; } }

.footerButtonCount {
	display: inline;
	margin: 0;
	font-size: 13px;
	font-variant-numeric: tabular-nums;
}

// A tablet has a wide enough timeline to miss the container breakpoint below,
// but it cannot reveal hover-only controls.  Keep the social actions directly
// reachable on any touch surface.
@media (hover: none), (pointer: coarse) {
	.footerButton, .footer > .bookmark { min-width: 44px; min-height: 44px; }
	.menuButton { min-width: 44px; min-height: 44px; }

	.root.showActionsOnlyHover .footer {
		visibility: visible;
		position: relative;
		top: auto;
		right: auto;
		padding: 0;
		background: transparent;
		box-shadow: none;
	}
}

@container (max-width: 580px) {
	.article { padding: 14px 12px 8px; }
	.avatar { width: 40px; height: 40px; margin-right: 10px; }
	.threadContent::after { left: -30px; }
	.avatar.useSticky { position: relative !important; top: auto; }
	.menuButton { margin-top: -5px; }
	.renote, .tip { padding: 10px 12px 0; font-size: 12px; }
	.footer { gap: clamp(4px, 2vw, 10px); }
	.root.showActionsOnlyHover .footer { position: relative; visibility: visible; top: auto; right: auto; background: transparent; box-shadow: none; }
}

.muted {
	padding: 8px;
	text-align: center;
	opacity: 0.7;
}

.reactionOmitted {
	display: inline-block;
	margin-left: 8px;
	opacity: .8;
	font-size: 95%;
}

.deleted {
	text-align: center;
	padding: 32px;
	margin: 6px 32px 28px;
	--color: light-dark(rgba(0, 0, 0, 0.05), rgba(0, 0, 0, 0.15));
	background-size: auto auto;
	background-image: repeating-linear-gradient(135deg, transparent, transparent 10px, var(--color) 4px, var(--color) 14px);
	border-radius: 8px;
}
</style>
