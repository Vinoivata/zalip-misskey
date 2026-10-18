/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ref, computed, reactive, onActivated, onDeactivated, onBeforeUnmount } from 'vue';
import * as mfm from 'mfm-js';
import * as Misskey from 'misskey-js';
import { isLink } from '@@/js/is-link.js';
import { shouldCollapsed } from '@@/js/collapsed.js';
import { host } from '@@/js/config.js';
import type { Ref } from 'vue';
import type { OpenOnRemoteOptions } from '@/utility/please-login.js';
import type { DI as DIType } from '@/di.js';
import type { ExtractInjectedType } from '@/types/misc.js';
import type { MenuItem } from '@/types/menu.js';
import { pleaseLogin } from '@/utility/please-login.js';
import { checkWordMute } from '@/utility/check-word-mute.js';
import { misskeyApi, misskeyApiGet } from '@/utility/misskey-api.js';
import * as sound from '@/utility/sound.js';
import * as os from '@/os.js';
import { reactionPicker } from '@/utility/reaction-picker.js';
import { extractUrlFromMfm } from '@/utility/extract-url-from-mfm.js';
import { getNoteClipMenu, getNoteMenu, getRenoteMenu, getAbuseNoteMenu, getCopyNoteLinkMenu } from '@/utility/get-note-menu.js';
import { noteEvents, useNoteCapture } from '@/composables/use-note-capture.js';
import { deepClone } from '@/utility/clone.js';
import { useTooltip } from '@/composables/use-tooltip.js';
import { claimAchievement } from '@/utility/achievements.js';
import { showMovedDialog } from '@/utility/show-moved-dialog.js';
import { getAppearNote } from '@/utility/get-appear-note.js';
import { prefer } from '@/preferences.js';
import { getPluginHandlers } from '@/plugin.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { globalEvents, useGlobalEvent } from '@/events.js';
import MkUsersTooltip from '@/components/MkUsersTooltip.vue';
import MkReactionsViewerDetails from '@/components/MkReactionsViewer.details.vue';
import MkRippleEffect from '@/components/MkRippleEffect.vue';
import { notePage } from '@/filters/note.js';

export interface UseNoteProps {
	note: Misskey.entities.Note;
	pinned?: boolean;
	mock?: boolean;
	withHardMute?: boolean;
}

export interface UseNoteElements {
	rootEl?: Ref<HTMLElement | null>;
	menuButton?: Ref<HTMLElement | null>;
	renoteButton?: Ref<HTMLElement | null>;
	renoteTime?: Ref<HTMLElement | null>;
	reactButton?: Ref<HTMLElement | null>;
	clipButton?: Ref<HTMLElement | null>;
}

export interface UseNoteOptions {
	inTimeline?: boolean;
	tl_withSensitive?: Ref<boolean>;
	inChannel?: ExtractInjectedType<typeof DIType['inChannel']>;
	currentClip?: Ref<Misskey.entities.Clip | null> | null;
	currentAntenna?: Ref<Misskey.entities.Antenna | null> | null;
}

type NoteActionActor = { id: string; token: string };

export function calculateMuteStatus<
	CheckOnly extends boolean,
	CheckForSensitiveMedia extends boolean,
	ReturnTypeA = CheckOnly extends true ? boolean : Array<string | string[]> | false | 'sensitiveMute',
	ReturnTypeB = CheckForSensitiveMedia extends true ? ReturnTypeA : Exclude<ReturnTypeA, 'sensitiveMute'>,
>(
	noteToCheck: Misskey.entities.Note,
	user: typeof $i,
	mutedWords: Array<string | string[]> | null,
	checkForSensitiveMedia: CheckForSensitiveMedia,
	checkOnly: CheckOnly = false as CheckOnly,
): ReturnTypeB {
	if (mutedWords != null) {
		const result = checkWordMute(noteToCheck, user, mutedWords);
		if (Array.isArray(result)) return checkOnly ? (result.length > 0) as ReturnTypeB : result as ReturnTypeB;

		const replyResult = noteToCheck.reply && checkWordMute(noteToCheck.reply, user, mutedWords);
		if (Array.isArray(replyResult)) return checkOnly ? (replyResult.length > 0) as ReturnTypeB : replyResult as ReturnTypeB;

		const renoteResult = noteToCheck.renote && checkWordMute(noteToCheck.renote, user, mutedWords);
		if (Array.isArray(renoteResult)) return checkOnly ? (renoteResult.length > 0) as ReturnTypeB : renoteResult as ReturnTypeB;
	}

	if (checkOnly) return false as ReturnTypeB;

	if (checkForSensitiveMedia && noteToCheck.files?.some((v) => v.isSensitive)) {
		return 'sensitiveMute' as ReturnTypeB;
	}

	return false as ReturnTypeB;
}

