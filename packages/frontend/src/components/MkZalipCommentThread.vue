<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<section v-if="!isDeleted && !hideByPlugin && !hardMuted && !appearNote.isHidden" ref="rootEl" tabindex="-1" :class="[$style.root, { [$style.nested]: depth > 0, [$style.deep]: depth >= 2 }]" :data-comment-id="appearNote.id" :data-comment-depth="depth">
	<button v-if="muted" type="button" class="_button" :class="$style.muted" @click="muted = false">{{ i18n.tsx.userSaysSomething({ name: appearNote.user.name ?? appearNote.user.username }) }}</button>
	<template v-else>
		<article :class="$style.comment">
			<div :class="$style.gutter">
				<MkAvatar :class="$style.avatar" :user="appearNote.user" link preview/>
				<span v-if="expandedChildren" :class="$style.rail" aria-hidden="true"></span>
			</div>
			<div :class="$style.body">
				<header :class="$style.header">
					<MkA v-user-preview="appearNote.userId" :class="$style.author" :to="userPage(appearNote.user)"><MkUserName :user="appearNote.user"/></MkA>
					<i v-if="appearNote.user.isBot" class="ti ti-robot" :title="i18n.ts._role._condition.isBot" aria-hidden="true"></i>
					<img v-for="(role, index) in appearNote.user.badgeRoles" :key="index" :class="$style.badge" :src="role.iconUrl ?? undefined" :alt="role.name" :title="role.name" loading="lazy" decoding="async">
					<MkA :class="$style.time" :to="notePage(appearNote)"><MkTime :time="appearNote.createdAt"/></MkA>
					<span v-if="appearNote.visibility !== 'public'" :class="$style.visibility" role="img" :aria-label="i18n.ts._visibility[appearNote.visibility]" :title="i18n.ts._visibility[appearNote.visibility]"><i :class="appearNote.visibility === 'home' ? 'ti ti-home' : appearNote.visibility === 'followers' ? 'ti ti-lock' : 'ti ti-mail'" aria-hidden="true"></i></span>
					<MkZalipFollowButton :user="appearNote.user" :mock="mock"/>
					<button ref="menuButton" type="button" class="_button" :class="$style.menu" :aria-label="i18n.ts.more" :title="i18n.ts.more" @click="showMenu()"><i class="ti ti-dots" aria-hidden="true"></i></button>
				</header>
				<p v-if="appearNote.cw != null" :class="$style.cw"><Mfm v-if="appearNote.cw" :text="appearNote.cw" :author="appearNote.user"/><MkCwButton v-model="showContent" :text="appearNote.text" :files="appearNote.files" :poll="appearNote.poll"/></p>
				<div v-show="appearNote.cw == null || showContent">
					<div :class="[$style.text, { [$style.collapsed]: hasLongText && collapsed }]"><Mfm v-if="appearNote.text" :text="appearNote.text" :parsedNodes="parsed" :author="appearNote.user" :emojiUrls="appearNote.emojis" :nyaize="'respect'" :enableEmojiMenu="true" :enableEmojiMenuReaction="true" class="_selectable"/></div>
					<button v-if="hasLongText" type="button" class="_button" :class="$style.textToggle" :aria-expanded="!collapsed" @click="collapsed = !collapsed">{{ collapsed ? i18n.ts.showMore : i18n.ts.showLess }}</button>
					<ZalipShareCard v-if="appearNote.zalipShare" :share="appearNote.zalipShare"/>
					<MkMediaList v-if="appearNote.files?.length" :class="$style.media" :mediaList="appearNote.files" layout="carousel"/>
					<MkPoll v-if="appearNote.poll" :class="$style.media" :noteId="appearNote.id" :multiple="appearNote.poll.multiple" :expiresAt="appearNote.poll.expiresAt" :choices="$appearNote.pollChoices" :author="appearNote.user" :emojiUrls="appearNote.emojis"/>
					<MkNoteSimple v-if="appearNote.renote" :class="$style.quote" :note="appearNote.renote"/>
				</div>
				<footer :class="$style.actions">
					<button ref="reactButton" type="button" class="_button" :class="[$style.action, { [$style.reacted]: $appearNote.myReaction != null }]" :aria-label="i18n.ts.reaction" :aria-pressed="$appearNote.myReaction != null" @click="toggleReact()"><MkReactionIcon v-if="summaryReaction" :class="$style.reaction" :reaction="summaryReaction" :emojiUrl="$appearNote.reactionEmojis[summaryReaction.substring(1, summaryReaction.length - 1)]"/><MkZalipIcon v-else :name="appearNote.reactionAcceptance === 'likeOnly' ? 'heart' : 'mood'"/><span>{{ number($appearNote.reactionCount) }}</span></button>
					<button type="button" class="_button" :class="$style.action" :aria-label="i18n.ts.reply" @click="emit('reply', appearNote)"><MkZalipIcon name="reply"/><span>{{ number(replyCount) }}</span></button>
					<button ref="renoteButton" type="button" class="_button" :class="$style.action" :aria-label="i18n.ts.renote" :disabled="!canRenote" @click="renote()"><MkZalipIcon name="repeat"/><span>{{ number(appearNote.renoteCount) }}</span></button>
				</footer>
				<template v-if="hasReplies && !atDepthLimit">
					<button type="button" class="_button" :class="$style.expand" :aria-expanded="pager.state.expanded" :aria-controls="childrenId" @click="pager.toggle()"><i :class="pager.state.expanded ? 'ti ti-minus' : 'ti ti-plus'" aria-hidden="true"></i>{{ pager.state.expanded ? i18n.ts.showLess : i18n.ts.loadReplies }}</button>
				</template>
				<MkA v-else-if="hasReplies" :class="$style.continue" :to="notePage(appearNote)">{{ i18n.ts.continueThread }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
			</div>
		</article>
		<div v-if="pager.state.expanded" :id="childrenId" :class="$style.branch" :aria-busy="pager.state.pending">
			<div v-for="(child, index) in pager.state.items" :key="child.id" :class="[$style.branchItem, { [$style.branchContinues]: index < pager.state.items.length - 1 }]"><MkZalipCommentThread :note="child" :depth="depth + 1" :ancestors="[...ancestors, appearNote.id]" :mock="mock" @reply="emit('reply', $event)"/></div>
			<p v-if="pager.state.pending" :class="$style.state" role="status">{{ i18n.ts.loading }}</p>
			<div v-if="pager.state.error" :class="$style.state"><p role="alert">{{ i18n.ts.zalip.commentsError }}</p><button type="button" class="_textButton" @click="pager.loadNext()">{{ i18n.ts.retry }}</button></div>
			<p v-else-if="pager.state.loaded && !pager.state.items.length && !pager.state.hasMore" :class="$style.state">{{ i18n.ts.zalip.commentsEmpty }}</p>
			<button v-if="hasUnloadedReplies && !pager.state.pending && !pager.state.error && !pager.state.limited" type="button" class="_button" :class="$style.more" @click="pager.loadNext()">{{ i18n.ts.loadReplies }}</button>
			<button v-if="pager.state.hasMore && !pager.state.pending && !pager.state.error" type="button" class="_button" :class="$style.more" @click="pager.loadNext()">{{ i18n.ts.loadMore }}</button>
			<MkA v-if="pager.state.limited" :class="$style.continue" :to="notePage(appearNote)">{{ i18n.ts.continueThread }} <i class="ti ti-arrow-up-right" aria-hidden="true"></i></MkA>
		</div>
	</template>
</section>
</template>

<script lang="ts" setup>
import { computed, inject, onBeforeUnmount, provide, ref, useId, useTemplateRef, watch } from 'vue';
import { shouldCollapsed } from '@@/js/collapsed.js';
import type * as Misskey from 'misskey-js';
import { useNote } from '@/composables/use-note.js';
import MkCwButton from '@/components/MkCwButton.vue';
import MkMediaList from '@/components/MkMediaList.vue';
import MkPoll from '@/components/MkPoll.vue';
import MkNoteSimple from '@/components/MkNoteSimple.vue';
import MkReactionIcon from '@/components/MkReactionIcon.vue';
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import MkZalipFollowButton from '@/components/MkZalipFollowButton.vue';
import ZalipShareCard from '@/components/ZalipShareCard.vue';
import { DI } from '@/di.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { useGlobalEvent } from '@/events.js';
import { notePage } from '@/filters/note.js';
import { userPage } from '@/filters/user.js';
import number from '@/filters/number.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { checkWordMute } from '@/utility/check-word-mute.js';
import { commentThreadBudgetKey, createCommentReplyPager, createCommentThreadBudget, COMMENT_THREAD_MAX_DEPTH } from '@/utility/zalip-comment-thread.js';

const props = withDefaults(defineProps<{ note: Misskey.entities.Note; depth?: number; ancestors?: readonly string[]; mock?: boolean; withHardMute?: boolean }>(), { depth: 0, ancestors: () => [], mock: false, withHardMute: true });
const emit = defineEmits<{ (ev: 'reply', note: Misskey.entities.Note): void }>();
const rootEl = useTemplateRef<HTMLElement>('rootEl');
const menuButton = useTemplateRef<HTMLElement>('menuButton');
const reactButton = useTemplateRef<HTMLElement>('reactButton');
const renoteButton = useTemplateRef<HTMLElement>('renoteButton');
const childrenId = useId();
const { appearNote, $appearNote, hideByPlugin, hardMuted, muted, isDeleted, showContent, collapsed, parsed, canRenote, renote, toggleReact, showMenu, reactViaMfmEmoji } = useNote(props, { rootEl, menuButton, reactButton, renoteButton });
provide(DI.mfmEmojiReactCallback, reactViaMfmEmoji);
const budget = inject(commentThreadBudgetKey, null) ?? createCommentThreadBudget();
budget.take(appearNote);
provide(commentThreadBudgetKey, budget);
const pager = createCommentReplyPager({ parentId: appearNote.id, ancestors: props.ancestors, accountId: () => $i?.id ?? null, budget, allowNote: note => !$i || !checkWordMute(note, $i, $i.hardMutedWords), fetchPage: params => misskeyApi('notes/replies', params, $i?.token ?? null) });
const localReplies = ref(new Set<string>());
const removedReplies = ref(new Set<string>());
const seenLocalReplies = new Set<string>();
const atDepthLimit = computed(() => props.depth >= COMMENT_THREAD_MAX_DEPTH);
// useNote captures this card's snapshot; local deltas belong to that same baseline.
const replyCount = computed(() => Math.max(0, appearNote.repliesCount + localReplies.value.size - removedReplies.value.size, pager.state.items.length));
const hasReplies = computed(() => replyCount.value > 0);
const hasUnloadedReplies = computed(() => !pager.state.loaded && replyCount.value > pager.state.items.length);
const expandedChildren = computed(() => pager.state.expanded && pager.state.items.length > 0);
const hasLongText = computed(() => shouldCollapsed({ ...appearNote, files: [] }, []));
const summaryReaction = computed(() => $appearNote.myReaction ?? Object.entries($appearNote.reactions).sort((a, b) => b[1] - a[1])[0]?.[0]);
watch(() => $i?.id, () => { pager.reset(); localReplies.value.clear(); removedReplies.value.clear(); seenLocalReplies.clear(); });
onBeforeUnmount(pager.reset);
useGlobalEvent('notePosted', created => {
	if (created.userId !== $i?.id || created.replyId !== appearNote.id || created.isHidden || created.deletedAt || removedReplies.value.has(created.id) || seenLocalReplies.has(created.id)) return;
	seenLocalReplies.add(created.id);
	if (!pager.state.items.some(note => note.id === created.id)) localReplies.value.add(created.id);
	// A successful reply should be visible beneath its real parent even when
	// that branch was closed. Older replies still require an explicit load.
	if (!atDepthLimit.value) pager.reveal(created);
});
useGlobalEvent('noteDeleted', id => {
	const wasLocal = localReplies.value.delete(id);
	if (!wasLocal && pager.state.items.some(note => note.id === id)) removedReplies.value.add(id);
	pager.remove(id);
});
</script>

<style lang="scss" module>
.root { --comment-avatar: 32px; --comment-child-avatar: 28px; padding: 16px 24px; min-width: 0; font-size: max(1em, 14px); }
.nested { --comment-avatar: 28px; padding: 12px 0 0; }
.comment { display: grid; grid-template-columns: var(--comment-avatar) minmax(0, 1fr); gap: 10px; }
.gutter { position: relative; }
.avatar { display: block; width: var(--comment-avatar); height: var(--comment-avatar); border-radius: 50%; }
.rail { position: absolute; left: calc(var(--comment-avatar) / 2 - .5px); top: calc(var(--comment-avatar) + 8px); bottom: 0; border-left: 1px solid var(--MI_THEME-divider); pointer-events: none; }
.body { min-width: 0; }
.header { display: flex; align-items: center; gap: 7px; min-height: 28px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; }
.author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--MI_THEME-fg); font-size: 14px; font-weight: 700; }
.time { flex: 0 0 auto; color: inherit; }
.badge { width: 16px; height: 16px; object-fit: contain; }
.visibility { flex: 0 0 auto; }
.menu { display: grid; place-items: center; flex: 0 0 44px; width: 44px; height: 44px; margin: -8px 0 -8px auto; color: var(--MI_THEME-fgTransparentWeak); border-radius: 50%; > i { display: block; width: 18px; height: 18px; font-size: 18px; line-height: 18px; } &:hover { color: var(--MI_THEME-fg); } &:focus-visible { outline: 2px solid var(--MI_THEME-focus); outline-offset: -2px; } }
.text { line-height: 1.6; overflow-wrap: anywhere; }
.collapsed { max-height: 9.6em; overflow: clip; }
.textToggle { min-height: 36px; color: var(--MI_THEME-accent); font-size: 13px; }
.cw { margin: 0; overflow-wrap: anywhere; }
.media { margin-top: 8px; }
.quote { margin-top: 8px; padding: 10px; border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 14px; margin-top: 5px; }
.action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-width: 32px; min-height: 32px; color: var(--MI_THEME-fgTransparentWeak); font-size: 13px; font-variant-numeric: tabular-nums; > svg { width: 20px; height: 20px; } > i { font-size: 20px; } }
.action.reacted { color: var(--MI_THEME-accent); }
.action:disabled { opacity: .4; cursor: default; }
.reaction { width: 20px; height: 20px; font-size: 20px; }
.action:hover:not(:disabled), .expand:hover, .more:hover { color: var(--MI_THEME-accent); }
.expand, .more, .continue { display: inline-flex; align-items: center; gap: 7px; min-height: 36px; font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); }
.branch { margin-left: var(--comment-avatar); }
.branchItem { position: relative; }
.branchItem::before { content: ''; position: absolute; left: calc(var(--comment-avatar) / -2 - .5px); top: 0; width: calc(var(--comment-avatar) / 2 + .5px); height: calc(12px + var(--comment-child-avatar) / 2); box-sizing: border-box; border-left: 1px solid var(--MI_THEME-divider); border-bottom: 1px solid var(--MI_THEME-divider); border-bottom-left-radius: 12px; pointer-events: none; }
.branchContinues::after { content: ''; position: absolute; left: calc(var(--comment-avatar) / -2 - .5px); top: 0; bottom: 0; border-left: 1px solid var(--MI_THEME-divider); pointer-events: none; }
.state { margin: 0; padding: 12px 0; font-size: 13px; color: var(--MI_THEME-fgTransparentWeak); > p { margin: 0 0 6px; } }
.muted { width: 100%; min-height: 44px; text-align: center; color: var(--MI_THEME-fgTransparentWeak); }
@media (hover: none), (pointer: coarse) { .action, .menu { min-width: 44px; min-height: 44px; } }
// Keep the real recursive parent/child structure, but stop consuming horizontal
// space at every level in a narrow discussion column.
@container (max-width: 600px) {
	.deep > .branch { margin-left: 0; }
	.deep > .branch > .branchItem::before { left: calc(var(--comment-avatar) / 2 - .5px); width: 0; border-bottom: 0; border-bottom-left-radius: 0; }
	.deep > .branch > .branchContinues::after { left: calc(var(--comment-avatar) / 2 - .5px); }
}
@container (max-width: 450px) { .root { padding: 14px 16px; } .nested { padding: 12px 0 0; } .actions { gap: 8px; } }
</style>