/** MkNote, MkNoteDetailedの共通ロジック */
export function useNote(
	props: UseNoteProps,
	els: UseNoteElements = {},
	options: UseNoteOptions = {},
) {
	const inTimeline = options.inTimeline ?? false;
	const tl_withSensitive = options.tl_withSensitive ?? ref(true);
	const inChannel = options.inChannel ?? null;
	const currentClip = options.currentClip ?? null;
	const currentAntenna = options.currentAntenna ?? null;

	// プラグインの割り込み処理
	let rawNote = deepClone(props.note);
	const hideByPlugin = ref(false);
	const noteViewInterruptors = getPluginHandlers('note_view_interruptor');

	if (noteViewInterruptors.length > 0) {
		let result: Misskey.entities.Note | null = deepClone(rawNote);
		for (const interruptor of noteViewInterruptors) {
			try {
				result = interruptor.handler(result!) as Misskey.entities.Note | null;
			} catch (err) {
				console.error(err);
			}
		}
		if (result == null) {
			hideByPlugin.value = true;
		} else {
			rawNote = result as Misskey.entities.Note;
		}
	}

	// 基本状態
	const isRenote = Misskey.note.isPureRenote(rawNote);
	const appearNote = reactive(getAppearNote(rawNote) ?? rawNote);

	// キャプチャ（ストリーム購読）
	const { $note: $appearNote, subscribe: subscribeManuallyToNoteCapture } = useNoteCapture({
		note: appearNote,
		parentNote: rawNote,
		mock: props.mock,
	});

	// 各種フラグ状態
	const showContent = ref(false);
	const isDeleted = ref(false);
	const translating = ref(false);
	const translation = ref<Misskey.entities.NotesTranslateResponse | null>(null);
	const renoteChanging = ref(false);
	const reactionChanging = ref(false);
	let alive = true;
	let active = true;
	let renoteMenuOpen = false;
	const countedRenotes = new Set<string>();

	onActivated(() => { active = true; });
	onDeactivated(() => { active = false; });
	onBeforeUnmount(() => { alive = false; countedRenotes.clear(); });

	// ミュート判定
	const muted = ref($i ? calculateMuteStatus(appearNote, $i, $i.mutedWords, inTimeline && !tl_withSensitive.value) : false);
	const hardMuted = ref(props.withHardMute && $i ? calculateMuteStatus(appearNote, $i, $i.hardMutedWords, inTimeline && !tl_withSensitive.value, true) : false);

	// 計算プロパティ (Computed)
	const isMyRenote = computed(() => $i && ($i.id === rawNote.userId));
	const parsed = computed(() => appearNote.text ? mfm.parse(appearNote.text) : null);
	const urls = computed(() => parsed.value ? extractUrlFromMfm(parsed.value).filter((url) => appearNote.renote?.url !== url && appearNote.renote?.uri !== url) : null);
	const isLong = computed(() => shouldCollapsed(appearNote, urls.value ?? []));
	const collapsed = ref(appearNote.cw == null && isLong.value);
	const showTicker = computed(() => (prefer.s.instanceTicker === 'always') || (prefer.s.instanceTicker === 'remote' && appearNote.user.instance));
	const canRenote = computed(() => !isDeleted.value && !appearNote.isHidden && (['public', 'home'].includes(appearNote.visibility) || (appearNote.visibility === 'followers' && appearNote.userId === $i?.id)));
	const renoteCollapsed = ref(prefer.s.collapseRenotes && isRenote && appearNote.replyId == null && (($i && ($i.id === rawNote.userId || $i.id === appearNote.userId)) || ($appearNote.myReaction != null)));

	const pleaseLoginContext = computed<OpenOnRemoteOptions>(() => ({
		type: 'lookup',
		url: `https://${host}/notes/${appearNote.id}`,
	}));

	function actor(): NoteActionActor | null { return $i ? { id: $i.id, token: $i.token } : null; }

	function current(captured: NoteActionActor): boolean {
		return alive && active && !props.mock && !isDeleted.value && !appearNote.isHidden && props.note.id === rawNote.id && $i?.id === captured.id && $i.token === captured.token;
	}

	async function authorize(): Promise<NoteActionActor | null> {
		if (!alive || !active || props.mock || isDeleted.value || appearNote.isHidden) return null;
		const captured = actor();
		try {
			if (!(await pleaseLogin({ openOnRemote: pleaseLoginContext.value })) || !captured || !current(captured)) return null;
		} catch (error) { if (captured) reportActionError(error, captured); return null; }
		try { showMovedDialog(); } catch { return null; }
		return captured;
	}

	function reportActionError(error: unknown, captured: NoteActionActor): void {
		if (!current(captured)) return;
		const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
		const text = code === 'RATE_LIMIT_EXCEEDED' ? i18n.ts.cannotPerformTemporaryDescription
			: code === 'NO_SUCH_NOTE' || code === 'NO_SUCH_RENOTE_TARGET' ? i18n.ts.deletedNote
				: ['CANNOT_RENOTE_DUE_TO_VISIBILITY', 'YOU_HAVE_BEEN_BLOCKED', 'YOU_ARE_BLOCKING', 'ROLE_PERMISSION_DENIED', 'ACCESS_DENIED'].includes(code ?? '') ? i18n.ts.operationForbidden
					: i18n.ts.somethingHappened;
		void os.alert({ type: 'error', text });
	}

	function onRenoteCreated(note: Misskey.entities.Note, captured: NoteActionActor): void {
		if (!current(captured) || note.userId !== captured.id || note.renoteId !== appearNote.id || !note.id) return;
		if (!countedRenotes.has(note.id)) {
			countedRenotes.add(note.id);
			appearNote.renoteCount = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, appearNote.renoteCount) + 1);
			if (countedRenotes.size > 128) countedRenotes.delete(countedRenotes.values().next().value!);
		}
	}

	// グローバルイベントの監視
	useGlobalEvent('noteDeleted', (noteId) => {
		if (noteId === rawNote.id || noteId === appearNote.id) {
			isDeleted.value = true;
		}
	});
	useGlobalEvent('notePosted', note => {
		const captured = actor();
		if (captured) onRenoteCreated(note, captured);
	});

	// ツールチップのセットアップ (Mockでない場合のみ)
	if (!props.mock) {
		if (els.renoteButton != null) {
			useTooltip(els.renoteButton, async (showing) => {
				const renotes = await misskeyApi('notes/renotes', {
					noteId: appearNote.id,
					limit: 11,
				});
				const users = renotes.map(x => x.user);
				if (users.length < 1 || els.renoteButton!.value == null) return;
				const { dispose } = os.popup(MkUsersTooltip, {
					showing,
					users,
					count: appearNote.renoteCount,
					anchorElement: els.renoteButton!.value,
				}, {
					closed: () => dispose(),
				});
			});
		}

		if (appearNote.reactionAcceptance === 'likeOnly' && els.reactButton != null) {
			useTooltip(els.reactButton, async (showing) => {
				const reactions = await misskeyApiGet('notes/reactions', {
					noteId: appearNote.id,
					limit: 10,
					_cacheKey_: $appearNote.reactionCount,
				});
				const users = reactions.map(x => x.user);
				if (users.length < 1 || els.reactButton!.value == null) return;
				const { dispose } = os.popup(MkReactionsViewerDetails, {
					showing,
					reaction: '❤️',
					users,
					count: $appearNote.reactionCount,
					anchorElement: els.reactButton!.value,
				}, {
					closed: () => dispose(),
				});
			});
		}
	}

	// 共通アクション関数群
	async function renote() {
		if (props.mock || !canRenote.value || renoteMenuOpen || renoteChanging.value) return;
		renoteMenuOpen = true;
		let captured: NoteActionActor | null = null;
		try {
			captured = await authorize();
			if (!captured || !canRenote.value || els.renoteButton == null) return;
			const contextActor = captured;
			const { menu } = getRenoteMenu({
				note: rawNote,
				renoteButton: els.renoteButton,
				context: {
					actor: contextActor,
					isCurrent: () => current(contextActor) && canRenote.value,
					changing: renoteChanging,
					onCreated: note => onRenoteCreated(note, contextActor),
					onError: error => reportActionError(error, contextActor),
				},
			});
			const closed = os.popupMenu(menu, els.renoteButton.value, { appearance: 'zalip-note' });
			subscribeManuallyToNoteCapture();
			await closed;
		} catch (error) { if (captured) reportActionError(error, captured); } finally { renoteMenuOpen = false; }
	}

	async function reply() {
		const captured = await authorize();
		if (!captured) return;
		try {
			await os.post({ reply: appearNote, channel: appearNote.channel });
			if (current(captured)) focus();
		} catch (error) { reportActionError(error, captured); }
	}

	async function changeReaction(captured: NoteActionActor, reaction: string, remove = false): Promise<boolean> {
		if (!current(captured) || reactionChanging.value) return false;
		reactionChanging.value = true;
		try {
			if (remove) await misskeyApi('notes/reactions/delete', { noteId: appearNote.id }, captured.token);
			else await misskeyApi('notes/reactions/create', { noteId: appearNote.id, reaction }, captured.token);
			if (!current(captured)) return false;
			noteEvents.emit(`${remove ? 'unreacted' : 'reacted'}:${appearNote.id}`, { userId: captured.id, reaction });
			if (!remove) sound.playMisskeySfx('reaction');
			return true;
		} catch (error) { reportActionError(error, captured); return false; } finally { reactionChanging.value = false; }
	}

	async function react(customCallback?: (reaction: string) => void) {
		if (reactionChanging.value) return;
		if (props.mock) {
			if (appearNote.reactionAcceptance === 'likeOnly') customCallback?.('❤️');
			else reactionPicker.show(els.reactButton?.value ?? null, rawNote, reaction => customCallback?.(reaction), focus);
			return;
		}
		const captured = await authorize();
		if (!captured) return;
		if (appearNote.reactionAcceptance === 'likeOnly') {
			if (!(await changeReaction(captured, '❤️'))) return;
			if (els.reactButton?.value && prefer.s.animation && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
				const el = els.reactButton.value;
				const rect = el.getBoundingClientRect();
				const { dispose } = os.popup(MkRippleEffect, { x: rect.left + (el.offsetWidth / 2), y: rect.top + (el.offsetHeight / 2) }, { end: () => dispose() });
			}
			return;
		}
		blur();
		reactionPicker.show(els.reactButton?.value ?? null, rawNote, async reaction => {
			if (!current(captured)) return;
			try {
				if (prefer.s.confirmOnReact) {
					const confirm = await os.confirm({ type: 'question', text: i18n.tsx.reactAreYouSure({ emoji: reaction.replace('@.', '') }) });
					if (confirm.canceled || !current(captured)) return;
				}
				if (await changeReaction(captured, reaction)) {
					if (appearNote.text && appearNote.text.length > 100 && (Date.now() - new Date(appearNote.createdAt).getTime() < 1000 * 3)) claimAchievement('reactWithoutRead');
				}
			} catch (error) { reportActionError(error, captured); }
		}, () => { if (current(captured)) focus(); });
	}

	async function reactViaMfmEmoji(reaction: string) {
		const captured = await authorize();
		if (captured) await changeReaction(captured, reaction);
	}

	async function undoReact(): Promise<void> {
		const oldReaction = $appearNote.myReaction;
		if (!oldReaction || props.mock || reactionChanging.value) return;
		const captured = await authorize();
		if (captured && $appearNote.myReaction === oldReaction) await changeReaction(captured, oldReaction, true);
	}

	function toggleReact(customMockCallback?: (reaction: string) => void) {
		if ($appearNote.myReaction == null) {
			react(customMockCallback);
		} else {
			if (props.mock && customMockCallback) {
				customMockCallback($appearNote.myReaction);
			} else {
				undoReact();
			}
		}
	}

	function onContextmenu(ev: PointerEvent): void {
		if (props.mock) return;
		if (ev.target && isLink(ev.target as HTMLElement)) return;
		if (window.getSelection()?.toString() !== '') return;

		if (prefer.s.useReactionPickerForContextMenu) {
			ev.preventDefault();
			react();
		} else {
			const { menu, cleanup } = getNoteMenu({
				note: rawNote,
				translating,
				translation,
				currentClip: currentClip?.value,
				currentAntenna: currentAntenna?.value ?? undefined,
				appearance: 'zalip-note',
			});
			os.contextMenu(menu, ev).then(focus).finally(cleanup);
		}
	}

	function showMenu(): void {
		if (props.mock || els.menuButton == null) return;
		const { menu, cleanup } = getNoteMenu({
			note: rawNote,
			translating,
			translation,
			currentClip: currentClip?.value,
			currentAntenna: currentAntenna?.value ?? undefined,
			appearance: 'zalip-note',
		});
		os.popupMenu(menu, els.menuButton.value, { appearance: 'zalip-note' }).then(focus).finally(cleanup);
	}

	async function clip(): Promise<void> {
		if (props.mock) return;
		os.popupMenu(await getNoteClipMenu({
			note: rawNote,
			currentClip: currentClip?.value,
		}), els.clipButton?.value).then(focus);
	}

	async function showRenoteMenu() {
		if (!isRenote || renoteChanging.value) return;
		const captured = await authorize();
		if (!captured) return;

		const getUnrenote = () => ({
			text: i18n.ts.unrenote,
			icon: 'ti ti-trash',
			danger: true,
			action: async () => {
				if (!current(captured) || renoteChanging.value || !Misskey.note.isPureRenote(rawNote) || !(rawNote.userId === captured.id || $i?.isModerator || $i?.isAdmin)) return;
				renoteChanging.value = true;
				try {
					await misskeyApi('notes/delete', { noteId: rawNote.id }, captured.token);
					if (current(captured)) globalEvents.emit('noteDeleted', rawNote.id);
				} catch (error) { reportActionError(error, captured); } finally { renoteChanging.value = false; }
			},
		});

		const menuItems: MenuItem[] = [{
			type: 'link',
			text: i18n.ts.renoteDetails,
			icon: 'ti ti-info-circle',
			to: notePage(rawNote),
		}];

		if (props.note.channelId != null && (inChannel == null || props.note.channelId !== inChannel.value)) {
			menuItems.push({
				type: 'link',
				text: i18n.ts.viewRenotedChannel,
				icon: 'ti ti-device-tv',
				to: `/channels/${props.note.channelId}`,
			});
		}

		menuItems.push(getCopyNoteLinkMenu(rawNote, i18n.ts.copyLinkRenote));
		menuItems.push({ type: 'divider' });

		if (isMyRenote.value) {
			menuItems.push(getUnrenote());
			os.popupMenu(menuItems, els.renoteTime?.value);
		} else {
			menuItems.push(getAbuseNoteMenu(rawNote, i18n.ts.reportAbuseRenote));
			if ($i?.isModerator || $i?.isAdmin) {
				menuItems.push(getUnrenote());
			}

			os.popupMenu(menuItems, els.renoteTime?.value);
		}
	}

	// フォーカス制御
	function focus() { els.rootEl?.value?.focus(); }

	function blur() { els.rootEl?.value?.blur(); }

	return {
		// 状態・データ
		note: rawNote,
		appearNote,
		$appearNote,
		hideByPlugin,
		isRenote,
		showContent,
		isDeleted,
		translating,
		translation,
		muted,
		hardMuted,
		collapsed,
		renoteCollapsed,

		// 計算プロパティ
		isMyRenote,
		parsed,
		urls,
		isLong,
		showTicker,
		canRenote,

		// アクション関数
		renote,
		reply,
		react,
		reactViaMfmEmoji,
		toggleReact,
		onContextmenu,
		showMenu,
		clip,
		showRenoteMenu,
		focus,
		blur,
	};
}
